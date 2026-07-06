// src/adapters/gpl/index.ts
// Public facade: re-exports all named exports from sub-modules.
export { GPL_ATTRIBUTION, GPL_TYPE_ICON_MAP, GPL_BASE_ALLERGENS, stubConfigGPL, capitalize } from "./constants.js";
export { classifySensor, isGplDataSensor, discoverGplSensors, discoverGplAllergens, resolveEntityIds } from "./discovery.js";
export { fetchForecast } from "./forecast.js";

import type { HomeAssistant } from "../../types/home-assistant.js";
import type {
  AdapterAutodetect,
  AutodetectContext,
  AutodetectDetectResult,
  AutodetectDiscovery,
} from "../../types/adapter.js";
import { GPL_ATTRIBUTION as _GPL_ATTRIBUTION } from "./constants.js";
import { discoverGplSensors as _discoverGplSensors } from "./discovery.js";

/**
 * Autodetect descriptor. Detection uses the `pollenlevels` platform in
 * hass.entities (primary) or the attribution string (fallback), excluding
 * date/timestamp helper entities in both paths (issue #258). Discovery is lazy
 * (used only by autoSelectLocation), so detectStates returns no discovery.
 */
export const autodetect: AdapterAutodetect = {
  priority: 8,
  detectStates(
    hass: HomeAssistant,
    ctx: AutodetectContext,
  ): AutodetectDetectResult {
    const isNonDataDeviceClass = (eid: string): boolean => {
      const dc = hass?.states?.[eid]?.attributes?.device_class;
      return dc === "date" || dc === "timestamp";
    };
    let ids: string[] = [];
    if (hass && hass.entities) {
      ids = Object.entries(hass.entities)
        .filter(
          ([eid, entry]) =>
            (entry as { platform?: string }).platform === "pollenlevels" &&
            !(entry as { entity_category?: string }).entity_category &&
            !isNonDataDeviceClass(eid),
        )
        .map(([eid]) => eid);
    }
    if (!ids.length) {
      ids = ctx.stateIds.filter((id) => {
        const s = hass.states[id];
        return (
          s?.attributes?.attribution === _GPL_ATTRIBUTION &&
          s.attributes.device_class !== "date" &&
          s.attributes.device_class !== "timestamp"
        );
      });
    }
    return { ids };
  },
  discover: (hass, debug) =>
    _discoverGplSensors(hass, debug) as AutodetectDiscovery,
};
