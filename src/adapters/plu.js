// src/adapters/plu.js
import { t } from "../i18n.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { slugify } from "../utils/slugify.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, meetsThreshold, resolveAllergenNames } from "../utils/adapter-helpers.js";

const SENSOR_PREFIX = "sensor.pollen_";

// Raw alias names (before slugification) grouped by canonical allergen name
// This is the single source of truth for supported allergens
const RAW_ALIAS_NAMES = {
  sorrel: ["Rumex", "Sorrel", "Ampfer", "Oseille"],
  mugwort: ["Artemisia", "Mugwort", "Beifuß", "Beifuss", "Armoise"],
  birch: ["Betula", "Birch", "Birke", "Bouleau"],
  beech: ["Fagus", "Beech", "Buche", "Hêtre", "Hetre", "Hetra"],
  oak: ["Quercus", "Oak", "Eiche", "Chêne", "Chene"],
  alder: ["Alnus", "Alder", "Erle", "Aulne"],
  ash: ["Fraxinus", "Ash", "Esche", "Frêne", "Frene"],
  goosefoot: ["Chenopodium", "Goosefoot", "Gänsefuß", "Gaensefuss", "Gansefuss", "Chénopode", "Chenopode"],
  poaceae: ["Poacea", "Poaceae", "Grasses", "Gräser", "Graeser", "Graminées", "Graminees"],
  hazel: ["Corylus", "Hazel", "Hasel", "Haselnussstrauch", "Noisetier"],
  plantain: ["Plantago", "Plantain", "Wegerich"],
};

// Canonical allergen list derived from RAW_ALIAS_NAMES (alphabetically sorted)
export const PLU_SUPPORTED_ALLERGENS = Object.keys(RAW_ALIAS_NAMES).sort();

// Slugified alias map exported for sensor discovery helpers
export const PLU_ALIAS_MAP = Object.entries(RAW_ALIAS_NAMES).reduce(
  (acc, [canonical, names]) => {
    const slugged = Array.from(
      new Set(names.map((name) => slugify(name))),
    );
    // Ensure canonical slug is present as alias
    if (!slugged.includes(canonical)) slugged.push(canonical);
    acc[canonical] = slugged;
    return acc;
  },
  {},
);

// Default thresholds per allergen (fallback when sensor attributes are missing)
const DEFAULT_THRESHOLDS = {
  alder: { moderate: 11, high: 51 },
  mugwort: { moderate: 3, high: 7 },
  birch: { moderate: 11, high: 51 },
  beech: { moderate: 11, high: 51 },
  oak: { moderate: 11, high: 51 },
  ash: { moderate: 11, high: 51 },
  goosefoot: { moderate: 4, high: 16 },
  poaceae: { moderate: 6, high: 31 },
  hazel: { moderate: 11, high: 51 },
  plantain: { moderate: 4, high: 16 },
  sorrel: { moderate: 4, high: 16 },
};

export const stubConfigPLU = {
  integration: "plu",
  allergens: [...PLU_SUPPORTED_ALLERGENS],
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
  days_to_show: 1,
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

function resolveSensorId(hass, canonical, debug) {
  const aliases = PLU_ALIAS_MAP[canonical] || [canonical];
  for (const alias of aliases) {
    const sensorId = `${SENSOR_PREFIX}${alias}`;
    if (hass.states[sensorId]) {
      if (debug) {
        console.debug(`[PLU] Using sensor '${sensorId}' for allergen '${canonical}'`);
      }
      return sensorId;
    }
  }
  return null;
}

function parseThreshold(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function valueToLevel(value, thresholds) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return -1;
  if (amount === 0) return 0;
  const { moderate, high } = thresholds;
  if (amount < moderate) return 1;
  if (amount < high) return 2;
  return 3;
}

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } = getLangAndLocale(hass, config);

  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } = mergePhrases(config, lang);

  // Build level names. Allow users to supply 4 or 7 custom labels.
  const fullLevelNames = buildLevelNames(userLevels, lang);
  const levelIndices = [0, 1, 3, 5];
  const levelNames = levelIndices.map((idx, pos) => {
    const custom = Array.isArray(userLevels) ? userLevels[pos] : undefined;
    if (custom != null && custom !== "") return custom;
    return fullLevelNames[idx] || t(`card.levels.${idx}`, lang);
  });

  const pollen_threshold =
    config.pollen_threshold ?? stubConfigPLU.pollen_threshold;

  const days_to_show = Math.max(
    1,
    config.days_to_show ?? stubConfigPLU.days_to_show,
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sensors = [];

  for (const allergen of config.allergens || []) {
    if (!PLU_SUPPORTED_ALLERGENS.includes(allergen)) continue;

    const dict = { days: [] };
    dict.allergenReplaced = allergen;

    const { allergenCapitalized, allergenShort } = resolveAllergenNames(allergen, {
      fullPhrases, shortPhrases, abbreviated: config.allergens_abbreviated, lang,
    });
    dict.allergenCapitalized = allergenCapitalized;
    dict.allergenShort = allergenShort;

    const sensorId = resolveSensorId(hass, allergen, debug);
    if (!sensorId) {
      if (debug) {
        console.debug(`[PLU] No sensor found for allergen '${allergen}'`);
      }
      continue;
    }

    const entity = hass.states[sensorId];
    if (!entity) continue;

    dict.entity_id = sensorId;
    dict.attributes = entity.attributes || {};

    const rawValue = Number(entity.state);
    const thresholds = DEFAULT_THRESHOLDS[allergen] || {
      moderate: 1,
      high: 2,
    };

    const moderate = parseThreshold(
      dict.attributes?.moderate_threshold,
      thresholds.moderate,
    );
    const high = parseThreshold(
      dict.attributes?.high_threshold,
      thresholds.high,
    );
    const level = valueToLevel(rawValue, { moderate, high });

    const referenceDate = dict.attributes?.last_update
      ? new Date(dict.attributes.last_update)
      : today;

    const label = buildDayLabel(referenceDate, 0, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale });

    const stateText =
      level < 0 ? noInfoLabel : levelNames[level] || noInfoLabel;

    const dayObj = {
      name: dict.allergenCapitalized,
      day: label,
      state: level,
      display_state: Number.isFinite(rawValue) ? rawValue : level,
      state_text: stateText,
      thresholds: { moderate, high },
      level_string: dict.attributes?.level || null,
      last_update: dict.attributes?.last_update || null,
      next_poll: dict.attributes?.next_poll || null,
    };

    dict.day0 = dayObj;
    dict.days.push(dayObj);

    // Clamp number of columns according to configuration (only today available)
    while (dict.days.length < days_to_show) {
      dict.days.push({
        name: dict.allergenCapitalized,
        day: "",
        state: -1,
        display_state: -1,
        state_text: noInfoLabel,
      });
    }

    if (meetsThreshold(dict.days.slice(0, 1), pollen_threshold)) {
      sensors.push(dict);
    }
  }

  if (config.sort !== "none") {
    sensors.sort(
      {
        value_ascending: (a, b) =>
          (a.day0?.state ?? 0) - (b.day0?.state ?? 0),
        value_descending: (a, b) =>
          (b.day0?.state ?? 0) - (a.day0?.state ?? 0),
        name_ascending: (a, b) =>
          (a.allergenCapitalized || "").localeCompare(
            b.allergenCapitalized || "",
            lang,
          ),
        name_descending: (a, b) =>
          (b.allergenCapitalized || "").localeCompare(
            a.allergenCapitalized || "",
            lang,
          ),
        none: () => 0,
      }[config.sort] || ((a, b) => (a.day0?.state ?? 0) - (b.day0?.state ?? 0)),
    );
  }

  return sensors;
}

