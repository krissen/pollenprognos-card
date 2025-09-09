// src/adapters/kleenex.js
import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { normalize } from "../utils/normalize.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";

const DOMAIN = "kleenex_pollen_radar";

// Map kleenex allergen names to our canonical names
const KLEENEX_ALLERGEN_MAP = {
  'hazel': 'hazel',
  'elm': 'elm', 
  'pine': 'pine',
  'alder': 'alder',
  'poplar': 'poplar',
  'oak': 'oak',
  'plane': 'plane',
  'birch': 'birch',
  'cypress': 'cypress',
  'grass': 'grass',
  'weeds': 'weeds',
  'ragweed': 'ragweed',
  'mugwort': 'mugwort'
};

export const stubConfigKleenex = {
  integration: "kleenex",
  location: "",
  // Optional entity naming used when location is "manual"
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    // General categories (broad sensors)
    "trees",
    "grass",
    "weeds",
    // Individual allergens (detailed sensors)
    "alder",
    "birch", 
    "cypress",
    "elm",
    "hazel",
    "mugwort",
    "oak",
    "pine",
    "plane",
    "poplar",
    "ragweed",
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

  // Find all kleenex sensors
  const kleenexSensors = Object.values(hass.states).filter((entity) => {
    return entity.entity_id && entity.entity_id.startsWith(`sensor.${DOMAIN}_`);
  });

  if (debug) {
    console.debug("Kleenex sensors found:", kleenexSensors.map(s => s.entity_id));
  }

  const sensors = [];
  const allergenData = new Map(); // Map to collect data by allergen name

  // Process each kleenex sensor to extract allergen data
  for (const sensor of kleenexSensors) {
    const attributes = sensor.attributes || {};
    const details = attributes.details || [];
    const forecastData = attributes.forecast || [];
    
    // Determine sensor category from entity_id
    let sensorCategory = null;
    if (sensor.entity_id.endsWith('_trees')) {
      sensorCategory = 'trees';
    } else if (sensor.entity_id.endsWith('_grass')) {
      sensorCategory = 'grass';
    } else if (sensor.entity_id.endsWith('_weeds')) {
      sensorCategory = 'weeds';
    }

    // Process general category sensor (trees, grass, weeds)
    if (sensorCategory && config.allergens.includes(sensorCategory)) {
      if (!allergenData.has(sensorCategory)) {
        allergenData.set(sensorCategory, {
          levels: [],
          entity_id: sensor.entity_id
        });
      }

      const allergenEntry = allergenData.get(sensorCategory);
      
      // Today's data from sensor state
      const currentLevel = sensor.attributes.level ? kleenexLevelToNumeric(sensor.attributes.level) : ppmToLevel(sensor.state);
      
      allergenEntry.levels[0] = {
        date: new Date(today),
        level: currentLevel,
        value: Number(sensor.state) || 0
      };
      
      // Forecast data
      forecastData.forEach((forecastItem, dayIndex) => {
        const forecastLevel = forecastItem.level ? kleenexLevelToNumeric(forecastItem.level) : ppmToLevel(forecastItem.value);
        
        allergenEntry.levels[dayIndex + 1] = {
          date: new Date(today.getTime() + (dayIndex + 1) * 86400000),
          level: forecastLevel,
          value: Number(forecastItem.value) || 0
        };
      });
    }

    // Extract individual allergens from current details
    for (const detail of details) {
      const allergenName = detail.name?.toLowerCase();
      if (!allergenName) continue;

      const canonicalName = KLEENEX_ALLERGEN_MAP[allergenName] || allergenName;
      
      // Skip if this allergen is not in the config
      if (!config.allergens.includes(canonicalName)) continue;

      if (!allergenData.has(canonicalName)) {
        allergenData.set(canonicalName, {
          levels: [],
          entity_id: sensor.entity_id
        });
      }

      const allergenEntry = allergenData.get(canonicalName);
      
      // Today's data
      const currentLevel = detail.level ? kleenexLevelToNumeric(detail.level) : ppmToLevel(detail.value);
      
      allergenEntry.levels[0] = {
        date: new Date(today),
        level: currentLevel,
        value: detail.value || 0
      };
    }

    // Extract forecast data for each day (individual allergens)
    forecastData.forEach((forecastItem, dayIndex) => {
      const forecastDate = new Date(today.getTime() + (dayIndex + 1) * 86400000);
      const forecastDetails = forecastItem.details || [];

      for (const detail of forecastDetails) {
        const allergenName = detail.name?.toLowerCase();
        if (!allergenName) continue;

        const canonicalName = KLEENEX_ALLERGEN_MAP[allergenName] || allergenName;
        
        // Skip if this allergen is not in the config
        if (!config.allergens.includes(canonicalName)) continue;

        if (!allergenData.has(canonicalName)) {
          allergenData.set(canonicalName, {
            levels: [],
            entity_id: sensor.entity_id
          });
        }

        const allergenEntry = allergenData.get(canonicalName);
        const forecastLevel = detail.level ? kleenexLevelToNumeric(detail.level) : ppmToLevel(detail.value);
        
        allergenEntry.levels[dayIndex + 1] = {
          date: forecastDate,
          level: forecastLevel,
          value: detail.value || 0
        };
      }
    });
  }

  // Build sensor data for each allergen
  for (const [allergenKey, allergenInfo] of allergenData) {
    try {
      const dict = {};
      dict.allergenReplaced = allergenKey;
      dict.entity_id = allergenInfo.entity_id;
      
      // Canonical key for lookup in locales
      const canonKey = ALLERGEN_TRANSLATION[allergenKey] || allergenKey;

      // Allergen name: use user phrase, else i18n, else default
      const userFull = fullPhrases[allergenKey];
      if (userFull) {
        dict.allergenCapitalized = userFull;
      } else {
        const transKey = ALLERGEN_TRANSLATION[allergenKey] || allergenKey;
        const nameKey = `card.allergen.${transKey}`;
        const i18nName = t(nameKey, lang);
        dict.allergenCapitalized =
          i18nName !== nameKey ? i18nName : capitalize(allergenKey);
      }

      // Short name depending on config.allergens_abbreviated
      if (config.allergens_abbreviated) {
        const userShort = shortPhrases[allergenKey];
        dict.allergenShort =
          userShort ||
          t(`editor.phrases_short.${canonKey}`, lang) ||
          dict.allergenCapitalized;
      } else {
        dict.allergenShort = dict.allergenCapitalized;
      }

      // Pad levels array to match days_to_show
      const levels = allergenInfo.levels;
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
          value: -1
        });
      }

      // Fill missing days with -1 values
      for (let i = 0; i < days_to_show; i++) {
        if (!levels[i]) {
          levels[i] = {
            date: new Date(today.getTime() + i * 86400000),
            level: -1,
            value: -1
          };
        }
      }

      const levelNames = buildLevelNames(config.phrases.levels, lang);
      dict.levelNames = levelNames;

      // Build day objects for card display
      for (let i = 0; i < days_to_show; i++) {
        const dayData = levels[i];
        dict[`day${i}`] = {
          state: dayData.level,
          value: dayData.value,
          description: levelNames[dayData.level] || "",
        };
      }

      // Check threshold
      const meets = levels
        .slice(0, days_to_show)
        .some((l) => l.level >= pollen_threshold);
      if (meets || pollen_threshold === 0) sensors.push(dict);
    } catch (e) {
      console.warn(`Kleenex adapter error for allergen ${allergenKey}:`, e);
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