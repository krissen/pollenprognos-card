// src/adapters/kleenex/index.js
// Public facade: re-exports all named exports from sub-modules.
export { stubConfigKleenex, KLEENEX_ALLERGEN_MAP, KLEENEX_ALLERGEN_CATEGORIES, INDIVIDUAL_TO_CATEGORY, DOMAIN, capitalize } from "./constants.js";
export { ppmToLevel } from "./levels.js";
export { resolveEntityIds } from "./discovery.js";
export { fetchForecast } from "./forecast.js";
