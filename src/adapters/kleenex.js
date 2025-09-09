// src/adapters/kleenex.js
import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { normalize } from "../utils/normalize.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";

const DOMAIN = "kleenex_pollenradar";

export const stubConfigKleenex = {
  integration: "kleenex",
  location: "",
  // Optional entity naming used when location is "manual"
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    "trees",
    "grass", 
    "weeds",
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
  days_to_show: 5,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 1,
  sort: "value_descending",
  allergy_risk_top: true,
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Convert kleenex level strings to numeric levels (0-6)
function kleenexLevelToNumeric(level) {
  const levelMap = {
    'low': 1,
    'moderate': 3,
    'high': 5,
    'very-high': 6,
  };
  return levelMap[level] || -1;
}

// Convert numeric ppm values to level (0-6) 
function ppmToLevel(value) {
  const numVal = Number(value);
  if (isNaN(numVal) || numVal < 0) return -1;
  if (numVal === 0) return 0;
  if (numVal <= 10) return 1;
  if (numVal <= 50) return 2;
  if (numVal <= 100) return 3;
  if (numVal <= 200) return 4;
  if (numVal <= 500) return 5;
  return 6;
}

export async function fetchForecast(hass, config) {
  const lang = detectLang(hass, config.date_locale);
  const debug = config.debug;
  const days_to_show = config.days_to_show || stubConfigKleenex.days_to_show;
  const shortPhrases = config.phrases?.short || {};
  const fullPhrases = config.phrases?.full || {};
  const pollen_threshold = 
    config.pollen_threshold ?? stubConfigKleenex.pollen_threshold;

  if (debug)
    console.debug("Kleenex adapter: start fetchForecast", { config, lang });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sensors = [];

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      const rawKey = allergen;
      dict.allergenReplaced = rawKey;
      
      // Canonical key for lookup in locales
      const canonKey = ALLERGEN_TRANSLATION[rawKey] || rawKey;

      // Allergen name: use user phrase, else i18n, else default
      const userFull = fullPhrases[allergen];
      if (userFull) {
        dict.allergenCapitalized = userFull;
      } else {
        const transKey = ALLERGEN_TRANSLATION[rawKey] || rawKey;
        const nameKey = `card.allergen.${transKey}`;
        const i18nName = t(nameKey, lang);
        dict.allergenCapitalized =
          i18nName !== nameKey ? i18nName : capitalize(allergen);
      }

      // Short name depending on config.allergens_abbreviated
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
      if (config.location === "manual") {
        const prefix = config.entity_prefix || "";
        const suffix = config.entity_suffix || "";
        sensorId = `${prefix}${rawKey}${suffix}`;
      } else {
        // Auto-detect based on integration pattern
        const candidates = Object.keys(hass.states).filter((id) =>
          id.startsWith(`sensor.${DOMAIN}_`) && id.includes(`_${rawKey}`)
        );
        if (candidates.length === 1) {
          sensorId = candidates[0];
        } else if (candidates.length > 1) {
          // If there are multiple, try to pick the main value sensor (not level)
          const valueCandidates = candidates.filter(id => !id.endsWith('_level'));
          sensorId = valueCandidates.length > 0 ? valueCandidates[0] : candidates[0];
        } else {
          continue; // No sensors found for this allergen
        }
      }

      const sensor = hass.states[sensorId];
      if (!sensor) continue;

      dict.entity_id = sensorId;

      // Get current and forecast values
      const currentValue = Number(sensor.state);
      const attributes = sensor.attributes || {};
      const forecastData = attributes.forecast || [];

      // Build level data for days
      const levels = [];
      
      // Today's data
      const todayLevel = attributes.level ? kleenexLevelToNumeric(attributes.level) : ppmToLevel(currentValue);
      levels.push({ 
        date: new Date(today), 
        level: isNaN(currentValue) ? -1 : todayLevel,
        value: isNaN(currentValue) ? -1 : currentValue
      });

      // Forecast days (up to 4 more days from attributes)
      for (let i = 0; i < Math.min(4, forecastData.length); i++) {
        const forecastItem = forecastData[i];
        const forecastDate = new Date(today.getTime() + (i + 1) * 86400000);
        const forecastValue = Number(forecastItem.value);
        const forecastLevel = forecastItem.level ? kleenexLevelToNumeric(forecastItem.level) : ppmToLevel(forecastValue);
        
        levels.push({
          date: forecastDate,
          level: isNaN(forecastValue) ? -1 : forecastLevel,
          value: isNaN(forecastValue) ? -1 : forecastValue
        });
      }

      // Pad with empty days if needed
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
          value: -1
        });
      }

      const levelNames = buildLevelNames(config.phrases.levels, lang);
      dict.levelNames = levelNames;

      // Build day objects for card display
      for (let i = 0; i < days_to_show; i++) {
        if (i < levels.length) {
          const dayData = levels[i];
          dict[`day${i}`] = {
            state: dayData.level,
            value: dayData.value,
            description: levelNames[dayData.level] || "",
          };
        } else {
          dict[`day${i}`] = { state: -1, value: -1, description: "" };
        }
      }

      // Check threshold
      const meets = levels
        .slice(0, days_to_show)
        .some((l) => l.level >= pollen_threshold);
      if (meets || pollen_threshold === 0) sensors.push(dict);
    } catch (e) {
      console.warn(`Kleenex adapter error for allergen ${allergen}:`, e);
    }
  }

  // Sort sensors
  sensors.sort(
    {
      value_ascending: (a, b) => a.day0.state - b.day0.state,
      value_descending: (a, b) => b.day0.state - a.day0.state,
      name_ascending: (a, b) =>
        a.allergenCapitalized.localeCompare(b.allergenCapitalized),
      name_descending: (a, b) =>
        b.allergenCapitalized.localeCompare(a.allergenCapitalized),
    }[config.sort] || ((a, b) => b.day0.state - a.day0.state)
  );

  if (debug) console.debug("Kleenex adapter complete sensors:", sensors);
  return sensors;
}

// Stub functions to match other adapters
export function findSensors() {
  return [];
}

export async function getData() {
  return [];
}