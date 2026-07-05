// Locale-aware number formatting/parsing for editor input fields.
//
// Native `<input type="number">` (and `ha-textfield type="number">`) derive their
// decimal separator from the browser/OS locale, ignoring the Home Assistant
// profile's number-format setting. These helpers drive the formatting/parsing in
// JS instead, so editor number fields honour `hass.locale.number_format`
// (point vs comma) and accept either separator on input.

import type { HomeAssistant } from "../types/home-assistant.js";

/**
 * Derive a decimal separator ("." or ",") from an Intl locale.
 * @param locale - BCP-47 tag, or undefined for the runtime default.
 */
function intlDecimalSeparator(locale?: string): string {
  try {
    const parts = new Intl.NumberFormat(locale || undefined).formatToParts(1.1);
    const dec = parts.find((p) => p.type === "decimal");
    return dec ? dec.value : ".";
  } catch {
    return ".";
  }
}

/**
 * Resolve the decimal separator the user expects, based on the HA profile's
 * `number_format` setting (falling back to their language, then the OS, then ".").
 * Mirrors Home Assistant's NumberFormat enum.
 * @returns "." or ","
 */
export function getDecimalSeparator(hass?: HomeAssistant): string {
  const fmt = hass?.locale?.number_format;
  switch (fmt) {
    case "comma_decimal": // 1,234.56
    case "quote_decimal": // 1'234.56
    case "none": // 1234.56
      return ".";
    case "decimal_comma": // 1.234,56
    case "space_comma": // 1 234,56
      return ",";
    case "system":
      return intlDecimalSeparator(undefined);
    case "language":
    default: {
      const lang = hass?.locale?.language;
      return lang ? intlDecimalSeparator(lang) : ".";
    }
  }
}

/**
 * Format a numeric value for display in an editable input: no grouping, decimal
 * separator per the HA profile. Empty/non-finite values render as "".
 */
export function formatNumberForInput(
  value: number | string | null | undefined,
  hass?: HomeAssistant,
): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "";
  const sep = getDecimalSeparator(hass);
  return sep === "," ? String(num).replace(".", ",") : String(num);
}

/**
 * Parse user input from a number field, accepting either decimal separator and
 * tolerating grouping whitespace. Returns a finite number, or null when the
 * input is empty/invalid (so callers can revert instead of writing NaN/0).
 * @param hass - reserved for future locale-specific parsing
 */
export function parseLocaleNumber(
  str: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  hass?: HomeAssistant,
): number | null {
  if (typeof str !== "string") str = String(str ?? "");
  const trimmed = str.trim();
  if (trimmed === "") return null;
  // Strip grouping whitespace, unify any comma -> dot. These fields hold a
  // single small decimal value (no thousands grouping), so a bare comma->dot
  // swap is sufficient; replace all commas (not just the first) so stray
  // separators yield NaN -> null (revert) rather than a partial parse.
  const normalized = trimmed.replace(/\s/g, "").replace(/,/g, ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}
