// src/adapters/gpl/discovery.js
import { GPL_ATTRIBUTION, GPL_TYPE_ICON_MAP, GPL_BASE_ALLERGENS } from "./constants.js";
import { discoverEntitiesByDevice, resolveLocationByKey } from "../../utils/adapter-helpers.js";

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
 * Discover all GPL sensors using the shared discoverEntitiesByDevice helper.
 *
 * Returns: { locations: Map<configEntryId, { label: string, entities: Map<allergenKey, entityId> }> }
 *
 * Tier 1: device identifier match (platform "pollenlevels" in device.identifiers).
 * Tier 2: entity registry scan filtering by entry.platform === "pollenlevels".
 * Tier 3: attribution scan -- filters states by GPL_ATTRIBUTION attribute.
 */
export function discoverGplSensors(hass, debug = false) {
  if (!hass) return { locations: new Map() };

  const { locations } = discoverEntitiesByDevice(hass, {
    platform: "pollenlevels",

    // classify is used in tier 2 and tier 3; reads state.attributes.code or icon
    classify: (eid, { state }) => {
      if (!isGplDataSensor(state)) return null;
      return classifySensor(state);
    },

    // classifyRelaxed used in tier 1 -- same logic, no relaxation needed for GPL
    classifyRelaxed: (eid, { state }) => {
      if (!isGplDataSensor(state)) return null;
      return classifySensor(state);
    },

    // isRelevant: additional pre-classification filter (device_class check handled in classify)
    isRelevant: (eid, { state }) => isGplDataSensor(state),

    // fallbackSelector: tier 3 uses attribution attribute instead of entity ID regex
    fallbackSelector: (h) =>
      Object.keys(h.states).filter((eid) => {
        const s = h.states[eid];
        return s?.attributes?.attribution === GPL_ATTRIBUTION && isGplDataSensor(s);
      }),

    debug,
    logTag: "GPL",
  });

  return { locations };
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
    const resolved = resolveLocationByKey(discovery, configEntryId);
    if (resolved) discoveredEntities = resolved[1].entities;
  }

  for (const allergen of cfg.allergens || []) {
    const sensorId = resolveEntityId(allergen, hass, cfg, discoveredEntities, debug);
    if (sensorId && hass.states[sensorId]) {
      map.set(allergen, sensorId);
    }
  }
  return map;
}
