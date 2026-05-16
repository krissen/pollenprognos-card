// src/adapters/gpl/discovery.js
import { GPL_ATTRIBUTION, GPL_TYPE_ICON_MAP, GPL_BASE_ALLERGENS } from "./constants.js";
import { discoverEntitiesByDevice, resolveLocationByKey, isConfigEntryId } from "../../utils/adapter-helpers.js";
import { cleanDeviceLabel } from "../../utils/device-label.js";

/**
 * Classify a GPL sensor by its attributes / registry entry.
 * Returns the allergen key (e.g. "birch", "grass_cat", "allergy_risk")
 * or null.
 *
 * @param {object} state - hass.states entry (attributes carry the data).
 * @param {object} [entry] - hass.entities registry entry (carries
 *   unique_id and translation_key; needed for v2.1.0 summary sensors
 *   which don't expose either via state.attributes).
 */
export function classifySensor(state, entry) {
  const attrs = state?.attributes || {};
  // Plant sensors have a code attribute (always English, e.g. "birch").
  if (attrs.code) {
    return attrs.code.toLowerCase();
  }
  // Type sensors identified by icon.
  const iconKey = GPL_TYPE_ICON_MAP[attrs.icon];
  if (iconKey) return iconKey;

  // Pollen Levels v2.1.0 summary: `overall_pollen_risk_today` (0-5
  // aggregated index). Registered with the same device as the
  // per-allergen sensors, but without a `code` attribute or matching
  // icon -- detection has to use unique_id / translation_key from the
  // entity registry. Mapped to canonical `allergy_risk` so it reuses
  // Atmo's / SILAM's pinning + rendering paths.
  //
  // The two sibling v2.1.0 summary sensors -- `top_pollen_types_today`
  // (comma-joined string) and `plants_in_season_today` (count) -- are
  // intentionally left unhandled here; they need new render shapes and
  // are tracked in #222.
  const uniqueId = entry?.unique_id;
  const translationKey = entry?.translation_key;
  if (
    (typeof uniqueId === "string" && uniqueId.endsWith("_overall_pollen_risk_today")) ||
    translationKey === "overall_pollen_risk_today"
  ) {
    return "allergy_risk";
  }

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

    // classify is used in tier 2 and tier 3; reads state.attributes.code
    // or icon, and falls through to the registry entry for v2.1.0 summary
    // sensors which only expose their identity via unique_id /
    // translation_key.
    classify: (eid, { state, entry }) => {
      if (!isGplDataSensor(state)) return null;
      return classifySensor(state, entry);
    },

    // classifyRelaxed used in tier 1 -- same logic, no relaxation needed for GPL.
    classifyRelaxed: (eid, { state, entry }) => {
      if (!isGplDataSensor(state)) return null;
      return classifySensor(state, entry);
    },

    // isRelevant: additional pre-classification filter (device_class check handled in classify)
    isRelevant: (eid, { state }) => isGplDataSensor(state),

    // fallbackSelector: tier 3 uses attribution attribute instead of entity ID regex
    fallbackSelector: (h) =>
      Object.keys(h.states).filter((eid) => {
        const s = h.states[eid];
        return s?.attributes?.attribution === GPL_ATTRIBUTION && isGplDataSensor(s);
      }),

    /**
     * resolveLabel priority for GPL:
     *   1. device.name_by_user -- explicit user override, kept verbatim.
     *   2. device.name run through cleanDeviceLabel to strip the
     *      "{location} - {category-localized} ({lat},{lng})" suffix that
     *      the pollenlevels integration appends. cleanDeviceLabel uses a
     *      locale-agnostic regex so new HA languages don't regress this.
     *   3. friendly_name from state.attributes.
     *   4. "Auto" fallback.
     */
    resolveLabel: (ctx) => {
      if (ctx.device?.name_by_user) return ctx.device.name_by_user;
      const cleaned = cleanDeviceLabel(ctx.device?.name);
      if (typeof cleaned === "string" && cleaned.trim()) return cleaned;
      if (ctx.state?.attributes?.friendly_name) {
        return cleanDeviceLabel(ctx.state.attributes.friendly_name);
      }
      return "Auto";
    },

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

      // Classify and check if it matches the requested allergen. Pass
      // the registry entry so manual-mode lookups also catch the
      // v2.1.0 summary sensor (detected via unique_id / translation_key).
      const entry = hass.entities?.[eid];
      const key = classifySensor(state, entry);
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
    let resolved = resolveLocationByKey(discovery, configEntryId);
    // Stale-config recovery: a saved ULID that no longer matches any
    // discovered location (e.g. integration reinstalled, tier 3 collapsed
    // into a single "default" bucket) used to silently produce an empty map.
    // Retry with autodetect semantics so legacy/changed configs still work.
    if (!resolved && configEntryId && isConfigEntryId(configEntryId)) {
      resolved = resolveLocationByKey(discovery, "");
    }
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
