// src/utils/level-names.js
// Helpers to merge user-provided level names with defaults.
// Locales declare a default name per index for each scale we support:
//   card.levels.0..6   - 7-level scale (PP / SILAM / Atmo, also the legacy
//                        default used by adapters that remap their native
//                        scale onto these indices via runtime spreads)
//   card.levels5.0..4  - 5-level scale (MSW; available for PEU/SILAM-risk
//                        migration via #215)
// Adapters with non-default scales should use buildLevelNamesForScale(scale)
// to look up names at native indices, so user-visible severity labels match
// the integration's own level count instead of borrowing semantically-wrong
// strings from a wider scale.
import { t } from "../i18n.js";

/**
 * Build a 7-element level-name array using `card.levels.0..6` defaults,
 * with optional user overrides at the same indices.
 * Kept for adapters that have always used the 7-level scale (PP / SILAM /
 * Atmo) and for adapters whose level-name lookup still spreads native to
 * 0-6 (DWD; PEU pending #215).
 *
 * @param {Array<string|null|undefined>|undefined} userLevels - per-index overrides
 * @param {string} lang - active language code
 * @returns {string[]} length-7 array of level names
 */
export function buildLevelNames(userLevels, lang) {
  return buildLevelNamesForScale(7, userLevels, lang);
}

/**
 * Build a level-name array of `scale` entries, indexed natively (0..scale-1).
 * Defaults come from `card.levels{scale}.{i}` when scale !== 7, and from the
 * legacy `card.levels.{i}` when scale === 7. User-supplied entries at the
 * matching index override the default.
 *
 * @param {number} scale - native level count for this integration
 * @param {Array<string|null|undefined>|undefined} userLevels
 * @param {string} lang
 * @returns {string[]} length-`scale` array of level names
 */
export function buildLevelNamesForScale(scale, userLevels, lang) {
  const keyPrefix = scale === 7 ? "card.levels" : `card.levels${scale}`;
  const defaults = Array.from({ length: scale }, (_, i) =>
    t(`${keyPrefix}.${i}`, lang),
  );
  if (!Array.isArray(userLevels)) return defaults;
  return defaults.map((def, idx) => {
    const val = userLevels[idx];
    return val == null || val === "" ? def : val;
  });
}
