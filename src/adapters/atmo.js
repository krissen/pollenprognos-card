// src/adapters/atmo.js
import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";

// Mapping from canonical allergen names to French entity slugs used by Atmo France
export const ATMO_ALLERGEN_MAP = {
  // Pollen
  ragweed: "ambroisie",
  mugwort: "armoise",
  alder: "aulne",
  birch: "bouleau",
  grass: "gramine",
  olive: "olivier",
  allergy_risk: "qualite_globale_pollen",
  // Pollution
  pm25: "pm25",
  pm10: "pm10",
  ozone: "ozone",
  no2: "dioxyde_d_azote",
  so2: "dioxyde_de_soufre",
  qualite_globale: "qualite_globale",
};

// Reverse map for sensor detection: French slug → canonical
const ATMO_REVERSE_MAP = Object.fromEntries(
  Object.entries(ATMO_ALLERGEN_MAP).map(([k, v]) => [v, k]),
);

// Known French allergen slugs (excluding allergy_risk special entity)
const ATMO_KNOWN_FR_SLUGS = new Set([
  "ambroisie",
  "armoise",
  "aulne",
  "bouleau",
  "gramine",
  "olivier",
  "pm25",
  "pm10",
  "ozone",
  "dioxyde_d_azote",
  "dioxyde_de_soufre",
]);

// Pollution allergens use a different entity pattern (no "niveau_" prefix)
const ATMO_POLLUTION_ALLERGENS = new Set(["pm25", "pm10", "ozone", "no2", "so2"]);

export const stubConfigATMO = {
  integration: "atmo",
  location: "",
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    "allergy_risk", "qualite_globale",
    "ragweed", "mugwort", "alder", "birch", "grass", "olive",
    "pm25", "pm10", "ozone", "no2", "so2",
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
  pollen_threshold: 1,
  sort: "value_descending",
  allergy_risk_top: true,
  sort_pollution_block: true,
  pollution_block_position: "bottom",
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

export const ATMO_ALLERGENS = [...stubConfigATMO.allergens];

/**
 * Detect location slug from available Atmo France entities.
 */
function detectLocation(hass, debug) {
  // Try pollen entities first (most reliable pattern)
  for (const id of Object.keys(hass.states)) {
    const m = id.match(
      /^sensor\.niveau_(ambroisie|armoise|aulne|bouleau|gramine|olivier)_(.+?)(?:_j_\d+)?$/,
    );
    if (m) {
      if (debug) console.debug("[ATMO] auto-detected location:", m[2]);
      return m[2];
    }
  }
  // Fallback: try pollution entities
  for (const id of Object.keys(hass.states)) {
    const m = id.match(
      /^sensor\.(pm25|pm10|ozone|dioxyde_d_azote|dioxyde_de_soufre)_(.+?)(?:_j_\d+)?$/,
    );
    if (m) {
      if (debug) console.debug("[ATMO] auto-detected location from pollution entity:", m[2]);
      return m[2];
    }
  }
  return null;
}

/**
 * Build entity ID for an allergen at a given location.
 * Pollen entities: sensor.niveau_{fr_slug}_{location}
 * Pollution entities: sensor.{fr_slug}_{location} (no "niveau_" prefix)
 */
function buildEntityId(allergen, location, forecast) {
  const frSlug = ATMO_ALLERGEN_MAP[allergen];
  if (!frSlug) return null;

  let base;
  if (allergen === "allergy_risk") {
    base = `sensor.qualite_globale_pollen_${location}`;
  } else if (allergen === "qualite_globale") {
    base = `sensor.qualite_globale_${location}`;
  } else if (ATMO_POLLUTION_ALLERGENS.has(allergen)) {
    base = `sensor.${frSlug}_${location}`;
  } else {
    base = `sensor.niveau_${frSlug}_${location}`;
  }
  return forecast ? `${base}_j_1` : base;
}

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const lang = detectLang(hass, config.date_locale);
  const locale = config.date_locale || stubConfigATMO.date_locale;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);

  const phrases = config.phrases || {};
  const fullPhrases = phrases.full || {};
  const shortPhrases = phrases.short || {};
  const userLevels = phrases.levels;
  const levelNames = buildLevelNames(userLevels, lang);
  const noInfoLabel = phrases.no_information || t("card.no_information", lang);
  const userDays = phrases.days || {};
  const days_to_show = config.days_to_show ?? stubConfigATMO.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigATMO.pollen_threshold;

  if (debug) console.debug("ATMO adapter: start fetchForecast", { config, lang });

  const testVal = (val) => {
    const n = Number(val);
    return isNaN(n) ? -1 : n;
  };

  // Resolve location
  let location = config.location || "";
  if (location === "manual") {
    // Manual mode handled below per allergen
  } else if (!location) {
    location = detectLocation(hass, debug) || "";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sensors = [];

  for (const allergen of config.allergens) {
    try {
      const dict = { days: [] };
      const canonKey = ALLERGEN_TRANSLATION[allergen] || allergen;
      dict.allergenReplaced = allergen;

      // Allergen name
      const userFull = fullPhrases[allergen];
      if (userFull) {
        dict.allergenCapitalized = userFull;
      } else {
        const nameKey = `card.allergen.${canonKey}`;
        const i18nName = t(nameKey, lang);
        dict.allergenCapitalized =
          i18nName !== nameKey ? i18nName : capitalize(allergen);
      }

      // Short name
      if (config.allergens_abbreviated) {
        const userShort = shortPhrases[allergen];
        dict.allergenShort =
          userShort ||
          t(`editor.phrases_short.${canonKey}`, lang) ||
          dict.allergenCapitalized;
      } else {
        dict.allergenShort = dict.allergenCapitalized;
      }

      // Find sensor entity
      let sensorId;
      if (location === "manual") {
        const prefix = config.entity_prefix || "";
        const suffix = config.entity_suffix || "";
        const frSlug = ATMO_ALLERGEN_MAP[allergen];
        if (!frSlug) continue;
        sensorId = `sensor.${prefix}${frSlug}${suffix}`;
        if (!hass.states[sensorId]) {
          if (suffix === "") {
            const base = `sensor.${prefix}${frSlug}`;
            const candidates = Object.keys(hass.states).filter((id) =>
              id.startsWith(base),
            );
            if (candidates.length === 1) sensorId = candidates[0];
            else continue;
          } else continue;
        }
      } else {
        if (!location) continue;
        sensorId = buildEntityId(allergen, location, false);
        if (!sensorId || !hass.states[sensorId]) {
          // Fallback: search for matching entity
          const frSlug = ATMO_ALLERGEN_MAP[allergen];
          if (!frSlug) continue;
          let prefix;
          if (allergen === "allergy_risk") {
            prefix = `sensor.qualite_globale_pollen_`;
          } else if (allergen === "qualite_globale") {
            prefix = `sensor.qualite_globale_`;
          } else if (ATMO_POLLUTION_ALLERGENS.has(allergen)) {
            prefix = `sensor.${frSlug}_`;
          } else {
            prefix = `sensor.niveau_${frSlug}_`;
          }
          const candidates = Object.keys(hass.states).filter((id) => {
            if (!id.startsWith(prefix) || id.includes("_j_")) return false;
            // Exclude qualite_globale_pollen_* when searching for qualite_globale
            if (allergen === "qualite_globale" && id.includes("qualite_globale_pollen")) return false;
            return true;
          });
          if (candidates.length === 1) sensorId = candidates[0];
          else continue;
        }
      }

      const sensor = hass.states[sensorId];
      dict.entity_id = sensorId;

      // Today's value (0-6 scale, no conversion needed)
      const todayVal = testVal(sensor.state);

      // J+1 forecast
      let tomorrowVal = -1;
      if (location !== "manual") {
        const j1Id = buildEntityId(allergen, location, true);
        if (j1Id && hass.states[j1Id]) {
          tomorrowVal = testVal(hass.states[j1Id].state);
        }
      }

      // Build level entries
      const levels = [
        { date: today, level: todayVal },
        { date: new Date(today.getTime() + 86400000), level: tomorrowVal },
      ];
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
        });
      }

      // Build day objects
      levels.forEach((entry, idx) => {
        if (entry.level !== null && entry.level >= 0) {
          const diff = Math.round((entry.date - today) / 86400000);
          let dayLabel;

          if (!daysRelative) {
            dayLabel = entry.date.toLocaleDateString(locale, {
              weekday: dayAbbrev ? "short" : "long",
            });
            dayLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
          } else if (userDays[diff] !== undefined) {
            dayLabel = userDays[diff];
          } else if (diff >= 0 && diff <= 2) {
            dayLabel = t(`card.days.${diff}`, lang);
          } else {
            dayLabel = entry.date.toLocaleDateString(locale, {
              day: "numeric",
              month: "short",
            });
          }
          if (daysUppercase) dayLabel = dayLabel.toUpperCase();

          // Use Libellé attribute as state_text fallback
          const libelle = sensor.attributes?.["Libellé"] || "";
          const lvlIndex = Math.min(Math.max(Math.round(entry.level), 0), 6);
          const stateText =
            lvlIndex < 0
              ? noInfoLabel
              : levelNames[lvlIndex] || libelle || noInfoLabel;

          dict[`day${idx}`] = {
            name: dict.allergenCapitalized,
            day: dayLabel,
            state: entry.level,
            display_state: entry.level,
            state_text: stateText,
          };
          dict.days.push(dict[`day${idx}`]);
        }
      });

      // Threshold filter
      const meets = levels
        .slice(0, days_to_show)
        .some((l) => l.level >= pollen_threshold);
      if (meets || pollen_threshold === 0) sensors.push(dict);
    } catch (e) {
      console.warn(`ATMO adapter error for allergen ${allergen}:`, e);
    }
  }

  // Move summary indices to top if configured
  if (config.allergy_risk_top) {
    // Move qualite_globale first (so allergy_risk ends up above it)
    const qgIdx = sensors.findIndex(
      (s) => s.allergenReplaced === "qualite_globale",
    );
    if (qgIdx > 0) {
      const [qg] = sensors.splice(qgIdx, 1);
      sensors.unshift(qg);
    }
    const arIdx = sensors.findIndex(
      (s) => s.allergenReplaced === "allergy_risk",
    );
    if (arIdx > 0) {
      const [ar] = sensors.splice(arIdx, 1);
      sensors.unshift(ar);
    }
  }

  // Sorting
  if (config.sort !== "none") {
    const sortFn =
      {
        value_ascending: (a, b) => (a.day0?.state ?? 0) - (b.day0?.state ?? 0),
        value_descending: (a, b) =>
          (b.day0?.state ?? 0) - (a.day0?.state ?? 0),
        name_ascending: (a, b) =>
          a.allergenCapitalized.localeCompare(b.allergenCapitalized),
        name_descending: (a, b) =>
          b.allergenCapitalized.localeCompare(a.allergenCapitalized),
      }[config.sort] ||
        ((a, b) => (b.day0?.state ?? 0) - (a.day0?.state ?? 0));

    // Extract summary indices (allergy_risk, qualite_globale) to preserve at top
    const summaryKeys = new Set(["allergy_risk", "qualite_globale"]);
    const topItems = [];
    if (config.allergy_risk_top) {
      while (sensors.length && summaryKeys.has(sensors[0]?.allergenReplaced)) {
        topItems.push(sensors.shift());
      }
    }

    if (config.sort_pollution_block) {
      // Separate remaining into pollen and pollution groups
      const pollen = [];
      const pollution = [];
      for (const s of sensors) {
        if (ATMO_POLLUTION_ALLERGENS.has(s.allergenReplaced)) {
          pollution.push(s);
        } else {
          pollen.push(s);
        }
      }
      pollen.sort(sortFn);
      pollution.sort(sortFn);

      sensors =
        config.pollution_block_position === "top"
          ? [...pollution, ...pollen]
          : [...pollen, ...pollution];
    } else {
      sensors.sort(sortFn);
    }

    sensors.unshift(...topItems);
  }

  if (debug) console.debug("ATMO adapter complete sensors:", sensors);
  return sensors;
}
