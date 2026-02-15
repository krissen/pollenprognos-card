// src/adapters/gpl.js
// Adapter for the Google Pollen Levels (pollenlevels) HACS integration.
// Detection uses hass.entities (platform-based) or attribution fallback.
// Sensors classified by attributes.code (plants) or attributes.icon (types).
// Each sensor has state 0-5 and attributes.forecast[] for multi-day data.

import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";

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
    // Manual mode: build entity ID from prefix/suffix and search by attribution
    const prefix = config.entity_prefix || "";
    const suffix = config.entity_suffix || "";

    // Search all GPL sensors for matching prefix/suffix
    for (const [eid, state] of Object.entries(hass.states)) {
      if (state?.attributes?.attribution !== GPL_ATTRIBUTION) continue;
      if (!isGplDataSensor(state)) continue;

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

  // Discover sensors (unless manual mode)
  let discoveredEntities = null;
  if (config.location !== "manual") {
    const discovery = discoverGplSensors(hass, debug);
    const configEntryId = config.location || "";

    let location;
    if (configEntryId && discovery.locations.has(configEntryId)) {
      location = discovery.locations.get(configEntryId);
    } else if (discovery.locations.size) {
      // Use first available location
      location = discovery.locations.values().next().value;
    }

    if (location) {
      discoveredEntities = location.entities;
    }

    if (debug) {
      console.debug("[GPL] Resolved location entities:",
        discoveredEntities ? [...discoveredEntities.entries()] : "none");
    }
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
      const sensorId = resolveEntityId(allergen, hass, config, discoveredEntities, debug);
      if (!sensorId || !hass.states[sensorId]) continue;

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
