// src/adapters/gp/discovery.js
import { toCanonicalAllergenKey } from "../../constants.js";
import { normalizeManualPrefix, resolveManualEntity } from "../../utils/adapter-helpers.js";
import { GP_DOMAIN, GP_CATEGORY_MAP, GP_BASE_ALLERGENS } from "./constants.js";

/**
 * Classify a google_pollen sensor by its display_name attribute.
 * Returns the canonical allergen key (e.g. "birch", "grass_cat") or null.
 */
export function classifySensor(state) {
  const displayName = state?.attributes?.display_name;
  if (!displayName) return null;

  const slug = displayName.trim().toLowerCase().replace(/\s+/g, "_");

  // Check for category (grass, tree, weed)
  if (GP_CATEGORY_MAP[slug]) return GP_CATEGORY_MAP[slug];

  // Plant: normalize through the global alias map
  return toCanonicalAllergenKey(slug);
}

/**
 * Discover all google_pollen sensors.
 *
 * Returns: { locations: Map<configEntryId, { label, entities: Map<allergenKey, entityId> }> }
 *
 * Primary: hass.entities with platform === "google_pollen", no entity_category
 * Fallback: hass.states where entity_id starts with "sensor.google_pollen_"
 */
export function discoverGpSensors(hass, debug = false) {
  const result = { locations: new Map() };
  if (!hass) return result;

  let entityIds = [];
  let usedPrimary = false;

  // Primary: hass.entities (entity registry)
  if (hass.entities) {
    const candidates = Object.entries(hass.entities)
      .filter(([, entry]) =>
        entry.platform === GP_DOMAIN &&
        !entry.entity_category
      )
      .map(([eid]) => eid);

    if (candidates.length > 0) {
      entityIds = candidates;
      usedPrimary = true;
      if (debug) console.debug("[GP] Discovery: using hass.entities, found", candidates.length, "candidates");
    }
  }

  // Fallback: entity_id prefix scan
  if (!entityIds.length && hass.states) {
    entityIds = Object.keys(hass.states).filter((eid) =>
      eid.startsWith("sensor.google_pollen_")
    );
    if (debug) console.debug("[GP] Discovery: using prefix fallback, found", entityIds.length, "candidates");
  }

  if (!entityIds.length) return result;

  // Group by config_entry_id (primary) or device_id
  for (const eid of entityIds) {
    const state = hass.states[eid];
    if (!state) continue;

    const allergenKey = classifySensor(state);
    if (!allergenKey) {
      if (debug) console.debug("[GP] Could not classify sensor:", eid);
      continue;
    }

    // Resolve config_entry_id for location grouping
    let configEntryId = "default";
    if (usedPrimary && hass.entities?.[eid]?.device_id && hass.devices) {
      const deviceId = hass.entities[eid].device_id;
      const device = hass.devices[deviceId];
      if (device?.config_entries?.length) {
        configEntryId = device.config_entries[0];
      }
    }

    if (!result.locations.has(configEntryId)) {
      let label = "Auto";
      if (usedPrimary && hass.entities?.[eid]?.device_id && hass.devices) {
        const deviceId = hass.entities[eid].device_id;
        const device = hass.devices[deviceId];
        if (device?.name) label = device.name;
      } else {
        const friendly = state.attributes?.friendly_name || "";
        if (friendly) label = friendly;
      }
      result.locations.set(configEntryId, { label, entities: new Map() });
    }

    result.locations.get(configEntryId).entities.set(allergenKey, eid);
  }

  if (debug) {
    console.debug("[GP] Discovery result:", result.locations.size, "locations");
    for (const [locId, loc] of result.locations) {
      console.debug(`  [${locId}] "${loc.label}":`, [...loc.entities.keys()]);
    }
  }

  return result;
}

/**
 * Get available allergen keys for a given location.
 * Returns sorted array: categories first, then plants alphabetically.
 */
export function discoverGpAllergens(hass, configEntryId, debug = false) {
  const discovery = discoverGpSensors(hass, debug);
  if (!discovery.locations.size) return [];

  let location;
  if (configEntryId && discovery.locations.has(configEntryId)) {
    location = discovery.locations.get(configEntryId);
  } else {
    location = discovery.locations.values().next().value;
  }

  if (!location) return [];

  const keys = [...location.entities.keys()];
  const categories = keys.filter((k) => GP_BASE_ALLERGENS.includes(k)).sort();
  const plants = keys.filter((k) => !GP_BASE_ALLERGENS.includes(k)).sort();
  return [...categories, ...plants];
}

/**
 * Resolve entity ID for a single allergen, using discovery or manual mode.
 */
function resolveEntityId(allergen, hass, config, discoveredEntities, debug) {
  if (config.location === "manual") {
    const prefix = normalizeManualPrefix(config.entity_prefix || "");
    const suffix = config.entity_suffix || "";

    // Collect candidate entity IDs
    let candidateIds = [];
    if (hass.entities) {
      candidateIds = Object.entries(hass.entities)
        .filter(([, entry]) => entry.platform === GP_DOMAIN && !entry.entity_category)
        .map(([eid]) => eid);
    }
    if (!candidateIds.length) {
      candidateIds = Object.keys(hass.states || {}).filter((eid) =>
        eid.startsWith("sensor.google_pollen_")
      );
    }

    for (const eid of candidateIds) {
      const state = hass.states[eid];
      if (!state) continue;

      const idPart = eid.replace(/^sensor\./, "");
      if (prefix && !idPart.startsWith(prefix)) continue;
      if (suffix && !idPart.endsWith(suffix)) continue;

      const key = classifySensor(state);
      if (key === allergen) return eid;
    }

    if (debug) console.debug(`[GP] Manual mode: no sensor found for allergen "${allergen}"`);
    return null;
  }

  // Discovery-based lookup
  if (discoveredEntities && discoveredEntities.has(allergen)) {
    return discoveredEntities.get(allergen);
  }

  if (debug) console.debug(`[GP] Sensor not found for allergen "${allergen}"`);
  return null;
}

export function resolveEntityIds(cfg, hass, debug = false) {
  const map = new Map();
  const discovery = discoverGpSensors(hass, debug);
  const configEntryId = cfg.location || "";

  let discoveredEntities = null;
  if (configEntryId !== "manual") {
    let location;
    if (configEntryId && discovery.locations.has(configEntryId)) {
      location = discovery.locations.get(configEntryId);
    } else if (discovery.locations.size) {
      location = discovery.locations.values().next().value;
    }
    if (location) discoveredEntities = location.entities;
  }

  for (const allergen of cfg.allergens || []) {
    const sensorId = resolveEntityId(allergen, hass, cfg, discoveredEntities, debug);
    if (sensorId && hass.states[sensorId]) {
      map.set(allergen, sensorId);
    }
  }
  return map;
}
