// src/utils/adapter-helpers.js
// Shared pure helpers used by multiple adapters.
import { t } from "../i18n.js";

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
