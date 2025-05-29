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
  // 1) Hitta den fulla taggen
  let tag = userLocale || hass?.locale?.language || hass?.language || DEFAULT;
  // 2) Om vi har en exakt match i LOCALES, använd den
  if (LOCALES[tag]) {
    return tag;
  }
  // 3) Annars titta på första två bokstäver
  const short = tag.slice(0, 2).toLowerCase();
  if (LOCALES[short]) {
    return short;
  }
  // 4) Annars fallback
  return DEFAULT;
}

export const SUPPORTED_LOCALES = Object.keys(LOCALES);

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
