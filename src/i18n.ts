import { IntlMessageFormat } from "intl-messageformat";
import type { PrimitiveType } from "intl-messageformat";
import type { HomeAssistant } from "./types/home-assistant.js";

// One locale's flat translation table: dot-separated key -> localized string.
type LocaleData = Record<string, string>;

// Load all locale JSON files eagerly using Vite's import.meta.glob.
const localeModules = import.meta.glob<{ default: LocaleData }>(
  "./locales/*.json",
  { eager: true },
);

// Map of language code to translation object.
const LOCALES: Record<string, LocaleData> = {};
for (const filePath in localeModules) {
  const match = filePath.match(/\.\/locales\/([\w-]+)\.json$/);
  const code = match?.[1];
  if (code) {
    LOCALES[code] = localeModules[filePath]!.default;
  }
}

// Default language when no suitable locale is found.
const DEFAULT = "en";

// Helper to resolve dot separated keys inside nested objects.
// Looks up flat translation keys like "card.header_prefix"
function resolveKey(obj: LocaleData, path: string): string | undefined {
  return obj[path];
}

// Detect the best language based on Home Assistant settings and an optional override.
export function detectLang(
  hass: HomeAssistant | null | undefined,
  userLocale?: string,
): string {
  const tag = userLocale || hass?.locale?.language || hass?.language || DEFAULT;
  if (LOCALES[tag]) return tag;
  const short = tag.slice(0, 2).toLowerCase();
  if (LOCALES[short]) return short;
  return DEFAULT;
}

export const SUPPORTED_LOCALES = Object.keys(LOCALES);

// Translate a given key to the requested language using IntlMessageFormat.
export function t(
  key: string,
  lang: string | undefined,
  vars: Record<string, PrimitiveType> = {},
): string {
  const localeData =
    (lang !== undefined ? LOCALES[lang] : undefined) || LOCALES[DEFAULT] || {};
  let msg = resolveKey(localeData, key);
  if (msg === undefined) {
    const fallback = resolveKey(LOCALES[DEFAULT] || {}, key);
    msg = fallback === undefined ? key : fallback;
  }
  try {
    const formatter = new IntlMessageFormat(msg, lang);
    return formatter.format(vars) as string;
  } catch (err) {
    console.warn(`Translation failed for key: ${key}`, err);
    return msg;
  }
}
