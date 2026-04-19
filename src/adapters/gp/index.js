// src/adapters/gp/index.js
// Adapter for svenove/home-assistant-google-pollen (domain: google_pollen)

export { fetchForecast } from "./forecast.js";
export { resolveEntityIds, discoverGpSensors, discoverGpAllergens } from "./discovery.js";
export { stubConfigGP, capitalize, GP_DOMAIN, GP_BASE_ALLERGENS, GP_DISPLAY_NAME_MAP, GP_COLLISION_PLANTS } from "./constants.js";
