// src/utils/sensors.js
import { normalize, normalizeDWD } from "./normalize.js";
import { getAdapter } from "../adapter-registry.js";
import { ATMO_ALLERGEN_MAP } from "../adapters/atmo.js";
import silamAllergenMap from "../adapters/silam_allergen_map.json" assert { type: "json" };

/**
 * Shared manual mode entity resolution for PP, DWD, PEU, SILAM, ATMO.
 * Adds trailing underscore to prefix and strips "sensor." prefix.
 * Kleenex and GPL handle their own manual mode in resolveEntityIds.
 */
function resolveManualEntities(cfg, hass, debug) {
  const integration = cfg.integration;
  let prefix = cfg.entity_prefix || "";
  if (prefix.startsWith("sensor.")) {
    prefix = prefix.substring(7);
  }
  if (prefix && !prefix.endsWith("_")) {
    prefix = prefix + "_";
  }
  const suffix = cfg.entity_suffix || "";
  const sensors = [];

  for (const allergen of cfg.allergens || []) {
    let slug;
    if (integration === "dwd") {
      slug = normalizeDWD(allergen);
    } else if (integration === "atmo") {
      slug = ATMO_ALLERGEN_MAP[allergen] || normalize(allergen);
    } else if (integration === "silam") {
      slug = null;
      for (const mapping of Object.values(silamAllergenMap.mapping)) {
        const inv = Object.entries(mapping).reduce((acc, [ha, master]) => {
          acc[master] = ha;
          return acc;
        }, {});
        if (inv[allergen]) {
          slug = inv[allergen];
          break;
        }
      }
      if (!slug) slug = normalize(allergen);
    } else {
      slug = normalize(allergen);
    }
    let sensorId = `sensor.${prefix}${slug}${suffix}`;
    let exists = !!hass.states[sensorId];
    if (!exists && suffix === "") {
      const base = `sensor.${prefix}${slug}`;
      const candidates = Object.keys(hass.states).filter((id) =>
        id.startsWith(base),
      );
      if (candidates.length === 1) {
        sensorId = candidates[0];
        exists = true;
      }
    }
    if (debug) {
      console.debug(
        `[findAvailableSensors][custom] allergen: '${allergen}', slug: '${slug}', suffix: '${suffix}', sensorId: '${sensorId}', exists: ${exists}`,
      );
    }
    if (exists) sensors.push(sensorId);
  }
  if (debug) {
    console.debug(
      "[findAvailableSensors] Found sensors (",
      sensors.length,
      ") :",
      sensors,
    );
  }
  return sensors;
}

export function findAvailableSensors(cfg, hass, debug = false) {
  const integration = cfg.integration;

  // Shared manual mode for PP, DWD, PEU, SILAM, ATMO.
  // Kleenex and GPL handle their own manual mode in resolveEntityIds.
  const manual =
    cfg.city === "manual" ||
    cfg.region_id === "manual" ||
    (cfg.location === "manual" && integration !== "kleenex" && integration !== "gpl");
  if (manual) {
    return resolveManualEntities(cfg, hass, debug);
  }

  // Delegate to adapter's resolveEntityIds
  const adapter = getAdapter(integration);
  if (!adapter?.resolveEntityIds) return [];

  const map = adapter.resolveEntityIds(cfg, hass, debug);
  const sensors = [...map.values()].filter(Boolean);

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
