// src/utils/adapter-helpers.js
// Shared pure helpers used by multiple adapters.
import { t, detectLang } from "../i18n.js";
import { toCanonicalAllergenKey } from "../constants.js";
import { normalize, normalizeDWD } from "./normalize.js";
import { isConfigEntryId } from "./silam.js";

/**
 * Clamp a sensor value to a valid level range.
 *
 * @param {*}      v         - Raw sensor value (will be coerced via Number()).
 * @param {number|null} maxLevel - Upper clamp bound, or null for no upper clamp.
 * @param {*}      nanResult - Value returned for NaN / negative input.
 * @returns {number|null}
 */
export function clampLevel(v, maxLevel = 6, nanResult = -1) {
  if (v === null || v === undefined) return nanResult;
  const n = Number(v);
  if (isNaN(n) || n < 0) return nanResult;
  return maxLevel != null ? Math.min(n, maxLevel) : n;
}

/**
 * Sort a sensors array in-place using one of the standard sort keys.
 * Adapter-specific post-sorts (tiered, pin-to-top) are applied by the caller.
 *
 * @param {object[]} sensors  - Array of sensor dicts (mutated in-place).
 * @param {string}   sortKey  - One of "value_ascending", "value_descending",
 *                              "name_ascending", "name_descending", or "none".
 */
export function sortSensors(sensors, sortKey) {
  if (sortKey === "none") return;
  const sortFn = {
    value_ascending: (a, b) => (a.day0?.state ?? 0) - (b.day0?.state ?? 0),
    value_descending: (a, b) => (b.day0?.state ?? 0) - (a.day0?.state ?? 0),
    name_ascending: (a, b) =>
      a.allergenCapitalized.localeCompare(b.allergenCapitalized),
    name_descending: (a, b) =>
      b.allergenCapitalized.localeCompare(a.allergenCapitalized),
  }[sortKey] || ((a, b) => (b.day0?.state ?? 0) - (a.day0?.state ?? 0));
  sensors.sort(sortFn);
}

/**
 * Check whether any day in the array meets or exceeds the pollen threshold.
 * Returns true when threshold is 0 (show-all mode) or when at least one
 * day's state >= threshold.
 *
 * @param {object[]} days       - Array of day objects with a .state property.
 * @param {number}   threshold  - Minimum state value to qualify.
 * @returns {boolean}
 */
export function meetsThreshold(days, threshold) {
  return threshold === 0 || days.some((d) => d.state >= threshold);
}

/**
 * Resolve full and short allergen display names.
 *
 * @param {string} allergenKey - Normalized/slugified allergen key for toCanonicalAllergenKey().
 * @param {object} opts
 * @param {object}  opts.fullPhrases   - User phrase overrides (full names).
 * @param {object}  opts.shortPhrases  - User phrase overrides (short names).
 * @param {boolean} opts.abbreviated   - Whether to use abbreviated (short) names.
 * @param {string}  opts.lang          - Language code for i18n.
 * @param {Function} [opts.capitalize] - Custom capitalize function (default: first char upper).
 * @param {string}  [opts.configKey]   - Original config key for phrases lookup when it
 *                                       differs from allergenKey (e.g. PP/DWD raw names).
 * @returns {{ allergenCapitalized: string, allergenShort: string }}
 */
export function resolveAllergenNames(allergenKey, { fullPhrases, shortPhrases, abbreviated, lang, capitalize: capFn, configKey }) {
  const cap = capFn || ((s) => s.charAt(0).toUpperCase() + s.slice(1));
  const ck = configKey ?? allergenKey;
  const canonKey = toCanonicalAllergenKey(allergenKey);

  let allergenCapitalized;
  if (fullPhrases[ck]) {
    allergenCapitalized = fullPhrases[ck];
  } else {
    const nameKey = `card.allergen.${canonKey}`;
    const i18nName = t(nameKey, lang);
    allergenCapitalized = i18nName !== nameKey ? i18nName : cap(ck);
  }

  let allergenShort;
  if (abbreviated) {
    allergenShort = shortPhrases[ck]
      || t(`editor.phrases_short.${canonKey}`, lang)
      || allergenCapitalized;
  } else {
    allergenShort = allergenCapitalized;
  }

  return { allergenCapitalized, allergenShort };
}

/**
 * Merge user phrase overrides with defaults.
 *
 * Returns the five destructured fields adapters need. Custom level
 * mapping (e.g. PEU's 5-to-7, PLU's 4-level) stays in the adapter
 * and uses the returned userLevels array.
 *
 * @param {object} config - Card configuration (reads config.phrases).
 * @param {string} lang   - Language code for the noInfoLabel fallback.
 * @returns {{ fullPhrases: object, shortPhrases: object, userLevels: Array, userDays: object, noInfoLabel: string }}
 */
export function mergePhrases(config, lang) {
  const phrases = {
    full: {}, short: {}, levels: [], days: {}, no_information: "",
    ...(config.phrases || {}),
  };
  return {
    fullPhrases: phrases.full,
    shortPhrases: phrases.short,
    userLevels: phrases.levels,
    userDays: phrases.days,
    noInfoLabel: phrases.no_information || t("card.no_information", lang),
  };
}

/**
 * Derive language, locale, and day-display flags from hass and config.
 *
 * @param {object} hass   - Home Assistant state object.
 * @param {object} config - Card configuration.
 * @param {string|undefined|null} [defaultLocale=null]
 *   When null (default), locale cascades through hass fields.
 *   When explicitly passed (even as undefined), used as the fallback locale.
 * @returns {{ lang: string, locale: string|undefined, daysRelative: boolean, dayAbbrev: boolean, daysUppercase: boolean }}
 */
export function getLangAndLocale(hass, config, defaultLocale = null) {
  const lang = detectLang(hass, config.date_locale);
  const locale = defaultLocale !== null
    ? (config.date_locale || defaultLocale)
    : (config.date_locale || hass.locale?.language || hass.language || `${lang}-${lang.toUpperCase()}`);
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);
  return { lang, locale, daysRelative, dayAbbrev, daysUppercase };
}

/**
 * Normalize a manual-mode entity prefix.
 * Strips leading "sensor." and ensures a trailing "_" (unless empty).
 *
 * @param {string} raw - The raw entity_prefix from config.
 * @returns {string}
 */
export function normalizeManualPrefix(raw) {
  let p = raw || "";
  if (p.startsWith("sensor.")) p = p.substring(7);
  if (p && !p.endsWith("_")) p = p + "_";
  return p;
}

/**
 * Resolve a manual-mode entity ID from prefix + slug + suffix.
 * Falls back to unique-candidate matching when suffix is empty
 * and the exact ID is not found.
 *
 * @param {object} hass   - Home Assistant state object.
 * @param {string} prefix - Already normalized prefix (via normalizeManualPrefix).
 * @param {string} slug   - Allergen slug.
 * @param {string} suffix - Entity suffix from config.
 * @returns {string|null} - Matched entity ID or null.
 */
export function resolveManualEntity(hass, prefix, slug, suffix) {
  const sensorId = `sensor.${prefix}${slug}${suffix}`;
  if (hass.states[sensorId]) return sensorId;
  if (suffix === "") {
    const base = `sensor.${prefix}${slug}`;
    const candidates = Object.keys(hass.states).filter((id) =>
      id.startsWith(base),
    );
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

/**
 * Build a day column label from a date and its offset from today.
 *
 * @param {Date}   date  - The date to label.
 * @param {number} diff  - Day offset (0 = today, 1 = tomorrow, …).
 * @param {object} opts
 * @param {boolean} opts.daysRelative  - Show relative labels (today/tomorrow)?
 * @param {boolean} opts.dayAbbrev     - Abbreviate weekday names?
 * @param {boolean} opts.daysUppercase - Uppercase the final label?
 * @param {object}  opts.userDays      - User-defined day label overrides (keyed by diff).
 * @param {string}  opts.lang          - Language code for i18n.
 * @param {string}  opts.locale        - Locale tag for date formatting.
 * @returns {string}
 */
export function buildDayLabel(date, diff, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale }) {
  let label;
  if (!daysRelative) {
    label = date.toLocaleDateString(locale, {
      weekday: dayAbbrev ? "short" : "long",
    });
    label = label.charAt(0).toUpperCase() + label.slice(1);
  } else if (userDays[diff] != null) {
    label = userDays[diff];
  } else if (diff >= 0 && diff <= 2) {
    label = t(`card.days.${diff}`, lang);
  } else {
    label = date.toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
    });
  }
  if (daysUppercase) label = label.toUpperCase();
  return label;
}

/**
 * Filter adapter sensors after fetchForecast returns.
 *
 * Three branches:
 * 1. SILAM daily: entity_id-based filtering with reverse-map fallback.
 * 2. SILAM non-daily: no entity-level filtering (pass through).
 * 3. Other integrations: name-based filtering (DWD uses normalizeDWD).
 *
 * @param {object[]} sensors          - Sensor dicts from fetchForecast.
 * @param {object}   cfg              - Card config with integration, mode, location, allergens.
 * @param {string[]} availableSensors - Entity IDs from findAvailableSensors.
 * @param {string[]} hassStateKeys    - Object.keys(hass.states).
 * @param {object}   silamMapping     - silamAllergenMap.mapping object.
 * @returns {object[]}
 */
export function filterSensorsPostFetch(sensors, cfg, availableSensors, hassStateKeys, silamMapping) {
  let filtered = sensors.filter((s) => {
    if (cfg.integration === "silam" && (!cfg.mode || cfg.mode === "daily")) {
      // allergy_risk is derived from the weather entity state, not an
      // individual sensor entity, so it has no entity_id to match.
      if (s.allergenReplaced === "allergy_risk") return true;
      if (s.entity_id) {
        return availableSensors.includes(s.entity_id);
      }
      const configLocation = cfg.location || "";
      if (!isConfigEntryId(configLocation)) {
        const loc = configLocation;
        const silamReverse = {};
        const locStates = hassStateKeys.filter((id) => {
          const m = id.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
          return m && m[1] === loc;
        });
        for (const eid of locStates) {
          const m = eid.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
          if (!m) continue;
          const haSlug = m[2];
          for (const [, mapping] of Object.entries(silamMapping)) {
            if (mapping[haSlug]) {
              silamReverse[mapping[haSlug]] = haSlug;
              break;
            }
          }
        }
        const key = silamReverse[s.allergenReplaced] || s.allergenReplaced;
        const id = `sensor.silam_pollen_${loc}_${key}`;
        return availableSensors.includes(id);
      }
      return false;
    }
    return true;
  });

  if (Array.isArray(cfg.allergens) && cfg.allergens.length > 0 && cfg.integration !== "silam") {
    let allowed;
    let getKey;
    if (cfg.integration === "dwd") {
      allowed = new Set(cfg.allergens.map((a) => normalizeDWD(a)));
      getKey = (s) => normalizeDWD(s.allergenReplaced || "");
    } else {
      allowed = new Set(cfg.allergens.map((a) => normalize(a)));
      getKey = (s) => normalize(s.allergenReplaced || "");
    }
    filtered = filtered.filter((s) => allowed.has(getKey(s)));
  }

  return filtered;
}
