// src/adapters/silam.js
import { t, detectLang } from "../i18n.js";
import { normalize } from "../utils/normalize.js";

// Läs in mapping och namn för allergener
import silamAllergenMap from "./silam_allergen_map.json" assert { type: "json" };

// Skapa stubConfigSILAM – allergener i master/engelsk slugform!
export const stubConfigSILAM = {
  integration: "silam",
  location: "",
  allergens: [
    "alder",
    "birch",
    "grass",
    "hazel",
    "mugwort",
    "olive",
    "ragweed",
  ],
  minimal: false,
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
  pollen_threshold: 1,
  sort: "value_descending",
  allergens_abbreviated: false,
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const lang = detectLang(hass, config.date_locale);
  const locale =
    config.date_locale ||
    hass.locale?.language ||
    hass.language ||
    `${lang}-${lang.toUpperCase()}`;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);

  const SILAM_THRESHOLDS = {
    birch: [0, 1, 10, 50, 100, 200, 400],
    grass: [0, 1, 10, 30, 50, 100, 200],
    hazel: [0, 1, 5, 20, 50, 100, 200],
    alder: [0, 1, 5, 20, 50, 100, 200],
    ragweed: [0, 1, 3, 10, 30, 50, 100],
    mugwort: [0, 1, 5, 15, 30, 50, 100],
    olive: [0, 1, 3, 10, 20, 50, 100],
  };

  function grainsToLevel(allergen, grains) {
    const arr = SILAM_THRESHOLDS[allergen];
    if (!arr) return -1;
    if (isNaN(grains)) return -1;
    if (grains <= arr[0]) return 0;
    if (grains <= arr[1]) return 1;
    if (grains <= arr[2]) return 2;
    if (grains <= arr[3]) return 3;
    if (grains <= arr[4]) return 4;
    if (grains <= arr[5]) return 5;
    return 6;
  }

  const phrases = {
    full: {},
    short: {},
    levels: [],
    days: {},
    no_information: "",
    ...(config.phrases || {}),
  };
  const fullPhrases = phrases.full;
  const shortPhrases = phrases.short;
  const userLevels = phrases.levels;
  const levelNames =
    Array.isArray(userLevels) && userLevels.length === 7
      ? userLevels
      : Array.from({ length: 7 }, (_, i) => t(`card.levels.${i}`, lang));
  const noInfoLabel = phrases.no_information || t("card.no_information", lang);
  const userDays = phrases.days;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days_to_show = config.days_to_show ?? stubConfigSILAM.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigSILAM.pollen_threshold;

  // Alla silam-sensorer
  const silamStates = Object.keys(hass.states).filter((id) =>
    id.startsWith("sensor.silam_pollen_"),
  );

  // Bygg lookup
  const sensorLookup = {};
  for (const eid of silamStates) {
    const match = eid.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
    if (!match) continue;
    const rawSlug = normalize(match[2] || "");
    const mapping =
      silamAllergenMap.mapping?.[lang] || silamAllergenMap.mapping?.en || {};
    const masterSlug =
      mapping[rawSlug] || silamAllergenMap.mapping?.en?.[rawSlug];
    if (!masterSlug) continue;
    sensorLookup[masterSlug] = eid;
  }

  const sensors = [];
  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.days = [];
      dict.allergenReplaced = allergen;

      if (fullPhrases[allergen]) {
        dict.allergenCapitalized = fullPhrases[allergen];
      } else if (
        silamAllergenMap.names &&
        silamAllergenMap.names[allergen] &&
        silamAllergenMap.names[allergen][lang]
      ) {
        dict.allergenCapitalized = silamAllergenMap.names[allergen][lang];
      } else {
        dict.allergenCapitalized =
          allergen.charAt(0).toUpperCase() + allergen.slice(1);
      }
      if (config.allergens_abbreviated) {
        const userShort = shortPhrases[allergen];
        dict.allergenShort = userShort || dict.allergenCapitalized;
      } else {
        dict.allergenShort = dict.allergenCapitalized;
      }

      const sensorId = sensorLookup[allergen];
      if (!sensorId || !hass.states[sensorId]) {
        if (debug)
          console.debug(`[SILAM] Ingen sensor för ${allergen}:`, sensorId);
        continue;
      }
      const sensor = hass.states[sensorId];

      // Läs state + forecast/tomorrow
      const mainVal = Number(sensor.state);
      let forecasts = [];
      if (
        sensor.attributes &&
        sensor.attributes.forecast &&
        Array.isArray(sensor.attributes.forecast)
      ) {
        forecasts = sensor.attributes.forecast
          .map((f) => ({
            date: new Date(f.datetime || f.time),
            value: Number(f.value),
          }))
          .filter(
            (f) => !isNaN(f.value) && f.date instanceof Date && !isNaN(f.date),
          );
        forecasts.sort((a, b) => a.date - b.date);
      }

      // Bygg dag-objekt (här sker konverteringen!)
      let stateList = [];
      stateList.push(grainsToLevel(allergen, mainVal));

      // Försök forecast-array
      if (
        sensor.attributes &&
        Array.isArray(sensor.attributes.forecast) &&
        sensor.attributes.forecast.length > 0
      ) {
        for (let i = 1; i < days_to_show; ++i) {
          const dt = new Date(today.getTime() + i * 86400000);
          const forecast = sensor.attributes.forecast.find(
            (f) =>
              Math.abs(
                new Date(f.datetime || f.time).getTime() - dt.getTime(),
              ) <
              12 * 3600 * 1000,
          );
          const forecastVal = forecast
            ? grainsToLevel(allergen, Number(forecast.value))
            : -1;
          stateList.push(forecastVal);
        }
      } else {
        // Saknar forecast-array
        // För dag 2: ta attribute 'tomorrow' om den finns
        if (days_to_show > 1 && sensor.attributes?.tomorrow !== undefined) {
          stateList.push(
            grainsToLevel(allergen, Number(sensor.attributes.tomorrow)),
          );
        } else if (days_to_show > 1) {
          stateList.push(-1);
        }
        // Fyll ut med -1 om fler dagar krävs
        while (stateList.length < days_to_show) {
          stateList.push(-1);
        }
      }

      if (
        stateList.length < days_to_show &&
        sensor.attributes?.tomorrow !== undefined
      ) {
        stateList[1] =
          grainsToLevel(allergen, Number(sensor.attributes.tomorrow)) || -1;
      }

      for (let i = 0; i < days_to_show; ++i) {
        const scaled = stateList[i];
        const d = new Date(today.getTime() + i * 86400000);
        const diff = i;
        let label;
        if (!daysRelative) {
          label = d.toLocaleDateString(locale, {
            weekday: dayAbbrev ? "short" : "long",
          });
          label = label.charAt(0).toUpperCase() + label.slice(1);
        } else if (userDays[diff] != null) {
          label = userDays[diff];
        } else if (diff >= 0 && diff <= 2) {
          label = t(`card.days.${diff}`, lang);
        } else {
          label = d.toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
          });
        }
        if (daysUppercase) label = label.toUpperCase();

        const lvlIndex = scaled < 0 ? 0 : Math.min(Math.round(scaled), 6);
        const stateText =
          scaled < 0 ? noInfoLabel : levelNames[lvlIndex] || String(scaled);

        dict[`day${i}`] = {
          name: dict.allergenCapitalized,
          day: label,
          state: scaled,
          state_text: stateText,
        };
        dict.days.push(dict[`day${i}`]);
      }

      const meets = dict.days.some((d) => d.state >= pollen_threshold);
      if (meets || pollen_threshold === 0) sensors.push(dict);
    } catch (e) {
      if (debug) console.warn(`[SILAM] Fel vid allergen ${allergen}:`, e);
    }
  }

  sensors.sort(
    {
      value_ascending: (a, b) => a.day0.state - b.day0.state,
      value_descending: (a, b) => b.day0.state - a.day0.state,
      name_ascending: (a, b) =>
        a.allergenCapitalized.localeCompare(b.allergenCapitalized),
      name_descending: (a, b) =>
        b.allergenCapitalized.localeCompare(a.allergenCapitalized),
    }[config.sort] || ((a, b) => b.day0.state - a.day0.state),
  );

  if (debug) console.debug("[SILAM] fetchForecast klar:", sensors);
  return sensors;
}
