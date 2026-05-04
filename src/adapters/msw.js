// src/adapters/msw.js
// MeteoSwiss / hass-swissweather adapter.
//
// Reads current pollen level from SwissPollenLevelSensor entities created by
// the hass-swissweather integration (https://github.com/izacus/hass-swissweather).
// Only current-day measurements are available; MeteoSwiss publishes no
// machine-readable pollen forecast API.

import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import {
  getLangAndLocale,
  mergePhrases,
  buildDayLabel,
  sortSensors,
  meetsThreshold,
  resolveAllergenNames,
} from "../utils/adapter-helpers.js";

// hass-swissweather entity slug → canonical allergen key.
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

// Reverse map: canonical allergen key → hass-swissweather entity slug.
const CANONICAL_TO_MSW = Object.fromEntries(
  Object.entries(MSW_POLLEN_TYPES).map(([slug, canonical]) => [canonical, slug]),
);

// hass-swissweather categorical level → pollenprognos 0-6 scale.
// Gaps (2, 4) intentionally left so mid-levels stay visually distinct.
const MSW_LEVEL_MAP = {
  none: 0,
  low: 1,
  medium: 3,
  strong: 5,
  "very strong": 6,
};

export const stubConfigMSW = {
  integration: "msw",
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
  days_to_show: 1,
  pollen_threshold: 0,
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
 * Map allergen keys from config to hass-swissweather SwissPollenLevelSensor entity IDs.
 * Discovery matches entity IDs with prefix sensor.pollen_{mswSlug}_level_.
 * If multiple stations are installed, the first alphabetically matching entity wins.
 *
 * @param {Object} cfg - Card config
 * @param {Object} hass - Home Assistant object
 * @param {boolean} [debug]
 * @returns {Map<string, string>} allergen → entity_id
 */
export function resolveEntityIds(cfg, hass, debug = false) {
  if (!hass?.states) return new Map();
  const map = new Map();
  const stateKeys = Object.keys(hass.states);

  for (const allergen of cfg.allergens || []) {
    const mswSlug = CANONICAL_TO_MSW[allergen];
    if (!mswSlug) {
      if (debug) console.debug(`[MSW:resolveEntityIds] Unknown allergen '${allergen}', skipping`);
      continue;
    }

    const prefix = `sensor.pollen_${mswSlug}_level_`;
    const match = stateKeys.find((id) => id.startsWith(prefix));

    if (match) {
      if (debug) console.debug(`[MSW:resolveEntityIds] ${allergen} → ${match}`);
      map.set(allergen, match);
    } else if (debug) {
      console.debug(`[MSW:resolveEntityIds] No entity found for '${allergen}' (prefix: ${prefix})`);
    }
  }

  return map;
}

/**
 * Fetch current pollen levels from hass-swissweather entities.
 * Returns one day (today) per allergen.
 *
 * @param {Object} hass - Home Assistant object
 * @param {Object} config - Card config
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
  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } =
    mergePhrases(config, lang);
  const levelNames = buildLevelNames(userLevels, lang);
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
