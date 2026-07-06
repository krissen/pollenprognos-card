// src/adapters/kleenex/index.ts
// Public facade: re-exports all named exports from sub-modules.
export {
  stubConfigKleenex,
  KLEENEX_ALLERGEN_MAP,
  KLEENEX_ALLERGEN_CATEGORIES,
  INDIVIDUAL_TO_CATEGORY,
  DOMAIN,
  capitalize,
} from "./constants.js";
export { ppmToLevel } from "./levels.js";
export { resolveEntityIds } from "./discovery.js";
export { fetchForecast } from "./forecast.js";

import type { HomeAssistant } from "../../types/home-assistant.js";
import type {
  AdapterAutodetect,
  AutodetectContext,
  AutodetectDetectResult,
} from "../../types/adapter.js";

/**
 * Autodetect descriptor. Detection matches the `sensor.kleenex_pollen_radar_`
 * prefix. Kleenex has no discovery dimension (location resolution scans the
 * sibling `_date` sensors, handled by the shared autodetect module), so neither
 * `discover` nor `extractLocationSlug` is provided.
 */
export const autodetect: AdapterAutodetect = {
  priority: 5,
  detectStates(
    _hass: HomeAssistant,
    ctx: AutodetectContext,
  ): AutodetectDetectResult {
    const ids = ctx.stateIds.filter(
      (id) =>
        typeof id === "string" &&
        id.startsWith("sensor.kleenex_pollen_radar_"),
    );
    return { ids };
  },
};
