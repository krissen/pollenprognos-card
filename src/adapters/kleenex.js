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
  pollen_threshold: 0,
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
// Based on typical pollen count ranges - similar to SILAM thresholds
function ppmToLevel(value) {
  const numVal = Number(value);
  if (isNaN(numVal) || numVal < 0) return -1;
  if (numVal === 0) return 0;
  if (numVal <= 5) return 1;    // Very low
  if (numVal <= 25) return 2;   // Low  
  if (numVal <= 50) return 3;   // Moderate
  if (numVal <= 100) return 4;  // High
  if (numVal <= 200) return 5;  // Very high
  return 6;                     // Extreme
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
    console.debug("[Kleenex] Adapter: start fetchForecast", { config, lang });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all kleenex sensors
  const kleenexSensors = Object.values(hass.states).filter((entity) => {
    return entity.entity_id && entity.entity_id.startsWith(`sensor.${DOMAIN}_`);
  });

  if (debug) {
    console.debug("[Kleenex] Sensors found:", kleenexSensors.map(s => s.entity_id));
  }

  const sensors = [];
  const allergenData = new Map(); // Map to collect data by allergen name

  if (debug) {
    console.debug(`[Kleenex] Processing ${kleenexSensors.length} sensors for allergens:`, config.allergens);
  }

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

    if (debug) {
      console.debug(`[Kleenex] Processing sensor ${sensor.entity_id}, category: ${sensorCategory}, details count: ${details.length}, forecast days: ${forecastData.length}`);
    }

    // Process general category sensor (trees, grass, weeds) - only if category is requested
    if (sensorCategory && config.allergens.includes(sensorCategory)) {
      if (debug) {
        console.debug(`[Kleenex] Processing CATEGORY sensor for: ${sensorCategory}`);
      }

      if (!allergenData.has(sensorCategory)) {
        allergenData.set(sensorCategory, {
          levels: [],
          entity_id: sensor.entity_id,
          source: 'category_sensor' // Track data source
        });
      }

      const allergenEntry = allergenData.get(sensorCategory);
      
      // Today's data from sensor state - prioritize numeric value over level text
      const sensorValue = Number(sensor.state) || 0;
      const currentLevel = ppmToLevel(sensorValue); // Always use numeric value for level calculation
      
      if (debug) {
        console.debug(`[Kleenex] CATEGORY ${sensorCategory} TODAY: sensor_state=${sensor.state}, parsed_value=${sensorValue}, calculated_level=${currentLevel}, text_level=${sensor.attributes?.level}`);
      }
      
      allergenEntry.levels[0] = {
        date: new Date(today),
        level: currentLevel,
        value: sensorValue
      };
      
      // Forecast data for categories
      forecastData.forEach((forecastItem, dayIndex) => {
        const forecastValue = Number(forecastItem.value) || 0;
        const forecastLevel = ppmToLevel(forecastValue); // Always use numeric value for level calculation
        
        if (debug) {
          console.debug(`[Kleenex] CATEGORY ${sensorCategory} FORECAST day ${dayIndex + 1}: value=${forecastValue}, level=${forecastLevel}, text_level=${forecastItem.level}`);
        }
        
        allergenEntry.levels[dayIndex + 1] = {
          date: new Date(today.getTime() + (dayIndex + 1) * 86400000),
          level: forecastLevel,
          value: forecastValue
        };
      });
    }

    // Extract individual allergens from current details - only if specific allergen is requested
    for (const detail of details) {
      const allergenName = detail.name?.toLowerCase();
      if (!allergenName) continue;

      const canonicalName = KLEENEX_ALLERGEN_MAP[allergenName] || allergenName;
      
      // Skip if this allergen is not in the config
      if (!config.allergens.includes(canonicalName)) {
        if (debug && detail.value !== undefined) {
          console.debug(`[Kleenex] SKIPPING individual allergen ${canonicalName} (${allergenName}): not in config allergens`);
        }
        continue;
      }

      if (debug) {
        console.debug(`[Kleenex] Processing INDIVIDUAL allergen: ${canonicalName} (original: ${allergenName})`);
      }

      if (!allergenData.has(canonicalName)) {
        allergenData.set(canonicalName, {
          levels: [],
          entity_id: sensor.entity_id,
          source: 'individual_details' // Track data source
        });
      }

      const allergenEntry = allergenData.get(canonicalName);
      
      // Today's data - prioritize numeric value over level text
      const detailValue = Number(detail.value) || 0;
      const currentLevel = ppmToLevel(detailValue); // Always use numeric value for level calculation
      
      if (debug) {
        console.debug(`[Kleenex] INDIVIDUAL ${canonicalName} TODAY: detail_value=${detail.value}, parsed_value=${detailValue}, calculated_level=${currentLevel}, text_level=${detail.level}, source=${sensor.entity_id}`);
      }
      
      // Only set if not already set by category processing (avoid overwriting)
      if (!allergenEntry.levels[0] || allergenEntry.source === 'individual_details') {
        allergenEntry.levels[0] = {
          date: new Date(today),
          level: currentLevel,
          value: detailValue
        };
      }
    }

    // Extract forecast data for each day (individual allergens)
    forecastData.forEach((forecastItem, dayIndex) => {
      const forecastDate = new Date(today.getTime() + (dayIndex + 1) * 86400000);
      const forecastDetails = forecastItem.details || [];

      if (debug && forecastDetails.length > 0) {
        console.debug(`[Kleenex] Processing forecast day ${dayIndex + 1} with ${forecastDetails.length} allergen details`);
      }

      for (const detail of forecastDetails) {
        const allergenName = detail.name?.toLowerCase();
        if (!allergenName) continue;

        const canonicalName = KLEENEX_ALLERGEN_MAP[allergenName] || allergenName;
        
        // Skip if this allergen is not in the config
        if (!config.allergens.includes(canonicalName)) continue;

        if (!allergenData.has(canonicalName)) {
          allergenData.set(canonicalName, {
            levels: [],
            entity_id: sensor.entity_id,
            source: 'individual_forecast' // Track data source
          });
        }

        const allergenEntry = allergenData.get(canonicalName);
        const forecastValue = Number(detail.value) || 0;
        const forecastLevel = ppmToLevel(forecastValue); // Always use numeric value for level calculation
        
        if (debug) {
          console.debug(`[Kleenex] INDIVIDUAL ${canonicalName} FORECAST day ${dayIndex + 1}: detail_value=${detail.value}, parsed_value=${forecastValue}, calculated_level=${forecastLevel}, text_level=${detail.level}`);
        }
        
        // Only set if not already set by category processing (avoid overwriting)
        const dayIdx = dayIndex + 1;
        if (!allergenEntry.levels[dayIdx] || allergenEntry.source === 'individual_forecast' || allergenEntry.source === 'individual_details') {
          allergenEntry.levels[dayIdx] = {
            date: forecastDate,
            level: forecastLevel,
            value: forecastValue
          };
        }
      }
    });
  }

  if (debug) {
    console.debug(`[Kleenex] Collected data for ${allergenData.size} allergens:`, Array.from(allergenData.keys()));
    allergenData.forEach((data, allergen) => {
      console.debug(`[Kleenex] Final data for ${allergen}: source=${data.source}, levels=${data.levels.length}, today_value=${data.levels[0]?.value}, today_level=${data.levels[0]?.level}`);
    });
  }

  // Configuration for day labels
  const daysRelative = config.days_relative ?? stubConfigKleenex.days_relative;
  const dayAbbrev = config.days_abbreviated ?? stubConfigKleenex.days_abbreviated;
  const daysUppercase = config.days_uppercase ?? stubConfigKleenex.days_uppercase;
  const userDays = config.phrases?.days || {};
  const locale = lang.replace("_", "-");

  // Build sensor data for each allergen
  for (const [allergenKey, allergenInfo] of allergenData) {
    try {
      const dict = {};
      dict.allergenReplaced = allergenKey;
      dict.entity_id = allergenInfo.entity_id;
      dict.days = []; // Initialize days array
      
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
        const d = dayData.date;
        const diff = Math.round((d - today) / 86400000);
        
        // Generate day label using same logic as other adapters
        let dayLabel;
        if (!daysRelative) {
          dayLabel = d.toLocaleDateString(locale, {
            weekday: dayAbbrev ? "short" : "long",
          });
          dayLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
        } else if (userDays[diff] != null) {
          dayLabel = userDays[diff];
        } else if (diff >= 0 && diff <= 2) {
          dayLabel = t(`card.days.${diff}`, lang);
        } else {
          dayLabel = d.toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
          });
        }
        if (daysUppercase) dayLabel = dayLabel.toUpperCase();

        const dayObj = {
          name: dict.allergenCapitalized,
          day: dayLabel,
          state: dayData.level,
          state_text: levelNames[dayData.level] || "",
          value: dayData.value,
          description: levelNames[dayData.level] || "",
        };

        dict[`day${i}`] = dayObj;
        dict.days.push(dayObj);
      }

      // Check threshold
      const meets = dict.days.some((d) => d.state >= pollen_threshold);
      const shouldAdd = meets || pollen_threshold === 0;
      
      if (debug) {
        console.debug(`[Kleenex] THRESHOLD CHECK for ${allergenKey}: meets=${meets}, pollen_threshold=${pollen_threshold}, shouldAdd=${shouldAdd}, days_length=${dict.days.length}`);
      }
      
      if (shouldAdd) {
        sensors.push(dict);
        if (debug) {
          console.debug(`[Kleenex] SENSOR ADDED for ${allergenKey}: today_state=${dict.day0?.state}, entity_id=${dict.entity_id}`);
        }
      }
    } catch (e) {
      console.warn(`[Kleenex] Adapter error for allergen ${allergenKey}:`, e);
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

  if (debug) {
    console.debug("[Kleenex] Adapter complete sensors:", sensors);
    console.debug(`[Kleenex] ADAPTER FINAL RESULTS: returning ${sensors.length} sensors`);
    sensors.forEach(sensor => {
      console.debug(`[Kleenex] FINAL SENSOR ${sensor.allergenReplaced}: day0_state=${sensor.day0?.state}, day0_value=${sensor.day0?.value}, days_length=${sensor.days?.length}, first_day_state=${sensor.days?.[0]?.state}, entity_id=${sensor.entity_id}`);
      // Show first few days of data for debugging
      sensor.days?.slice(0, 3).forEach((day, i) => {
        console.debug(`[Kleenex] FINAL SENSOR ${sensor.allergenReplaced} day${i}: state=${day.state}, value=${day.value}, day=${day.day}`);
      });
    });
  }
  return sensors;
}

// Stub functions to match other adapters
export function findSensors() {
  return [];
}

export async function getData() {
  return [];
}