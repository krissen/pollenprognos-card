// src/adapters/msw.js
// MeteoSwiss / hass-swissweather adapter.
//
// Reads current pollen level from SwissPollenLevelSensor entities created by
// the hass-swissweather integration (https://github.com/izacus/hass-swissweather).
// Only current-day measurements are available; MeteoSwiss publishes no
// machine-readable pollen forecast API.
//
// Discovery uses the shared device-registry helper so that:
//   - Multi-station setups are disambiguated by config_entry_id rather than
//     silently mixing entities across stations.
//   - HA's automatic device-name prefix on entity_ids
//     (sensor.<device-slug>_pollen_<allergen>_level_at_<station>) is handled.
//   - Stale config_entry_id values fall back to the first discovered location,
//     mirroring DWD/GPL/GP/SILAM/Atmo recovery behavior.

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

// hass-swissweather entity slug -> canonical allergen key.
// "grasses" is the slug used in entity IDs by hass-swissweather.
const MSW_POLLEN_TYPES = {
  birch: "birch",
  grasses: "grass",
  alder: "alder",
  hazel: "hazel",
  beech: "beech",
  ash: "ash",
  oak: "oak",
};

// hass-swissweather categorical level -> the integration's native 5-level
// scale (0-4). Card-wide convention: each integration keeps its own native
// level count for editor phrases, level circles, and color mapping; we do
// not stretch native counts onto a shared 0-6 gradient. Same shape as
// DWD (0-3, four levels) and GPL/GP (0-5, six levels).
const MSW_LEVEL_MAP = {
  none: 0,
  low: 1,
  medium: 2,
  strong: 3,
  "very strong": 4,
};

// Match pollen_<slug>_level_at_ inside an entity_id, allowing both the bare
// shape (sensor.pollen_<slug>_level_at_<station>) and HA's auto-prefixed
// shape (sensor.<device-slug>_pollen_<slug>_level_at_<station>) where
// <device-slug> is derived from the device's friendly name.
const MSW_LEVEL_RE =
  /(?:^sensor\.|_)pollen_(birch|grasses|alder|hazel|beech|ash|oak)_level_at_/;

function classifyMswEntity(eid) {
  if (typeof eid !== "string") return null;
  const m = MSW_LEVEL_RE.exec(eid);
  if (!m) return null;
  return MSW_POLLEN_TYPES[m[1]] || null;
}

export const stubConfigMSW = {
  integration: "msw",
  location: "",
  allergens: ["birch", "grass", "alder", "hazel", "beech", "ash", "oak"],
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
  // Day-label display defaults that match the conventions used by every
  // other adapter. They are mostly cosmetic for MSW (only one day is ever
  // rendered upstream), but keeping them in the stub means the editor's
  // form generator surfaces the same toggles users see for other
  // integrations and merged-config comparisons stay consistent.
  days_relative: true,
  days_abbreviated: false,
  days_boldfaced: false,
  days_uppercase: false,
  show_empty_days: false,
  days_to_show: 1,
  // Default threshold of 1 matches the convention used by every other
  // adapter on the 0-6 scale (PP, PEU, SILAM, PLU, Atmo, GPL, GP, Kleenex):
  // hide allergens reporting None until a measurement crosses Low or higher.
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
 * Strip the redundant "MeteoSwiss at " integration prefix from a device label
 * when no user-friendly rename (`name_by_user`) has been applied. Mirrors the
 * approach used for DWD (region-ID prefix) and GPL/GP (coordinate suffix):
 * remove integration-specific noise from labels that will be rendered in an
 * already MSW-scoped context (the location dropdown and the card header).
 *
 * Examples:
 *   "MeteoSwiss at 8000-KLO" -> "8000-KLO"
 *   "Bern"                   -> "Bern"   (user-renamed via name_by_user)
 *   "Zürich"                 -> "Zürich" (custom device.name set elsewhere)
 *
 * @param {{ device?: { name?: string, name_by_user?: string }, state?: { attributes?: { friendly_name?: string } } }} ctx
 * @returns {string}
 */
function resolveMswLabel(ctx) {
  const device = ctx?.device;
  if (device?.name_by_user) return device.name_by_user;
  if (device?.name) {
    const stripped = device.name.replace(/^MeteoSwiss at\s+/i, "");
    return stripped || device.name;
  }
  if (ctx?.state?.attributes?.friendly_name) return ctx.state.attributes.friendly_name;
  return "Auto";
}

/**
 * Discover hass-swissweather pollen-level sensors grouped by config entry.
 *
 * Three-tier cascade via shared helper:
 *   1. Device registry: hass.devices with identifiers ["swissweather", ...].
 *   2. Entity registry: hass.entities filtered by platform === "swissweather".
 *   3. Regex fallback: hass.states scanned for the level-entity pattern.
 *
 * @param {Object} hass
 * @param {boolean} [debug]
 * @returns {{ locations: Map<string, { label: string, entities: Map<string, string>, deviceId?: string }> }}
 */
export function discoverMswSensors(hass, debug = false) {
  if (!hass) return { locations: new Map() };

  // Tier 3 fallback: device-name prefix (\w+_)* covers slugified
  // "meteoswiss_at_8000_klo_" and friendly renames like "bern_".
  const fallbackRe = /^sensor\.(?:\w+_)*pollen_(?:birch|grasses|alder|hazel|beech|ash|oak)_level_at_/;

  const { locations } = discoverEntitiesByDevice(hass, {
    platform: "swissweather",
    classify: classifyMswEntity,
    resolveLabel: resolveMswLabel,
    fallbackRegex: fallbackRe,
    debug,
    logTag: "MSW",
  });

  return { locations };
}

/**
 * Map allergen keys from config to hass-swissweather entity IDs for the
 * resolved location. Falls back to the first discovered location when the
 * configured location key does not match (auto-recovery from stale
 * config_entry_id).
 *
 * @param {Object} cfg
 * @param {Object} hass
 * @param {boolean} [debug]
 * @returns {Map<string, string>} allergen -> entity_id
 */
export function resolveEntityIds(cfg, hass, debug = false) {
  if (!hass?.states) return new Map();

  const discovery = discoverMswSensors(hass, debug);
  if (discovery.locations.size === 0) {
    if (debug) console.debug("[MSW:resolveEntityIds] No sensors discovered");
    return new Map();
  }

  let resolved = resolveLocationByKey(discovery, cfg?.location);
  if (!resolved) {
    // Stale or unknown location key: fall back to first discovered location
    // (sorted lex/numeric inside resolveLocationByKey when cfgLocation empty).
    resolved = resolveLocationByKey(discovery, "");
    if (debug && cfg?.location) {
      console.debug(
        `[MSW:resolveEntityIds] Location '${cfg.location}' not found; falling back to first discovered location`,
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
      if (debug) console.debug(`[MSW:resolveEntityIds] ${allergen} -> ${eid}`);
    } else if (debug) {
      console.debug(`[MSW:resolveEntityIds] No entity for '${allergen}' in resolved location`);
    }
  }
  return map;
}

/**
 * Fetch current pollen levels from hass-swissweather entities.
 * Returns one day (today) per allergen.
 *
 * @param {Object} hass
 * @param {Object} config
 * @returns {Promise<Array>} Sensor dicts compatible with pollenprognos-card renderer
 */
export async function fetchForecast(hass, config) {
  if (!hass?.states || !config.allergens?.length) return [];
  const debug = Boolean(config.debug);

  const { lang, locale, dayAbbrev, daysUppercase } = getLangAndLocale(
    hass,
    config,
    stubConfigMSW.date_locale,
  );
  const { fullPhrases, shortPhrases, userLevels, userDays } =
    mergePhrases(config, lang);
  // Five-level scale: defaults from card.levels5.0..4, native-indexed.
  const levelNames = buildLevelNamesForScale(5, userLevels, lang);
  const pollen_threshold = config.pollen_threshold ?? stubConfigMSW.pollen_threshold;

  if (debug) console.debug("MSW adapter: start fetchForecast", { config, lang });

  const sensors = [];
  const entityMap = resolveEntityIds(config, hass, debug);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayLabel = buildDayLabel(today, 0, {
    daysRelative: true,
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
      const level = MSW_LEVEL_MAP[rawState];
      if (level === undefined) continue; // unavailable / unknown / unexpected value

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
      console.warn(`MSW adapter error for allergen ${allergen}:`, e);
    }
  }

  sortSensors(sensors, config.sort);

  if (debug) console.debug("MSW adapter complete sensors:", sensors);
  return sensors;
}
