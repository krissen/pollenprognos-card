// src/utils/sensors.js
import { getAdapter } from "../adapter-registry.js";

/**
 * Detect available sensor entity IDs for the configured integration.
 * Delegates all resolution (including manual mode) to the adapter's
 * resolveEntityIds().
 */
export function findAvailableSensors(cfg, hass, debug = false) {
  const adapter = getAdapter(cfg.integration);
  if (!adapter?.resolveEntityIds) return [];

  const map = adapter.resolveEntityIds(cfg, hass, debug);
  const sensors = [...map.values()].filter((eid) => {
    if (!eid) return false;
    const state = hass?.states?.[eid]?.state;
    // Exclude entities that are unavailable or unknown (e.g. disabled integration)
    return state !== "unavailable" && state !== "unknown";
  });

  if (debug) {
    console.debug(
      "[findAvailableSensors] Found sensors (",
      sensors.length,
      "): ",
      sensors,
    );
  }

  return sensors;
}
