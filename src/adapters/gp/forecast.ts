// src/adapters/gp/forecast.ts
import type { HomeAssistant } from "../../types/home-assistant.js";
import type { CardConfig } from "../../types/config.js";
import type { PollenSensor, ForecastDay } from "../../types/sensor.js";
import { buildLevelNames } from "../../utils/level-names.js";
import {
  getLangAndLocale,
  mergePhrases,
  buildDayLabel,
  clampLevel,
  sortSensors,
  meetsThreshold,
  resolveAllergenNames,
} from "../../utils/adapter-helpers.js";
import { scaleUpi0_5To0_6 } from "../base.js";
import { stubConfigGP, capitalize } from "./constants.js";
import { resolveEntityIds } from "./discovery.js";

// Forecast attribute keys used by svenove/home-assistant-google-pollen
const FORECAST_ATTRS = ["tomorrow", "day 3", "day 4"];

interface GpLevelDay {
  date: Date;
  level: number;
}

export async function fetchForecast(
  hass: HomeAssistant,
  config: CardConfig,
): Promise<PollenSensor[]> {
  const debug = Boolean(config.debug);
  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } =
    getLangAndLocale(
      hass,
      config,
      stubConfigGP.date_locale as string | undefined,
    );

  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } =
    mergePhrases(config, lang);
  const levelNames = buildLevelNames(
    userLevels as Array<string | null | undefined>,
    lang,
  );
  const days_to_show =
    (config.days_to_show as number | undefined) ??
    (stubConfigGP.days_to_show as number);
  const pollen_threshold =
    (config.pollen_threshold as number | undefined) ??
    (stubConfigGP.pollen_threshold as number);

  // google_pollen uses UPI 0-5
  const testVal = (v: unknown): number => clampLevel(v, 5, -1);

  if (debug)
    console.debug("[GP] Adapter: start fetchForecast", { config, lang });

  const entityMap = resolveEntityIds(config, hass, debug);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let sensors: PollenSensor[] = [];

  for (const allergen of config.allergens as string[]) {
    try {
      const dict = { days: [] as ForecastDay[] } as PollenSensor;
      dict.allergenReplaced = allergen;

      const { allergenCapitalized, allergenShort } = resolveAllergenNames(
        allergen,
        {
          fullPhrases,
          shortPhrases,
          abbreviated: config.allergens_abbreviated as boolean,
          lang,
          capitalize: (s) => capitalize(s.replace(/_/g, " ")),
        },
      );
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = allergenShort;

      const sensorId = entityMap.get(allergen);
      if (!sensorId) continue;

      const sensor = hass.states[sensorId];
      dict.entity_id = sensorId;

      if (debug) {
        console.debug(`[GP] Processing sensor ${sensorId}:`, {
          state: sensor.state,
          index_value: sensor.attributes?.index_value,
        });
      }

      // Today: read index_value attribute (numeric UPI 0-5)
      const todayVal = testVal(sensor.attributes?.index_value);

      // Build levels: today + flat forecast attributes
      const levels: GpLevelDay[] = [{ date: today, level: todayVal }];

      for (let i = 0; i < FORECAST_ATTRS.length; i++) {
        if (levels.length >= days_to_show) break;
        const attrKey = FORECAST_ATTRS[i];
        const val = sensor.attributes?.[attrKey];
        const offset =
          attrKey === "tomorrow"
            ? 1
            : parseInt(attrKey.replace("day ", ""), 10) - 1;
        levels.push({
          date: new Date(today.getTime() + offset * 86400000),
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

      // Build day objects with level scaling (0-5 UPI to 0-6 display)
      for (let i = 0; i < days_to_show; i++) {
        const entry = levels[i];
        if (!entry) continue;

        const diff = Math.round(
          (entry.date.getTime() - today.getTime()) / 86400000,
        );
        const dayLabel = buildDayLabel(entry.date, diff, {
          daysRelative,
          dayAbbrev,
          daysUppercase,
          userDays,
          lang,
          locale,
        });

        const level = entry.level;
        const scaledLevel = scaleUpi0_5To0_6(level);

        const stateText =
          scaledLevel < 0 ? noInfoLabel : levelNames[scaledLevel] || noInfoLabel;

        const dayObj: ForecastDay = {
          name: dict.allergenCapitalized,
          day: dayLabel,
          state: entry.level,
          display_state: entry.level < 0 ? -1 : entry.level,
          state_text: stateText,
        };

        dict.days.push(dayObj);
      }

      if (meetsThreshold(dict.days, pollen_threshold)) {
        sensors.push(dict);
      }
    } catch (e) {
      console.warn(`[GP] Adapter error for allergen ${allergen}:`, e);
    }
  }

  // Sorting with category-first support
  if (config.sort !== "none") {
    if (config.sort_category_allergens_first) {
      const categoryAllergens = sensors.filter((s) =>
        ["trees_cat", "grass_cat", "weeds_cat"].includes(s.allergenReplaced),
      );
      const individualAllergens = sensors.filter(
        (s) =>
          !["trees_cat", "grass_cat", "weeds_cat"].includes(s.allergenReplaced),
      );
      sortSensors(categoryAllergens, config.sort as string);
      sortSensors(individualAllergens, config.sort as string);
      sensors = [...categoryAllergens, ...individualAllergens];
    } else {
      sortSensors(sensors, config.sort as string);
    }
  }

  if (debug) console.debug("[GP] Adapter complete sensors:", sensors);
  return sensors;
}
