// src/adapters/silam.js
import { t, detectLang } from "../i18n.js";
import { normalize } from "../utils/normalize.js";
import { findSilamWeatherEntity } from "../utils/silam.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";

// Läs in mapping och namn för allergener
import silamAllergenMap from "./silam_allergen_map.json" assert { type: "json" };

// Skapa stubConfigSILAM – allergener i master/engelsk slugform!
export const stubConfigSILAM = {
  integration: "silam",
  location: "",
  // Optional entity naming used when location is "manual"
  entity_prefix: "",
  entity_suffix: "",
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
  minimal_gap: 35,
  mode: "daily",
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
  index_top: true,
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

// All possible allergens for the SILAM integration
export const SILAM_ALLERGENS = [...stubConfigSILAM.allergens, "index"];

export const SILAM_THRESHOLDS = {
  // birch: [5, 25, 50, 100, 500, 1000, 5000],
  // grass: [5, 25, 50, 100, 500, 1000, 5000],
  // hazel: [5, 25, 50, 100, 500, 1000, 5000],
  // The above are the correct level thresholds
  // The below has lower thresholds specifically for the first, lowest level.
  // Just seemed odd to have documented pollen levels, but tell the user that
  // there is *none.*
  birch: [1, 25, 50, 100, 500, 1000, 5000],
  grass: [1, 25, 50, 100, 500, 1000, 5000],
  hazel: [1, 25, 50, 100, 500, 1000, 5000],
  alder: [1, 10, 25, 50, 100, 500, 1000],
  ragweed: [1, 10, 25, 50, 100, 500, 1000],
  mugwort: [1, 10, 25, 50, 100, 500, 1000],
  olive: [1, 10, 25, 50, 100, 500, 1000],
};

export function grainsToLevel(allergen, grains) {
  const arr = SILAM_THRESHOLDS[allergen];
  if (!arr) return -1;
  if (isNaN(grains)) return -1;
  if (grains < arr[0]) return 0;
  if (grains < arr[1]) return 1;
  if (grains < arr[2]) return 2;
  if (grains < arr[3]) return 3;
  if (grains < arr[4]) return 4;
  if (grains < arr[5]) return 5;
  return 6;
}

export function indexToLevel(val) {
  if (val == null) return -1;
  const scale = [0, 1, 3, 5, 6];
  const map = {
    very_low: 0,
    low: 1,
    moderate: 2,
    high: 3,
    very_high: 4,
  };
  if (typeof val === "string") {
    const idx = map[val.toLowerCase()];
    return idx == null ? -1 : scale[Math.max(0, Math.min(idx, 4))];
  }
  const num = Number(val);
  if (!isNaN(num)) {
    const idx = Math.max(0, Math.min(Math.round(num), 4));
    return scale[idx];
  }
  return -1;
}

export function getPhrases(config, lang) {
  const phrases = {
    full: {},
    short: {},
    levels: [],
    days: {},
    no_information: "",
    ...(config.phrases || {}),
  };
  phrases.no_information =
    phrases.no_information || t("card.no_information", lang);
  return phrases;
}

export function getLevelNames(phrases, lang) {
  return buildLevelNames(phrases.levels, lang);
}

export function getAllergenNames(allergen, phrases, lang) {
  // Capitalized: phrases > silamAllergenMap > fallback
  let allergenCapitalized;
  if (phrases.full[allergen]) {
    allergenCapitalized = phrases.full[allergen];
  } else if (
    silamAllergenMap.names &&
    silamAllergenMap.names[allergen] &&
    silamAllergenMap.names[allergen][lang]
  ) {
    allergenCapitalized = silamAllergenMap.names[allergen][lang];
  } else {
    allergenCapitalized = allergen.charAt(0).toUpperCase() + allergen.slice(1);
  }

  // Short: phrases > capitalized
  const allergenShort = phrases.short[allergen] || allergenCapitalized;

  return { allergenCapitalized, allergenShort };
}

export async function fetchForecast(hass, config, forecastEvent = null) {
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

  const phrases = getPhrases(config, lang);
  const levelNames = getLevelNames(phrases, lang);
  const noInfoLabel = phrases.no_information;
  const userDays = phrases.days;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days_to_show = config.days_to_show ?? stubConfigSILAM.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigSILAM.pollen_threshold;

  // Hitta weather-entity
  const locationSlug =
    config.location === "manual" ? "" : (config.location || "").toLowerCase();
  const weatherEntity = findSilamWeatherEntity(hass, locationSlug, locale);

  if (!weatherEntity || !hass.states[weatherEntity]) {
    if (debug)
      console.warn("[SILAM] Ingen weather-entity hittad:", weatherEntity);
    return [];
  }

  const entity = hass.states[weatherEntity];
  const rawAllergens = config.allergens || stubConfigSILAM.allergens;
  const allergens = rawAllergens.map((raw) => {
    const norm = normalize(raw);
    // Translate user-facing slugs (e.g. 'index') to internal canonicals
    return ALLERGEN_TRANSLATION[norm] || norm;
  });

  // Forecast-array: från forecastEvent om det finns, annars från entity
  let forecastArr = [];
  if (
    forecastEvent &&
    forecastEvent.forecast &&
    Array.isArray(forecastEvent.forecast)
  ) {
    forecastArr = forecastEvent.forecast;
  } else if (Array.isArray(entity.attributes.forecast)) {
    forecastArr = entity.attributes.forecast;
  }

  // Hur många dagar/kolumner som ska visas
  // För daily används dag0 + första n forecast, för hourly/twice_daily används forecast direkt
  let maxItems;
  if (config.mode === "hourly" || config.mode === "twice_daily") {
    maxItems = Math.min(forecastArr.length, days_to_show);
  } else {
    maxItems = Math.min(forecastArr.length + 1, days_to_show);
  }

  const sensors = [];
  for (const allergen of allergens) {
    try {
      const dict = {};
      dict.days = [];
      dict.allergenReplaced = allergen;

      // Namn-uppslag
      const { allergenCapitalized, allergenShort } = getAllergenNames(
        allergen,
        phrases,
        lang,
      );
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = config.allergens_abbreviated
        ? allergenShort
        : allergenCapitalized;
      if (allergen === "allergy_risk") {
        const name = silamAllergenMap.names?.allergy_risk?.[lang] || "Index";
        dict.allergenCapitalized = name;
        dict.allergenShort = name;
      }

      // Attempt to find the matching sensor entity for this allergen
      let sensorId = null;
      if (config.location === "manual") {
        let slug = null;
        for (const mapping of Object.values(silamAllergenMap.mapping)) {
          const inverse = Object.entries(mapping).reduce(
            (acc, [ha, master]) => {
              acc[master] = ha;
              return acc;
            },
            {},
          );
          if (inverse[allergen]) {
            slug = inverse[allergen];
            break;
          }
        }
        slug = slug || allergen;
        const prefix = config.entity_prefix || "";
        const suffix = config.entity_suffix || "";
        const candidate = `sensor.${prefix}${slug}${suffix}`;
        if (hass.states[candidate]) sensorId = candidate;
      } else {
        for (const mapping of Object.values(silamAllergenMap.mapping)) {
          const inverse = Object.entries(mapping).reduce(
            (acc, [ha, master]) => {
              acc[master] = ha;
              return acc;
            },
            {},
          );
          if (inverse[allergen]) {
            const candidate = `sensor.silam_pollen_${locationSlug}_${inverse[allergen]}`;
            if (hass.states[candidate]) {
              sensorId = candidate;
              break;
            }
          }
        }
        if (!sensorId) {
          const fallback = `sensor.silam_pollen_${locationSlug}_${allergen}`;
          if (hass.states[fallback]) sensorId = fallback;
        }
      }
      dict.entity_id = sensorId;

      // Samla nivåer per dag/kolumn (olika för daily och övriga lägen)
      let stateList = [];
      if (allergen === "allergy_risk") {
        if (config.mode === "hourly" || config.mode === "twice_daily") {
          for (let i = 0; i < maxItems; ++i) {
            const forecast = forecastArr[i];
            const val = forecast
              ? forecast.index ?? forecast.pollen_index
              : null;
            stateList.push(indexToLevel(val));
          }
        } else {
          const currentVal =
            entity.attributes.index ??
            entity.attributes.pollen_index ??
            entity.state;
          stateList.push(indexToLevel(currentVal));
          for (let i = 1; i < maxItems; ++i) {
            const forecast = forecastArr[i - 1];
            const val = forecast
              ? forecast.index ?? forecast.pollen_index
              : null;
            stateList.push(indexToLevel(val));
          }
        }
      } else {
        if (config.mode === "hourly" || config.mode === "twice_daily") {
          for (let i = 0; i < maxItems; ++i) {
            const forecast = forecastArr[i];
            const pollenVal = forecast
              ? Number(forecast[`pollen_${allergen}`])
              : NaN;
            stateList.push(grainsToLevel(allergen, pollenVal));
          }
        } else {
          const currentVal = Number(entity.attributes[`pollen_${allergen}`]);
          stateList.push(grainsToLevel(allergen, currentVal));
          for (let i = 1; i < maxItems; ++i) {
            const forecast = forecastArr[i - 1];
            const pollenVal = forecast
              ? Number(forecast[`pollen_${allergen}`])
              : NaN;
            stateList.push(grainsToLevel(allergen, pollenVal));
          }
        }
      }

      // Fyll dag-objekt för kortet
      for (let i = 0; i < maxItems; ++i) {
        const scaled = stateList[i];
        let label, icon;
        let d;
        if (config.mode === "hourly" || config.mode === "twice_daily") {
          if (
            forecastArr[i] &&
            (forecastArr[i].datetime || forecastArr[i].time)
          ) {
            d = new Date(forecastArr[i].datetime || forecastArr[i].time);
          } else {
            d = new Date(today.getTime() + i * 3600000); // fallback
          }
          if (config.mode === "twice_daily") {
            const weekday = d.toLocaleDateString(locale, { weekday: "short" });
            label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
            icon =
              i % 2 === 0 ? "mdi:weather-sunset-up" : "mdi:weather-sunset-down";
            if (daysUppercase) label = label.toUpperCase();
          } else {
            label =
              d.toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              }) || "";
            icon = null;
          }
        } else {
          d = new Date(today.getTime() + i * 86400000);
          if (!daysRelative) {
            label = d.toLocaleDateString(locale, {
              weekday: dayAbbrev ? "short" : "long",
            });
            label = label.charAt(0).toUpperCase() + label.slice(1);
          } else if (userDays[i] != null) {
            label = userDays[i];
          } else if (i >= 0 && i <= 2) {
            label = t(`card.days.${i}`, lang);
          } else {
            label = d.toLocaleDateString(locale, {
              day: "numeric",
              month: "short",
            });
          }
          if (daysUppercase) label = label.toUpperCase();
          icon = null;
        }

        const lvlIndex = scaled < 0 ? 0 : Math.min(Math.round(scaled), 6);
        const stateText =
          scaled < 0 ? noInfoLabel : levelNames[lvlIndex] || String(scaled);

        dict[`day${i}`] = {
          name: dict.allergenCapitalized,
          day: label,
          icon: icon,
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

  // Sortering
  if (config.sort !== "none") {
    sensors.sort(
      {
        value_ascending: (a, b) => (a.day0?.state ?? 0) - (b.day0?.state ?? 0),
        value_descending: (a, b) => (b.day0?.state ?? 0) - (a.day0?.state ?? 0),
        name_ascending: (a, b) =>
          a.allergenCapitalized.localeCompare(b.allergenCapitalized),
        name_descending: (a, b) =>
          b.allergenCapitalized.localeCompare(a.allergenCapitalized),
      }[config.sort] || ((a, b) => (b.day0?.state ?? 0) - (a.day0?.state ?? 0)),
    );
  }

  if (config.index_top || config.allergy_risk_top) {
    const idx = sensors.findIndex(
      (s) =>
        s.allergenReplaced === "allergy_risk" || s.allergenReplaced === "index",
    );
    if (idx > 0) {
      const [special] = sensors.splice(idx, 1);
      sensors.unshift(special);
    }
  }

  if (debug) console.debug("[SILAM] fetchForecast klar:", sensors);
  return sensors;
}
