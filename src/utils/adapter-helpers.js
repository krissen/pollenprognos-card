// src/utils/adapter-helpers.js
// Shared pure helpers used by multiple adapters.
import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";

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
/**
 * Clamp a sensor value to a valid level range.
 *
 * @param {*}      v         - Raw sensor value (will be coerced via Number()).
 * @param {number|null} maxLevel - Upper clamp bound, or null for no upper clamp.
 * @param {*}      nanResult - Value returned for NaN / negative input.
 * @returns {number|null}
 */
export function clampLevel(v, maxLevel = 6, nanResult = -1) {
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
 * @param {string} allergenKey - Normalized/slugified allergen key for ALLERGEN_TRANSLATION.
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
  const canonKey = ALLERGEN_TRANSLATION[allergenKey] || allergenKey;

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
