// src/adapters/atmo.js
import { t } from "../i18n.js";
import { toCanonicalAllergenKey } from "../constants.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, clampLevel, meetsThreshold, resolveAllergenNames, normalizeManualPrefix, resolveManualEntity, discoverEntitiesByDevice, findLocationBySlug } from "../utils/adapter-helpers.js";

// Mapping from canonical allergen names to French entity slugs used by Atmo France
export const ATMO_ALLERGEN_MAP = {
  // Pollen
  ragweed: "ambroisie",
  mugwort: "armoise",
  alder: "aulne",
  birch: "bouleau",
  grass: "gramine",
  olive: "olivier",
  allergy_risk: "qualite_globale_pollen",
  // Pollution
  pm25: "pm25",
  pm10: "pm10",
  ozone: "ozone",
  no2: "dioxyde_d_azote",
  so2: "dioxyde_de_soufre",
  qualite_globale: "qualite_globale",
};

// Pollution allergens use a different entity pattern (no "niveau_" prefix)
export const ATMO_POLLUTION_ALLERGENS = new Set(["pm25", "pm10", "ozone", "no2", "so2"]);

// Summary indices (always pinned at top when allergy_risk_top is set)
const ATMO_SUMMARY_KEYS = new Set(["allergy_risk", "qualite_globale"]);

export const stubConfigATMO = {
  integration: "atmo",
  location: "",
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    "allergy_risk", "qualite_globale",
    "ragweed", "mugwort", "alder", "birch", "grass", "olive",
    "pm25", "pm10", "ozone", "no2", "so2",
  ],
  minimal: false,
  minimal_gap: 35,
  background_color: "",
  icon_size: "48",
  text_size_ratio: 1,
  ...LEVELS_DEFAULTS,
  show_text_allergen: true,
  show_value_text: true,
  show_value_numeric: false,
  show_value_numeric_in_circle: false,
  show_empty_days: false,
  debug: false,
  show_version: true,
  days_to_show: 2,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 1,
  sort: "value_descending",
  allergy_risk_top: true,
  sort_pollution_block: true,
  pollution_block_position: "bottom",
  show_block_separator: false,
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  phrases: {
    full: {},
    short: {},
    levels: [],
    days: {},
    no_information: "",
  },
};

export const ATMO_ALLERGENS = [...stubConfigATMO.allergens];

/**
 * Classify an Atmo France entity by its entity_id.
 * Returns the canonical allergen key (e.g. "birch", "pm25") or null.
 */
function classifyAtmoEntity(entityId) {
  const id = entityId.replace(/^sensor\./, "");

  // Summary entities (most specific first)
  if (id.includes("qualite_globale_pollen")) return "allergy_risk";
  if (id.includes("qualite_globale") && !id.includes("qualite_globale_pollen")) return "qualite_globale";

  // Pollen: niveau_{fr_slug} (current) or legacy niveau_alerte_{fr_slug}.
  // Tier 2/3 discovery uses this classifier, so covering the legacy pattern
  // keeps them consistent with classifyAtmoEntityRelaxed (used by tier 1).
  for (const [canonical, frSlug] of Object.entries(ATMO_ALLERGEN_MAP)) {
    if (canonical === "allergy_risk" || canonical === "qualite_globale") continue;
    if (ATMO_POLLUTION_ALLERGENS.has(canonical)) continue;
    if (id.includes(`niveau_${frSlug}`) || id.includes(`niveau_alerte_${frSlug}`)) return canonical;
  }

  // Pollution: {fr_slug} without niveau_ or concentration_ prefix
  for (const canonical of ATMO_POLLUTION_ALLERGENS) {
    const frSlug = ATMO_ALLERGEN_MAP[canonical];
    if (id.includes(frSlug) && !id.includes(`niveau_${frSlug}`) && !id.includes(`concentration_${frSlug}`)) {
      return canonical;
    }
  }

  return null;
}

/**
 * Relaxed classifier for entities already known to belong to an Atmo France device.
 * Unlike classifyAtmoEntity(), pollen entities don't need the "niveau_" prefix;
 * the allergen slug alone suffices (e.g. "ambroisie"), as long as it's not
 * a concentration entity.
 */
export function classifyAtmoEntityRelaxed(entityId) {
  const id = entityId.replace(/^sensor\./, "");

  // Summary entities (most specific first)
  if (id.includes("qualite_globale_pollen")) return "allergy_risk";
  if (id.includes("qualite_globale") && !id.includes("qualite_globale_pollen")) return "qualite_globale";

  // Pollen, first pass: prefer explicit niveau_{slug} segment so that user
  // prefixes which happen to contain an allergen slug don't misclassify.
  for (const [canonical, frSlug] of Object.entries(ATMO_ALLERGEN_MAP)) {
    if (canonical === "allergy_risk" || canonical === "qualite_globale") continue;
    if (ATMO_POLLUTION_ALLERGENS.has(canonical)) continue;
    if (new RegExp(`(?:^|_)niveau_${frSlug}(?:_|$)`).test(id)) return canonical;
  }

  // Pollen, second pass: relaxed bounded-token match (no niveau_ required)
  // for resilience against upstream renaming. Segment boundaries prevent
  // substring misclassification (e.g. "bouleau" inside a user prefix).
  for (const [canonical, frSlug] of Object.entries(ATMO_ALLERGEN_MAP)) {
    if (canonical === "allergy_risk" || canonical === "qualite_globale") continue;
    if (ATMO_POLLUTION_ALLERGENS.has(canonical)) continue;
    const boundary = new RegExp(`(?:^|_)${frSlug}(?:_|$)`);
    if (boundary.test(id) && !id.includes(`concentration_${frSlug}`)) return canonical;
  }

  // Pollution: bounded-token match, excluding niveau_/concentration_ variants.
  for (const canonical of ATMO_POLLUTION_ALLERGENS) {
    const frSlug = ATMO_ALLERGEN_MAP[canonical];
    const boundary = new RegExp(`(?:^|_)${frSlug}(?:_|$)`);
    if (boundary.test(id) && !id.includes(`niveau_${frSlug}`) && !id.includes(`concentration_${frSlug}`)) {
      return canonical;
    }
  }

  return null;
}

/**
 * Resolve a human-readable label for an Atmo France location.
 * Priority: device name_by_user > city from identifier > zone attribute > device name > "Auto"
 *
 * "Nom de la zone" is deprioritized because it often contains administrative
 * zone names (e.g. "CC Leff Armor Communauté" instead of "Plouha") or is in
 * ALL CAPS ("CHAMBRAY-LÈS-TOURS").
 */
function resolveAtmoLabel(state, device) {
  if (device?.name_by_user) return device.name_by_user;

  // Extract city from device identifier: ["atmofrance", "Lig'Air-Chambray-les-Tours"]
  if (device?.identifiers) {
    for (const tuple of device.identifiers) {
      if (Array.isArray(tuple) && tuple[0] === "atmofrance" && tuple[1]) {
        const dashIdx = tuple[1].indexOf("-");
        if (dashIdx >= 0) return tuple[1].slice(dashIdx + 1);
      }
    }
  }

  const zoneName = state?.attributes?.["Nom de la zone"];
  if (zoneName) return zoneName;

  if (device?.name && device.name !== "Atmo France") return device.name;

  return "Auto";
}

/**
 * Discover all Atmo France sensors, grouped by location (config entry).
 *
 * Thin wrapper around discoverEntitiesByDevice with Atmo-specific classifiers,
 * label resolver, and fallback regex. Returns the same shape as before:
 *   { locations: Map<configEntryId, { label, entities: Map<allergenKey, entityId> }> }
 *
 * Three-tier discovery:
 *   1. Device-based: hass.devices (identifiers containing "atmofrance") -> entities by device_id
 *   2. Entity-registry: hass.entities filtered by platform === "atmofrance"
 *   3. Regex fallback: hass.states scanned for known Atmo entity patterns
 */
export function discoverAtmoSensors(hass, debug = false) {
  if (!hass) return { locations: new Map() };

  // (?:\w+_)* handles multi-word prefixes like "chambray_les_tours_".
  // (?:alerte_)? keeps legacy niveau_alerte_{slug} entities in scope.
  const atmoFallbackRe = /^sensor\.(?:\w+_)*(?:niveau_(?:alerte_)?(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)|(?:pm25|pm10|ozone|dioxyde_d_azote|dioxyde_de_soufre)|qualite_globale(?:_pollen)?)_/;

  const { locations } = discoverEntitiesByDevice(hass, {
    platform: "atmofrance",
    classify: (eid) => classifyAtmoEntity(eid),
    classifyRelaxed: (eid) => classifyAtmoEntityRelaxed(eid),
    isRelevant: (eid) => !/_j_\d+$/.test(eid) && !eid.includes("concentration_"),
    resolveLabel: (ctx) => resolveAtmoLabel(ctx.state, ctx.device),
    fallbackRegex: atmoFallbackRe,
    debug,
    logTag: "ATMO",
  });

  return { locations };
}

/**
 * Resolve a legacy slug-style location (e.g. "nice") to its config_entry_id
 * in a discovery result. Returns null if no match is found.
 *
 * Matches by scanning discovered entity IDs for ones ending in `_{slug}`
 * (or `_{slug}_j_1`). This covers both non-prefixed (`sensor.niveau_bouleau_nice`)
 * and prefixed (`sensor.toulouse_niveau_bouleau_toulouse`) entity formats.
 */
export function findAtmoLocationBySlug(discovery, slug) {
  const match = findLocationBySlug(discovery, slug, { suffixExtras: ["", "_j_1"] });
  return match ? match[0] : null;
}

/**
 * Detect location slug from available Atmo France entities.
 * Legacy fallback for slug-based configs without hass.entities.
 */
function detectLocation(hass, debug) {
  // Try pollen entities first (most reliable pattern)
  for (const id of Object.keys(hass.states)) {
    const m = id.match(
      /^sensor\.niveau_(ambroisie|armoise|aulne|bouleau|gramine|olivier)_(.+?)(?:_j_\d+)?$/,
    );
    if (m) {
      if (debug) console.debug("[ATMO] auto-detected location:", m[2]);
      return m[2];
    }
  }
  // Fallback: try pollution entities
  for (const id of Object.keys(hass.states)) {
    const m = id.match(
      /^sensor\.(pm25|pm10|ozone|dioxyde_d_azote|dioxyde_de_soufre)_(.+?)(?:_j_\d+)?$/,
    );
    if (m) {
      if (debug) console.debug("[ATMO] auto-detected location from pollution entity:", m[2]);
      return m[2];
    }
  }
  // Fallback: try summary entities (qualite_globale_pollen_* or qualite_globale_*)
  for (const id of Object.keys(hass.states)) {
    // Match qualite_globale_pollen_{location} first (more specific)
    const mp = id.match(
      /^sensor\.qualite_globale_pollen_(.+?)(?:_j_\d+)?$/,
    );
    if (mp) {
      if (debug) console.debug("[ATMO] auto-detected location from pollen summary entity:", mp[1]);
      return mp[1];
    }
    // Match qualite_globale_{location} but not qualite_globale_pollen_*
    const mg = id.match(
      /^sensor\.qualite_globale_(?!pollen)(.+?)(?:_j_\d+)?$/,
    );
    if (mg) {
      if (debug) console.debug("[ATMO] auto-detected location from global summary entity:", mg[1]);
      return mg[1];
    }
  }
  return null;
}

/**
 * Build entity ID for an allergen at a given location.
 * Pollen entities: sensor.niveau_{fr_slug}_{location}
 * Pollution entities: sensor.{fr_slug}_{location} (no "niveau_" prefix)
 */
function buildEntityId(allergen, location, forecast) {
  const frSlug = ATMO_ALLERGEN_MAP[allergen];
  if (!frSlug) return null;

  let base;
  if (allergen === "allergy_risk") {
    base = `sensor.qualite_globale_pollen_${location}`;
  } else if (allergen === "qualite_globale") {
    base = `sensor.qualite_globale_${location}`;
  } else if (ATMO_POLLUTION_ALLERGENS.has(allergen)) {
    base = `sensor.${frSlug}_${location}`;
  } else {
    base = `sensor.niveau_${frSlug}_${location}`;
  }
  return forecast ? `${base}_j_1` : base;
}

export function resolveEntityIds(cfg, hass, debug = false) {
  const map = new Map();

  if (cfg.location === "manual") {
    // Manual mode: prefix/suffix based lookup
    for (const allergen of cfg.allergens || []) {
      const frSlug = ATMO_ALLERGEN_MAP[allergen];
      if (!frSlug) continue;
      const prefix = normalizeManualPrefix(cfg.entity_prefix);
      const suffix = cfg.entity_suffix || "";
      let stem;
      if (allergen === "allergy_risk") {
        stem = "qualite_globale_pollen";
      } else if (allergen === "qualite_globale") {
        stem = "qualite_globale";
      } else if (ATMO_POLLUTION_ALLERGENS.has(allergen)) {
        stem = frSlug;
      } else {
        stem = `niveau_${frSlug}`;
      }
      const sensorId = resolveManualEntity(hass, prefix, stem, suffix);
      if (!sensorId) continue;
      if (debug) console.debug(`[ATMO:resolveEntityIds] manual: '${allergen}' -> '${sensorId}'`);
      map.set(allergen, sensorId);
    }
    return map;
  }

  // Discovery-based resolution (handles prefixed entity IDs)
  const discovery = discoverAtmoSensors(hass, debug);
  const location = cfg.location || "";
  let discoveredEntities = null;

  if (location && discovery.locations.has(location)) {
    // Config entry ID match (new-style config)
    discoveredEntities = discovery.locations.get(location).entities;
  } else if (!location && discovery.locations.size) {
    // Auto-detect: use first discovered location
    discoveredEntities = discovery.locations.values().next().value.entities;
  }

  if (discoveredEntities) {
    for (const allergen of cfg.allergens || []) {
      const sensorId = discoveredEntities.get(allergen);
      if (sensorId && hass.states?.[sensorId]) {
        if (debug) console.debug(`[ATMO:resolveEntityIds] discovery: '${allergen}' -> '${sensorId}'`);
        map.set(allergen, sensorId);
      }
    }
    return map;
  }

  // Slug fallback (backward compat for location: "nice" style configs).
  // If the slug matches a discovered location, prefer its entities so prefixed
  // multi-instance setups still work when the config carries a legacy slug.
  if (location && !discovery.locations.has(location)) {
    const entryId = findAtmoLocationBySlug(discovery, location);
    if (entryId) {
      discoveredEntities = discovery.locations.get(entryId).entities;
      for (const allergen of cfg.allergens || []) {
        const sensorId = discoveredEntities.get(allergen);
        if (sensorId && hass.states?.[sensorId]) {
          if (debug) console.debug(`[ATMO:resolveEntityIds] slug->discovery: '${allergen}' -> '${sensorId}'`);
          map.set(allergen, sensorId);
        }
      }
      return map;
    }
  }
  const slugLocation = location || detectLocation(hass, debug) || "";
  if (!slugLocation) return map;

  for (const allergen of cfg.allergens || []) {
    const frSlug = ATMO_ALLERGEN_MAP[allergen];
    if (!frSlug) continue;

    let sensorId = buildEntityId(allergen, slugLocation, false);
    if (!sensorId || !hass.states[sensorId]) {
      let pfx;
      if (allergen === "allergy_risk") {
        pfx = `sensor.qualite_globale_pollen_`;
      } else if (allergen === "qualite_globale") {
        pfx = `sensor.qualite_globale_`;
      } else if (ATMO_POLLUTION_ALLERGENS.has(allergen)) {
        pfx = `sensor.${frSlug}_`;
      } else {
        pfx = `sensor.niveau_${frSlug}_`;
      }
      const candidates = Object.keys(hass.states).filter((id) => {
        if (!id.startsWith(pfx) || id.includes("_j_")) return false;
        if (allergen === "qualite_globale" && id.includes("qualite_globale_pollen")) return false;
        return true;
      });
      if (candidates.length === 1) sensorId = candidates[0];
      else continue;
    }
    if (debug) console.debug(`[ATMO:resolveEntityIds] slug fallback: '${allergen}' -> '${sensorId}'`);
    map.set(allergen, sensorId);
  }
  return map;
}

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } = getLangAndLocale(hass, config, stubConfigATMO.date_locale);

  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } = mergePhrases(config, lang);
  const levelNames = buildLevelNames(userLevels, lang);
  const days_to_show = config.days_to_show ?? stubConfigATMO.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigATMO.pollen_threshold;

  if (debug) console.debug("ATMO adapter: start fetchForecast", { config, lang });

  // Atmo France: 0 = indisponible, 1–6 = valid levels, 7 = événement
  const testVal = (v) => clampLevel(v, null, -1);

  // Labels for Atmo-specific special values (0 and 7).
  // t() returns the lookup key itself when a translation is missing, so we
  // treat that sentinel as "no localized label" rather than a real string.
  const localizedOrNull = (key) => {
    const v = t(key, lang);
    return v !== key ? v : null;
  };
  const atmoUnavailableLabel = localizedOrNull("card.atmo.unavailable");
  const atmoEventLabel = localizedOrNull("card.atmo.event");

  /**
   * Map raw Atmo level to state/display_state/state_text.
   * @param {number} raw   - Raw sensor value (-1, 0–7)
   * @param {string} libelle - Sensor Libellé attribute (native label)
   */
  const mapAtmoLevel = (raw, libelle) => {
    if (raw < 0) {
      return { state: -1, display_state: -1, state_text: noInfoLabel };
    }
    if (raw === 0) {
      // Indisponible — show as empty circle. Prefer the card's localized label
      // over the integration's Libellé (which is always French "Indisponible").
      // If no translation exists for this locale, fall back to Libellé, then
      // the generic noInfoLabel.
      return { state: 0, display_state: -1, state_text: atmoUnavailableLabel || libelle || noInfoLabel };
    }
    if (raw >= 1 && raw <= 6) {
      return { state: raw, display_state: raw, state_text: levelNames[raw] || libelle || noInfoLabel };
    }
    if (raw === 7) {
      // Événement — cap circle at 6. Prefer the localized label so non-French
      // users don't see the raw French wording; fall back to Libellé, then
      // noInfoLabel.
      return { state: 7, display_state: 6, state_text: atmoEventLabel || libelle || noInfoLabel };
    }
    // Unexpected value — treat as max
    return { state: raw, display_state: Math.min(raw, 6), state_text: libelle || noInfoLabel };
  };

  const entityMap = resolveEntityIds(config, hass, debug);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let sensors = [];

  for (const allergen of config.allergens) {
    try {
      const dict = { days: [] };
      const canonKey = toCanonicalAllergenKey(allergen);
      dict.allergenReplaced = allergen;
      // Group: allergy_risk belongs with pollen, qualite_globale with pollution
      dict.group = allergen === "qualite_globale" || ATMO_POLLUTION_ALLERGENS.has(allergen)
        ? "pollution"
        : "pollen";

      // Allergen name resolution
      const { allergenCapitalized, allergenShort } = resolveAllergenNames(allergen, {
        fullPhrases, shortPhrases, abbreviated: config.allergens_abbreviated, lang,
      });
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = allergenShort;

      // Sensor lookup (delegated to resolveEntityIds)
      const sensorId = entityMap.get(allergen);
      if (!sensorId) continue;

      const sensor = hass.states[sensorId];
      dict.entity_id = sensorId;

      // Today's value
      const todayVal = testVal(sensor.state);
      const todayLibelle = sensor.attributes?.["Libellé"] || "";

      // J+1 forecast: always derive from {sensorId}_j_1 (works for prefixed entities)
      let tomorrowVal = -1;
      let tomorrowLibelle = "";
      const j1Id = `${sensorId}_j_1`;
      if (hass.states[j1Id]) {
        tomorrowVal = testVal(hass.states[j1Id].state);
        tomorrowLibelle = hass.states[j1Id].attributes?.["Libellé"] || "";
      }

      // Build level entries with per-entity Libellé
      const levels = [
        { date: today, level: todayVal, libelle: todayLibelle },
        { date: new Date(today.getTime() + 86400000), level: tomorrowVal, libelle: tomorrowLibelle },
      ];
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
          libelle: "",
        });
      }

      // Build day objects (always include placeholders for show_empty_days support)
      levels.forEach((entry, idx) => {
        const diff = Math.round((entry.date - today) / 86400000);
        const dayLabel = buildDayLabel(entry.date, diff, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale });

        const mapped = mapAtmoLevel(entry.level, entry.libelle);

        dict[`day${idx}`] = {
          name: dict.allergenCapitalized,
          day: dayLabel,
          state: mapped.state,
          display_state: mapped.display_state,
          state_text: mapped.state_text,
        };
        dict.days.push(dict[`day${idx}`]);
      });

      // Threshold filter
      if (meetsThreshold(dict.days, pollen_threshold)) sensors.push(dict);
    } catch (e) {
      console.warn(`ATMO adapter error for allergen ${allergen}:`, e);
    }
  }

  // Sorting
  if (config.sort !== "none") {
    // Sort by display_state for visual consistency, raw state as tiebreaker
    const sortFn =
      {
        value_ascending: (a, b) =>
          (a.day0?.display_state ?? 0) - (b.day0?.display_state ?? 0) ||
          (a.day0?.state ?? 0) - (b.day0?.state ?? 0),
        value_descending: (a, b) =>
          (b.day0?.display_state ?? 0) - (a.day0?.display_state ?? 0) ||
          (b.day0?.state ?? 0) - (a.day0?.state ?? 0),
        name_ascending: (a, b) =>
          a.allergenCapitalized.localeCompare(b.allergenCapitalized),
        name_descending: (a, b) =>
          b.allergenCapitalized.localeCompare(a.allergenCapitalized),
      }[config.sort] ||
        ((a, b) =>
          (b.day0?.display_state ?? 0) - (a.day0?.display_state ?? 0) ||
          (b.day0?.state ?? 0) - (a.day0?.state ?? 0));

    if (config.sort_pollution_block) {
      // Separate into pollen and pollution by group property
      const pollen = [];
      const pollution = [];
      for (const s of sensors) {
        if (s.group === "pollution") {
          pollution.push(s);
        } else {
          pollen.push(s);
        }
      }
      pollen.sort(sortFn);
      pollution.sort(sortFn);

      // Pin summaries to top of their respective blocks
      if (config.allergy_risk_top) {
        const arIdx = pollen.findIndex((s) => s.allergenReplaced === "allergy_risk");
        if (arIdx > 0) pollen.unshift(...pollen.splice(arIdx, 1));
        const qgIdx = pollution.findIndex((s) => s.allergenReplaced === "qualite_globale");
        if (qgIdx > 0) pollution.unshift(...pollution.splice(qgIdx, 1));
      }

      sensors =
        config.pollution_block_position === "top"
          ? [...pollution, ...pollen]
          : [...pollen, ...pollution];
    } else {
      sensors.sort(sortFn);
      // Pin both summaries to absolute top when not using block separation
      if (config.allergy_risk_top) {
        const qgIdx = sensors.findIndex((s) => s.allergenReplaced === "qualite_globale");
        if (qgIdx > 0) sensors.unshift(...sensors.splice(qgIdx, 1));
        const arIdx = sensors.findIndex((s) => s.allergenReplaced === "allergy_risk");
        if (arIdx > 0) sensors.unshift(...sensors.splice(arIdx, 1));
      }
    }
  }

  if (debug) console.debug("ATMO adapter complete sensors:", sensors);
  return sensors;
}
