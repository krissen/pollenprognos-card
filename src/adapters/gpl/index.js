// src/adapters/gpl/index.js
// Public facade: re-exports all named exports from sub-modules.
export { GPL_ATTRIBUTION, GPL_TYPE_ICON_MAP, GPL_BASE_ALLERGENS, stubConfigGPL, capitalize } from "./constants.js";
export { classifySensor, isGplDataSensor, discoverGplSensors, discoverGplAllergens, resolveEntityIds } from "./discovery.js";
export { fetchForecast } from "./forecast.js";

// Stub functions to match other adapters
export function findSensors() {
  return [];
}

export async function getData() {
  return [];
}
