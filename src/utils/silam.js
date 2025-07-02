import silamAllergenMap from "../adapters/silam_allergen_map.json" assert { type: "json" };

// Skapa dynamisk reverse-map: masterAllergen => slug för rätt språk
export function getSilamReverseMap(lang) {
  const mapping =
    silamAllergenMap.mapping?.[lang] || silamAllergenMap.mapping?.en || {};
  const reverse = {};
  for (const [slug, master] of Object.entries(mapping)) {
    reverse[master] = slug;
  }
  return reverse;
}

/**
 * Hitta rätt weather.silam_pollen_{location}_{suffix} i hass.states.
 * - Testar: locale-suffixar, engelska, alla, samt sista utväg: prefix-match.
 */
export function findSilamWeatherEntity(hass, location, locale) {
  if (!hass || !location) return null;
  const loc = location.toLowerCase();
  let tried = new Set();

  // 1. Testa suffixar för aktuell locale
  const suffixesLocale =
    silamAllergenMap.weather_suffixes?.[locale] ||
    silamAllergenMap.weather_suffixes?.[locale?.split("-")[0]] ||
    [];
  for (const suffix of suffixesLocale) {
    tried.add(suffix);
    const entityId = `weather.silam_pollen_${loc}_${suffix}`;
    if (entityId in hass.states) return entityId;
  }

  // 2. Testa engelska suffixar
  for (const suffix of silamAllergenMap.weather_suffixes?.en || []) {
    if (tried.has(suffix)) continue;
    tried.add(suffix);
    const entityId = `weather.silam_pollen_${loc}_${suffix}`;
    if (entityId in hass.states) return entityId;
  }

  // 3. Testa alla kända suffixar (alla språk)
  const allSuffixes = Array.from(
    new Set(Object.values(silamAllergenMap.weather_suffixes).flat()),
  );
  for (const suffix of allSuffixes) {
    if (tried.has(suffix)) continue;
    const entityId = `weather.silam_pollen_${loc}_${suffix}`;
    if (entityId in hass.states) return entityId;
  }

  // 4. Fallback: första entity med rätt prefix
  const prefix = `weather.silam_pollen_${loc}_`;
  return Object.keys(hass.states).find((id) => id.startsWith(prefix)) || null;
}
