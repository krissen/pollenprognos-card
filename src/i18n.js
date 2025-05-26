// src/i18n.js
import sv from "./locales/sv.json";
import en from "./locales/en.json";
import de from "./locales/de.json";

const LOCALES = { sv, en, de };
const DEFAULT = "en";

// Hjälpfunktion för att dyka i objekt enligt punktseparerad nyckel
function resolveKey(obj, path) {
  return path
    .split(".")
    .reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

export function detectLang(hass, userLocale) {
  let lang;
  if (userLocale) {
    lang = userLocale.slice(0, 2).toLowerCase();
  } else if (hass?.locale?.language) {
    // Newer HA stores UI locale here
    lang = hass.locale.language.slice(0, 2).toLowerCase();
  } else if (hass?.language) {
    // Fallback to older property
    lang = hass.language.slice(0, 2).toLowerCase();
  } else {
    lang = DEFAULT;
  }
  if (!LOCALES[lang]) {
    lang = DEFAULT;
  }
  return lang;
}

export function t(key, lang) {
  // Försök direkt på rot-objekt (stöder platta nycklar i JSON)
  if (LOCALES[lang] && LOCALES[lang][key] !== undefined) {
    return LOCALES[lang][key];
  }
  // Försök med punktsyntax (nested objekt)
  const nested = resolveKey(LOCALES[lang], key);
  if (nested !== undefined) {
    return nested;
  }
  // Fallback direkt engelska
  if (LOCALES[DEFAULT] && LOCALES[DEFAULT][key] !== undefined) {
    return LOCALES[DEFAULT][key];
  }
  // Fallback nested engelska
  const fbNested = resolveKey(LOCALES[DEFAULT], key);
  if (fbNested !== undefined) {
    return fbNested;
  }
  // Om allt misslyckas
  return key;
}
