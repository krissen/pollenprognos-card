// src/adapters/atmo.js
import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";

// Mapping from canonical allergen names to French entity slugs used by Atmo France
export const ATMO_ALLERGEN_MAP = {
  ragweed: "ambroisie",
  mugwort: "armoise",
  alder: "aulne",
  birch: "bouleau",
  grass: "gramine",
  olive: "olivier",
  allergy_risk: "qualite_globale_pollen",
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
]);

export const stubConfigATMO = {
  integration: "atmo",
  location: "",
  entity_prefix: "",
  entity_suffix: "",
  allergens: ["ragweed", "mugwort", "alder", "birch", "grass", "olive"],
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

export const ATMO_ALLERGENS = [
  "allergy_risk",
  ...stubConfigATMO.allergens,
];

/**
 * Detect location slug from available Atmo France entities.
 */
function detectLocation(hass, debug) {
  for (const id of Object.keys(hass.states)) {
    const m = id.match(
      /^sensor\.niveau_(ambroisie|armoise|aulne|bouleau|gramine|olivier)_(.+?)(?:_j_\d+)?$/,
    );
    if (m) {
      if (debug) console.debug("[ATMO] auto-detected location:", m[2]);
      return m[2];
    }
  }
  return null;
}

/**
 * Build entity ID for an allergen at a given location.
 */
function buildEntityId(allergen, location, forecast) {
  const frSlug = ATMO_ALLERGEN_MAP[allergen];
  if (!frSlug) return null;

  let base;
  if (allergen === "allergy_risk") {
    base = `sensor.qualite_globale_pollen_${location}`;
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
          const prefix =
            allergen === "allergy_risk"
              ? `sensor.qualite_globale_pollen_`
              : `sensor.niveau_${frSlug}_`;
          const candidates = Object.keys(hass.states).filter(
            (id) => id.startsWith(prefix) && !id.includes("_j_"),
          );
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

  // Move allergy_risk to top if configured
  if (config.allergy_risk_top) {
    const idx = sensors.findIndex(
      (s) => s.allergenReplaced === "allergy_risk",
    );
    if (idx > 0) {
      const [special] = sensors.splice(idx, 1);
      sensors.unshift(special);
    }
  }

  // Sorting
  if (config.sort !== "none") {
    // Preserve allergy_risk at top if configured
    const topItem =
      config.allergy_risk_top && sensors[0]?.allergenReplaced === "allergy_risk"
        ? sensors.shift()
        : null;

    sensors.sort(
      {
        value_ascending: (a, b) => (a.day0?.state ?? 0) - (b.day0?.state ?? 0),
        value_descending: (a, b) =>
          (b.day0?.state ?? 0) - (a.day0?.state ?? 0),
        name_ascending: (a, b) =>
          a.allergenCapitalized.localeCompare(b.allergenCapitalized),
        name_descending: (a, b) =>
          b.allergenCapitalized.localeCompare(a.allergenCapitalized),
      }[config.sort] ||
        ((a, b) => (b.day0?.state ?? 0) - (a.day0?.state ?? 0)),
    );

    if (topItem) sensors.unshift(topItem);
  }

  if (debug) console.debug("ATMO adapter complete sensors:", sensors);
  return sensors;
}
