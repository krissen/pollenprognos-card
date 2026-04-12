// src/adapters/gp/index.js
// Adapter for svenove/home-assistant-google-pollen (domain: google_pollen)

export { fetchForecast } from "./forecast.js";
export { resolveEntityIds, discoverGpSensors, discoverGpAllergens } from "./discovery.js";
export { stubConfigGP, capitalize, GP_DOMAIN, GP_BASE_ALLERGENS, GP_CATEGORY_MAP } from "./constants.js";
