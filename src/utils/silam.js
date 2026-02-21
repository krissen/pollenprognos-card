import silamAllergenMap from "../adapters/silam_allergen_map.json" assert { type: "json" };

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

/** Test if a config.location value is a config_entry_id (ULID format). */
export function isConfigEntryId(value) {
  return typeof value === "string" && /^[0-9A-Z]{26}$/i.test(value);
}

/**
 * Discover all SILAM sensors using hass.entities (entity registry).
 *
 * Returns: { locations: Map<configEntryId, { label, weatherEntity, sensors: Map<allergenKey, entityId> }> }
 *
 * Primary path: hass.entities → filter platform === "silam_pollen", no entity_category
 * Groups entities by device → config_entry_id, identifies weather entities via
 * translation_key === "forecast" and allergen sensors via translation_key.
 *
 * Returns empty map if hass.entities is unavailable (older HA) — callers
 * should fall back to regex-based detection.
 */
export function discoverSilamSensors(hass, debug = false) {
  const result = { locations: new Map() };
  if (!hass?.entities) return result;

  // Collect candidate entity IDs from entity registry
  const candidates = Object.entries(hass.entities).filter(
    ([, entry]) => entry.platform === "silam_pollen" && !entry.entity_category,
  );

  if (!candidates.length) return result;
  if (debug)
    console.debug(
      "[SILAM] Discovery: using hass.entities, found",
      candidates.length,
      "candidates",
    );

  // Group by config_entry_id (via device)
  for (const [eid, entry] of candidates) {
    // Resolve config_entry_id via device
    let configEntryId = "default";
    const deviceId = entry.device_id;
    if (deviceId && hass.devices?.[deviceId]?.config_entries?.length) {
      configEntryId = hass.devices[deviceId].config_entries[0];
    }

    // Get or create location entry
    if (!result.locations.has(configEntryId)) {
      let label = "Auto";
      if (deviceId && hass.devices?.[deviceId]) {
        const device = hass.devices[deviceId];
        label = device.name_by_user || device.name || label;
      }
      result.locations.set(configEntryId, {
        label,
        weatherEntity: null,
        sensors: new Map(),
      });
    }

    const loc = result.locations.get(configEntryId);
    const translationKey = entry.translation_key;

    if (eid.startsWith("weather.") || translationKey === "forecast") {
      // Weather entity
      loc.weatherEntity = eid;
    } else if (translationKey) {
      // Allergen sensor — translation_key is the canonical allergen name
      // Map through silamAllergenMap to get master key
      let masterKey = translationKey;
      for (const mapping of Object.values(silamAllergenMap.mapping)) {
        if (mapping[translationKey]) {
          masterKey = mapping[translationKey];
          break;
        }
      }
      loc.sensors.set(masterKey, eid);
    }
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
 * Hitta rätt weather entity för en SILAM-plats.
 *
 * Primärt: discovery-baserad lookup via hass.entities (hanterar omdöpta entiteter).
 * Fallback: regex-match mot weather.silam_pollen_{location}_{suffix} i hass.states.
 */
export function findSilamWeatherEntity(hass, location, locale, debug = false) {
  if (!hass) return null;

  // Primärt: discovery-baserad lookup (config_entry_id eller slug-match)
  const discovery = discoverSilamSensors(hass, debug);
  if (discovery.locations.size > 0) {
    // Om location är config_entry_id → direkt lookup
    if (isConfigEntryId(location)) {
      const loc = discovery.locations.get(location);
      if (loc?.weatherEntity) return loc.weatherEntity;
    }
    // Om location är slug → sök alla locations
    if (location) {
      const locLower = location.toLowerCase();
      for (const [, loc] of discovery.locations) {
        if (
          loc.weatherEntity &&
          loc.label.toLowerCase().includes(locLower)
        ) {
          return loc.weatherEntity;
        }
      }
    }
    // Om location saknas → första tillgängliga
    if (!location) {
      const first = discovery.locations.values().next().value;
      if (first?.weatherEntity) return first.weatherEntity;
    }
  }

  // Fallback: regex-baserad lookup (äldre HA utan hass.entities)
  if (!location) return null;
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
