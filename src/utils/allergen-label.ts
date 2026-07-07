// src/utils/allergen-label.ts
import { t } from "../i18n.js";

/**
 * Resolve a human label for an allergen, never leaking a raw i18n key.
 *
 * Chain: editor.phrases_{full|short}.<canonical> -> card.allergen.<canonical>
 * -> capitalized humanized raw. A t() result is a hit only when it differs
 * from the *full* key passed to t() (t() echoes the key on a miss); this is the
 * correct miss-detection. The editor's previous inline guard compared against
 * the un-prefixed key, so misses on the editor.* namespace were never detected
 * and the raw key leaked (e.g. `graminales`, which had no editor.phrases_*
 * entry -- issue #262 follow-up).
 *
 * Pure (only depends on t() + the locale data) so it can be unit-tested
 * directly, unlike the LitElement editor method that delegates to it.
 *
 * @param {string} canonical - canonical allergen key (e.g. "graminales").
 * @param {string} raw - the original key, used for the humanized fallback.
 * @param {object} [opts]
 * @param {boolean} [opts.short] - use the phrases_short namespace.
 * @param {string} [opts.lang] - locale code; passed through to t().
 * @returns {string}
 */
export function resolveAllergenPhrase(
  canonical: string,
  raw: string,
  { short = false, lang }: { short?: boolean; lang?: string } = {},
): string {
  const editorKey = `editor.phrases_${short ? "short" : "full"}.${canonical}`;
  const editorVal = t(editorKey, lang);
  if (editorVal && editorVal !== editorKey) return editorVal;
  const cardKey = `card.allergen.${canonical}`;
  const cardVal = t(cardKey, lang);
  if (cardVal && cardVal !== cardKey) return cardVal;
  const base = String(raw || canonical || "").replace(/_/g, " ");
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
}
