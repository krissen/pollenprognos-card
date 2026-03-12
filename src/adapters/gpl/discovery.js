// src/adapters/gpl/discovery.js
import { GPL_ATTRIBUTION, GPL_TYPE_ICON_MAP, GPL_BASE_ALLERGENS } from "./constants.js";

/**
 * Classify a GPL sensor by its attributes.
 * Returns the allergen key (e.g. "birch", "grass_cat") or null.
 */
export function classifySensor(state) {
  const attrs = state?.attributes || {};
  // Plant sensors have a code attribute (always English, e.g. "birch")
  if (attrs.code) {
    return attrs.code.toLowerCase();
  }
  // Type sensors identified by icon
  const iconKey = GPL_TYPE_ICON_MAP[attrs.icon];
  if (iconKey) return iconKey;
  return null;
}

/**
 * Check if an entity is a GPL sensor (not a diagnostic/meta sensor).
 */
export function isGplDataSensor(state) {
  const attrs = state?.attributes || {};
  const dc = attrs.device_class;
  return dc !== "date" && dc !== "timestamp";
}

/**
 * Discover all GPL sensors using hass.entities (primary) or attribution (fallback).
 *
 * Returns: { locations: Map<configEntryId, { label: string, entities: Map<allergenKey, entityId> }> }
 *
 * Primary path: hass.entities -> filter platform === "pollenlevels", no entity_category
 * Fallback path: hass.states -> filter attribution === GPL_ATTRIBUTION, exclude date/timestamp
 */
export function discoverGplSensors(hass, debug = false) {
  const result = { locations: new Map() };
  if (!hass) return result;

  // Collect candidate entity IDs
  let entityIds = [];
  let usedPrimary = false;

  // Primary: hass.entities (entity registry)
  if (hass.entities) {
    const candidates = Object.entries(hass.entities)
      .filter(([, entry]) =>
        entry.platform === "pollenlevels" &&
        !entry.entity_category
      )
      .map(([eid]) => eid);

    if (candidates.length > 0) {
      entityIds = candidates;
      usedPrimary = true;
      if (debug) console.debug("[GPL] Discovery: using hass.entities, found", candidates.length, "candidates");
    }
  }

  // Fallback: attribution scan
  if (!entityIds.length && hass.states) {
    entityIds = Object.keys(hass.states).filter((eid) => {
      const s = hass.states[eid];
      return s?.attributes?.attribution === GPL_ATTRIBUTION && isGplDataSensor(s);
    });
    if (debug) console.debug("[GPL] Discovery: using attribution fallback, found", entityIds.length, "candidates");
  }

  if (!entityIds.length) return result;

  // Group by config_entry_id
  for (const eid of entityIds) {
    const state = hass.states[eid];
    if (!state) continue;

    // Filter out meta sensors in both paths
    if (!isGplDataSensor(state)) continue;

    // Classify sensor
    const allergenKey = classifySensor(state);
    if (!allergenKey) {
      if (debug) console.debug("[GPL] Could not classify sensor:", eid);
      continue;
    }

    // Resolve config_entry_id
    let configEntryId = "default";
    if (usedPrimary && hass.entities?.[eid]?.device_id && hass.devices) {
      const deviceId = hass.entities[eid].device_id;
      const device = hass.devices[deviceId];
      if (device?.config_entries?.length) {
        configEntryId = device.config_entries[0];
      }
    }

    // Get or create location entry
    if (!result.locations.has(configEntryId)) {
      // Generate label from device name or "Auto"
      let label = "Auto";
      if (usedPrimary && hass.entities?.[eid]?.device_id && hass.devices) {
        const deviceId = hass.entities[eid].device_id;
        const device = hass.devices[deviceId];
        if (device?.name) {
          label = device.name;
        }
      } else {
        // Fallback: try friendly_name from first sensor
        const friendly = state.attributes?.friendly_name || "";
        if (friendly) label = friendly;
      }
      result.locations.set(configEntryId, { label, entities: new Map() });
    }

    result.locations.get(configEntryId).entities.set(allergenKey, eid);
  }

  if (debug) {
    console.debug("[GPL] Discovery result:", result.locations.size, "locations");
    for (const [locId, loc] of result.locations) {
      console.debug(`  [${locId}] "${loc.label}":`, [...loc.entities.keys()]);
    }
  }

  return result;
}

/**
 * Get available allergen keys for a given location (config_entry_id).
 * If configEntryId is empty/null, uses the first discovered location.
 * Returns sorted array of allergen keys (e.g. ["grass_cat", "trees_cat", "birch", "oak"]).
 */
export function discoverGplAllergens(hass, configEntryId, debug = false) {
  const discovery = discoverGplSensors(hass, debug);
  if (!discovery.locations.size) return [];

  let location;
  if (configEntryId && discovery.locations.has(configEntryId)) {
    location = discovery.locations.get(configEntryId);
  } else {
    // Use first available location
    location = discovery.locations.values().next().value;
  }

  if (!location) return [];

  const keys = [...location.entities.keys()];
  // Sort: categories first, then plants alphabetically
  const categories = keys.filter((k) => GPL_BASE_ALLERGENS.includes(k)).sort();
  const plants = keys.filter((k) => !GPL_BASE_ALLERGENS.includes(k)).sort();
  return [...categories, ...plants];
}

/**
 * Resolve entity ID for a given allergen and config, using discovery or manual mode.
 * Returns entity ID string or null.
 */
function resolveEntityId(allergen, hass, config, discoveredEntities, debug) {
  if (config.location === "manual") {
    // Manual mode: search by platform (primary) or attribution (fallback) + prefix/suffix filter
    let prefix = config.entity_prefix || "";
    // Remove 'sensor.' prefix if user included it
    if (prefix.startsWith("sensor.")) prefix = prefix.substring(7);
    const suffix = config.entity_suffix || "";

    // Collect candidate entity IDs: primary via hass.entities, fallback via attribution
    let candidateIds = [];
    if (hass.entities) {
      candidateIds = Object.entries(hass.entities)
        .filter(([, entry]) => entry.platform === "pollenlevels" && !entry.entity_category)
        .map(([eid]) => eid);
    }
    if (!candidateIds.length) {
      // Fallback: attribution scan
      candidateIds = Object.keys(hass.states || {}).filter((eid) => {
        const s = hass.states[eid];
        return s?.attributes?.attribution === GPL_ATTRIBUTION && isGplDataSensor(s);
      });
    }

    for (const eid of candidateIds) {
      const state = hass.states[eid];
      if (!state || !isGplDataSensor(state)) continue;

      // Check prefix/suffix match on entity_id
      const idPart = eid.replace(/^sensor\./, "");
      if (prefix && !idPart.startsWith(prefix)) continue;
      if (suffix && !idPart.endsWith(suffix)) continue;

      // Classify and check if it matches the requested allergen
      const key = classifySensor(state);
      if (key === allergen) return eid;
    }

    if (debug) console.debug(`[GPL] Manual mode: no sensor found for allergen "${allergen}"`);
    return null;
  }

  // Discovery-based lookup
  if (discoveredEntities && discoveredEntities.has(allergen)) {
    return discoveredEntities.get(allergen);
  }

  if (debug) console.debug(`[GPL] Sensor not found for allergen "${allergen}"`);
  return null;
}

export function resolveEntityIds(cfg, hass, debug = false) {
  const map = new Map();
  const discovery = discoverGplSensors(hass, debug);
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
