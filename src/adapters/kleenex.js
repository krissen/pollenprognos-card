// src/adapters/kleenex.js
import { t } from "../i18n.js";
import { KLEENEX_LOCALIZED_CATEGORY_NAMES } from "../constants.js";
import { normalize } from "../utils/normalize.js";
import { slugify } from "../utils/slugify.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, clampLevel, sortSensors, meetsThreshold, resolveAllergenNames } from "../utils/adapter-helpers.js";

const DOMAIN = "kleenex_pollen_radar";

// Map kleenex allergen names to our canonical names (supports all regional language variations)
const KLEENEX_ALLERGEN_MAP = {
  // Trees - English (EN/US)
  hazel: "hazel",
  elm: "elm",
  pine: "pine",
  alder: "alder",
  poplar: "poplar",
  oak: "oak",
  plane: "plane",
  birch: "birch",
  cypress: "cypress",

  // Trees - French (FR)
  noisetier: "hazel",
  orme: "elm",
  pin: "pine",
  aulne: "alder",
  peuplier: "poplar",
  chêne: "oak",
  platane: "plane",
  bouleau: "birch",
  cyprès: "cypress",

  // Trees - Italian (IT)
  nocciolo: "hazel",
  olmo: "elm",
  pino: "pine",
  ontano: "alder",
  pioppo: "poplar",
  quercia: "oak",
  platano: "plane",
  betulla: "birch",
  cipresso: "cypress",

  // Trees - Dutch (NL)
  hazelaar: "hazel",
  iep: "elm",
  pijnboom: "pine",
  els: "alder",
  populier: "poplar",
  eik: "oak",
  plataan: "plane",
  berk: "birch",
  cipres: "cypress",

  // Grass - Multiple languages
  grass: "grass",
  poaceae: "poaceae", // EN/US/FR/NL
  graminacee: "poaceae", // IT

  // Weeds - English (EN/US)
  weeds: "weeds",
  ragweed: "ragweed",
  mugwort: "mugwort",
  chenopod: "chenopod",
  nettle: "nettle",

  // Weeds - French (FR)
  ambroisie: "ragweed",
  armoise: "mugwort",
  chénopodes: "chenopod",
  ortie: "nettle",

  // Weeds - Italian (IT)
  ambrosia: "ragweed",
  artemisia: "mugwort",
  chenopodio: "chenopod",
  ortica: "nettle",

  // Weeds - Dutch (NL)
  ambrosia: "ragweed", // Same as Italian
  bijvoet: "mugwort",
  ganzevoet: "chenopod",
  brandnetel: "nettle",
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
  sort_category_allergens_first: true,
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
  trees_cat: "trees",
  trees: "trees", // Keep compatibility for sensor mapping
  hazel: "trees",
  elm: "trees",
  pine: "trees",
  alder: "trees",
  poplar: "trees",
  oak: "trees",
  plane: "trees",
  birch: "trees",
  cypress: "trees",

  // Grass category
  grass_cat: "grass",
  grass: "grass", // Keep compatibility for sensor mapping
  poaceae: "grass",

  // Weeds category
  weeds_cat: "weeds",
  weeds: "weeds", // Keep compatibility for sensor mapping
  ragweed: "weeds",
  mugwort: "weeds",
  chenopod: "weeds",
  nettle: "weeds",
};

// Convert numeric ppm values to level (0-4) using category-specific thresholds
// Based on kleenex integration thresholds: trees [95, 207, 703], weeds [20, 77, 266], grass [29, 60, 341]
function ppmToLevel(value, allergenName) {
  const numVal = Number(value);
  if (isNaN(numVal) || numVal < 0) return -1;
  if (numVal === 0) return 0;

  // Get category for this allergen
  const category = KLEENEX_ALLERGEN_CATEGORIES[allergenName] || "trees"; // Default to trees

  // Category-specific thresholds: [low, moderate, high] -> levels 1, 2, 3, with 4 being very-high
  let thresholds;
  switch (category) {
    case "trees":
      thresholds = [95, 207, 703];
      break;
    case "weeds":
      thresholds = [20, 77, 266];
      break;
    case "grass":
      thresholds = [29, 60, 341];
      break;
    default:
      thresholds = [95, 207, 703]; // Default to trees
  }

  if (numVal <= thresholds[0]) return 1; // low
  if (numVal <= thresholds[1]) return 2; // moderate
  if (numVal <= thresholds[2]) return 3; // high
  return 4; // very-high
}

// Map allergens to the kleenex category they belong to
const INDIVIDUAL_TO_CATEGORY = {
  alder: "trees", birch: "trees", cypress: "trees", elm: "trees",
  hazel: "trees", oak: "trees", pine: "trees", plane: "trees", poplar: "trees",
  poaceae: "grass",
  mugwort: "weeds", ragweed: "weeds", chenopod: "weeds", nettle: "weeds",
};

/**
 * Resolve category-level entity IDs for sensor detection.
 * Returns Map<categoryName, entityId> for the 3 category sensors
 * needed by the configured allergens.
 */
export function resolveEntityIds(cfg, hass, debug = false) {
  const map = new Map();
  const locationSlug = slugify(cfg.location || "");
  const categoryAllergens = ["trees", "grass", "weeds"];

  // Determine which categories are needed
  const needsCategories = new Set();
  for (const allergen of cfg.allergens || []) {
    if (categoryAllergens.includes(allergen)) {
      needsCategories.add(allergen);
    } else if (allergen.endsWith("_cat")) {
      const categoryName = allergen.replace("_cat", "");
      if (categoryAllergens.includes(categoryName)) {
        needsCategories.add(categoryName);
      }
    } else {
      const category = INDIVIDUAL_TO_CATEGORY[allergen];
      if (category) needsCategories.add(category);
    }
  }

  for (const category of needsCategories) {
    let sensorId;
    if (cfg.location === "manual") {
      let prefix = cfg.entity_prefix || "";
      if (prefix.startsWith("sensor.")) prefix = prefix.substring(7);
      if (prefix && !prefix.endsWith("_")) prefix = prefix + "_";
      const suffix = cfg.entity_suffix || "";

      sensorId = `sensor.${prefix}${category}${suffix}`;
      if (!hass.states[sensorId]) {
        const possiblePrefixes = Object.entries(KLEENEX_LOCALIZED_CATEGORY_NAMES)
          .filter(([_, canonical]) => canonical === category)
          .map(([localPrefix]) => localPrefix);

        const expectedPrefix = `sensor.${prefix}`;
        const candidates = Object.keys(hass.states).filter((id) => {
          if (!id.startsWith(expectedPrefix)) return false;
          const middle = id.substring(expectedPrefix.length);
          if (suffix && !middle.endsWith(suffix)) return false;
          const categoryPart = suffix ? middle.substring(0, middle.length - suffix.length) : middle;
          return possiblePrefixes.some((lp) => categoryPart.startsWith(lp));
        });
        if (candidates.length >= 1) sensorId = candidates[0];
      }
    } else {
      sensorId = locationSlug
        ? `sensor.kleenex_pollen_radar_${locationSlug}_${category}`
        : null;
      if (!sensorId || !hass.states[sensorId]) {
        const possiblePrefixes = Object.entries(KLEENEX_LOCALIZED_CATEGORY_NAMES)
          .filter(([_, canonical]) => canonical === category)
          .map(([lp]) => lp);

        const candidates = Object.keys(hass.states).filter((id) => {
          if (!id.startsWith("sensor.kleenex_pollen_radar_")) return false;
          const parts = id.split("_");
          const suffix = parts[parts.length - 1];
          return possiblePrefixes.some((lp) => suffix.startsWith(lp));
        });
        if (candidates.length >= 1) sensorId = candidates[0];
      }
    }

    if (debug) {
      console.debug(
        `[Kleenex:resolveEntityIds] category: '${category}', sensorId: '${sensorId}', exists: ${!!hass.states[sensorId]}`,
      );
    }
    if (hass.states[sensorId]) map.set(category, sensorId);
  }
  return map;
}

export async function fetchForecast(hass, config) {
  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } = getLangAndLocale(hass, config);
  const debug = config.debug;
  const days_to_show = config.days_to_show || stubConfigKleenex.days_to_show;
  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } = mergePhrases(config, lang);
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigKleenex.pollen_threshold;

  // Kleenex uses 5-level system (0-4), validate and clamp level values
  const testVal = (v) => clampLevel(v, 4, -1);

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
    const wantedLocation = slugify(config.location);

    if (debug) {
      console.debug(
        `[Kleenex] Filtering sensors for location: ${config.location} (normalized: ${wantedLocation})`,
      );
    }

    kleenexSensors = kleenexSensors.filter((entity) => {
      const eid = entity.entity_id.replace(`sensor.${DOMAIN}_`, "");
      const locPart = eid.replace(/_[^_]+$/, ""); // Remove the last part (allergen/type)
      const matches = locPart === wantedLocation;

      if (debug && matches) {
        console.debug(
          `[Kleenex] Location match: ${entity.entity_id} -> locPart: ${locPart}`,
        );
      }

      return matches;
    });

    if (debug) {
      console.debug(
        `[Kleenex] After location filtering: ${kleenexSensors.length} sensors for location '${wantedLocation}'`,
      );
    }
  } else if (config.location === "manual") {
    // Manual mode: filter by entity_prefix
    let prefix = config.entity_prefix || "";
    // Remove 'sensor.' prefix if user included it
    if (prefix.startsWith("sensor.")) {
      prefix = prefix.substring(7); // Remove 'sensor.'
    }
    // Add trailing underscore if not present (unless prefix is empty)
    if (prefix && !prefix.endsWith("_")) {
      prefix = prefix + "_";
    }
    
    if (debug) {
      console.debug(
        `[Kleenex] Manual mode filtering with prefix: '${prefix}'`,
      );
    }
    
    if (prefix) {
      const expectedPrefix = `sensor.${prefix}`;
      kleenexSensors = kleenexSensors.filter((entity) => {
        const matches = entity.entity_id.startsWith(expectedPrefix);
        
        if (debug && matches) {
          console.debug(
            `[Kleenex] Manual mode match: ${entity.entity_id}`,
          );
        }
        
        return matches;
      });
      
      if (debug) {
        console.debug(
          `[Kleenex] After manual mode filtering: ${kleenexSensors.length} sensors with prefix '${expectedPrefix}'`,
        );
      }
    }
  }

  if (debug) {
    console.debug(
      "[Kleenex] Sensors found:",
      kleenexSensors.map((s) => s.entity_id),
    );
  }

  let sensors = [];
  const allergenData = new Map(); // Map to collect data by allergen name

  if (debug) {
    console.debug(
      `[Kleenex] Processing ${kleenexSensors.length} sensors for allergens:`,
      config.allergens,
    );
  }

  // Process each kleenex sensor to extract allergen data
  for (const sensor of kleenexSensors) {
    if (debug) {
      console.debug(`[Kleenex] === PROCESSING SENSOR: ${sensor.entity_id} ===`);
    }
    
    const attributes = sensor.attributes || {};
    const details = attributes.details || [];
    const forecastData = attributes.forecast || [];

    // Determine sensor category from entity_id by checking all localized name prefixes
    let sensorCategory = null;
    const entitySuffix = sensor.entity_id.split('_').pop();
    for (const [localizedPrefix, canonicalCategory] of Object.entries(KLEENEX_LOCALIZED_CATEGORY_NAMES)) {
      if (entitySuffix.startsWith(localizedPrefix)) {
        sensorCategory = canonicalCategory;
        break;
      }
    }

    if (debug) {
      console.debug(
        `[Kleenex] Processing sensor ${sensor.entity_id}, category: ${sensorCategory}, details count: ${details.length}, forecast days: ${forecastData.length}`,
      );
    }

    // Process general category sensor (trees, grass, weeds) - only if category is requested
    if (sensorCategory) {
      // Map sensor category to config allergen name
      let configAllergenName = sensorCategory;
      if (
        sensorCategory === "trees" &&
        config.allergens.includes("trees_cat")
      ) {
        configAllergenName = "trees_cat";
      } else if (
        sensorCategory === "grass" &&
        config.allergens.includes("grass_cat")
      ) {
        configAllergenName = "grass_cat";
      } else if (
        sensorCategory === "weeds" &&
        config.allergens.includes("weeds_cat")
      ) {
        configAllergenName = "weeds_cat";
      }

      if (debug) {
        console.debug(
          `[Kleenex] Category sensor mapping: ${sensorCategory} -> ${configAllergenName}, included in config: ${config.allergens.includes(configAllergenName)}`,
        );
      }

      // Only process if the config allergen name is requested
      if (config.allergens.includes(configAllergenName)) {
        if (debug) {
          console.debug(
            `[Kleenex] Processing CATEGORY sensor for: ${sensorCategory} -> ${configAllergenName}`,
          );
        }

        if (!allergenData.has(configAllergenName)) {
          allergenData.set(configAllergenName, {
            levels: [],
            entity_id: sensor.entity_id,
            source: "category_sensor", // Track data source
          });
          
          if (debug) {
            console.debug(`[Kleenex] CREATED allergenData entry for category: ${configAllergenName}`);
          }
        }

        const allergenEntry = allergenData.get(configAllergenName);

        // Today's data from sensor state - prioritize numeric value over level text
        const sensorValue = Number(sensor.state) || 0;
        const rawLevel = ppmToLevel(sensorValue, configAllergenName); // Calculate raw level (0-4)
        const currentLevel = testVal(rawLevel); // Validate and clamp level (0-4)

        if (debug) {
          console.debug(
            `[Kleenex] CATEGORY ${configAllergenName} TODAY: sensor_state=${sensor.state}, parsed_value=${sensorValue}, raw_level=${rawLevel}, clamped_level=${currentLevel}, text_level=${sensor.attributes?.level}`,
          );
        }

        allergenEntry.levels[0] = {
          date: new Date(today),
          level: currentLevel, // Store raw level (0-4)
          value: sensorValue,
        };

        if (debug) {
          console.debug(`[Kleenex] CATEGORY ${configAllergenName} TODAY DATA SET: level=${currentLevel}, value=${sensorValue}`);
        }

        // Forecast data for categories
        forecastData.forEach((forecastItem, dayIndex) => {
          const forecastValue = Number(forecastItem.value) || 0;
          const rawLevel = ppmToLevel(forecastValue, configAllergenName); // Calculate raw level (0-4)
          const forecastLevel = testVal(rawLevel); // Validate and clamp level (0-4)

          if (debug) {
            console.debug(
              `[Kleenex] CATEGORY ${configAllergenName} FORECAST day ${dayIndex + 1}: value=${forecastValue}, raw_level=${rawLevel}, clamped_level=${forecastLevel}, text_level=${forecastItem.level}`,
            );
          }

          allergenEntry.levels[dayIndex + 1] = {
            date: new Date(today.getTime() + (dayIndex + 1) * 86400000),
            level: forecastLevel, // Store raw level (0-4)
            value: forecastValue,
          };
          
          if (debug) {
            console.debug(`[Kleenex] CATEGORY ${configAllergenName} FORECAST DAY ${dayIndex + 1} DATA SET: level=${forecastLevel}, value=${forecastValue}`);
          }
        });
      } else {
        if (debug) {
          console.debug(
            `[Kleenex] SKIPPING category sensor ${sensorCategory} -> ${configAllergenName}: not in config.allergens [${config.allergens.join(', ')}]`,
          );
        }
      }
    }

    // Extract individual allergens from current details - only if specific allergen is requested
    if (debug) {
      console.debug(`[Kleenex] Processing ${details.length} individual allergen details for sensor: ${sensor.entity_id}`);
    }
    
    try {
      for (const detail of details) {
        const allergenName = detail.name?.toLowerCase();
        if (!allergenName) continue;

        const canonicalName = KLEENEX_ALLERGEN_MAP[allergenName] || allergenName;

        // Skip if this allergen is not in the config
        if (!config.allergens.includes(canonicalName)) {
          if (debug && detail.value !== undefined) {
            console.debug(
              `[Kleenex] SKIPPING individual allergen ${canonicalName} (${allergenName}): not in config allergens`,
            );
          }
          continue;
        }

        if (debug) {
          console.debug(
            `[Kleenex] Processing INDIVIDUAL allergen: ${canonicalName} (original: ${allergenName})`,
          );
        }

        if (!allergenData.has(canonicalName)) {
          allergenData.set(canonicalName, {
            levels: [],
            entity_id: sensor.entity_id,
            source: "individual_details", // Track data source
          });
        }

        const allergenEntry = allergenData.get(canonicalName);

        // Today's data - prioritize numeric value over level text
        const detailValue = Number(detail.value) || 0;
        const rawLevel = ppmToLevel(detailValue, canonicalName); // Calculate raw level (0-4)
        const currentLevel = testVal(rawLevel); // Validate and clamp level (0-4)

        if (debug) {
          console.debug(
            `[Kleenex] INDIVIDUAL ${canonicalName} TODAY: detail_value=${detail.value}, parsed_value=${detailValue}, raw_level=${rawLevel}, clamped_level=${currentLevel}, text_level=${detail.level}, source=${sensor.entity_id}`,
          );
        }

        // Only set if not already set by category processing (avoid overwriting)
        if (
          !allergenEntry.levels[0] ||
          allergenEntry.source === "individual_details"
        ) {
          allergenEntry.levels[0] = {
            date: new Date(today),
            level: currentLevel, // Store raw level (0-4)
            value: detailValue,
          };
        }
      }
    } catch (error) {
      if (debug) {
        console.warn(`[Kleenex] Error processing individual allergens for sensor ${sensor.entity_id}:`, error);
      }
    }

    // Extract forecast data for each day (individual allergens)
    try {
      forecastData.forEach((forecastItem, dayIndex) => {
        const forecastDate = new Date(
          today.getTime() + (dayIndex + 1) * 86400000,
        );
        const forecastDetails = forecastItem.details || [];

        if (debug && forecastDetails.length > 0) {
          console.debug(
            `[Kleenex] Processing forecast day ${dayIndex + 1} with ${forecastDetails.length} allergen details`,
          );
        }

        for (const detail of forecastDetails) {
          const allergenName = detail.name?.toLowerCase();
          if (!allergenName) continue;

          const canonicalName =
            KLEENEX_ALLERGEN_MAP[allergenName] || allergenName;

          // Skip if this allergen is not in the config
          if (!config.allergens.includes(canonicalName)) continue;

          if (!allergenData.has(canonicalName)) {
            allergenData.set(canonicalName, {
              levels: [],
              entity_id: sensor.entity_id,
              source: "individual_forecast", // Track data source
            });
          }

          const allergenEntry = allergenData.get(canonicalName);
          const forecastValue = Number(detail.value) || 0;
          const rawLevel = ppmToLevel(forecastValue, canonicalName); // Calculate raw level (0-4)
          const forecastLevel = testVal(rawLevel); // Validate and clamp level (0-4)

          if (debug) {
            console.debug(
              `[Kleenex] INDIVIDUAL ${canonicalName} FORECAST day ${dayIndex + 1}: detail_value=${detail.value}, parsed_value=${forecastValue}, raw_level=${rawLevel}, clamped_level=${forecastLevel}, text_level=${detail.level}`,
            );
          }

          // Only set if not already set by category processing (avoid overwriting)
          const dayIdx = dayIndex + 1;
          if (
            !allergenEntry.levels[dayIdx] ||
            allergenEntry.source === "individual_forecast" ||
            allergenEntry.source === "individual_details"
          ) {
            allergenEntry.levels[dayIdx] = {
              date: forecastDate,
              level: forecastLevel, // Store raw level (0-4)
              value: forecastValue,
            };
          }
        }
      });
    } catch (error) {
      if (debug) {
        console.warn(`[Kleenex] Error processing forecast data for sensor ${sensor.entity_id}:`, error);
      }
    }
  }

  if (debug) {
    console.debug(
      `[Kleenex] === ALLERGEN DATA COLLECTION COMPLETE ===`,
    );
    console.debug(
      `[Kleenex] Collected data for ${allergenData.size} allergens:`,
      Array.from(allergenData.keys()),
    );
    
    if (allergenData.size === 0) {
      console.debug("[Kleenex] WARNING: No allergen data collected! This will result in empty sensors array.");
      console.debug("[Kleenex] Checking config:", { 
        allergens: config.allergens, 
        location: config.location,
        filteredSensorCount: kleenexSensors.length 
      });
      console.debug("[Kleenex] Sensor entity IDs processed:", kleenexSensors.map(s => s.entity_id));
      console.debug("[Kleenex] Was any category sensor found that matches config allergens?");
    } else {
      console.debug("[Kleenex] DETAILED ALLERGEN DATA ANALYSIS:");
      allergenData.forEach((data, allergen) => {
        const isCategory = ["trees_cat", "grass_cat", "weeds_cat"].includes(allergen);
        console.debug(`[Kleenex] === ${allergen.toUpperCase()} (${isCategory ? 'CATEGORY' : 'INDIVIDUAL'}) ===`);
        console.debug(`[Kleenex] Source: ${data.source}`);
        console.debug(`[Kleenex] Entity: ${data.entity_id}`);
        console.debug(`[Kleenex] Levels array length: ${data.levels.length}`);
        console.debug(`[Kleenex] Valid levels count (>= 0): ${data.levels.filter(l => l.level >= 0).length}`);
        
        // Show detailed day-by-day data
        data.levels.forEach((level, i) => {
          const dayName = i === 0 ? 'TODAY' : `DAY+${i}`;
          console.debug(`[Kleenex] ${allergen} ${dayName}: date=${level.date?.toISOString().split('T')[0]}, level=${level.level}, value=${level.value}`);
        });
        
        // Check if today has valid data
        const todayLevel = data.levels[0]?.level;
        const hasValidToday = todayLevel !== undefined && todayLevel >= 0;
        console.debug(`[Kleenex] ${allergen} TODAY DATA CHECK: hasValidToday=${hasValidToday}, todayLevel=${todayLevel}`);
      });
    }
  }

  // Build sensor data for each allergen
  if (debug) {
    console.debug(`[Kleenex] === BUILDING SENSORS FROM ${allergenData.size} COLLECTED ALLERGENS ===`);
    console.debug(`[Kleenex] pollen_threshold = ${pollen_threshold}`);
    allergenData.forEach((data, allergen) => {
      console.debug(`[Kleenex] Building sensor for: ${allergen}, source: ${data.source}, levels_count: ${data.levels.length}`);
      if (data.levels[0]) {
        console.debug(`[Kleenex] ${allergen} today data: level=${data.levels[0].level}, value=${data.levels[0].value}`);
      } else {
        console.debug(`[Kleenex] ${allergen} WARNING: No today data found!`);
      }
    });
  }
  
  // Build sensors array in the correct order
  const allergenKeys = config.sort === "none" 
    ? config.allergens.filter(allergen => allergenData.has(allergen))
    : Array.from(allergenData.keys());
    
  if (debug) {
    console.debug(
      `[Kleenex] Building sensors array ${config.sort === "none" ? "in config order" : "in discovery order"}:`,
      allergenKeys
    );
  }
    
  for (const allergenKey of allergenKeys) {
    const allergenInfo = allergenData.get(allergenKey);
    if (!allergenInfo) continue;
    
    try {
      const dict = {};
      dict.allergenReplaced = allergenKey;
      dict.entity_id = allergenInfo.entity_id;
      dict.days = []; // Initialize days array

      // Allergen name resolution
      const { allergenCapitalized, allergenShort } = resolveAllergenNames(allergenKey, {
        fullPhrases, shortPhrases, abbreviated: config.allergens_abbreviated, lang,
      });
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = allergenShort;

      // Pad levels array to match days_to_show
      const levels = allergenInfo.levels;
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
          value: -1,
        });
      }

      // Fill missing days with -1 values
      for (let i = 0; i < days_to_show; i++) {
        if (!levels[i]) {
          levels[i] = {
            date: new Date(today.getTime() + i * 86400000),
            level: -1,
            value: -1,
          };
        }
      }

      // Levels from Kleenex are reported as 0-4 but scaled to 0-6 in the card.
      // Accept either five or seven custom names and map them to the 0-6 scale.
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

        const dayLabel = buildDayLabel(d, diff, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale });

        // Scale level for display (keep raw 0-4 for state, but scale for level names like PEU)
        const level = dayData.level; // Raw level (0-4)
        // Calculate scaled level for level names (like PEU does)
        let scaledLevel;
        if (level < 0) {
          scaledLevel = level; // Keep -1 as is
        } else if (level < 2) {
          scaledLevel = Math.floor((level * 6) / 4);
        } else {
          scaledLevel = Math.ceil((level * 6) / 4);
        }

        const dayObj = {
          name: dict.allergenCapitalized,
          day: dayLabel,
          state: level, // Raw level for sorting and threshold checking
          state_text:
            scaledLevel < 0
              ? noInfoLabel
              : levelNames[scaledLevel] ||
                t(`card.levels.${scaledLevel}`, lang),
          value: dayData.value,
          description:
            scaledLevel < 0
              ? noInfoLabel
              : levelNames[scaledLevel] ||
                t(`card.levels.${scaledLevel}`, lang),
        };

        dict[`day${i}`] = dayObj;
        dict.days.push(dayObj);
      }

      // Check threshold
      const shouldAdd = meetsThreshold(dict.days, pollen_threshold);

      if (debug) {
        const isCategory = ["trees_cat", "grass_cat", "weeds_cat"].includes(allergenKey);
        console.debug(
          `[Kleenex] === THRESHOLD CHECK for ${allergenKey} (${isCategory ? 'CATEGORY' : 'INDIVIDUAL'}) ===`,
        );
        console.debug(`[Kleenex] pollen_threshold = ${pollen_threshold}`);
        console.debug(`[Kleenex] days.length = ${dict.days.length}`);
        
        // Show detailed level values for debugging
        dict.days.forEach((day, i) => {
          console.debug(`[Kleenex] ${allergenKey} day${i}: state=${day.state}, value=${day.value}, day=${day.day}, meets_threshold=${day.state >= pollen_threshold}`);
        });
        
        console.debug(`[Kleenex] meets = ${meets} (any day >= ${pollen_threshold})`);
        console.debug(`[Kleenex] shouldAdd = ${shouldAdd} (meets || threshold===0)`);
        
        if (isCategory && !shouldAdd) {
          console.debug(`[Kleenex] ❌ CATEGORY ALLERGEN ${allergenKey} FILTERED OUT BY THRESHOLD!`);
          console.debug(`[Kleenex] Highest level found: ${Math.max(...dict.days.map(d => d.state))}`);
        } else if (isCategory && shouldAdd) {
          console.debug(`[Kleenex] ✅ CATEGORY ALLERGEN ${allergenKey} PASSES THRESHOLD CHECK`);
        }
      }

      if (shouldAdd) {
        sensors.push(dict);
        if (debug) {
          console.debug(
            `[Kleenex] SENSOR ADDED for ${allergenKey}: today_state=${dict.day0?.state}, entity_id=${dict.entity_id}`,
          );
        }
      } else {
        if (debug) {
          console.debug(
            `[Kleenex] SENSOR FILTERED OUT for ${allergenKey}: threshold not met (highest level: ${Math.max(...dict.days.map(d => d.state))})`,
          );
        }
      }
    } catch (e) {
      console.warn(`[Kleenex] Adapter error for allergen ${allergenKey}:`, e);
    }
  }

  // Sort sensors - implement two-tiered sorting for kleenex when sort_category_allergens_first is true
  if (config.sort !== "none") {
    if (config.sort_category_allergens_first) {
      const categoryAllergens = sensors.filter((s) =>
        ["trees_cat", "grass_cat", "weeds_cat"].includes(s.allergenReplaced),
      );
      const individualAllergens = sensors.filter(
        (s) =>
          !["trees_cat", "grass_cat", "weeds_cat"].includes(s.allergenReplaced),
      );
      sortSensors(categoryAllergens, config.sort);
      sortSensors(individualAllergens, config.sort);
      sensors = [...categoryAllergens, ...individualAllergens];

      if (debug) {
        console.debug(
          `[Kleenex] Two-tiered sorting: ${categoryAllergens.length} category + ${individualAllergens.length} individual allergens`,
        );
      }
    } else {
      sortSensors(sensors, config.sort);

      if (debug) {
        console.debug(
          `[Kleenex] Standard sorting: ${sensors.length} allergens sorted together`,
        );
      }
    }
  } else if (debug) {
    console.debug(
      `[Kleenex] No sorting applied: ${sensors.length} allergens kept in config order`,
    );
  }

  if (debug) {
    console.debug("[Kleenex] === FINAL ADAPTER RESULTS ===");
    console.debug(`[Kleenex] Total sensors returning: ${sensors.length}`);
    
    if (sensors.length === 0) {
      console.debug("[Kleenex] ❌ NO SENSORS RETURNED! Checking why:");
      console.debug(`[Kleenex] - allergenData.size: ${allergenData.size}`);
      console.debug(`[Kleenex] - pollen_threshold: ${pollen_threshold}`);
      console.debug(`[Kleenex] - config.allergens: [${config.allergens.join(', ')}]`);
      
      // Check if any allergens were filtered by threshold
      let thresholdFiltered = 0;
      allergenData.forEach((data, allergen) => {
        const hasValidLevel = data.levels.some(l => l.level >= pollen_threshold);
        if (!hasValidLevel) {
          thresholdFiltered++;
          console.debug(`[Kleenex] - ${allergen} filtered by threshold (max level: ${Math.max(...data.levels.map(l => l.level))})`);
        }
      });
      console.debug(`[Kleenex] - allergens filtered by threshold: ${thresholdFiltered}`);
      
    } else {
      console.debug("[Kleenex] ✅ SENSORS FOUND:");
      sensors.forEach((sensor, i) => {
        const isCategory = ["trees_cat", "grass_cat", "weeds_cat"].includes(sensor.allergenReplaced);
        console.debug(`[Kleenex] ${i+1}. ${sensor.allergenReplaced} (${isCategory ? 'CATEGORY' : 'INDIVIDUAL'}): day0_state=${sensor.day0?.state}, entity_id=${sensor.entity_id}`);
      });
    }
    
    console.debug("[Kleenex] Adapter fetchForecast complete.");
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

