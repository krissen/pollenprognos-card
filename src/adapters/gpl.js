// src/adapters/gpl.js
// Adapter for the Google Pollen Levels (pollenlevels) HACS integration.
// Detection uses hass.entities (platform-based) or attribution fallback.
// Sensors classified by attributes.code (plants) or attributes.icon (types).
// Each sensor has state 0-5 and attributes.forecast[] for multi-day data.

import { ALLERGEN_TRANSLATION } from "../constants.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, clampLevel, sortSensors, meetsThreshold, resolveAllergenNames } from "../utils/adapter-helpers.js";

// Attribution string used by pollenlevels integration
export const GPL_ATTRIBUTION = "Data provided by Google Maps Pollen API";

// Map pollenlevels TYPE_ICONS to our canonical allergen keys
const GPL_TYPE_ICON_MAP = {
  "mdi:grass": "grass_cat",
  "mdi:tree": "trees_cat",
  "mdi:flower-tulip": "weeds_cat",
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
 * Classify a GPL sensor by its attributes.
 * Returns the allergen key (e.g. "birch", "grass_cat") or null.
 */
function classifySensor(state) {
  const attrs = state?.attributes || {};
  // Plant sensors have a code attribute (always English, e.g. "birch")
  if (attrs.code) {
    return attrs.code.toLowerCase();
  }
  // Type sensors identified by icon
  const iconKey = GPL_TYPE_ICON_MAP[attrs.icon];
  if (iconKey) return iconKey;
  return null;
}

/**
 * Check if an entity is a GPL sensor (not a diagnostic/meta sensor).
 */
function isGplDataSensor(state) {
  const attrs = state?.attributes || {};
  const dc = attrs.device_class;
  return dc !== "date" && dc !== "timestamp";
}

/**
 * Discover all GPL sensors using hass.entities (primary) or attribution (fallback).
 *
 * Returns: { locations: Map<configEntryId, { label: string, entities: Map<allergenKey, entityId> }> }
 *
 * Primary path: hass.entities → filter platform === "pollenlevels", no entity_category
 * Fallback path: hass.states → filter attribution === GPL_ATTRIBUTION, exclude date/timestamp
 */
export function discoverGplSensors(hass, debug = false) {
  const result = { locations: new Map() };
  if (!hass) return result;

  // Collect candidate entity IDs
  let entityIds = [];
  let usedPrimary = false;

  // Primary: hass.entities (entity registry)
  if (hass.entities) {
    const candidates = Object.entries(hass.entities)
      .filter(([, entry]) =>
        entry.platform === "pollenlevels" &&
        !entry.entity_category
      )
      .map(([eid]) => eid);

    if (candidates.length > 0) {
      entityIds = candidates;
      usedPrimary = true;
      if (debug) console.debug("[GPL] Discovery: using hass.entities, found", candidates.length, "candidates");
    }
  }

  // Fallback: attribution scan
  if (!entityIds.length && hass.states) {
    entityIds = Object.keys(hass.states).filter((eid) => {
      const s = hass.states[eid];
      return s?.attributes?.attribution === GPL_ATTRIBUTION && isGplDataSensor(s);
    });
    if (debug) console.debug("[GPL] Discovery: using attribution fallback, found", entityIds.length, "candidates");
  }

  if (!entityIds.length) return result;

  // Group by config_entry_id
  for (const eid of entityIds) {
    const state = hass.states[eid];
    if (!state) continue;

    // Filter out meta sensors in both paths
    if (!isGplDataSensor(state)) continue;

    // Classify sensor
    const allergenKey = classifySensor(state);
    if (!allergenKey) {
      if (debug) console.debug("[GPL] Could not classify sensor:", eid);
      continue;
    }

    // Resolve config_entry_id
    let configEntryId = "default";
    if (usedPrimary && hass.entities?.[eid]?.device_id && hass.devices) {
      const deviceId = hass.entities[eid].device_id;
      const device = hass.devices[deviceId];
      if (device?.config_entries?.length) {
        configEntryId = device.config_entries[0];
      }
    }

    // Get or create location entry
    if (!result.locations.has(configEntryId)) {
      // Generate label from device name or "Auto"
      let label = "Auto";
      if (usedPrimary && hass.entities?.[eid]?.device_id && hass.devices) {
        const deviceId = hass.entities[eid].device_id;
        const device = hass.devices[deviceId];
        if (device?.name) {
          label = device.name;
        }
      } else {
        // Fallback: try friendly_name from first sensor
        const friendly = state.attributes?.friendly_name || "";
        if (friendly) label = friendly;
      }
      result.locations.set(configEntryId, { label, entities: new Map() });
    }

    result.locations.get(configEntryId).entities.set(allergenKey, eid);
  }

  if (debug) {
    console.debug("[GPL] Discovery result:", result.locations.size, "locations");
    for (const [locId, loc] of result.locations) {
      console.debug(`  [${locId}] "${loc.label}":`, [...loc.entities.keys()]);
    }
  }

  return result;
}

/**
 * Get available allergen keys for a given location (config_entry_id).
 * If configEntryId is empty/null, uses the first discovered location.
 * Returns sorted array of allergen keys (e.g. ["grass_cat", "trees_cat", "birch", "oak"]).
 */
export function discoverGplAllergens(hass, configEntryId, debug = false) {
  const discovery = discoverGplSensors(hass, debug);
  if (!discovery.locations.size) return [];

  let location;
  if (configEntryId && discovery.locations.has(configEntryId)) {
    location = discovery.locations.get(configEntryId);
  } else {
    // Use first available location
    location = discovery.locations.values().next().value;
  }

  if (!location) return [];

  const keys = [...location.entities.keys()];
  // Sort: categories first, then plants alphabetically
  const categories = keys.filter((k) => GPL_BASE_ALLERGENS.includes(k)).sort();
  const plants = keys.filter((k) => !GPL_BASE_ALLERGENS.includes(k)).sort();
  return [...categories, ...plants];
}

/**
 * Resolve entity ID for a given allergen and config, using discovery or manual mode.
 * Returns entity ID string or null.
 */
function resolveEntityId(allergen, hass, config, discoveredEntities, debug) {
  if (config.location === "manual") {
    // Manual mode: search by platform (primary) or attribution (fallback) + prefix/suffix filter
    let prefix = config.entity_prefix || "";
    // Remove 'sensor.' prefix if user included it
    if (prefix.startsWith("sensor.")) prefix = prefix.substring(7);
    const suffix = config.entity_suffix || "";

    // Collect candidate entity IDs: primary via hass.entities, fallback via attribution
    let candidateIds = [];
    if (hass.entities) {
      candidateIds = Object.entries(hass.entities)
        .filter(([, entry]) => entry.platform === "pollenlevels" && !entry.entity_category)
        .map(([eid]) => eid);
    }
    if (!candidateIds.length) {
      // Fallback: attribution scan
      candidateIds = Object.keys(hass.states || {}).filter((eid) => {
        const s = hass.states[eid];
        return s?.attributes?.attribution === GPL_ATTRIBUTION && isGplDataSensor(s);
      });
    }

    for (const eid of candidateIds) {
      const state = hass.states[eid];
      if (!state || !isGplDataSensor(state)) continue;

      // Check prefix/suffix match on entity_id
      const idPart = eid.replace(/^sensor\./, "");
      if (prefix && !idPart.startsWith(prefix)) continue;
      if (suffix && !idPart.endsWith(suffix)) continue;

      // Classify and check if it matches the requested allergen
      const key = classifySensor(state);
      if (key === allergen) return eid;
    }

    if (debug) console.debug(`[GPL] Manual mode: no sensor found for allergen "${allergen}"`);
    return null;
  }

  // Discovery-based lookup
  if (discoveredEntities && discoveredEntities.has(allergen)) {
    return discoveredEntities.get(allergen);
  }

  if (debug) console.debug(`[GPL] Sensor not found for allergen "${allergen}"`);
  return null;
}

export function resolveEntityIds(cfg, hass, debug = false) {
  const map = new Map();
  const discovery = discoverGplSensors(hass, debug);
  const configEntryId = cfg.location || "";

  let discoveredEntities = null;
  if (configEntryId !== "manual") {
    let location;
    if (configEntryId && discovery.locations.has(configEntryId)) {
      location = discovery.locations.get(configEntryId);
    } else if (discovery.locations.size) {
      location = discovery.locations.values().next().value;
    }
    if (location) discoveredEntities = location.entities;
  }

  for (const allergen of cfg.allergens || []) {
    const sensorId = resolveEntityId(allergen, hass, cfg, discoveredEntities, debug);
    if (sensorId && hass.states[sensorId]) {
      map.set(allergen, sensorId);
    }
  }
  return map;
}

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } = getLangAndLocale(hass, config, stubConfigGPL.date_locale);

  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } = mergePhrases(config, lang);
  const levelNames = buildLevelNames(userLevels, lang);
  const days_to_show = config.days_to_show ?? stubConfigGPL.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigGPL.pollen_threshold;

  // GPL uses 6-level system (0-5)
  const testVal = (v) => clampLevel(v, 5, -1);

  if (debug) console.debug("[GPL] Adapter: start fetchForecast", { config, lang });

  const entityMap = resolveEntityIds(config, hass, debug);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let sensors = [];

  for (const allergen of config.allergens) {
    try {
      const dict = { days: [] };
      const canonKey = ALLERGEN_TRANSLATION[allergen] || allergen;
      dict.allergenReplaced = allergen;

      // Allergen name resolution
      const { allergenCapitalized, allergenShort } = resolveAllergenNames(allergen, {
        fullPhrases, shortPhrases, abbreviated: config.allergens_abbreviated, lang,
        capitalize: (s) => capitalize(s.replace(/_/g, " ")),
      });
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = allergenShort;

      // Sensor lookup (delegated to resolveEntityIds)
      const sensorId = entityMap.get(allergen);
      if (!sensorId) continue;

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
      // pollenlevels items: { offset, date, has_index, value, category, ... }
      const forecastData = sensor.attributes?.forecast;
      for (const forecastItem of (Array.isArray(forecastData) ? forecastData : [])) {
        if (levels.length >= days_to_show) break;
        // Skip days without valid index data
        if (forecastItem.has_index === false) {
          const offset = forecastItem.offset ?? levels.length;
          levels.push({
            date: new Date(today.getTime() + offset * 86400000),
            level: -1,
          });
          continue;
        }
        const offset = forecastItem.offset ?? levels.length;
        const forecastDate = forecastItem.date
          ? new Date(forecastItem.date)
          : new Date(today.getTime() + offset * 86400000);
        const val = forecastItem.value ?? forecastItem.state ?? forecastItem.level ?? forecastItem;
        levels.push({
          date: forecastDate,
          level: testVal(val),
        });
      }

      // Pad to days_to_show
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
        });
      }

      // Build day objects (always include -1 placeholders so show_empty_days works)
      for (let i = 0; i < days_to_show; i++) {
        const entry = levels[i];
        if (!entry) continue;

        const diff = Math.round((entry.date - today) / 86400000);
        const dayLabel = buildDayLabel(entry.date, diff, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale });

        // Scale level 0-5 to level name index 0-6 (like Kleenex does for 0-4)
        const level = entry.level;
        let scaledLevel;
        if (level < 0) {
          scaledLevel = level;
        } else if (level < 2) {
          scaledLevel = Math.floor((level * 6) / 5);
        } else {
          scaledLevel = Math.ceil((level * 6) / 5);
        }

        const stateText =
          scaledLevel < 0
            ? noInfoLabel
            : levelNames[scaledLevel] || noInfoLabel;

        const dayObj = {
          name: dict.allergenCapitalized,
          day: dayLabel,
          state: entry.level,
          display_state: entry.level < 0 ? -1 : entry.level,
          state_text: stateText,
        };

        dict[`day${i}`] = dayObj;
        dict.days.push(dayObj);
      }

      // Threshold filter
      if (meetsThreshold(dict.days, pollen_threshold)) {
        sensors.push(dict);
      }
    } catch (e) {
      console.warn(`[GPL] Adapter error for allergen ${allergen}:`, e);
    }
  }

  // Sorting
  if (config.sort !== "none") {
    if (config.sort_category_allergens_first) {
      const categoryAllergens = sensors.filter((s) =>
        ["trees_cat", "grass_cat", "weeds_cat"].includes(s.allergenReplaced),
      );
      const individualAllergens = sensors.filter(
        (s) =>
          !["trees_cat", "grass_cat", "weeds_cat"].includes(
            s.allergenReplaced,
          ),
      );
      sortSensors(categoryAllergens, config.sort);
      sortSensors(individualAllergens, config.sort);
      sensors = [...categoryAllergens, ...individualAllergens];
    } else {
      sortSensors(sensors, config.sort);
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
