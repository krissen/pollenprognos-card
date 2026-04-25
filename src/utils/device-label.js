// src/utils/device-label.js

/**
 * Normalize an HA-derived device name for display as a location label.
 *
 * Several pollen integrations (pollenlevels for sure, others suspected)
 * name devices as:
 *
 *   "<user-given-name> - <category-localized> (<lat>,<lng>)"
 *
 * The category word varies by HA language: Swedish "Pollentyper", German
 * "Pollentypen", English "Pollen types", French "Niveaux de pollen", etc.
 * The coordinate-laden suffix is unhelpful in editor dropdowns and card
 * titles. The user just wants their location name back.
 *
 * Strategy (locale-agnostic):
 *   1. Strip a trailing parenthesized segment whose contents look like
 *      decimal coordinates (digits, dot, comma, sign, whitespace only).
 *      This avoids matching parens that contain real text.
 *   2. If (1) matched, drop a trailing " - <something>" too. Use the LAST
 *      occurrence so hyphenated locations like "Saint-Cloud" survive.
 *   3. If (1) did NOT match, leave the string unchanged. Without a
 *      coordinate signal we can't tell integration noise from a real name.
 *
 * Returns the cleaned string. Empty cleanup result falls back to the
 * trimmed input. Non-string inputs are returned as-is.
 *
 * History note: this util exists to stop a recurring regression where
 * inline cleanup logic in adapter discovery code keeps getting refactored
 * away. See issue #208 for the latest occurrence.
 */
export function cleanDeviceLabel(raw) {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  // Require two numeric values separated by a comma (i.e. lat/lng shape) so
  // legitimate names like "Office (123)" or "Paris (2024)" aren't stripped.
  // Each value: optional sign, digits, optional decimal part. Whitespace
  // tolerated around values and the comma.
  const COORD_PAREN = /\s*\(\s*[+\-]?\d+(?:\.\d+)?\s*,\s*[+\-]?\d+(?:\.\d+)?\s*\)\s*$/;
  const stripped = trimmed.replace(COORD_PAREN, "").trim();
  if (stripped === trimmed) return trimmed;

  // Drop a trailing " - <suffix>" / " – <suffix>" / " — <suffix>" using the
  // LAST occurrence of any of the separator variants. Hyphenated location
  // names like "Saint-Cloud" survive because their internal hyphen has no
  // surrounding spaces. Suffixes that contain hyphens (e.g. "Pollen-types")
  // are still removed because we match on the separator's whitespace context,
  // not on what follows.
  const lastHyphen = stripped.lastIndexOf(" - ");
  const lastEnDash = stripped.lastIndexOf(" – ");
  const lastEmDash = stripped.lastIndexOf(" — ");
  const sepIdx = Math.max(lastHyphen, lastEnDash, lastEmDash);
  const final = sepIdx >= 0 ? stripped.slice(0, sepIdx).trim() : stripped;
  return final || trimmed;
}
