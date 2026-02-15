// src/adapters/gpl.js
// Adapter for the Google Pollen Levels (pollenlevels) HACS integration.
// Sensors: sensor.{location}_type_grass, _type_tree, _type_weed (categories)
//          sensor.{location}_plants_{code} (individual plants)
// Each sensor has state 0-5 and attributes.forecast[] for multi-day data.

import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";

// Category allergens — map from our canonical key to entity suffix
export const GPL_CATEGORY_MAP = {
  grass_cat: "type_grass",
  trees_cat: "type_tree",
  weeds_cat: "type_weed",
};

// Base allergens always available (categories)
export const GPL_BASE_ALLERGENS = ["grass_cat", "trees_cat", "weeds_cat"];

export const stubConfigGPL = {
  integration: "gpl",
  location: "",
  entity_prefix: "",
  entity_suffix: "",
  allergens: ["grass_cat", "trees_cat", "weeds_cat"],
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
  days_to_show: 5,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 1,
  sort: "value_descending",
  sort_category_allergens_first: true,
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Discover individual plant sensors for a given location prefix.
 * Returns array of plant codes found, e.g. ["oak", "birch", "ragweed"]
 */
export function discoverPlants(hass, locationPrefix) {
  if (!hass || !hass.states || !locationPrefix) return [];
  const prefix = `sensor.${locationPrefix}_plants_`;
  const plants = [];
  for (const id of Object.keys(hass.states)) {
    if (id.startsWith(prefix)) {
      const code = id.slice(prefix.length);
      if (code) plants.push(code);
    }
  }
  return plants.sort();
}

/**
 * Auto-detect the location prefix from available GPL entities.
 * Looks for sensor.*_type_(grass|tree|weed) pattern.
 */
export function detectLocationPrefix(hass, debug) {
  for (const id of Object.keys(hass.states)) {
    const m = id.match(/^sensor\.(.+)_type_(grass|tree|weed)$/);
    if (m) {
      if (debug) console.debug("[GPL] auto-detected location prefix:", m[1]);
      return m[1];
    }
  }
  return null;
}

/**
 * Build entity ID for a given allergen and location prefix.
 */
function buildEntityId(allergen, locationPrefix) {
  // Category allergens
  const categorySuffix = GPL_CATEGORY_MAP[allergen];
  if (categorySuffix) {
    return `sensor.${locationPrefix}_${categorySuffix}`;
  }
  // Individual plant allergens
  return `sensor.${locationPrefix}_plants_${allergen}`;
}

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const lang = detectLang(hass, config.date_locale);
  const locale = config.date_locale || stubConfigGPL.date_locale;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);

  const phrases = config.phrases || {};
  const fullPhrases = phrases.full || {};
  const shortPhrases = phrases.short || {};
  const userLevels = phrases.levels;
  const levelNames = buildLevelNames(userLevels, lang);
  const noInfoLabel = phrases.no_information || t("card.no_information", lang);
  const userDays = phrases.days || {};
  const days_to_show = config.days_to_show ?? stubConfigGPL.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigGPL.pollen_threshold;

  // GPL uses 6-level system (0-5)
  const maxLevel = 5;
  const testVal = (v) => {
    const n = Number(v);
    return isNaN(n) || n < 0 ? -1 : n > maxLevel ? maxLevel : n;
  };

  if (debug) console.debug("[GPL] Adapter: start fetchForecast", { config, lang });

  // Resolve location prefix
  let locationPrefix = config.location || "";
  if (locationPrefix === "manual") {
    // Manual mode handled below per allergen
  } else if (!locationPrefix) {
    locationPrefix = detectLocationPrefix(hass, debug) || "";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let sensors = [];

  for (const allergen of config.allergens) {
    try {
      const dict = { days: [] };
      const canonKey = ALLERGEN_TRANSLATION[allergen] || allergen;
      dict.allergenReplaced = allergen;

      // Allergen name
      const userFull = fullPhrases[allergen];
      if (userFull) {
        dict.allergenCapitalized = userFull;
      } else {
        const nameKey = `card.allergen.${canonKey}`;
        const i18nName = t(nameKey, lang);
        dict.allergenCapitalized =
          i18nName !== nameKey ? i18nName : capitalize(allergen.replace(/_/g, " "));
      }

      // Short name
      if (config.allergens_abbreviated) {
        const userShort = shortPhrases[allergen];
        dict.allergenShort =
          userShort ||
          t(`editor.phrases_short.${canonKey}`, lang) ||
          dict.allergenCapitalized;
      } else {
        dict.allergenShort = dict.allergenCapitalized;
      }

      // Find sensor entity
      let sensorId;
      if (locationPrefix === "manual") {
        const prefix = config.entity_prefix || "";
        const suffix = config.entity_suffix || "";
        const categorySuffix = GPL_CATEGORY_MAP[allergen];
        if (categorySuffix) {
          sensorId = `sensor.${prefix}${categorySuffix}${suffix}`;
        } else {
          sensorId = `sensor.${prefix}plants_${allergen}${suffix}`;
        }
        if (!hass.states[sensorId]) {
          if (debug) console.debug(`[GPL] Manual mode: sensor not found: ${sensorId}`);
          continue;
        }
      } else {
        if (!locationPrefix) continue;
        sensorId = buildEntityId(allergen, locationPrefix);
        if (!sensorId || !hass.states[sensorId]) {
          if (debug) console.debug(`[GPL] Sensor not found: ${sensorId}`);
          continue;
        }
      }

      const sensor = hass.states[sensorId];
      dict.entity_id = sensorId;

      if (debug) {
        console.debug(`[GPL] Processing sensor ${sensorId}:`, {
          state: sensor.state,
          forecast: sensor.attributes?.forecast?.length,
        });
      }

      // Today's value (0-5 direct)
      const todayVal = testVal(sensor.state);

      // Build levels array from today + forecast
      const levels = [{ date: today, level: todayVal }];

      // Read forecast from entity attributes
      const forecastData = sensor.attributes?.forecast || [];
      forecastData.forEach((forecastItem, idx) => {
        if (levels.length >= days_to_show) return;
        const forecastDate = new Date(today.getTime() + (idx + 1) * 86400000);
        // forecast items may have a 'state' or 'level' property
        const val = forecastItem.state ?? forecastItem.level ?? forecastItem;
        levels.push({
          date: forecastDate,
          level: testVal(val),
        });
      });

      // Pad to days_to_show
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
        });
      }

      // Build day objects
      for (let i = 0; i < days_to_show; i++) {
        const entry = levels[i];
        if (!entry) continue;

        const diff = Math.round((entry.date - today) / 86400000);
        let dayLabel;

        if (!daysRelative) {
          dayLabel = entry.date.toLocaleDateString(locale, {
            weekday: dayAbbrev ? "short" : "long",
          });
          dayLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
        } else if (userDays[diff] !== undefined) {
          dayLabel = userDays[diff];
        } else if (diff >= 0 && diff <= 2) {
          dayLabel = t(`card.days.${diff}`, lang);
        } else {
          dayLabel = entry.date.toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
          });
        }
        if (daysUppercase) dayLabel = dayLabel.toUpperCase();

        // Map level 0-5 to level name index 0-6 (scale up)
        let scaledLevel;
        if (entry.level < 0) {
          scaledLevel = entry.level;
        } else {
          // Scale 0-5 to 0-6: 0→0, 1→1, 2→2, 3→4, 4→5, 5→6
          const scaleMap = [0, 1, 2, 4, 5, 6];
          scaledLevel = scaleMap[Math.min(entry.level, 5)] ?? entry.level;
        }

        const stateText =
          scaledLevel < 0
            ? noInfoLabel
            : levelNames[scaledLevel] || noInfoLabel;

        const dayObj = {
          name: dict.allergenCapitalized,
          day: dayLabel,
          state: entry.level,
          display_state: entry.level,
          state_text: stateText,
        };

        dict[`day${i}`] = dayObj;
        dict.days.push(dayObj);
      }

      // Threshold filter
      const meets = levels
        .slice(0, days_to_show)
        .some((l) => l.level >= pollen_threshold);
      if (meets || pollen_threshold === 0) {
        sensors.push(dict);
      }
    } catch (e) {
      console.warn(`[GPL] Adapter error for allergen ${allergen}:`, e);
    }
  }

  // Sorting
  if (config.sort !== "none") {
    const sortFunction =
      {
        value_ascending: (a, b) => (a.day0?.state ?? 0) - (b.day0?.state ?? 0),
        value_descending: (a, b) =>
          (b.day0?.state ?? 0) - (a.day0?.state ?? 0),
        name_ascending: (a, b) =>
          a.allergenCapitalized.localeCompare(b.allergenCapitalized),
        name_descending: (a, b) =>
          b.allergenCapitalized.localeCompare(a.allergenCapitalized),
      }[config.sort] ||
      ((a, b) => (b.day0?.state ?? 0) - (a.day0?.state ?? 0));

    if (config.sort_category_allergens_first) {
      // Two-tiered: categories first, then individual
      const categoryAllergens = sensors.filter((s) =>
        ["trees_cat", "grass_cat", "weeds_cat"].includes(s.allergenReplaced),
      );
      const individualAllergens = sensors.filter(
        (s) =>
          !["trees_cat", "grass_cat", "weeds_cat"].includes(
            s.allergenReplaced,
          ),
      );
      categoryAllergens.sort(sortFunction);
      individualAllergens.sort(sortFunction);
      sensors = [...categoryAllergens, ...individualAllergens];
    } else {
      sensors.sort(sortFunction);
    }
  }

  if (debug) console.debug("[GPL] Adapter complete sensors:", sensors);
  return sensors;
}

// Stub functions to match other adapters
export function findSensors() {
  return [];
}

export async function getData() {
  return [];
}
