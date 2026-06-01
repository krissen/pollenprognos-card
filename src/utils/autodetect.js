// src/utils/autodetect.js
//
// Shared Home Assistant integration autodetection. Extracted from the card
// element and card editor (which previously each carried their own inline copy
// with documented behaviour divergences) so the card, card editor, badge
// element, and badge editor all detect integrations and auto-select a location
// the same way. One source of truth; the divergences (editor setConfig missing
// PLU, editor set hass missing Kleenex) are gone.
//
// Three layers, each pure and side-effect free:
//   detectIntegrationStates(hass)  -> per-integration entity-id lists + cached
//                                     discovery results
//   pickIntegration(detection,..)  -> priority pick honouring explicit/skip
//   autoSelectLocation(int,cfg,..) -> { key, value } | null for the location
//
// Plus normalizeIntegration() and detectedIntegrationIds() helpers.

import { PLU_ALIAS_MAP } from "../adapters/plu.js";
import { discoverAtmoSensors } from "../adapters/atmo.js";
import { GPL_ATTRIBUTION, discoverGplSensors } from "../adapters/gpl/index.js";
import { discoverGpSensors } from "../adapters/gp/index.js";
import { discoverMswSensors } from "../adapters/msw.js";
import {
  discoverPpSensors,
  extractCitySlugFromEntityId as extractPpCitySlugFromEntityId,
} from "../adapters/pp.js";
import { discoverDwdSensors, DWD_ENTITY_ID_RE } from "../adapters/dwd.js";
import { discoverPeuSensors } from "../adapters/peu.js";
import { discoverSilamSensors } from "./silam.js";

// Canonical autodetect priority order. The first integration with detected
// sensors (and not in `skip`) wins. Single source of truth for every consumer.
export const INTEGRATION_PRIORITY = [
  "pp",
  "plu",
  "peu",
  "dwd",
  "silam",
  "kleenex",
  "atmo",
  "gp",
  "gpl",
  "msw",
];

/**
 * Normalize an integration id from config: trim + lowercase when it's a string,
 * pass through otherwise. Previously duplicated in the card, badge, and both
 * editors.
 *
 * @param {*} value
 * @returns {*}
 */
export function normalizeIntegration(value) {
  if (value && typeof value === "string") return value.trim().toLowerCase();
  return value;
}

/**
 * Scan hass for every supported integration's sensors and run the discovery
 * helpers. Returns per-integration entity-id arrays plus discovery results so
 * callers never re-scan hass.states or re-run discovery within a single update.
 *
 * Discovery cost is preserved from the card: silam/atmo/gp run eagerly (the card
 * always did); pp/dwd/peu/gpl/msw stay behind memoized getters so large installs
 * don't gain extra registry scans per HA tick.
 *
 * @param {object} hass
 * @param {{debug?: boolean}} [opts]
 * @returns {{
 *   stateIds: string[],
 *   states: Record<string, string[]>,
 *   discovery: { silam: object, atmo: object, gp: object },
 *   getPpDiscovery: () => object,
 *   getDwdDiscovery: () => object,
 *   getPeuDiscovery: () => object,
 *   getGplDiscovery: () => object,
 *   getMswDiscovery: () => object,
 * }}
 */
export function detectIntegrationStates(hass, { debug = false } = {}) {
  const stateIds = hass && hass.states ? Object.keys(hass.states) : [];

  // PP allergen disambiguation against PLU (both can use sensor.pollen_<x>).
  const pluAllergenSlugs = new Set(Object.values(PLU_ALIAS_MAP).flat());

  const ppStates = stateIds.filter((id) => {
    if (typeof id !== "string") return false;
    if (!id.startsWith("sensor.pollen_")) return false;
    if (id.startsWith("sensor.pollenflug_")) return false;
    // Exclude MSW (hass-swissweather): sensor.pollen_<allergen>_level_at_<station>
    if (id.includes("_level_at_")) return false;

    // Match manual mode (sensor.pollen_<allergen>) and city mode
    // (sensor.pollen_<allergen>_<city>).
    const match = /^sensor\.pollen_([^_]+)(_.*)?$/.exec(id);
    if (!match) return false;

    const allergenSlug = match[1];
    // Single underscore AND a known PLU allergen -> likely PLU, not PP.
    if (!match[2] && pluAllergenSlugs.has(allergenSlug)) return false;

    return true;
  });

  // DWD: match the pollenflug_<allergen>_<region> segment whether or not HA has
  // prepended a device-name slug (#217).
  const dwdStates = stateIds.filter(
    (id) => typeof id === "string" && DWD_ENTITY_ID_RE.test(id),
  );

  const peuStates = stateIds.filter(
    (id) => typeof id === "string" && id.startsWith("sensor.polleninformation_"),
  );

  // SILAM: primary via discovery, fallback via regex.
  const silamDiscovery = discoverSilamSensors(hass, debug);
  let silamStates = [];
  if (silamDiscovery.locations.size > 0) {
    for (const [, loc] of silamDiscovery.locations) {
      for (const eid of loc.sensors.values()) silamStates.push(eid);
    }
  }
  if (!silamStates.length) {
    silamStates = stateIds.filter(
      (id) => typeof id === "string" && id.startsWith("sensor.silam_pollen_"),
    );
  }

  const kleenexStates = stateIds.filter(
    (id) =>
      typeof id === "string" && id.startsWith("sensor.kleenex_pollen_radar_"),
  );

  const pluStates = stateIds.filter((id) => {
    if (typeof id !== "string") return false;
    const match = /^sensor\.pollen_([^_]+)$/.exec(id);
    if (!match) return false;
    return pluAllergenSlugs.has(match[1]);
  });

  // ATMO: primary via discovery (prefixed entity IDs + device-based), fallback
  // to regex for older HA registries.
  const atmoDiscovery = discoverAtmoSensors(hass, debug);
  let atmoStates = [];
  if (atmoDiscovery.locations.size > 0) {
    for (const [, loc] of atmoDiscovery.locations) {
      for (const eid of loc.entities.values()) atmoStates.push(eid);
    }
  }
  if (!atmoStates.length) {
    // Legacy fallback. Matches current niveau_{slug} and legacy
    // niveau_alerte_{slug}.
    atmoStates = stateIds.filter(
      (id) =>
        typeof id === "string" &&
        /^sensor\.(?:niveau_(?:alerte_)?(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)|(?:pm25|pm10|ozone|dioxyde_d_azote|dioxyde_de_soufre)|qualite_globale(?:_pollen)?)_/.test(
          id,
        ) &&
        !/_j_\d+$/.test(id),
    );
  }

  // GPL: hass.entities platform (primary) or attribution (fallback).
  let gplStates = [];
  if (hass && hass.entities) {
    gplStates = Object.entries(hass.entities)
      .filter(
        ([, entry]) =>
          entry.platform === "pollenlevels" && !entry.entity_category,
      )
      .map(([eid]) => eid);
  }
  if (!gplStates.length) {
    gplStates = stateIds.filter((id) => {
      const s = hass.states[id];
      return (
        s?.attributes?.attribution === GPL_ATTRIBUTION &&
        s.attributes.device_class !== "date" &&
        s.attributes.device_class !== "timestamp"
      );
    });
  }

  // GP (svenove/google_pollen): full discovery; state list derived from it.
  const gpDiscovery = discoverGpSensors(hass, debug);
  let gpStates = [];
  if (gpDiscovery.locations.size > 0) {
    for (const [, loc] of gpDiscovery.locations) {
      for (const eid of loc.entities.values()) gpStates.push(eid);
    }
  }
  if (!gpStates.length) {
    if (hass && hass.entities) {
      gpStates = Object.entries(hass.entities)
        .filter(
          ([, entry]) =>
            entry.platform === "google_pollen" && !entry.entity_category,
        )
        .map(([eid]) => eid);
    }
    if (!gpStates.length) {
      gpStates = stateIds.filter(
        (id) => typeof id === "string" && id.startsWith("sensor.google_pollen_"),
      );
    }
  }

  // MSW (MeteoSwiss / hass-swissweather). Entity IDs follow
  // sensor.<device-slug>_pollen_<allergen>_level_at_<station>; the device-slug
  // prefix is added by HA and varies per install. Primary via hass.entities
  // platform check; fallback regex for older registries.
  const mswLevelRe =
    /(?:^|_)pollen_(?:birch|grasses|alder|hazel|beech|ash|oak)_level_at_/;
  let mswStates = [];
  if (hass && hass.entities) {
    mswStates = Object.entries(hass.entities)
      .filter(
        ([eid, entry]) =>
          entry.platform === "swissweather" &&
          !entry.entity_category &&
          mswLevelRe.test(eid),
      )
      .map(([eid]) => eid);
  }
  if (!mswStates.length) {
    mswStates = stateIds.filter(
      (id) =>
        typeof id === "string" &&
        /^sensor\.(?:\w+_)*pollen_(?:birch|grasses|alder|hazel|beech|ash|oak)_level_at_/.test(
          id,
        ),
    );
  }

  // Lazy/memoized discoveries for adapters whose header label / location
  // resolution would otherwise re-scan the registry. SILAM/Atmo/GP are already
  // computed above; PP/DWD/PEU/GPL/MSW go behind getters so callers that only
  // need the state lists don't pay for the scan.
  let _ppDiscovery = null;
  let _dwdDiscovery = null;
  let _peuDiscovery = null;
  let _gplDiscovery = null;
  let _mswDiscovery = null;
  const getPpDiscovery = () => {
    if (_ppDiscovery === null) _ppDiscovery = discoverPpSensors(hass, debug);
    return _ppDiscovery;
  };
  const getDwdDiscovery = () => {
    if (_dwdDiscovery === null) _dwdDiscovery = discoverDwdSensors(hass, debug);
    return _dwdDiscovery;
  };
  const getPeuDiscovery = () => {
    if (_peuDiscovery === null) _peuDiscovery = discoverPeuSensors(hass, debug);
    return _peuDiscovery;
  };
  const getGplDiscovery = () => {
    if (_gplDiscovery === null) _gplDiscovery = discoverGplSensors(hass, debug);
    return _gplDiscovery;
  };
  const getMswDiscovery = () => {
    if (_mswDiscovery === null) _mswDiscovery = discoverMswSensors(hass, debug);
    return _mswDiscovery;
  };

  if (debug) {
    console.debug("Sensor states detected:");
    console.debug("PP:", ppStates);
    console.debug("DWD:", dwdStates);
    console.debug("PEU:", peuStates);
    console.debug("SILAM:", silamStates);
    console.debug("KLEENEX:", kleenexStates);
    console.debug("PLU:", pluStates);
    console.debug("ATMO:", atmoStates);
    console.debug("GPL:", gplStates);
    console.debug("GP:", gpStates);
    console.debug("MSW:", mswStates);
  }

  return {
    stateIds,
    states: {
      pp: ppStates,
      dwd: dwdStates,
      peu: peuStates,
      silam: silamStates,
      kleenex: kleenexStates,
      plu: pluStates,
      atmo: atmoStates,
      gpl: gplStates,
      gp: gpStates,
      msw: mswStates,
    },
    discovery: { silam: silamDiscovery, atmo: atmoDiscovery, gp: gpDiscovery },
    getPpDiscovery,
    getDwdDiscovery,
    getPeuDiscovery,
    getGplDiscovery,
    getMswDiscovery,
  };
}

/**
 * Ordered Set of integration ids that have detected sensors, in canonical
 * priority order. Powers the editor integration dropdown's "installed first"
 * sort.
 *
 * @param {ReturnType<typeof detectIntegrationStates>} detection
 * @returns {Set<string>}
 */
export function detectedIntegrationIds(detection) {
  const out = new Set();
  if (!detection || !detection.states) return out;
  for (const id of INTEGRATION_PRIORITY) {
    if (detection.states[id] && detection.states[id].length) out.add(id);
  }
  return out;
}

/**
 * Pick the active integration. When `explicit` is set, the user's integration
 * wins unchanged (autodetect never overrides an explicit choice). Otherwise the
 * first integration in INTEGRATION_PRIORITY with detected sensors and not in
 * `skip` is chosen.
 *
 * @param {ReturnType<typeof detectIntegrationStates>} detection
 * @param {{explicit?: boolean, userIntegration?: *, skip?: Set<string>}} [opts]
 * @returns {string|undefined}
 */
export function pickIntegration(
  detection,
  { explicit = false, userIntegration, skip } = {},
) {
  const normalized = normalizeIntegration(userIntegration);
  if (explicit) return normalized;

  const states = detection?.states || {};
  const skipSet = skip || new Set();
  for (const id of INTEGRATION_PRIORITY) {
    if (states[id] && states[id].length && !skipSet.has(id)) return id;
  }
  // Nothing detected: keep whatever the user had (may be undefined).
  return normalized;
}

/**
 * Compute the location/city/region value to auto-select for an integration.
 * Pure: returns { key, value } (e.g. {key:"city", value:"stockholm"}) or null.
 * Callers apply the value under their own guards (typically
 * cfg[key] !== "manual" && !cfg[key] && states.length) so "manual" mode and
 * already-set values are honoured at the call site.
 *
 * @param {string} integration
 * @param {object} cfg              current config (read-only here)
 * @param {object} hass
 * @param {ReturnType<typeof detectIntegrationStates>} detection
 * @returns {{key: string, value: *}|null}
 */
export function autoSelectLocation(integration, cfg, hass, detection) {
  const states = detection?.states || {};

  if (integration === "dwd" && states.dwd?.length) {
    const value = Array.from(
      new Set(states.dwd.map((id) => id.split("_").pop())),
    ).sort((a, b) => Number(a) - Number(b))[0];
    return value != null ? { key: "region_id", value } : null;
  }

  if (integration === "pp" && states.pp?.length) {
    // Use the PP adapter's extractor (PP_ALLERGEN_SLUGS suffix whitelist) so
    // allergens whose slug contains underscores (e.g. "salg_och_viden") and
    // manual-mode sensors are handled correctly; a naive `_[^_]+$` split would
    // mis-derive the city. Pick the first sensor that yields a real city slug.
    for (const id of states.pp) {
      const value = extractPpCitySlugFromEntityId(id);
      if (value) return { key: "city", value };
    }
    return null;
  }

  if (integration === "peu" && states.peu?.length) {
    const peuLocations = Array.from(
      new Set(
        states.peu
          .map((eid) => hass.states[eid]?.attributes?.location_slug || null)
          .filter(Boolean),
      ),
    );
    return { key: "location", value: peuLocations[0] || null };
  }

  if (integration === "silam" && states.silam?.length) {
    const silamDiscovery = detection.discovery.silam;
    if (silamDiscovery.locations.size > 0) {
      const firstLocId = silamDiscovery.locations.keys().next().value;
      return { key: "location", value: firstLocId || null };
    }
    const silamLocations = Array.from(
      new Set(
        states.silam
          .map((eid) => {
            const m = eid.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
            return m ? m[1] : null;
          })
          .filter(Boolean),
      ),
    );
    return { key: "location", value: silamLocations[0] || null };
  }

  if (integration === "kleenex" && states.kleenex?.length) {
    const kleenexDateSensors = detection.stateIds.filter(
      (id) =>
        typeof id === "string" &&
        id.match(/^sensor\.kleenex_pollen_radar_.+_date$/),
    );
    const kleenexLocations = Array.from(
      new Set(
        kleenexDateSensors
          .map((eid) => {
            const m = eid.match(/^sensor\.kleenex_pollen_radar_(.+)_date$/);
            return m ? m[1] : null;
          })
          .filter(Boolean),
      ),
    );
    return { key: "location", value: kleenexLocations[0] || null };
  }

  if (integration === "atmo" && states.atmo?.length) {
    const atmoLocations = Array.from(
      new Set(
        states.atmo
          .map((eid) => {
            const m = eid.match(
              /^sensor\.niveau_(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)_(.+?)(?:_j_\d+)?$/,
            );
            return m ? m[1] : null;
          })
          .filter(Boolean),
      ),
    );
    return { key: "location", value: atmoLocations[0] || null };
  }

  if (integration === "gpl" && states.gpl?.length) {
    const gplDiscovery = detection.getGplDiscovery();
    const firstLocId = gplDiscovery.locations.keys().next().value;
    return { key: "location", value: firstLocId || null };
  }

  if (integration === "gp" && states.gp?.length) {
    const gpDiscovery = detection.discovery.gp;
    const firstLocId = gpDiscovery.locations.keys().next().value;
    return firstLocId ? { key: "location", value: firstLocId } : null;
  }

  if (integration === "msw" && states.msw?.length) {
    const mswDiscovery = detection.getMswDiscovery();
    const firstLocId = mswDiscovery.locations.keys().next().value;
    return firstLocId ? { key: "location", value: firstLocId } : null;
  }

  return null;
}
