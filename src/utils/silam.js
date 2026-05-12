import silamAllergenMap from "../adapters/silam_allergen_map.json" assert { type: "json" };
import { discoverEntitiesByDevice, isConfigEntryId } from "./adapter-helpers.js";

// Re-export so editor and other callers can keep their silam.js import path.
export { isConfigEntryId };

// Skapa dynamisk reverse-map: masterAllergen => slug för rätt språk
export function getSilamReverseMap(lang) {
  const mapping =
    silamAllergenMap.mapping?.[lang] || silamAllergenMap.mapping?.en || {};
  const reverse = {};
  for (const [slug, master] of Object.entries(mapping)) {
    reverse[master] = slug;
  }
  return reverse;
}

/**
 * Classify a SILAM entity by its translation_key.
 * Returns the canonical master allergen key, or null for non-allergen entities
 * (weather/forecast entities return null so they are excluded from sensors).
 */
function classifySilamEntity(eid, { entry }) {
  if (!entry) return null;
  // Weather/forecast entities are handled as a separate postprocess step
  if (eid.startsWith("weather.") || entry.translation_key === "forecast") return null;
  const tk = entry.translation_key;
  if (!tk) return null;
  // Map through all language mappings to find the master allergen key
  for (const mapping of Object.values(silamAllergenMap.mapping)) {
    if (mapping[tk]) return mapping[tk];
  }
  // translation_key not found in any language mapping
  return null;
}

/**
 * Discover all SILAM sensors using hass.entities (entity registry).
 *
 * Returns: { locations: Map<configEntryId, { label, weatherEntity, sensors: Map<allergenKey, entityId> }> }
 *
 * Uses discoverEntitiesByDevice with tier 1 (device identifier scan) active.
 * The SILAM integration uses platform "silam_pollen" in both entry.platform and
 * device identifiers, enabling robust device-based grouping.
 *
 * Weather entities are resolved as a postprocess step after sensor discovery,
 * by searching for entries with translation_key === "forecast" on the same device.
 *
 * Returns empty map if hass.entities is unavailable (older HA) — callers
 * should fall back to regex-based detection via findSilamWeatherEntity.
 *
 * Quirk: SILAM weather entities have translation_key === "forecast" and their
 * entity_id starts with "weather.". They are excluded from the sensor map and
 * attached as weatherEntity per location instead.
 */
/**
 * Strip the generic "SILAM Pollen" prefix (with optional separators) from a
 * device name so downstream consumers (editor dropdown, card title) get a
 * clean location label like "Karis" rather than "SILAM Pollen - Karis".
 */
function stripSilamPrefix(name) {
  if (typeof name !== "string") return name;
  const stripped = name.replace(/^\s*silam\s*pollen\b[\s:\-–—]*/i, "").trim();
  return stripped || name;
}

export function discoverSilamSensors(hass, debug = false) {
  const result = { locations: new Map() };
  if (!hass?.entities) return result;

  // Run shared discovery for allergen sensors (weather entities classified as null → skipped).
  // Tier 3 is disabled (fallbackRegex: null) — SILAM sensors always have entity registry entries.
  const { locations: rawLocations } = discoverEntitiesByDevice(hass, {
    platform: "silam_pollen",
    classify: classifySilamEntity,
    classifyRelaxed: classifySilamEntity,
    resolveLabel: (ctx) => {
      if (ctx.device?.name_by_user) return ctx.device.name_by_user;
      if (ctx.device?.name) return stripSilamPrefix(ctx.device.name);
      if (ctx.state?.attributes?.friendly_name) {
        return stripSilamPrefix(ctx.state.attributes.friendly_name);
      }
      return "Auto";
    },
    fallbackRegex: null,
    debug,
    logTag: "SILAM",
  });

  // Build a lookup: deviceId -> weatherEntityId for the postprocess step.
  // Also collect device metadata for locations that only have a weather entity
  // (e.g. the user enabled no allergen sensors in the SILAM integration config).
  //
  // Identifies weather entities by eid starting with "weather." OR by
  // translation_key === "forecast" (both are reliable in current HA versions).
  const deviceWeatherMap = new Map(); // deviceId -> weatherEntityId
  const deviceInfoMap = new Map();    // deviceId -> { configEntryId, label }
  for (const [eid, entry] of Object.entries(hass.entities)) {
    if (entry.platform !== "silam_pollen") continue;
    if (eid.startsWith("weather.") || entry.translation_key === "forecast") {
      const deviceId = entry.device_id;
      if (deviceId) {
        deviceWeatherMap.set(deviceId, eid);
        if (!deviceInfoMap.has(deviceId)) {
          const device = hass.devices?.[deviceId];
          const configEntryId = device?.config_entries?.[0] ?? "default";
          const label =
            device?.name_by_user ||
            (device?.name ? stripSilamPrefix(device.name) : null) ||
            "Auto";
          deviceInfoMap.set(deviceId, { configEntryId, label });
        }
      }
    }
  }

  if (rawLocations.size === 0 && deviceWeatherMap.size === 0) return result;

  // Convert discoverEntitiesByDevice result to SILAM's expected format:
  //   { label, weatherEntity, sensors: Map<allergenKey, entityId> }
  for (const [locKey, loc] of rawLocations) {
    const weatherEntity = loc.deviceId
      ? (deviceWeatherMap.get(loc.deviceId) || null)
      : null;
    result.locations.set(locKey, {
      label: loc.label,
      weatherEntity,
      sensors: loc.entities,
    });
  }

  // Add locations for devices that only have a weather entity (no allergen sensors).
  // This ensures the card can still show the allergy_risk index for such setups.
  for (const [deviceId, weatherEntityId] of deviceWeatherMap) {
    const info = deviceInfoMap.get(deviceId);
    if (!info) continue;
    const { configEntryId, label } = info;
    // Skip if already present from rawLocations
    if (result.locations.has(configEntryId)) continue;
    result.locations.set(configEntryId, {
      label,
      weatherEntity: weatherEntityId,
      sensors: new Map(),
    });
  }

  if (debug) {
    console.debug(
      "[SILAM] Discovery result:",
      result.locations.size,
      "locations",
    );
    for (const [locId, loc] of result.locations) {
      console.debug(
        `  [${locId}] "${loc.label}": weather=${loc.weatherEntity}, sensors:`,
        [...loc.sensors.keys()],
      );
    }
  }

  return result;
}

/**
 * Resolve a discovered location from pre-computed discovery data.
 *
 * - Empty configLocation → autodetect (first location).
 * - config_entry_id matching a discovered entry → that entry.
 * - Stale config_entry_id (looks like a ULID but missing from discovery,
 *   typically after the integration has been removed/reinstalled) →
 *   autodetect (first location), so the card recovers instead of going
 *   blank. Mirrors the DWD/GPL/GP recovery path.
 * - Slug-style configLocation matching a label substring → that location.
 * - Otherwise → null.
 */
export function resolveDiscoveredLocation(discovery, configLocation, debug = false) {
  if (!discovery?.locations?.size) return null;

  if (isConfigEntryId(configLocation)) {
    if (discovery.locations.has(configLocation)) {
      return discovery.locations.get(configLocation);
    }
    if (debug) {
      console.debug(
        "[SILAM] Stale config_entry_id, falling back to first location:",
        configLocation,
      );
    }
    return discovery.locations.values().next().value ?? null;
  }
  if (configLocation) {
    const locLower = configLocation.toLowerCase();
    for (const [, loc] of discovery.locations) {
      if (loc.label.toLowerCase().includes(locLower)) {
        return loc;
      }
    }
    if (debug)
      console.debug(
        "[SILAM] Discovery: explicit location not matched:",
        configLocation,
      );
    return null;
  }
  return discovery.locations.values().next().value ?? null;
}

/**
 * Hitta rätt weather entity för en SILAM-plats.
 *
 * Primärt: discovery-baserad lookup via hass.entities (hanterar omdöpta entiteter).
 * Fallback: regex-match mot weather.silam_pollen_{location}_{suffix} i hass.states.
 *
 * @param {object} hass
 * @param {string} location - config_entry_id, slug, or empty
 * @param {string} locale
 * @param {boolean} debug
 * @param {object} [precomputedDiscovery] - pass to avoid redundant discoverSilamSensors call
 */
export function findSilamWeatherEntity(hass, location, locale, debug = false, precomputedDiscovery = null) {
  if (!hass) return null;

  // Primärt: discovery-baserad lookup (config_entry_id eller slug-match)
  const discovery = precomputedDiscovery || discoverSilamSensors(hass, debug);
  const resolved = resolveDiscoveredLocation(discovery, location, debug);
  if (resolved?.weatherEntity) return resolved.weatherEntity;

  // Fallback: regex-baserad lookup (äldre HA utan hass.entities)
  if (!location || isConfigEntryId(location)) return null;
  const loc = location.toLowerCase();
  let tried = new Set();

  // 1. Testa suffixar för aktuell locale
  const suffixesLocale =
    silamAllergenMap.weather_suffixes?.[locale] ||
    silamAllergenMap.weather_suffixes?.[locale?.split("-")[0]] ||
    [];
  for (const suffix of suffixesLocale) {
    tried.add(suffix);
    const entityId = `weather.silam_pollen_${loc}_${suffix}`;
    if (entityId in hass.states) return entityId;
  }

  // 2. Testa engelska suffixar
  for (const suffix of silamAllergenMap.weather_suffixes?.en || []) {
    if (tried.has(suffix)) continue;
    tried.add(suffix);
    const entityId = `weather.silam_pollen_${loc}_${suffix}`;
    if (entityId in hass.states) return entityId;
  }

  // 3. Testa alla kända suffixar (alla språk)
  const allSuffixes = Array.from(
    new Set(Object.values(silamAllergenMap.weather_suffixes).flat()),
  );
  for (const suffix of allSuffixes) {
    if (tried.has(suffix)) continue;
    const entityId = `weather.silam_pollen_${loc}_${suffix}`;
    if (entityId in hass.states) return entityId;
  }

  // 4. Fallback: första entity med rätt prefix
  const prefix = `weather.silam_pollen_${loc}_`;
  return Object.keys(hass.states).find((id) => id.startsWith(prefix)) || null;
}
