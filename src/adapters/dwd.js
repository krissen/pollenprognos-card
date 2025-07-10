import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { normalizeDWD } from "../utils/normalize.js";

const DOMAIN = "dwd_pollenflug";
const ATTR_VAL_TOMORROW = "state_tomorrow";
const ATTR_VAL_IN_2_DAYS = "state_in_2_days";
const ATTR_DESC_TODAY = "state_today_desc";
const ATTR_DESC_TOMORROW = "state_tomorrow_desc";
const ATTR_DESC_IN_2_DAYS = "state_in_2_days_desc";

export const stubConfigDWD = {
  integration: "dwd",
  region_id: "",
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
  background_color: "",
  show_text_allergen: true,
  show_value_text: true,
  show_value_numeric: false,
  show_value_numeric_in_circle: false,
  show_empty_days: true,
  debug: false,
  days_to_show: 2,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 0.5,
  sort: "value_descending",
  allergens_abbreviated: false,
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

  // Språk- och lokaliseringsinställningar
  const lang = detectLang(hass, config.date_locale);
  const locale = config.date_locale || stubConfigDWD.date_locale;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);

  // Phrases från användar-config har förträde
  const phrases = config.phrases || {};
  const fullPhrases = phrases.full || {};
  const shortPhrases = phrases.short || {};
  const userLevels = phrases.levels;
  const levelNames =
    Array.isArray(userLevels) && userLevels.length === 7
      ? userLevels
      : Array.from({ length: 7 }, (_, i) => t(`card.levels.${i}`, lang));
  const noInfoLabel = phrases.no_information || t("card.no_information", lang);
  const userDays = phrases.days || {};
  const days_to_show = config.days_to_show ?? stubConfigDWD.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigDWD.pollen_threshold;

  if (debug)
    console.debug("DWD adapter: start fetchForecast", { config, lang });

  const testVal = (val) => {
    const n = Number(val);
    return isNaN(n) ? -1 : n;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sensors = [];

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      const rawKey = normalizeDWD(allergen);
      dict.allergenReplaced = rawKey;
      // Canonical key for lookup in locales
      const canonKey = ALLERGEN_TRANSLATION[rawKey] || rawKey;

      // Allergen-namn: använd user phrase, annars i18n, annars default
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

      // Kortnamn beroende på config.allergens_abbreviated
      if (config.allergens_abbreviated) {
        const userShort = shortPhrases[allergen];
        dict.allergenShort =
          userShort ||
          t(`editor.phrases_short.${canonKey}`, lang) ||
          dict.allergenCapitalized;
      } else {
        dict.allergenShort = dict.allergenCapitalized;
      }

      // Hitta sensor
      let sensorId = config.region_id
        ? `sensor.pollenflug_${rawKey}_${config.region_id}`
        : null;
      if (!sensorId || !hass.states[sensorId]) {
        const candidates = Object.keys(hass.states).filter((id) =>
          id.startsWith(`sensor.pollenflug_${rawKey}_`),
        );
        if (candidates.length === 1) sensorId = candidates[0];
        else continue;
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
          let dayLabel;

          if (!daysRelative) {
            // Visa absoluta veckodagar med versal
            dayLabel = entry.date.toLocaleDateString(locale, {
              weekday: dayAbbrev ? "short" : "long",
            });
            dayLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
          } else if (userDays[diff] !== undefined) {
            // Relativa dagar från användarens config
            dayLabel = userDays[diff];
          } else if (diff >= 0 && diff <= 2) {
            // Standard relative days från i18n
            dayLabel = t(`card.days.${diff}`, lang);
          } else {
            // Datum som dag mån
            dayLabel = entry.date.toLocaleDateString(locale, {
              day: "numeric",
              month: "short",
            });
          }
          if (daysUppercase) dayLabel = dayLabel.toUpperCase();

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
            state_text: stateText,
          };
          dict.days.push(dict[`day${idx}`]);
        }
      });

      // Filtrera med tröskel
      const meets = levels
        .slice(0, days_to_show)
        .some((l) => l.level >= pollen_threshold);
      if (meets || pollen_threshold === 0) sensors.push(dict);
    } catch (e) {
      console.warn(`DWD adapter error for allergen ${allergen}:`, e);
    }
  }

  // Sortering
  sensors.sort(
    {
      value_ascending: (a, b) => a.day0.state - b.day0.state,
      value_descending: (a, b) => b.day0.state - a.day0.state,
      name_descending: (a, b) =>
        b.allergenCapitalized.localeCompare(a.allergenCapitalized),
    }[config.sort] || ((a, b) => b.day0.state - a.day0.state),
  );

  if (debug) console.debug("DWD adapter complete sensors:", sensors);
  return sensors;
}
