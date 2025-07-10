// src/adapters/silam.js
import { t, detectLang } from "../i18n.js";
import { normalize } from "../utils/normalize.js";
import { findSilamWeatherEntity } from "../utils/silam.js";

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
  mode: "daily",
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

export const SILAM_THRESHOLDS = {
  birch: [5, 25, 50, 100, 500, 1000, 5000],
  grass: [5, 25, 50, 100, 500, 1000, 5000],
  hazel: [5, 25, 50, 100, 500, 1000, 5000],
  alder: [1, 10, 25, 50, 100, 500, 1000],
  ragweed: [1, 10, 25, 50, 100, 500, 1000],
  mugwort: [1, 10, 25, 50, 100, 500, 1000],
  olive: [1, 10, 25, 50, 100, 500, 1000],
};

export function grainsToLevel(allergen, grains) {
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
  return Array.isArray(phrases.levels) && phrases.levels.length === 7
    ? phrases.levels
    : Array.from({ length: 7 }, (_, i) => t(`card.levels.${i}`, lang));
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

  const phrases = getPhrases(config, lang);
  const levelNames = getLevelNames(phrases, lang);
  const noInfoLabel = phrases.no_information;
  const userDays = phrases.days;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days_to_show = config.days_to_show ?? stubConfigSILAM.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigSILAM.pollen_threshold;

  // Alla silam-sensorer
  const locationSlug = (config.location || "").toLowerCase();
  const silamStates = Object.keys(hass.states).filter((id) => {
    const m = id.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
    return m && m[1] === locationSlug;
  });

  // Bygg lookup: ALLA språk, så vi hittar master-key oavsett HA-språk
  const sensorLookup = {};
  for (const eid of silamStates) {
    const match = eid.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
    if (!match) continue;
    const haSlug = match[2];
    let found = false;
    for (const [langKey, mapping] of Object.entries(silamAllergenMap.mapping)) {
      if (mapping[haSlug]) {
        const masterSlug = mapping[haSlug];
        sensorLookup[masterSlug] = eid;
        found = true;
        break;
      }
    }
    if (!found && debug) {
      console.debug(
        `[SILAM][fetchForecast] Hittade ingen master-key för haSlug: '${haSlug}'`,
      );
    }
  }

  const sensors = [];
  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.days = [];
      dict.allergenReplaced = allergen;

      // Centralt namn- och label-uppslag
      const { allergenCapitalized, allergenShort } = getAllergenNames(
        allergen,
        phrases,
        lang,
      );
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = config.allergens_abbreviated
        ? allergenShort
        : allergenCapitalized;

      const sensorId = sensorLookup[allergen];
      if (!sensorId || !hass.states[sensorId]) {
        if (debug)
          console.debug(`[SILAM] Ingen sensor för ${allergen}:`, sensorId);
        continue;
      }
      const sensor = hass.states[sensorId];
      dict.entity_id = sensorId;

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
        if (days_to_show > 1 && sensor.attributes?.tomorrow !== undefined) {
          stateList.push(
            grainsToLevel(allergen, Number(sensor.attributes.tomorrow)),
          );
        } else if (days_to_show > 1) {
          stateList.push(-1);
        }
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
        if (scaled !== null && scaled >= 0) {
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

export async function fetchHourlyForecast(hass, config, forecastEvent = null) {
  const debug = Boolean(config.debug);

  if (forecastEvent) {
    if (debug) {
      console.debug(
        "[SILAM][fetchHourlyForecast] forecastEvent MOTTAGET!",
        forecastEvent,
      );
    }
  } else {
    if (debug) {
      console.debug("[SILAM][fetchHourlyForecast] forecastEvent ÄR NULL!");
    }
  }

  const lang = detectLang(hass, config.date_locale);
  const locale =
    config.date_locale ||
    hass.locale?.language ||
    hass.language ||
    `${lang}-${lang.toUpperCase()}`;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigSILAM.pollen_threshold;

  // Visa alla weather-entities om debug
  if (debug) {
    const weatherEntities = Object.keys(hass.states).filter((id) =>
      id.startsWith("weather.silam_pollen_"),
    );
    console.debug(
      "[SILAM][fetchHourlyForecast] Alla weather-entities i hass:",
      weatherEntities,
    );
    console.debug(
      "[SILAM][fetchHourlyForecast] config.location:",
      config.location,
      "-> locationSlug:",
      (config.location || "").toLowerCase(),
    );
  }

  // Identifiera weather-entity: auto-detect, eller ge i config (eller bygg från location)
  let locationSlug = (config.location || "").toLowerCase();
  const weatherEntity = findSilamWeatherEntity(hass, locationSlug, locale);

  if (debug) {
    console.debug(
      "[SILAM][fetchHourlyForecast] Matchad weatherEntity:",
      weatherEntity,
    );
  }

  if (!weatherEntity) {
    if (debug)
      console.warn(
        "[SILAM][fetchHourlyForecast] Ingen weather-entity hittad för locationSlug:",
        locationSlug,
      );
    return [];
  }

  // forecast-array tas primärt från forecastEvent, annars entity.attributes.forecast
  let forecastArr = null;
  if (
    forecastEvent &&
    forecastEvent.forecast &&
    Array.isArray(forecastEvent.forecast)
  ) {
    forecastArr = forecastEvent.forecast;
    if (debug)
      console.debug(
        "[SILAM][fetchHourlyForecast] forecastEvent används! forecast-array längd:",
        forecastArr.length,
        "forecastEvent:",
        forecastEvent,
      );
  } else {
    const entity = hass.states[weatherEntity];
    if (
      entity?.attributes?.forecast &&
      Array.isArray(entity.attributes.forecast)
    ) {
      forecastArr = entity.attributes.forecast;
      if (debug)
        console.debug(
          "[SILAM][fetchHourlyForecast] Fallback till entity.attributes.forecast! forecast-array längd:",
          forecastArr.length,
        );
    }
  }
  if (!forecastArr || !Array.isArray(forecastArr) || forecastArr.length === 0) {
    if (debug)
      console.warn(
        "[SILAM][fetchHourlyForecast] Ingen forecast-array kunde hittas för entity:",
        weatherEntity,
      );
    return [];
  }

  // DRY: Centrala phrases/labels/levels
  const phrases = getPhrases(config, lang);
  const levelNames = getLevelNames(phrases, lang);
  const noInfoLabel = phrases.no_information;
  const allergens = config.allergens || stubConfigSILAM.allergens;

  if (debug) {
    console.debug(
      "[SILAM][fetchHourlyForecast] Allergens att loopa över:",
      allergens,
    );
  }

  // Bygg sensors-array (en per allergen)
  const sensors = [];
  for (const allergen of allergens) {
    try {
      // if (debug) {
      //   console.debug(
      //     `[SILAM][fetchHourlyForecast] Loop allergen: '${allergen}'`,
      //   );
      // }
      const dict = {};
      dict.days = [];
      dict.allergenReplaced = allergen;

      // Centralt namn- och label-uppslag
      const { allergenCapitalized, allergenShort } = getAllergenNames(
        allergen,
        phrases,
        lang,
      );
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = config.allergens_abbreviated
        ? allergenShort
        : allergenCapitalized;

      for (let i = 0; i < forecastArr.length; ++i) {
        const f = forecastArr[i];
        const key = `pollen_${allergen}`;
        const pollenVal = Number(f[key]);
        const scaled = grainsToLevel(allergen, pollenVal);
        if (scaled !== null && scaled >= 0) {
          const stateText =
            scaled < 0 ? noInfoLabel : levelNames[scaled] || String(scaled);
          const d = new Date(f.datetime || f.time);

          let dayLabel, dayIcon;
          if (config.mode === "twice_daily") {
            const weekday = d.toLocaleDateString(locale, { weekday: "short" });
            dayLabel = weekday.charAt(0).toUpperCase() + weekday.slice(1);
            dayIcon =
              i % 2 === 0 ? "mdi:weather-sunset-up" : "mdi:weather-sunset-down";
            // console.debug("Icon: ", dayIcon);
            if (config.days_uppercase) dayLabel = dayLabel.toUpperCase();
          } else {
            dayLabel =
              d.toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              }) || "";
            dayIcon = null;
          }

          dict[`day${i}`] = {
            name: dict.allergenCapitalized,
            day: dayLabel,
            icon: dayIcon,
            state: scaled,
            state_text: stateText,
          };
          dict.days.push(dict[`day${i}`]);
        }
      }
      // Filtrera på threshold som vanligt
      const meets = dict.days.some((d) => d.state >= pollen_threshold);
      if (debug) {
        console.debug(
          `[SILAM][fetchHourlyForecast] Resultat för allergen ${allergen}:`,
          dict,
          "meets:",
          meets,
        );
      }
      if (meets || pollen_threshold === 0) sensors.push(dict);
    } catch (e) {
      if (debug)
        console.warn(`[SILAM][hourly] Fel vid allergen ${allergen}:`, e);
    }
  }

  if (debug) {
    console.debug("[SILAM][fetchHourlyForecast] Klar. sensors:", sensors);
  }
  return sensors;
}
