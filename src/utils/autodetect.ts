// src/utils/autodetect.ts
//
// Shared Home Assistant integration autodetection. Extracted from the card
// element and card editor (which previously each carried their own inline copy
// with documented behaviour divergences) so the card, card editor, badge
// element, and badge editor all detect integrations and auto-select a location
// the same way. One source of truth; the divergences (editor setConfig missing
// PLU, editor set hass missing Kleenex) are gone.
//
// This module is a pure orchestrator: every integration's detection knowledge
// (entity-id regexes, platform checks, attribution strings, alias
// disambiguation, discovery wrappers, legacy slug extraction) lives in the
// adapter's autodetect descriptor and is consumed uniformly via the registry
// (`getAutodetect`/`getAllAutodetect`). No adapter internals are imported here.
//
// Three layers, each pure and side-effect free:
//   detectIntegrationStates(hass)  -> per-integration entity-id lists + cached
//                                     discovery results
//   pickIntegration(detection,..)  -> priority pick honouring explicit/skip
//   autoSelectLocation(int,cfg,..) -> { key, value } | null for the location
//
// Plus normalizeIntegration() and detectedIntegrationIds() helpers.

import type { HomeAssistant } from "../types/home-assistant.js";
import type { CardConfig } from "../types/config.js";
import type {
  AutodetectContext,
  AutodetectDiscovery,
} from "../types/adapter.js";
import { getAutodetect, getAllAutodetect } from "../adapter-registry.js";

/** A location auto-selection: which config key to set and to what value. */
export type LocationResult = { key: string; value: unknown } | null;

/**
 * The cached result of a detection pass. Preserves the exact shape the card,
 * editors and badge consume: per-integration entity-id lists, the eagerly
 * computed silam/atmo/gp discovery, and lazily memoized discovery getters for
 * the remaining integrations.
 */
export interface DetectionResult {
  stateIds: string[];
  states: Record<string, string[]>;
  // silam/atmo/gp/kleenex run their discovery eagerly during detection (their
  // descriptors always return it), so these are always present.
  discovery: {
    silam: AutodetectDiscovery;
    atmo: AutodetectDiscovery;
    gp: AutodetectDiscovery;
    kleenex: AutodetectDiscovery;
  };
  getPpDiscovery: () => AutodetectDiscovery;
  getDwdDiscovery: () => AutodetectDiscovery;
  getPeuDiscovery: () => AutodetectDiscovery;
  getGplDiscovery: () => AutodetectDiscovery;
  getMswDiscovery: () => AutodetectDiscovery;
  getIrmkmiDiscovery: () => AutodetectDiscovery;
}

// Canonical autodetect priority order, derived from the descriptor registry so
// there is a single source of truth. The first integration with detected
// sensors (and not in `skip`) wins. Order:
//   PP > PLU > PEU > DWD > SILAM > Kleenex > ATMO > GP > GPL > MSW > IRMKMI
export const INTEGRATION_PRIORITY: string[] = getAllAutodetect().map(
  ([id]) => id,
);

/**
 * Normalize an integration id from config: trim + lowercase when it's a string,
 * pass through otherwise. Previously duplicated in the card, badge, and both
 * editors.
 */
export function normalizeIntegration(value: unknown): unknown {
  if (value && typeof value === "string") return value.trim().toLowerCase();
  return value;
}

/**
 * Build a memoized discovery getter for an integration: runs the adapter's
 * `discover` at most once, caching the result. Integrations without a
 * `discover` yield an empty discovery.
 */
function makeLazyDiscovery(
  id: string,
  hass: HomeAssistant,
  debug: boolean,
): () => AutodetectDiscovery {
  let cached: AutodetectDiscovery | null = null;
  return () => {
    if (cached === null) {
      const desc = getAutodetect(id);
      cached = desc?.discover
        ? desc.discover(hass, debug)
        : { locations: new Map() };
    }
    return cached;
  };
}

/**
 * Scan hass for every supported integration's sensors and run the discovery
 * helpers. Returns per-integration entity-id arrays plus discovery results so
 * callers never re-scan hass.states or re-run discovery within a single update.
 *
 * Discovery cost is preserved from the card: silam/atmo/gp run eagerly (their
 * descriptors return the discovery they computed during detection); the
 * remaining integrations stay behind memoized getters so large installs don't
 * gain extra registry scans per HA tick.
 */
export function detectIntegrationStates(
  hass: HomeAssistant,
  { debug = false }: { debug?: boolean } = {},
): DetectionResult {
  const stateIds =
    hass && hass.states ? Object.keys(hass.states as object) : [];

  // PP allergen disambiguation against PLU (both can use sensor.pollen_<x>).
  const pluAllergenSlugs =
    getAutodetect("plu")?.allergenSlugs ?? new Set<string>();
  const ctx: AutodetectContext = { stateIds, pluAllergenSlugs };

  const states: Record<string, string[]> = {};
  const eagerDiscovery: Record<string, AutodetectDiscovery> = {};

  // Detect every integration uniformly, in priority order. Descriptors that run
  // discovery eagerly (silam/atmo/gp) return it so it isn't recomputed below.
  for (const [id, desc] of getAllAutodetect()) {
    const result = desc.detectStates(hass, ctx, debug);
    states[id] = result.ids;
    if (result.discovery) eagerDiscovery[id] = result.discovery;
  }

  // Preserve the { silam, atmo, gp, kleenex } discovery shape consumers read
  // directly. These descriptors always run discovery eagerly, so the entries
  // are present.
  const emptyDiscovery: AutodetectDiscovery = { locations: new Map() };
  const discovery: DetectionResult["discovery"] = {
    silam: eagerDiscovery.silam ?? emptyDiscovery,
    atmo: eagerDiscovery.atmo ?? emptyDiscovery,
    gp: eagerDiscovery.gp ?? emptyDiscovery,
    kleenex: eagerDiscovery.kleenex ?? emptyDiscovery,
  };

  // Lazy/memoized discoveries for adapters whose header label / location
  // resolution would otherwise re-scan the registry.
  const getPpDiscovery = makeLazyDiscovery("pp", hass, debug);
  const getDwdDiscovery = makeLazyDiscovery("dwd", hass, debug);
  const getPeuDiscovery = makeLazyDiscovery("peu", hass, debug);
  const getGplDiscovery = makeLazyDiscovery("gpl", hass, debug);
  const getMswDiscovery = makeLazyDiscovery("msw", hass, debug);
  const getIrmkmiDiscovery = makeLazyDiscovery("irmkmi", hass, debug);

  if (debug) {
    console.debug("Sensor states detected:");
    for (const id of INTEGRATION_PRIORITY) {
      console.debug(`${id.toUpperCase()}:`, states[id]);
    }
  }

  return {
    stateIds,
    states,
    discovery,
    getPpDiscovery,
    getDwdDiscovery,
    getPeuDiscovery,
    getGplDiscovery,
    getMswDiscovery,
    getIrmkmiDiscovery,
  };
}

/**
 * Ordered Set of integration ids that have detected sensors, in canonical
 * priority order. Powers the editor integration dropdown's "installed first"
 * sort.
 */
export function detectedIntegrationIds(
  detection: DetectionResult | null | undefined,
): Set<string> {
  const out = new Set<string>();
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
 */
export function pickIntegration(
  detection: DetectionResult | null | undefined,
  {
    explicit = false,
    userIntegration,
    skip,
  }: { explicit?: boolean; userIntegration?: unknown; skip?: Set<string> } = {},
): string | undefined {
  const normalized = normalizeIntegration(userIntegration) as
    | string
    | undefined;
  if (explicit) return normalized;

  const states = detection?.states || {};
  const skipSet = skip || new Set<string>();
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
 */
export function autoSelectLocation(
  integration: string,
  _cfg: CardConfig | Record<string, unknown>,
  hass: HomeAssistant,
  detection: DetectionResult,
): LocationResult {
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
    const extract = getAutodetect("pp")?.extractLocationSlug;
    for (const id of states.pp) {
      const value = extract?.(id);
      if (value) return { key: "city", value };
    }
    return null;
  }

  if (integration === "peu" && states.peu?.length) {
    const peuLocations = Array.from(
      new Set(
        states.peu
          .map(
            (eid) => hass.states[eid]?.attributes?.location_slug || null,
          )
          .filter(Boolean),
      ),
    );
    const value = peuLocations[0];
    return value ? { key: "location", value } : null;
  }

  if (integration === "silam" && states.silam?.length) {
    const silamDiscovery = detection.discovery.silam;
    if (silamDiscovery && silamDiscovery.locations.size > 0) {
      const firstLocId = silamDiscovery.locations.keys().next().value;
      return firstLocId ? { key: "location", value: firstLocId } : null;
    }
    const extract = getAutodetect("silam")?.extractLocationSlug;
    const silamLocations = Array.from(
      new Set(
        states.silam.map((eid) => extract?.(eid) || null).filter(Boolean),
      ),
    );
    const value = silamLocations[0];
    return value ? { key: "location", value } : null;
  }

  if (integration === "kleenex" && states.kleenex?.length) {
    // Registry discovery first: entity IDs lose both the `radar_` prefix and
    // the location slug once the device is renamed (issue #309), so the
    // `_date`-sensor regex below only works on legacy installs.
    const kleenexDiscovery = detection.discovery.kleenex;
    if (kleenexDiscovery && kleenexDiscovery.locations.size > 0) {
      const firstLocId = kleenexDiscovery.locations.keys().next().value;
      if (firstLocId) return { key: "location", value: firstLocId };
    }
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
    const value = kleenexLocations[0];
    return value ? { key: "location", value } : null;
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
    const value = atmoLocations[0];
    return value ? { key: "location", value } : null;
  }

  if (integration === "gpl" && states.gpl?.length) {
    const gplDiscovery = detection.getGplDiscovery();
    const firstLocId = gplDiscovery.locations.keys().next().value;
    return firstLocId ? { key: "location", value: firstLocId } : null;
  }

  if (integration === "gp" && states.gp?.length) {
    const gpDiscovery = detection.discovery.gp;
    const firstLocId = gpDiscovery?.locations.keys().next().value;
    return firstLocId ? { key: "location", value: firstLocId } : null;
  }

  if (integration === "msw" && states.msw?.length) {
    const mswDiscovery = detection.getMswDiscovery();
    const firstLocId = mswDiscovery.locations.keys().next().value;
    return firstLocId ? { key: "location", value: firstLocId } : null;
  }

  if (integration === "irmkmi" && states.irmkmi?.length) {
    const irmkmiDiscovery = detection.getIrmkmiDiscovery();
    const firstLocId = irmkmiDiscovery.locations.keys().next().value;
    return firstLocId ? { key: "location", value: firstLocId } : null;
  }

  return null;
}

/**
 * Find the location key of the discovery entry that owns a specific entity id.
 * Works for every discovery shape used here: device-based discoveries expose
 * `entities` (Map<key, entityId>), SILAM exposes `sensors` (Map) plus an
 * optional `weatherEntity`. Returns the location map key (the same value
 * autoSelectLocation returns as `value`) or null.
 */
function findLocationKeyInDiscovery(
  discovery: AutodetectDiscovery | null | undefined,
  entityId: string,
): string | null {
  if (!discovery || !discovery.locations) return null;
  for (const [key, loc] of discovery.locations) {
    if (!loc) continue;
    if (loc.weatherEntity === entityId) return key;
    for (const map of [loc.entities, loc.sensors]) {
      if (map && typeof map.values === "function") {
        for (const eid of map.values()) {
          if (eid === entityId) return key;
        }
      }
    }
  }
  return null;
}

/**
 * Per-entity sibling of autoSelectLocation: derive the location/city/region of a
 * SPECIFIC entity id (not the integration's first location). Used by the card
 * picker suggestion so picking sensor.pollen_stockholm_bjork yields a Stockholm
 * card. Returns { key, value } or null when the entity's location can't be
 * derived (caller falls back to autoSelectLocation).
 *
 * Mirrors the per-integration logic in autoSelectLocation; discovery-based
 * integrations (gp/gpl/msw/silam-discovery/atmo) resolve via
 * findLocationKeyInDiscovery, id-pattern integrations via their adapter
 * descriptors' extractLocationSlug or inline regexes.
 */
export function deriveLocationForEntity(
  integration: string,
  entityId: string,
  hass: HomeAssistant,
  detection: DetectionResult,
): LocationResult {
  if (typeof integration !== "string" || typeof entityId !== "string")
    return null;

  switch (integration) {
    case "pp": {
      const value = getAutodetect("pp")?.extractLocationSlug?.(entityId);
      return value ? { key: "city", value } : null;
    }

    case "dwd": {
      const value = getAutodetect("dwd")?.extractLocationSlug?.(entityId);
      return value ? { key: "region_id", value } : null;
    }

    case "peu": {
      // Prefer the integration's own location_slug attribute; fall back to the
      // PEU adapter's entity-id slug extractor so multi-location installs that
      // don't expose the (optional) attribute still pin the picked location.
      const value =
        hass?.states?.[entityId]?.attributes?.location_slug ||
        getAutodetect("peu")?.extractLocationSlug?.(entityId);
      return value ? { key: "location", value } : null;
    }

    case "atmo": {
      // The niveau_{allergen}_{slug} regex gives the precise per-entity slug,
      // which the adapter resolves in both modern (config-entry) and
      // legacy/no-registry setups via its legacy-slug path -- mirroring
      // autoSelectLocation. Prefer it. Only non-niveau entities (pollution /
      // summary) need the discovery key, and we never return the tier-3
      // "default" merge bucket (it pins every location to one colliding key).
      const m = entityId.match(
        /^sensor\.niveau_(?:alerte_)?(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)_(.+?)(?:_j_\d+)?$/,
      );
      if (m) return { key: "location", value: m[1] };
      const fromDiscovery = findLocationKeyInDiscovery(
        detection?.discovery?.atmo,
        entityId,
      );
      return fromDiscovery && fromDiscovery !== "default"
        ? { key: "location", value: fromDiscovery }
        : null;
    }

    case "silam": {
      const fromDiscovery = findLocationKeyInDiscovery(
        detection?.discovery?.silam,
        entityId,
      );
      if (fromDiscovery) return { key: "location", value: fromDiscovery };
      const value = getAutodetect("silam")?.extractLocationSlug?.(entityId);
      return value ? { key: "location", value } : null;
    }

    case "kleenex": {
      // Registry discovery owns the entity -> location mapping whenever it
      // found anything; it also classifies out the diagnostic sensors, so a
      // hit is always a renderable pollen sensor.
      const fromDiscovery = findLocationKeyInDiscovery(
        detection?.discovery?.kleenex,
        entityId,
      );
      if (fromDiscovery) return { key: "location", value: fromDiscovery };

      // Legacy fallback (no registry exposed). Location can contain
      // underscores, so match against the known location set derived from the
      // `..._date` sensors and pick the longest prefix that owns this entity.
      const dateSensors = (detection?.stateIds || []).filter(
        (id) =>
          typeof id === "string" &&
          /^sensor\.kleenex_pollen_radar_.+_date$/.test(id),
      );
      const locations = Array.from(
        new Set(
          dateSensors
            .map((eid) => {
              const m = eid.match(/^sensor\.kleenex_pollen_radar_(.+)_date$/);
              return m ? m[1] : null;
            })
            .filter(Boolean),
        ),
      ) as string[];
      let best: string | null = null;
      for (const loc of locations) {
        const prefix = `sensor.kleenex_pollen_radar_${loc}_`;
        if (
          entityId === `sensor.kleenex_pollen_radar_${loc}_date` ||
          entityId.startsWith(prefix)
        ) {
          if (!best || loc.length > best.length) best = loc;
        }
      }
      if (!best) return null;
      // Reject diagnostic helper sensors (date/last_updated/region); only
      // category/detail sensors are renderable pollen data.
      const rest = entityId.slice(
        `sensor.kleenex_pollen_radar_${best}_`.length,
      );
      const KLEENEX_DIAGNOSTIC_SUFFIXES = new Set([
        "date",
        "last_updated",
        "region",
      ]);
      if (!rest || KLEENEX_DIAGNOSTIC_SUFFIXES.has(rest)) return null;
      return { key: "location", value: best };
    }

    case "gp": {
      const value = findLocationKeyInDiscovery(
        detection?.discovery?.gp,
        entityId,
      );
      return value ? { key: "location", value } : null;
    }

    case "gpl": {
      const value = findLocationKeyInDiscovery(
        detection?.getGplDiscovery?.(),
        entityId,
      );
      return value ? { key: "location", value } : null;
    }

    case "msw": {
      const value = findLocationKeyInDiscovery(
        detection?.getMswDiscovery?.(),
        entityId,
      );
      return value ? { key: "location", value } : null;
    }

    case "irmkmi": {
      const value = findLocationKeyInDiscovery(
        detection?.getIrmkmiDiscovery?.(),
        entityId,
      );
      return value ? { key: "location", value } : null;
    }

    default:
      return null;
  }
}

/**
 * Build a card-picker suggestion for a picked entity id (HA 2026.6
 * window.customCards getEntitySuggestion). Reverse-maps the entity to one of our
 * integrations, derives its specific location, and returns a config the picker
 * can drop in. Only sensor.* and weather.* entities pass the initial guard
 * (weather.* supports SILAM weather-only installs, including renamed weather
 * entities); any entity not owned by a known pollen integration -- including
 * weather.* entities that aren't SILAM's -- then returns null, so we never
 * clutter the picker.
 */
export function suggestEntityConfig(
  hass: HomeAssistant,
  entityId: string,
): { config: Record<string, unknown> } | null {
  // Pollen sensors live on sensor.*; SILAM weather-only installs expose the
  // allergy_risk index via a weather.* entity that detection/discovery already
  // recognise, so let that domain through too.
  if (
    typeof entityId !== "string" ||
    !(entityId.startsWith("sensor.") || entityId.startsWith("weather."))
  )
    return null;
  if (!hass || !hass.states) return null;

  const detection = detectIntegrationStates(hass);

  let integration: string | undefined;
  for (const id of INTEGRATION_PRIORITY) {
    if (detection.states[id]?.includes(entityId)) {
      integration = id;
      break;
    }
  }
  if (!integration) return null;

  const derived = deriveLocationForEntity(
    integration,
    entityId,
    hass,
    detection,
  );

  // For gpl/gp/msw/irmkmi/kleenex a null derivation means the entity isn't a
  // render-usable pollen sensor at the resolved location: gpl/gp/msw include
  // sibling summary/helper sensors (e.g. plants_in_season_today,
  // top_pollen_types_today) the discovery classifier skips, and kleenex
  // includes diagnostic helpers (_date, _last_updated, _region). msw/irmkmi are
  // multi-location, so falling back to autoSelectLocation's first-location
  // guess would pick the wrong location. For all of these, a renderable sensor
  // always yields a per-entity derivation, so a null derivation means we should
  // offer no suggestion rather than a wrong one.
  const STRICT_DERIVATION = new Set(["gpl", "gp", "msw", "irmkmi", "kleenex"]);
  if (!derived && STRICT_DERIVATION.has(integration)) return null;

  const loc = derived || autoSelectLocation(integration, {}, hass, detection);

  const config: Record<string, unknown> = {
    type: "custom:pollenprognos-card",
    integration,
    ...(loc ? { [loc.key]: loc.value } : {}),
  };

  return { config };
}
