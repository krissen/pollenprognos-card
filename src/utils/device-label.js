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

  const COORD_PAREN = /\s*\([\s\d.,+\-]+\)\s*$/;
  const stripped = trimmed.replace(COORD_PAREN, "").trim();
  if (stripped === trimmed) return trimmed;

  // Match the LAST " - " / " – " / " — " separator so hyphenated locations
  // like "Saint-Cloud" survive while a trailing " - <category>" is removed.
  const SEP = /\s+[-–—]\s+(?=[^-–—]*$)/;
  const sepMatch = stripped.match(SEP);
  const final = sepMatch
    ? stripped.slice(0, sepMatch.index).trim()
    : stripped;
  return final || trimmed;
}
