// src/i18n.js

// Import message formatter used by Home Assistant
import IntlMessageFormat from "intl-messageformat";

// Eagerly import all locale JSON files via Vite
const localeModules = import.meta.glob("./locales/*.json", { eager: true });

// Build a mapping from language code to translation resources
const LOCALES = {};
for (const filePath in localeModules) {
  const match = filePath.match(/\.\/locales\/([\w-]+)\.json$/);
  if (match) {
    LOCALES[match[1]] = localeModules[filePath].default;
  }
}

// Collect supported languages for external use
export const SUPPORTED_LOCALES = Object.keys(LOCALES);

// Default language used when no match is found
const DEFAULT = "en";

/**
 * Compute a localize function for a given language following HA's pattern.
 */
function computeLocalize(language, resources, formats) {
  const cache = {};
  return (key, ...args) => {
    if (!key || !resources || !language || !resources[language]) {
      return "";
    }
    const translatedValue = resources[language][key];
    if (!translatedValue) {
      return "";
    }
    let translatedMessage = cache[translatedValue];
    if (!translatedMessage) {
      try {
        translatedMessage = new IntlMessageFormat(
          translatedValue,
          language,
          formats
        );
      } catch (err) {
        return `Translation error: ${err.message}`;
      }
      cache[translatedValue] = translatedMessage;
    }
    let argObject = {};
    if (args.length === 1 && typeof args[0] === "object") {
      argObject = args[0];
    } else {
      for (let i = 0; i < args.length; i += 2) {
        argObject[args[i]] = args[i + 1];
      }
    }
    try {
      return translatedMessage.format(argObject);
    } catch (err) {
      return `Translation ${err}`;
    }
  };
}

// Create a localize function for each language using HA's standard approach
const LOCALIZE_FNS = {};
for (const lang of SUPPORTED_LOCALES) {
  LOCALIZE_FNS[lang] = computeLocalize(lang, LOCALES);
}

/**
 * Detect the best fitting language based on HA settings or user override.
 */
export function detectLang(hass, userLocale) {
  let tag = userLocale || hass?.locale?.language || hass?.language || DEFAULT;
  if (SUPPORTED_LOCALES.includes(tag)) {
    return tag;
  }
  const short = tag.slice(0, 2).toLowerCase();
  if (SUPPORTED_LOCALES.includes(short)) {
    return short;
  }
  return DEFAULT;
}

/**
 * Retrieve translation for key in the chosen language with fallback.
 */
export function t(key, lang) {
  const localize = LOCALIZE_FNS[lang] || LOCALIZE_FNS[DEFAULT];
  return localize(key) || LOCALIZE_FNS[DEFAULT](key) || key;
}
