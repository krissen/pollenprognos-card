// src/adapters/kleenex.js
import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { normalize } from "../utils/normalize.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";

const DOMAIN = "kleenex_pollen_radar";

// Map kleenex allergen names to our canonical names (supports all regional language variations)
const KLEENEX_ALLERGEN_MAP = {
  // Trees - English (EN/US)
  'hazel': 'hazel',
  'elm': 'elm', 
  'pine': 'pine',
  'alder': 'alder',
  'poplar': 'poplar',
  'oak': 'oak',
  'plane': 'plane',
  'birch': 'birch',
  'cypress': 'cypress',

  // Trees - French (FR)
  'noisetier': 'hazel',
  'orme': 'elm',
  'pin': 'pine',
  'aulne': 'alder',
  'peuplier': 'poplar',
  'chêne': 'oak',
  'platane': 'plane',
  'bouleau': 'birch',
  'cyprès': 'cypress',

  // Trees - Italian (IT)
  'nocciolo': 'hazel',
  'olmo': 'elm',
  'pino': 'pine',
  'ontano': 'alder',
  'pioppo': 'poplar',
  'quercia': 'oak',
  'platano': 'plane',
  'betulla': 'birch',
  'cipresso': 'cypress',

  // Trees - Dutch (NL)
  'hazelaar': 'hazel',
  'iep': 'elm',
  'pijnboom': 'pine',
  'els': 'alder',
  'populier': 'poplar',
  'eik': 'oak',
  'plataan': 'plane',
  'berk': 'birch',
  'cipres': 'cypress',

  // Grass - Multiple languages
  'grass': 'grass',
  'poaceae': 'poaceae',           // EN/US/FR/NL
  'graminacee': 'poaceae',        // IT

  // Weeds - English (EN/US)
  'weeds': 'weeds',
  'ragweed': 'ragweed',
  'mugwort': 'mugwort',
  'chenopod': 'chenopod',
  'nettle': 'nettle',

  // Weeds - French (FR)
  'ambroisie': 'ragweed',
  'armoise': 'mugwort',
  'chénopodes': 'chenopod',
  'ortie': 'nettle',

  // Weeds - Italian (IT)
  'ambrosia': 'ragweed',
  'artemisia': 'mugwort',
  'chenopodio': 'chenopod',
  'ortica': 'nettle',

  // Weeds - Dutch (NL)
  'ambrosia': 'ragweed',          // Same as Italian
  'bijvoet': 'mugwort',
  'ganzevoet': 'chenopod',
  'brandnetel': 'nettle'
};

export const stubConfigKleenex = {
  integration: "kleenex",
  location: "",
  // Optional entity naming used when location is "manual"
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    // Individual allergens (detailed sensors) - enabled by default, alphabetically ordered
    "alder",
    "birch", 
    "chenopod",
    "cypress",
    "elm",
    "hazel",
    "mugwort",
    "nettle",
    "oak",
    "pine",
    "plane",
    "poaceae",
    "poplar",
    "ragweed",
    // General categories (broad sensors) - disabled by default
    // "trees_cat",
    // "grass_cat", 
    // "weeds_cat",
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

// Category-specific allergen mapping for kleenex integration
const KLEENEX_ALLERGEN_CATEGORIES = {
  // Trees category
  'trees_cat': 'trees',
  'trees': 'trees',        // Keep compatibility for sensor mapping
  'hazel': 'trees',
  'elm': 'trees', 
  'pine': 'trees',
  'alder': 'trees',
  'poplar': 'trees',
  'oak': 'trees',
  'plane': 'trees',
  'birch': 'trees',
  'cypress': 'trees',
  
  // Grass category  
  'grass_cat': 'grass',
  'grass': 'grass',        // Keep compatibility for sensor mapping
  'poaceae': 'grass',
  
  // Weeds category
  'weeds_cat': 'weeds',
  'weeds': 'weeds',        // Keep compatibility for sensor mapping
  'ragweed': 'weeds',
  'mugwort': 'weeds', 
  'chenopod': 'weeds',
  'nettle': 'weeds'
};

// Convert numeric ppm values to level (0-4) using category-specific thresholds
// Based on kleenex integration thresholds: trees [95, 207, 703], weeds [20, 77, 266], grass [29, 60, 341]
function ppmToLevel(value, allergenName) {
  const numVal = Number(value);
  if (isNaN(numVal) || numVal < 0) return -1;
  if (numVal === 0) return 0;
  
  // Get category for this allergen
  const category = KLEENEX_ALLERGEN_CATEGORIES[allergenName] || 'trees'; // Default to trees
  
  // Category-specific thresholds: [low, moderate, high] -> levels 1, 2, 3, with 4 being very-high
  let thresholds;
  switch (category) {
    case 'trees':
      thresholds = [95, 207, 703];
      break;
    case 'weeds': 
      thresholds = [20, 77, 266];
      break;
    case 'grass':
      thresholds = [29, 60, 341];
      break;
    default:
      thresholds = [95, 207, 703]; // Default to trees
  }
  
  if (numVal <= thresholds[0]) return 1;      // low
  if (numVal <= thresholds[1]) return 2;      // moderate  
  if (numVal <= thresholds[2]) return 3;      // high
  return 4;                                   // very-high
}

// Scale kleenex levels (0-4) to display levels (0-6) similar to peu.js
// Maps: 0→0, 1→1, 2→3, 3→5, 4→6 (skipping display levels 2 and 4)
function scaleKleenexLevel(level) {
  if (level <= 0) return 0;
  if (level === 1) return 1;
  if (level === 2) return 3;
  if (level === 3) return 5;
  if (level >= 4) return 6;
  return level;
}

export async function fetchForecast(hass, config) {
  const lang = detectLang(hass, config.date_locale);
  const debug = config.debug;
  const days_to_show = config.days_to_show || stubConfigKleenex.days_to_show;
  const shortPhrases = config.phrases?.short || {};
  const fullPhrases = config.phrases?.full || {};
  const pollen_threshold = 
    config.pollen_threshold ?? stubConfigKleenex.pollen_threshold;

  // Kleenex uses 5-level system (0-4), validate and clamp level values
  const maxLevel = 4;
  const testVal = (v) => {
    const n = Number(v);
    return isNaN(n) || n < 0 ? -1 : n > maxLevel ? maxLevel : n;
  };

  if (debug)
    console.debug("[Kleenex] Adapter: start fetchForecast", { config, lang });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all kleenex sensors
  let kleenexSensors = Object.values(hass.states).filter((entity) => {
    return entity.entity_id && entity.entity_id.startsWith(`sensor.${DOMAIN}_`);
  });

  // Filter by location if specified (and not manual mode)
  if (config.location && config.location !== "manual") {
    const wantedLocation = config.location.toLowerCase().replace(/[^a-z0-9]/g, "_");
    
    if (debug) {
      console.debug(`[Kleenex] Filtering sensors for location: ${config.location} (normalized: ${wantedLocation})`);
    }
    
    kleenexSensors = kleenexSensors.filter((entity) => {
      const eid = entity.entity_id.replace(`sensor.${DOMAIN}_`, "");
      const locPart = eid.replace(/_[^_]+$/, ""); // Remove the last part (allergen/type)
      const matches = locPart === wantedLocation;
      
      if (debug && matches) {
        console.debug(`[Kleenex] Location match: ${entity.entity_id} -> locPart: ${locPart}`);
      }
      
      return matches;
    });
    
    if (debug) {
      console.debug(`[Kleenex] After location filtering: ${kleenexSensors.length} sensors for location '${wantedLocation}'`);
    }
  }

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
    if (sensorCategory) {
      // Map sensor category to config allergen name
      let configAllergenName = sensorCategory;
      if (sensorCategory === 'trees' && config.allergens.includes('trees_cat')) {
        configAllergenName = 'trees_cat';
      } else if (sensorCategory === 'grass' && config.allergens.includes('grass_cat')) {
        configAllergenName = 'grass_cat';  
      } else if (sensorCategory === 'weeds' && config.allergens.includes('weeds_cat')) {
        configAllergenName = 'weeds_cat';
      }
      
      // Only process if the config allergen name is requested
      if (config.allergens.includes(configAllergenName)) {
        if (debug) {
          console.debug(`[Kleenex] Processing CATEGORY sensor for: ${sensorCategory} -> ${configAllergenName}`);
        }

        if (!allergenData.has(configAllergenName)) {
          allergenData.set(configAllergenName, {
            levels: [],
            entity_id: sensor.entity_id,
            source: 'category_sensor' // Track data source
          });
        }

        const allergenEntry = allergenData.get(configAllergenName);
        
        // Today's data from sensor state - prioritize numeric value over level text
        const sensorValue = Number(sensor.state) || 0;
        const rawLevel = ppmToLevel(sensorValue, configAllergenName); // Calculate raw level (0-4)
        const currentLevel = testVal(rawLevel); // Validate and clamp level (0-4)
        
        if (debug) {
          console.debug(`[Kleenex] CATEGORY ${configAllergenName} TODAY: sensor_state=${sensor.state}, parsed_value=${sensorValue}, raw_level=${rawLevel}, clamped_level=${currentLevel}, text_level=${sensor.attributes?.level}`);
        }
        
        allergenEntry.levels[0] = {
          date: new Date(today),
          level: currentLevel, // Store raw level (0-4)
          value: sensorValue
        };
      
        // Forecast data for categories
        forecastData.forEach((forecastItem, dayIndex) => {
          const forecastValue = Number(forecastItem.value) || 0;
          const rawLevel = ppmToLevel(forecastValue, configAllergenName); // Calculate raw level (0-4)
          const forecastLevel = testVal(rawLevel); // Validate and clamp level (0-4)
          
          if (debug) {
            console.debug(`[Kleenex] CATEGORY ${configAllergenName} FORECAST day ${dayIndex + 1}: value=${forecastValue}, raw_level=${rawLevel}, clamped_level=${forecastLevel}, text_level=${forecastItem.level}`);
          }
          
          allergenEntry.levels[dayIndex + 1] = {
            date: new Date(today.getTime() + (dayIndex + 1) * 86400000),
            level: forecastLevel, // Store raw level (0-4)
            value: forecastValue
          };
        });
      }
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
      const rawLevel = ppmToLevel(detailValue, canonicalName); // Calculate raw level (0-4)
      const currentLevel = testVal(rawLevel); // Validate and clamp level (0-4)
      
      if (debug) {
        console.debug(`[Kleenex] INDIVIDUAL ${canonicalName} TODAY: detail_value=${detail.value}, parsed_value=${detailValue}, raw_level=${rawLevel}, clamped_level=${currentLevel}, text_level=${detail.level}, source=${sensor.entity_id}`);
      }
      
      // Only set if not already set by category processing (avoid overwriting)
      if (!allergenEntry.levels[0] || allergenEntry.source === 'individual_details') {
        allergenEntry.levels[0] = {
          date: new Date(today),
          level: currentLevel, // Store raw level (0-4)
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
        const rawLevel = ppmToLevel(forecastValue, canonicalName); // Calculate raw level (0-4)
        const forecastLevel = testVal(rawLevel); // Validate and clamp level (0-4)
        
        if (debug) {
          console.debug(`[Kleenex] INDIVIDUAL ${canonicalName} FORECAST day ${dayIndex + 1}: detail_value=${detail.value}, parsed_value=${forecastValue}, raw_level=${rawLevel}, clamped_level=${forecastLevel}, text_level=${detail.level}`);
        }
        
        // Only set if not already set by category processing (avoid overwriting)
        const dayIdx = dayIndex + 1;
        if (!allergenEntry.levels[dayIdx] || allergenEntry.source === 'individual_forecast' || allergenEntry.source === 'individual_details') {
          allergenEntry.levels[dayIdx] = {
            date: forecastDate,
            level: forecastLevel, // Store raw level (0-4)
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

      // Levels from Kleenex are reported as 0–4 but scaled to 0–6 in the card.
      // Accept either five or seven custom names and map them to the 0–6 scale.
      const userLevels = config.phrases.levels;
      const defaultNumLevels = 5; // original kleenex scale (none, low, moderate, high, very-high)
      const levelNamesDefault = Array.from({ length: 7 }, (_, i) =>
        t(`card.levels.${i}`, lang),
      );
      let levelNames = levelNamesDefault.slice();
      if (Array.isArray(userLevels)) {
        if (userLevels.length === 7) {
          levelNames = buildLevelNames(userLevels, lang);
        } else if (userLevels.length === defaultNumLevels) {
          const map = [0, 1, 3, 5, 6];
          map.forEach((lvl, idx) => {
            const val = userLevels[idx];
            if (val != null && val !== "") levelNames[lvl] = val;
          });
        }
      }
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

        // Scale level for display (0-4 to 0-6)
        const level = dayData.level; // Raw level (0-4)
        const scaledLevel = scaleKleenexLevel(level); // Scale to display level (0-6)

        const dayObj = {
          name: dict.allergenCapitalized,
          day: dayLabel,
          state: level, // Raw level for sorting and threshold checking
          state_text: scaledLevel < 0 ? 
            (config.phrases?.no_information || t("card.no_information", lang)) : 
            levelNames[scaledLevel] || t(`card.levels.${scaledLevel}`, lang),
          value: dayData.value,
          description: scaledLevel < 0 ? 
            (config.phrases?.no_information || t("card.no_information", lang)) : 
            levelNames[scaledLevel] || t(`card.levels.${scaledLevel}`, lang),
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