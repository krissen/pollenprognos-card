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
    const entity = hass?.states?.[eid];
    if (!entity) return false;
    // Keep `unknown`: the entity exists but its value is currently None
    // (e.g. API returned null). Only `unavailable` signals a disabled/down
    // integration, where "no sensors found" is the right message.
    return entity.state !== "unavailable";
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
