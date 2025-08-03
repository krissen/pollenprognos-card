import { IntlMessageFormat } from "intl-messageformat";

// Load all locale JSON files eagerly using Vite's import.meta.glob.
const localeModules = import.meta.glob("./locales/*.json", { eager: true });

// Map of language code to translation object.
const LOCALES = {};
for (const filePath in localeModules) {
  const match = filePath.match(/\.\/locales\/([\w-]+)\.json$/);
  if (match) {
    LOCALES[match[1]] = localeModules[filePath].default;
  }
}

// Default language when no suitable locale is found.
const DEFAULT = "en";

// Helper to resolve dot separated keys inside nested objects.
function resolveKey(obj, path) {
  return path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

// Detect the best language based on Home Assistant settings and an optional override.
export function detectLang(hass, userLocale) {
  let tag = userLocale || hass?.locale?.language || hass?.language || DEFAULT;
  if (LOCALES[tag]) return tag;
  const short = tag.slice(0, 2).toLowerCase();
  if (LOCALES[short]) return short;
  return DEFAULT;
}

export const SUPPORTED_LOCALES = Object.keys(LOCALES);

// Translate a given key to the requested language using IntlMessageFormat.
export function t(key, lang, vars = {}) {
  const localeData = LOCALES[lang] || LOCALES[DEFAULT] || {};
  let msg = resolveKey(localeData, key);
  if (msg === undefined) {
    const fallback = resolveKey(LOCALES[DEFAULT] || {}, key);
    msg = fallback === undefined ? key : fallback;
  }
  try {
    const formatter = new IntlMessageFormat(msg, lang);
    return formatter.format(vars);
  } catch (err) {
    console.warn(`Translation failed for key: ${key}`, err);
    return msg;
  }
}
