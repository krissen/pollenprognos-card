// src/adapters/gp/index.ts
// Adapter for svenove/home-assistant-google-pollen (domain: google_pollen)

export { fetchForecast } from "./forecast.js";
export {
  resolveEntityIds,
  discoverGpSensors,
  discoverGpAllergens,
} from "./discovery.js";
export {
  stubConfigGP,
  capitalize,
  GP_DOMAIN,
  GP_BASE_ALLERGENS,
  GP_DISPLAY_NAME_MAP,
  GP_COLLISION_PLANTS,
} from "./constants.js";

import type { HomeAssistant } from "../../types/home-assistant.js";
import type {
  AdapterAutodetect,
  AutodetectContext,
  AutodetectDetectResult,
  AutodetectDiscovery,
} from "../../types/adapter.js";
import { discoverGpSensors as _discoverGpSensors } from "./discovery.js";

/** Exclude date/timestamp helper entities so they are never treated as pollen data. */
function isNonDataDeviceClass(hass: HomeAssistant, eid: string): boolean {
  const dc = hass?.states?.[eid]?.attributes?.device_class;
  return dc === "date" || dc === "timestamp";
}

/**
 * Autodetect descriptor. Detection is discovery-primary (device/registry via
 * discoverGpSensors), falling back to the `google_pollen` platform in
 * hass.entities and finally to the `sensor.google_pollen_` prefix. The
 * eagerly-computed discovery is returned so autoSelectLocation reuses it.
 */
export const autodetect: AdapterAutodetect = {
  priority: 7,
  detectStates(
    hass: HomeAssistant,
    ctx: AutodetectContext,
    debug = false,
  ): AutodetectDetectResult {
    const discovery = _discoverGpSensors(hass, debug) as AutodetectDiscovery;
    let ids: string[] = [];
    if (discovery.locations.size > 0) {
      for (const [, loc] of discovery.locations) {
        if (loc.entities) {
          for (const eid of loc.entities.values()) ids.push(eid);
        }
      }
    }
    if (!ids.length) {
      if (hass && hass.entities) {
        ids = Object.entries(hass.entities)
          .filter(
            ([eid, entry]) =>
              (entry as { platform?: string }).platform === "google_pollen" &&
              !(entry as { entity_category?: string }).entity_category &&
              !isNonDataDeviceClass(hass, eid),
          )
          .map(([eid]) => eid);
      }
      if (!ids.length) {
        ids = ctx.stateIds.filter(
          (id) =>
            typeof id === "string" && id.startsWith("sensor.google_pollen_"),
        );
      }
    }
    return { ids, discovery };
  },
  discover: (hass, debug) =>
    _discoverGpSensors(hass, debug) as AutodetectDiscovery,
};
