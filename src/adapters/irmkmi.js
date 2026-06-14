// src/adapters/irmkmi.js
// IRM KMI / meteo.be adapter.
//
// Reads current pollen levels from the enum sensors created by the
// irm-kmi-ha integration (https://github.com/jdejaegh/irm-kmi-ha) for the
// Belgian Royal Meteorological Institute (meteo.be). Only a current-day value
// is published per allergen; there is no machine-readable multi-day forecast.
//
// The integration exposes the meteo.be pollen colour scale as enum states
// (green/yellow/orange/red/purple) plus the non-measurement states `none`
// (no data / not in season) and the legacy `active` flag. We map the five
// colours onto the card's native 5-level scale (0-4) and treat every other
// state as no-data (row skipped). Card-default level colours are used, not
// RMI's palette.
//
// Discovery uses the shared device-registry helper so that:
//   - Multi-location setups (one config entry per location, e.g. Antwerp and
//     Saint-Ghislain) are disambiguated by config entry rather than mixed.
//   - Stale config_entry_id values fall back to the first discovered location,
//     mirroring DWD/GPL/GP/SILAM/Atmo/MSW recovery behavior.

import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNamesForScale } from "../utils/level-names.js";
import {
  getLangAndLocale,
  mergePhrases,
  buildDayLabel,
  sortSensors,
  meetsThreshold,
  resolveAllergenNames,
  discoverEntitiesByDevice,
  resolveLocationByKey,
} from "../utils/adapter-helpers.js";

// irm-kmi-ha entity slug -> canonical allergen key.
// "grasses" is the slug used in entity IDs by the integration.
const IRMKMI_POLLEN_TYPES = {
  alder: "alder",
  ash: "ash",
  birch: "birch",
  grasses: "grass",
  hazel: "hazel",
  mugwort: "mugwort",
  oak: "oak",
};

// meteo.be pollen colour -> the integration's native 5-level scale (0-4).
// Card-wide convention: each integration keeps its own native level count for
// editor phrases, level circles, and color mapping; we do not stretch native
// counts onto a shared 0-6 gradient. The upstream irm_kmi_api ranks these as
// green=null < yellow=low < orange=moderate < red=high < purple=very high.
// `none` (no data) and the legacy `active` flag are intentionally absent: any
// state not in this map is treated as no-data and the row is skipped.
const IRMKMI_LEVEL_MAP = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
  purple: 4,
};

// The integration sets entity_ids explicitly to
// sensor.<entry-title-slug>_<allergen>_level, where the title slug is the
// location (e.g. "antwerp", "saint_ghislain"). Anchoring on
// _<allergen>_level$ extracts the allergen regardless of how many underscores
// the location slug contains.
const IRMKMI_LEVEL_RE =
  /_(alder|ash|birch|grasses|hazel|mugwort|oak)_level$/;

function classifyIrmkmiEntity(eid) {
  if (typeof eid !== "string") return null;
  const m = IRMKMI_LEVEL_RE.exec(eid);
  if (!m) return null;
  return IRMKMI_POLLEN_TYPES[m[1]] || null;
}

export const stubConfigIRMKMI = {
  integration: "irmkmi",
  location: "",
  allergens: ["alder", "ash", "birch", "grass", "hazel", "mugwort", "oak"],
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
  // Day-label display defaults matching every other adapter. They are mostly
  // cosmetic for IRM KMI (only one day is ever rendered upstream), but keeping
  // them in the stub means the editor's form generator surfaces the same
  // toggles users see for other integrations and merged-config comparisons
  // stay consistent.
  days_relative: true,
  days_abbreviated: false,
  days_boldfaced: false,
  days_uppercase: false,
  show_empty_days: false,
  days_to_show: 1,
  // Default threshold of 1 matches the other adapters' convention of hiding
  // None-level (green) allergens until a measurement crosses Low or higher.
  pollen_threshold: 1,
  sort: "value_descending",
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  debug: false,
  show_version: true,
  phrases: {
    full: {},
    short: {},
    levels: [],
    days: {},
    no_information: "",
  },
};

/**
 * Resolve a human-readable location label for an IRM KMI device. The device
 * name is the config-entry title, which is already the location (e.g.
 * "Antwerp", "Saint-Ghislain"); the RMI attribution lives in `manufacturer`,
 * not the name, so no prefix-stripping is needed.
 *
 * @param {{ device?: { name?: string, name_by_user?: string }, state?: { attributes?: { friendly_name?: string } } }} ctx
 * @returns {string}
 */
function resolveIrmkmiLabel(ctx) {
  const device = ctx?.device;
  if (device?.name_by_user) return device.name_by_user;
  if (device?.name) return device.name;
  if (ctx?.state?.attributes?.friendly_name) return ctx.state.attributes.friendly_name;
  return "Auto";
}

/**
 * Discover irm-kmi-ha pollen-level sensors grouped by config entry.
 *
 * Three-tier cascade via shared helper:
 *   1. Device registry: hass.devices with identifiers ["irm_kmi", ...].
 *   2. Entity registry: hass.entities filtered by platform === "irm_kmi".
 *   3. Regex fallback: hass.states scanned for the level-entity pattern.
 *
 * @param {Object} hass
 * @param {boolean} [debug]
 * @returns {{ locations: Map<string, { label: string, entities: Map<string, string>, deviceId?: string }> }}
 */
export function discoverIrmkmiSensors(hass, debug = false) {
  if (!hass) return { locations: new Map() };

  const fallbackRe =
    /^sensor\.\w+_(alder|ash|birch|grasses|hazel|mugwort|oak)_level$/;

  const { locations } = discoverEntitiesByDevice(hass, {
    platform: "irm_kmi",
    classify: classifyIrmkmiEntity,
    resolveLabel: resolveIrmkmiLabel,
    fallbackRegex: fallbackRe,
    debug,
    logTag: "IRMKMI",
  });

  return { locations };
}

/**
 * Map allergen keys from config to irm-kmi-ha entity IDs for the resolved
 * location. Falls back to the first discovered location when the configured
 * location key does not match (auto-recovery from stale config_entry_id).
 *
 * @param {Object} cfg
 * @param {Object} hass
 * @param {boolean} [debug]
 * @returns {Map<string, string>} allergen -> entity_id
 */
export function resolveEntityIds(cfg, hass, debug = false) {
  if (!hass?.states) return new Map();

  const discovery = discoverIrmkmiSensors(hass, debug);
  if (discovery.locations.size === 0) {
    if (debug) console.debug("[IRMKMI:resolveEntityIds] No sensors discovered");
    return new Map();
  }

  let resolved = resolveLocationByKey(discovery, cfg?.location);
  if (!resolved) {
    // Stale or unknown location key: fall back to first discovered location
    // (sorted lex/numeric inside resolveLocationByKey when cfgLocation empty).
    resolved = resolveLocationByKey(discovery, "");
    if (debug && cfg?.location) {
      console.debug(
        `[IRMKMI:resolveEntityIds] Location '${cfg.location}' not found; falling back to first discovered location`,
      );
    }
  }
  if (!resolved) return new Map();

  const [, location] = resolved;
  const map = new Map();
  for (const allergen of cfg?.allergens || []) {
    const eid = location.entities.get(allergen);
    if (eid) {
      map.set(allergen, eid);
      if (debug) console.debug(`[IRMKMI:resolveEntityIds] ${allergen} -> ${eid}`);
    } else if (debug) {
      console.debug(`[IRMKMI:resolveEntityIds] No entity for '${allergen}' in resolved location`);
    }
  }
  return map;
}

/**
 * Fetch current pollen levels from irm-kmi-ha entities.
 * Returns one day (today) per allergen.
 *
 * @param {Object} hass
 * @param {Object} config
 * @returns {Promise<Array>} Sensor dicts compatible with pollenprognos-card renderer
 */
export async function fetchForecast(hass, config) {
  if (!hass?.states || !config.allergens?.length) return [];
  const debug = Boolean(config.debug);

  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } =
    getLangAndLocale(hass, config, stubConfigIRMKMI.date_locale);
  const { fullPhrases, shortPhrases, userLevels, userDays } =
    mergePhrases(config, lang);
  // Five-level scale: defaults from card.levels5.0..4, native-indexed.
  const levelNames = buildLevelNamesForScale(5, userLevels, lang);
  const pollen_threshold = config.pollen_threshold ?? stubConfigIRMKMI.pollen_threshold;

  if (debug) console.debug("IRMKMI adapter: start fetchForecast", { config, lang });

  const sensors = [];
  const entityMap = resolveEntityIds(config, hass, debug);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayLabel = buildDayLabel(today, 0, {
    daysRelative,
    dayAbbrev,
    daysUppercase,
    userDays,
    lang,
    locale,
  });

  for (const allergen of config.allergens) {
    try {
      const entityId = entityMap.get(allergen);
      if (!entityId) continue;

      const stateObj = hass.states[entityId];
      if (!stateObj) continue;

      const rawState = typeof stateObj.state === "string"
        ? stateObj.state.toLowerCase()
        : "";
      const level = IRMKMI_LEVEL_MAP[rawState];
      if (level === undefined) continue; // none / active / unavailable / unknown -> no-data

      const { allergenCapitalized, allergenShort } = resolveAllergenNames(allergen, {
        fullPhrases,
        shortPhrases,
        abbreviated: config.allergens_abbreviated,
        lang,
        configKey: allergen,
      });

      const stateText = levelNames[level] ?? rawState;

      const day0 = {
        name: allergenCapitalized,
        day: dayLabel,
        state: level,
        display_state: level,
        state_text: stateText,
      };

      const dict = {
        allergenReplaced: allergen,
        allergenCapitalized,
        allergenShort,
        entity_id: entityId,
        day0,
        days: [day0],
      };

      if (meetsThreshold(dict.days, pollen_threshold)) sensors.push(dict);
    } catch (e) {
      console.warn(`IRMKMI adapter error for allergen ${allergen}:`, e);
    }
  }

  sortSensors(sensors, config.sort);

  if (debug) console.debug("IRMKMI adapter complete sensors:", sensors);
  return sensors;
}
