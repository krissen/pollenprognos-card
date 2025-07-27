// src/utils/level-names.js
// Helper to merge user provided level names with defaults.
// Returns an array of seven names, falling back to translation
// strings when user values are missing.
import { t } from "../i18n.js";

export function buildLevelNames(userLevels, lang) {
  const defaults = Array.from({ length: 7 }, (_, i) => t(`card.levels.${i}`, lang));
  if (!Array.isArray(userLevels)) return defaults;
  return defaults.map((def, idx) => {
    const val = userLevels[idx];
    return val == null || val === "" ? def : val;
  });
}
