// src/i18n.js

// Dynamiskt importera alla språkfiler från locales-katalogen via Vite
// Använder import.meta.glob med eager-flag för att paketera JSON-filerna
const localeModules = import.meta.glob("./locales/*.json", { eager: true });

const LOCALES = {};
for (const filePath in localeModules) {
  const match = filePath.match(/\.\/locales\/([\w-]+)\.json$/);
  if (match) {
    // Varje modul har sin data som default-export
    LOCALES[match[1]] = localeModules[filePath].default;
  }
}

// Standard-språk om nyckel eller språk saknas
const DEFAULT = "en";

/**
 * Hjälpfunktion för att plocka ut nested-nycklar från ett objekt
 */
function resolveKey(obj, path) {
  return path
    .split(".")
    .reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

/**
 * Detektera tvåbokstavskod för språk baserat på HA eller användarkonfig
 */
export function detectLang(hass, userLocale) {
  let lang;
  if (userLocale) {
    lang = userLocale.slice(0, 2).toLowerCase();
  } else if (hass?.locale?.language) {
    lang = hass.locale.language.slice(0, 2).toLowerCase();
  } else if (hass?.language) {
    lang = hass.language.slice(0, 2).toLowerCase();
  } else {
    lang = DEFAULT;
  }
  return LOCALES[lang] ? lang : DEFAULT;
}

/**
 * Hämta översättning för key i valt språk, med fallback
 */
export function t(key, lang) {
  const localeData = LOCALES[lang] || {};
  // Direkt nyckel
  if (localeData[key] !== undefined) {
    return localeData[key];
  }
  // Nested-nyckel
  const nested = resolveKey(localeData, key);
  if (nested !== undefined) {
    return nested;
  }
  // Fallback till default-språk
  const defaultData = LOCALES[DEFAULT] || {};
  if (defaultData[key] !== undefined) {
    return defaultData[key];
  }
  const defaultNested = resolveKey(defaultData, key);
  if (defaultNested !== undefined) {
    return defaultNested;
  }
  // Om inget hittas, returnera key
  return key;
}
