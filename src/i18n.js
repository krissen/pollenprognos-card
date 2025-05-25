// src/i18n.js
import sv from "./locales/sv.json";
import en from "./locales/en.json";
import de from "./locales/de.json";

const LOCALES = { sv, en, de };
const DEFAULT = "en";

export function detectLang(hass, userLocale) {
  if (userLocale) return userLocale.slice(0, 2).toLowerCase();
  const ha = hass?.language?.slice(0, 2).toLowerCase();
  return ha || DEFAULT;
}

export function t(key, lang) {
  return LOCALES[lang]?.[key] ?? LOCALES[DEFAULT]?.[key] ?? key;
}
