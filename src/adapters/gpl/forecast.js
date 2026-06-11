// src/adapters/gpl/forecast.js
import { buildLevelNames } from "../../utils/level-names.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, clampLevel, sortSensors, meetsThreshold, resolveAllergenNames, coerceBool, deviceLocationKey } from "../../utils/adapter-helpers.js";
import { stubConfigGPL, capitalize } from "./constants.js";
import { resolveEntityIds } from "./discovery.js";
import { t } from "../../i18n.js";

// Google Pollen API top-type codes -> our canonical category keys.
const TOP_CODE_TO_KEY = { TREE: "trees_cat", GRASS: "grass_cat", WEED: "weeds_cat" };

/**
 * Localize a pollen code to the CARD's language (issue #222). The pollenlevels
 * integration may have fetched its *_names in a different language than the
 * card (e.g. a config entry set to Ukrainian), so we localize from the code
 * via our own translations and only fall back to the integration's name when
 * we have no translation for that code.
 */
function localizeAllergenLabel(key, fallbackName, lang) {
  const tk = `card.allergen.${key}`;
  const tr = t(tk, lang);
  if (typeof tr === "string" && tr && tr !== tk) return tr;
  if (typeof fallbackName === "string" && fallbackName.trim()) return fallbackName.trim();
  return capitalize(String(key).replace(/_/g, " "));
}

/**
 * Subentry-aware location key for an entity, derived from its device.
 *
 * pollenlevels v3 puts several locations under one parent config entry via
 * config subentries (issue #262), so scoping siblings by config entry alone
 * would let a summary in location A bind a sibling in location B (both share
 * the parent entry). deviceLocationKey collapses to the subentry id when the
 * device has one and to the config entry id otherwise, so legacy (one entry
 * per location) and v3 (subentry per location) both scope correctly. Returns
 * the location key, or null when the entity has no resolvable device.
 */
function entityLocationKey(hass, eid) {
  const entry = hass?.entities?.[eid];
  const dev = entry?.device_id ? hass?.devices?.[entry.device_id] : null;
  if (!dev) return null;
  const key = deviceLocationKey(dev);
  return key === "default" ? null : key;
}

/**
 * Resolve a sibling pollenlevels entity in the SAME location as the summary
 * (e.g. plants_in_season_today next to overall_pollen_risk_today).
 * pollenlevels splits a location across several devices (pollen types vs
 * plants), so scope by location key, not device. Matches by translation_key OR
 * unique_id suffix (the frontend's reduced hass.entities does not always
 * expose unique_id, so translation_key is the primary signal). Returns the
 * sibling entity_id or null.
 */
function findSiblingEntityId(hass, summaryEntityId, translationKey, uidSuffix) {
  const entities = hass?.entities;
  if (!entities) return null;
  const summaryKey = entityLocationKey(hass, summaryEntityId);
  for (const [eid, entry] of Object.entries(entities)) {
    const matches =
      entry?.translation_key === translationKey ||
      (typeof entry?.unique_id === "string" && entry.unique_id.endsWith(uidSuffix));
    if (!matches) continue;
    // When the summary has a resolvable location, only accept a sibling from
    // the same location. A candidate without a resolvable key can't be proven
    // same-location, so skip it.
    if (summaryKey !== null && entityLocationKey(hass, eid) !== summaryKey) continue;
    return eid;
  }
  return null;
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

      // Summary block (issue #222): tag the aggregate and enrich it with the
      // v2.1.0 extras (top pollen types + plants in season), each shown as its
      // own text qualifier row under the aggregate. SILAM/Atmo have no
      // equivalent and stay a plain aggregate row.
      if (allergen === "allergy_risk") {
        dict.isSummary = true;
        const attrs = sensor.attributes ?? {};
        // Top types: localize from the canonical category codes in the CARD's
        // language (TREE -> trees_cat -> "Träd"). The integration's *_names may
        // be in another language, so they are only a per-item fallback.
        const topCodes = Array.isArray(attrs.top_pollen_codes) ? attrs.top_pollen_codes : [];
        const topNames = Array.isArray(attrs.top_pollen_names) ? attrs.top_pollen_names : [];
        const topList = topCodes
          .map((code, i) => {
            const key = TOP_CODE_TO_KEY[String(code).toUpperCase()] || String(code).toLowerCase();
            return localizeAllergenLabel(key, topNames[i], lang);
          })
          .filter((n) => typeof n === "string" && n.trim());
        if (topList.length) dict.topPollen = topList;

        // Plants in season: list + count from the sibling
        // `plants_in_season_today` entity (same config entry, shared unique_id
        // prefix). Localize from plant codes in the card language; fall back to
        // the integration's names per item.
        const plantsId = findSiblingEntityId(
          hass,
          sensorId,
          "plants_in_season_today",
          "_plants_in_season_today",
        );
        const plantsState = plantsId ? hass.states[plantsId] : null;
        const pAttrs = plantsState?.attributes ?? {};
        const plantCodes = Array.isArray(pAttrs.plant_codes) ? pAttrs.plant_codes : [];
        const plantNames = Array.isArray(pAttrs.plant_names) ? pAttrs.plant_names : [];
        let plantList;
        if (plantCodes.length) {
          plantList = plantCodes
            .map((code, i) => localizeAllergenLabel(String(code).toLowerCase(), plantNames[i], lang))
            .filter((n) => typeof n === "string" && n.trim());
        } else {
          plantList = plantNames.filter((n) => typeof n === "string" && n.trim());
        }
        if (plantList.length) dict.plantsInSeasonList = plantList;
      }

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

      // Threshold filter. The summary block (issue #222) needs the aggregate
      // retained regardless of threshold, but only when the block is enabled,
      // so existing row behaviour is unchanged when it is off.
      const skipThreshold =
        allergen === "allergy_risk" && coerceBool(config.show_summary_block);
      if (skipThreshold || meetsThreshold(dict.days, pollen_threshold)) {
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

  // Pin the `allergy_risk` summary row to the top when configured. Done
  // after sorting so the user's chosen sort order (and the
  // sort_category_allergens_first grouping above) is preserved for
  // everything else. Mirrors Atmo's allergy_risk_top pattern.
  if (config.allergy_risk_top) {
    const arIdx = sensors.findIndex(
      (s) => s.allergenReplaced === "allergy_risk",
    );
    if (arIdx > 0) sensors.unshift(...sensors.splice(arIdx, 1));
  }

  if (debug) console.debug("[GPL] Adapter complete sensors:", sensors);
  return sensors;
}
