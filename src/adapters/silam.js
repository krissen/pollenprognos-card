// src/adapters/silam.js
import { normalize } from "../utils/normalize.js";
import {
  findSilamWeatherEntity,
  discoverSilamSensors,
  resolveDiscoveredLocation,
} from "../utils/silam.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { toCanonicalAllergenKey } from "../constants.js";
import { t } from "../i18n.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, sortSensors, meetsThreshold, normalizeManualPrefix, resolveManualEntity } from "../utils/adapter-helpers.js";

// Läs in mapping och namn för allergener
import silamAllergenMap from "./silam_allergen_map.json" assert { type: "json" };

// Skapa stubConfigSILAM – allergener i master/engelsk slugform!
export const stubConfigSILAM = {
  integration: "silam",
  location: "",
  // Optional entity naming used when location is "manual".
  // entity_weather points at the weather.* entity that emits forecast
  // events (SILAM derives per-allergen levels from its forecast attribute).
  // Required for manual mode since auto-discovery is bypassed there;
  // ignored otherwise.
  entity_prefix: "",
  entity_suffix: "",
  entity_weather: "",
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

/**
 * Map SILAM's `allergy_risk` categorical state (very_low / low / moderate /
 * high / very_high, plus their numeric forms 0-4) onto the 0-6 visual scale
 * the SILAM card renders against, using the [0, 1, 3, 5, 6] severity steps.
 *
 * This deliberately keeps the runtime spread that PEU dropped in #215.
 * SILAM's case is structurally different from PEU's:
 *
 *  1. The SILAM chart renders `segments = 6` (default branch in the card's
 *     segments switch), and a single SILAM card commonly mixes allergy_risk
 *     with birch / grass / etc. on the *same* chart geometry. The spread
 *     stretches allergy_risk's 5 categorical steps onto the same 6-segment
 *     gradient the other allergens fill, so all rings on a SILAM card share
 *     the same visual scale.
 *  2. The output value is stored as `state`, which the card uses for both
 *     chart fill *and* level-name lookup against the seven-level
 *     `card.levels.0..6` defaults. The spread positions (0, 1, 3, 5, 6)
 *     happen to align with the seven-level palette's "No pollen / Low /
 *     Moderate / High / Very high" entries, so user-visible labels are
 *     semantically correct without per-allergen scale-specific keys.
 *
 * Removing this spread (the pattern PEU used) would either leave allergy_risk
 * never filling the rightmost two chart segments, or force per-allergen
 * segments and scale-specific locale keys -- a much bigger refactor for a
 * single categorical sensor that already works correctly. If SILAM later
 * drops `allergy_risk` from cards that also display per-allergen sensors, or
 * gains its own scale-specific chart geometry, this helper can be revisited.
 */
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

export function getAllergenNames(allergen, fullPhrases, shortPhrases, lang) {
  // Capitalized: phrases > silamAllergenMap > fallback
  let allergenCapitalized;
  if (fullPhrases[allergen]) {
    allergenCapitalized = fullPhrases[allergen];
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
  const allergenShort = shortPhrases[allergen] || allergenCapitalized;

  return { allergenCapitalized, allergenShort };
}

export function resolveEntityIds(cfg, hass, debug = false, precomputedDiscovery = null) {
  const map = new Map();
  const configLocation = cfg.location === "manual" ? "" : (cfg.location || "");
  const locationSlug = configLocation.toLowerCase();

  const discovery = precomputedDiscovery || discoverSilamSensors(hass, debug);
  const discoveredLoc = resolveDiscoveredLocation(discovery, configLocation, debug);

  // Precompute inverse maps once (master -> HA slug) for all languages
  const inverseMaps = Object.values(silamAllergenMap.mapping).map(
    (mapping) => Object.entries(mapping).reduce(
      (acc, [ha, master]) => { acc[master] = ha; return acc; }, {},
    ),
  );

  for (const rawAllergen of cfg.allergens || []) {
    const norm = normalize(rawAllergen);
    const allergen = toCanonicalAllergenKey(norm);

    let sensorId = null;
    if (cfg.location === "manual") {
      const prefix = normalizeManualPrefix(cfg.entity_prefix);
      const suffix = cfg.entity_suffix || "";
      // Try canonical (English) slug first
      sensorId = resolveManualEntity(hass, prefix, allergen, suffix);
      // Fall back to localized HA slugs from the allergen map
      if (!sensorId) {
        for (const inverse of inverseMaps) {
          if (inverse[allergen] && inverse[allergen] !== allergen) {
            sensorId = resolveManualEntity(hass, prefix, inverse[allergen], suffix);
            if (sensorId) break;
          }
        }
      }
    } else if (discoveredLoc?.sensors?.size) {
      sensorId = discoveredLoc.sensors.get(allergen) || null;
      if (sensorId && !hass.states[sensorId]) sensorId = null;
    }
    if (!sensorId && cfg.location !== "manual") {
      for (const inverse of inverseMaps) {
        if (inverse[allergen]) {
          const candidate = `sensor.silam_pollen_${locationSlug}_${inverse[allergen]}`;
          if (hass.states[candidate]) { sensorId = candidate; break; }
        }
      }
      if (!sensorId) {
        const fallback = `sensor.silam_pollen_${locationSlug}_${allergen}`;
        if (hass.states[fallback]) sensorId = fallback;
      }
    }
    if (debug) {
      console.debug(
        `[SILAM:resolveEntityIds] allergen: '${allergen}', sensorId: '${sensorId}'`,
      );
    }
    if (sensorId) map.set(allergen, sensorId);
  }
  return map;
}

export async function fetchForecast(hass, config, forecastEvent = null) {
  const debug = Boolean(config.debug);
  const t0 = debug ? performance.now() : 0;
  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } = getLangAndLocale(hass, config);

  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } = mergePhrases(config, lang);
  const levelNames = buildLevelNames(userLevels, lang);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days_to_show = config.days_to_show ?? stubConfigSILAM.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigSILAM.pollen_threshold;

  // Hitta weather-entity och discovery-data.
  // Pick the location hint that drives discovery. In manual mode without an
  // explicit weather override, fall back to using entity_prefix as a hint.
  let configLocation;
  if (config.location === "manual" && config.entity_prefix) {
    configLocation = normalizeManualPrefix(config.entity_prefix).replace(/_$/, "");
  } else if (config.location === "manual") {
    configLocation = "";
  } else {
    configLocation = config.location || "";
  }

  // Discovery for weather entity (allergen sensors delegated to resolveEntityIds).
  // Always run so resolveEntityIds can use it later.
  const tDisc = debug ? performance.now() : 0;
  const discovery = discoverSilamSensors(hass, debug);
  const discoveredLoc = resolveDiscoveredLocation(discovery, configLocation, debug);
  if (debug) console.debug(`[SILAM] Discovery took ${(performance.now() - tDisc).toFixed(1)}ms, locations: ${discovery.locations.size}`);

  // Manual mode honors an optional config.entity_weather override -- if set,
  // it bypasses discovery for the weather entity. Useful when the prefix-
  // based discovery hint doesn't find the right one (custom-renamed
  // entities, multiple SILAM instances, etc.).
  let weatherEntity;
  if (config.location === "manual" && config.entity_weather) {
    if (!hass.states[config.entity_weather]) {
      console.warn(
        `[SILAM] Manual mode: entity_weather '${config.entity_weather}' ` +
          "not found in hass.states. Verify the entity ID is correct.",
      );
      return [];
    }
    weatherEntity = config.entity_weather;
  } else {
    weatherEntity = discoveredLoc?.weatherEntity
      || findSilamWeatherEntity(hass, configLocation, locale, debug, discovery);

    if (!weatherEntity || !hass.states[weatherEntity]) {
      if (config.location === "manual") {
        console.warn(
          "[SILAM] Manual mode: could not auto-discover a weather entity " +
            "matching entity_prefix. Set config.entity_weather to the " +
            "weather.* entity ID explicitly (see issue #231).",
        );
      } else if (debug) {
        console.warn("[SILAM] No weather entity found:", weatherEntity);
      }
      return [];
    }
  }

  const entity = hass.states[weatherEntity];
  const rawAllergens = config.allergens || stubConfigSILAM.allergens;
  const allergens = rawAllergens.map((raw) => {
    const norm = normalize(raw);
    // Translate user-facing slugs (e.g. 'index') to internal canonicals
    return toCanonicalAllergenKey(norm);
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

  const tRes = debug ? performance.now() : 0;
  const entityMap = resolveEntityIds(config, hass, debug, discovery);
  if (debug) console.debug(`[SILAM] resolveEntityIds took ${(performance.now() - tRes).toFixed(1)}ms, resolved: ${entityMap.size}/${allergens.length}`);

  // When entity-registry discovery found zero allergen sensors for this
  // location (i.e. the user did not enable any allergens in the SILAM
  // integration), auto-include allergy_risk so the card can still show
  // the overall pollen index from the weather entity state.
  let autoAddedAllergyRisk = false;
  if (
    config.location !== "manual" &&
    discoveredLoc &&
    discoveredLoc.sensors.size === 0 &&
    !allergens.includes("allergy_risk")
  ) {
    allergens.push("allergy_risk");
    autoAddedAllergyRisk = true;
    if (debug)
      console.debug("[SILAM] Discovery found 0 allergen sensors; auto-adding allergy_risk");
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
        fullPhrases,
        shortPhrases,
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

      // Sensor lookup (delegated to resolveEntityIds)
      const sensorId = entityMap.get(allergen) || null;
      dict.entity_id = sensorId;

      // Collect levels per day/column (different for daily vs other modes).
      //
      // NOTE: For allergy_risk, daily mode reads entity.state (e.g. "very_low")
      // while hourly/twice_daily reads forecast[].pollen_index from the
      // subscription. The SILAM integration may report different values for
      // these two sources (e.g. entity.state="very_low" but forecast
      // pollen_index=1). This is an upstream data inconsistency; the card
      // faithfully displays whatever each source reports.
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
          label = buildDayLabel(d, i, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale });
          icon = null;
        }

        const lvlIndex = scaled < 0 ? 0 : Math.min(Math.round(scaled), 6);
        // Auto-added allergy_risk at level 0: the integration reports
        // "very_low" (has no "none" state). Show that localized rather
        // than our level-0 label ("No pollen").
        const stateText =
          (autoAddedAllergyRisk && allergen === "allergy_risk" && scaled === 0)
            ? (t("card.index.very_low", lang) || levelNames[0])
            : (scaled < 0 ? noInfoLabel : levelNames[lvlIndex] || String(scaled));

        dict[`day${i}`] = {
          name: dict.allergenCapitalized,
          day: label,
          icon: icon,
          state: scaled,
          state_text: stateText,
        };
        dict.days.push(dict[`day${i}`]);
      }

      // Auto-added allergy_risk bypasses the threshold: even "very_low" (level 0)
      // is worth showing when it is the only data available for this location.
      const skipThreshold = autoAddedAllergyRisk && allergen === "allergy_risk";
      if (skipThreshold || meetsThreshold(dict.days, pollen_threshold)) sensors.push(dict);
    } catch (e) {
      if (debug) console.warn(`[SILAM] Error for allergen ${allergen}:`, e);
    }
  }

  // Sortering
  sortSensors(sensors, config.sort);

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

  if (debug) console.debug(`[SILAM] fetchForecast done in ${(performance.now() - t0).toFixed(1)}ms, sensors: ${sensors.length}`);
  return sensors;
}
