// src/adapters/gp/discovery.js
import { normalizeManualPrefix, discoverEntitiesByDevice, resolveLocationByKey, isConfigEntryId } from "../../utils/adapter-helpers.js";
import { GP_DOMAIN, GP_DISPLAY_NAME_MAP, GP_COLLISION_PLANTS, GP_BASE_ALLERGENS } from "./constants.js";

// Regex to extract pollen code from unique_id.
// Format: google_pollen_{code}_{lat}_{lon}
// Pollen codes never start with a digit; coordinates always do.
const UNIQUE_ID_RE = /^google_pollen_(.+?)_-?\d/;

/**
 * Extract the pollen code from a unique_id string.
 * Returns the lowercase code (e.g. "birch", "tree") or null.
 */
function codeFromUniqueId(uniqueId) {
  if (!uniqueId) return null;
  const m = UNIQUE_ID_RE.exec(uniqueId);
  return m ? m[1].toLowerCase() : null;
}

// Category codes used in unique_id for the three base category sensors.
const CATEGORY_CODES = { grass: "grass_cat", tree: "trees_cat", weed: "weeds_cat" };

/**
 * Map a raw pollen code (from unique_id) to an allergen key.
 * Category codes get mapped to their canonical keys (grass_cat, trees_cat, weeds_cat).
 * Plant codes are kept as-is, since canonicalization for display/icons happens
 * later via resolveAllergenNames/ALLERGEN_ICON_FALLBACK.
 */
function classifyCode(code) {
  if (!code) return null;
  return CATEGORY_CODES[code] || code;
}

/**
 * Classify a sensor as a plant only (skip the category interpretation).
 * Used when a collision is detected and we need the plant interpretation.
 * Returns the raw pollen code (not canonicalized) to match GPL behavior.
 */
function classifySensorAsPlant(state, entityEntry) {
  const code = codeFromUniqueId(entityEntry?.unique_id);
  if (code) return code;

  const displayName = state?.attributes?.display_name;
  if (!displayName) return null;
  const key = displayName.trim().toLowerCase();
  // GP_COLLISION_PLANTS holds the plant interpretation for names that are shared
  // between the grass category and the graminales plant. Fall back to the main
  // map for display names that are not collision candidates.
  return GP_COLLISION_PLANTS[key] || GP_DISPLAY_NAME_MAP[key] || null;
}

/**
 * Classify a google_pollen sensor.
 *
 * Tries two strategies in order:
 * 1. unique_id from entity registry (language-independent, always English)
 * 2. display_name direct lookup in GP_DISPLAY_NAME_MAP (trimmed, lowercased)
 * 3. Returns null if unclassifiable
 */
export function classifySensor(state, entityEntry) {
  // 1. unique_id (best: always English pollen code)
  const code = codeFromUniqueId(entityEntry?.unique_id);
  if (code) {
    const key = classifyCode(code);
    if (key) return key;
  }

  // 2. display_name direct lookup (no transliteration needed)
  const displayName = state?.attributes?.display_name;
  if (!displayName) return null;

  const key = displayName.trim().toLowerCase();
  return GP_DISPLAY_NAME_MAP[key] || null;
}

/**
 * Discover all google_pollen sensors.
 *
 * Uses discoverEntitiesByDevice with three tiers:
 *   Tier 1: device.identifiers match "google_pollen" (strict device-based)
 *   Tier 2: entry.platform === "google_pollen" (entity-registry scan)
 *   Tier 3: entity_id prefix "sensor.google_pollen_" (fallback)
 *
 * Collision handling: when two sensors share the same allergen key
 * (e.g. Swedish "Gräs" maps to both grass_cat category and graminales plant),
 * the second sensor is reclassified as a plant via classifySensorAsPlant.
 *
 * Returns: { locations: Map<configEntryId, { label, entities: Map<allergenKey, entityId> }> }
 */
export function discoverGpSensors(hass, debug = false) {
  if (!hass) return { locations: new Map() };

  const { locations } = discoverEntitiesByDevice(hass, {
    platform: GP_DOMAIN,

    // Strict classifier: unique_id preferred, then display_name lookup.
    classify: (_eid, { state, entry }) => classifySensor(state, entry),

    // Relaxed classifier (tier 1): same logic -- classifySensor handles both paths.
    classifyRelaxed: (_eid, { state, entry }) => classifySensor(state, entry),

    // Skip diagnostic and config-flow entities.
    excludeEntry: (entry) => !!(entry && entry.entity_category),

    // Collision: when a key is already taken, reclassify the new sensor as a plant.
    // This handles the case where two sensors share a localized display_name
    // (e.g. Swedish "Gräs" = GRASS category + GRAMINALES plant).
    onCollision: (ctx, { existingKey, locEntities }) => {
      const alt = classifySensorAsPlant(ctx.state, ctx.entry);
      if (alt && alt !== existingKey && !locEntities.has(alt)) {
        if (debug) console.debug("[GP] Collision on", existingKey, "-> reclassified as", alt, "for", ctx.entityId);
        return alt;
      }
      if (debug) console.debug("[GP] Collision: duplicate key", existingKey, "for", ctx.entityId, "(skipped)");
      return null;
    },

    // Fallback: prefix scan for tier 3.
    fallbackSelector: (h) => Object.keys(h.states).filter((eid) =>
      eid.startsWith("sensor.google_pollen_")
    ),

    debug,
    logTag: "GP",
  });

  return { locations };
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

      const entityEntry = hass.entities?.[eid];
      const key = classifySensor(state, entityEntry);
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
    let match = resolveLocationByKey(discovery, configEntryId);
    // Stale-config recovery: a saved ULID that no longer matches any
    // discovered location (e.g. integration reinstalled, tier 3 collapsed
    // into a single "default" bucket) used to silently produce an empty map.
    // Retry with autodetect semantics so legacy/changed configs still work.
    if (!match && configEntryId && isConfigEntryId(configEntryId)) {
      match = resolveLocationByKey(discovery, "");
    }
    if (match) discoveredEntities = match[1].entities;
  }

  for (const allergen of cfg.allergens || []) {
    const sensorId = resolveEntityId(allergen, hass, cfg, discoveredEntities, debug);
    if (sensorId && hass.states[sensorId]) {
      map.set(allergen, sensorId);
    }
  }
  return map;
}
