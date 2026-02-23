import { t } from "../i18n.js";
import { normalizeDWD } from "../utils/normalize.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { getLangAndLocale, buildDayLabel, clampLevel, sortSensors, meetsThreshold, resolveAllergenNames } from "../utils/adapter-helpers.js";

const DOMAIN = "dwd_pollenflug";
const ATTR_VAL_TOMORROW = "state_tomorrow";
const ATTR_VAL_IN_2_DAYS = "state_in_2_days";
const ATTR_DESC_TODAY = "state_today_desc";
const ATTR_DESC_TOMORROW = "state_tomorrow_desc";
const ATTR_DESC_IN_2_DAYS = "state_in_2_days_desc";

export const stubConfigDWD = {
  integration: "dwd",
  region_id: "",
  // Optional entity naming used when region_id is "manual"
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    "erle",
    "ambrosia",
    "esche",
    "birke",
    "hasel",
    "gräser",
    "beifuss",
    "roggen",
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
  days_to_show: 2,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 0.5,
  sort: "value_descending",
  allergy_risk_top: true,
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  phrases: {
    full: {},
    short: {},
    levels: [],
    days: {},
    no_information: "",
  },
};

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } = getLangAndLocale(hass, config, stubConfigDWD.date_locale);

  // Phrases från användar-config har förträde
  const phrases = config.phrases || {};
  const fullPhrases = phrases.full || {};
  const shortPhrases = phrases.short || {};
  const userLevels = phrases.levels;
  const levelNames = buildLevelNames(userLevels, lang);
  const noInfoLabel = phrases.no_information || t("card.no_information", lang);
  const userDays = phrases.days || {};
  const days_to_show = config.days_to_show ?? stubConfigDWD.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigDWD.pollen_threshold;

  if (debug)
    console.debug("DWD adapter: start fetchForecast", { config, lang });

  const testVal = (v) => clampLevel(v, null, -1);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sensors = [];

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      const rawKey = normalizeDWD(allergen);
      dict.allergenReplaced = rawKey;
      // Allergen name resolution
      const { allergenCapitalized, allergenShort } = resolveAllergenNames(rawKey, {
        fullPhrases, shortPhrases, abbreviated: config.allergens_abbreviated, lang, configKey: allergen,
      });
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = allergenShort;

      // Find sensor entity
      let sensorId;
      if (config.region_id === "manual") {
        const prefix = config.entity_prefix || "";
        const suffix = config.entity_suffix || "";
        sensorId = `sensor.${prefix}${rawKey}${suffix}`;
        if (!hass.states[sensorId]) {
          if (suffix === "") {
            // Fallback: search for a unique candidate starting with prefix and slug
            const base = `sensor.${prefix}${rawKey}`;
            const candidates = Object.keys(hass.states).filter((id) =>
              id.startsWith(base),
            );
            if (candidates.length === 1) sensorId = candidates[0];
            else continue;
          } else continue;
        }
      } else {
        sensorId = config.region_id
          ? `sensor.pollenflug_${rawKey}_${config.region_id}`
          : null;
        if (!sensorId || !hass.states[sensorId]) {
          const candidates = Object.keys(hass.states).filter((id) =>
            id.startsWith(`sensor.pollenflug_${rawKey}_`),
          );
          if (candidates.length === 1) sensorId = candidates[0];
          else continue;
        }
      }
      const sensor = hass.states[sensorId];
      dict.entity_id = sensorId;

      // Råvärden
      const todayVal = testVal(sensor.state);
      const tomVal = testVal(sensor.attributes[ATTR_VAL_TOMORROW]);
      const twoVal = testVal(sensor.attributes[ATTR_VAL_IN_2_DAYS]);

      // Nivåer-datum
      const levels = [
        { date: today, level: todayVal },
        { date: new Date(today.getTime() + 86400000), level: tomVal },
        { date: new Date(today.getTime() + 2 * 86400000), level: twoVal },
      ];
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
        });
      }

      // Bygg dict.dayN
      dict.days = [];
      // Bygg dict.dayN och dict.days[]
      levels.forEach((entry, idx) => {
        if (entry.level !== null && entry.level >= 0) {
          const diff = Math.round((entry.date - today) / 86400000);
          const dayLabel = buildDayLabel(entry.date, diff, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale });

          const sensorDesc =
            sensor.attributes[
              idx === 0
                ? ATTR_DESC_TODAY
                : idx === 1
                  ? ATTR_DESC_TOMORROW
                  : ATTR_DESC_IN_2_DAYS
            ] || "";

          const scaled = entry.level * 2;
          const lvlIndex = Math.min(Math.max(Math.round(scaled), 0), 6);
          const stateText =
            lvlIndex < 0 ? noInfoLabel : levelNames[lvlIndex] || sensorDesc;

          dict[`day${idx}`] = {
            name: dict.allergenCapitalized,
            day: dayLabel,
            state: entry.level,
            display_state: scaled,
            state_text: stateText,
          };
          dict.days.push(dict[`day${idx}`]);
        }
      });

      // Filtrera med tröskel
      if (meetsThreshold(dict.days, pollen_threshold)) sensors.push(dict);
    } catch (e) {
      console.warn(`DWD adapter error for allergen ${allergen}:`, e);
    }
  }

  // Sortering
  sortSensors(sensors, config.sort);

  if (debug) console.debug("DWD adapter complete sensors:", sensors);
  return sensors;
}
