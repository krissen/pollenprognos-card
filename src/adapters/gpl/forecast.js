// src/adapters/gpl/forecast.js
import { toCanonicalAllergenKey } from "../../constants.js";
import { buildLevelNames } from "../../utils/level-names.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, clampLevel, sortSensors, meetsThreshold, resolveAllergenNames } from "../../utils/adapter-helpers.js";
import { stubConfigGPL, capitalize } from "./constants.js";
import { resolveEntityIds } from "./discovery.js";

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
      const canonKey = toCanonicalAllergenKey(allergen);
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
