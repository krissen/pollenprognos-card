/**
 * Shared test helpers for mocking Home Assistant state objects.
 */

/**
 * Create a minimal hass mock with the given entity states.
 * @param {Object} states - Map of entity_id to state object
 * @param {Object} [opts] - Additional hass properties
 * @returns {Object} hass mock
 */
export function createHass(states = {}, opts = {}) {
  return {
    states,
    locale: { language: opts.language || "en" },
    language: opts.language || "en",
    entities: opts.entities || {},
    ...opts,
  };
}

/**
 * Create a sensor state object with forecast data (PP style).
 * @param {number[]} levels - Array of level values per day
 * @param {Object} [opts] - Override attributes
 * @returns {Object} sensor state
 */
export function createPPSensor(levels, opts = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const forecast = levels.map((level, i) => {
    const d = new Date(today.getTime() + i * 86400000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return { time: `${yyyy}-${mm}-${dd}T00:00:00`, level };
  });
  return {
    state: String(levels[0] ?? 0),
    attributes: { forecast, ...opts },
  };
}

/**
 * Create a sensor state object for DWD.
 * @param {number} todayVal - Today's level (0-3 scale)
 * @param {number} tomorrowVal - Tomorrow's level
 * @param {number} twoDaysVal - Day after tomorrow's level
 * @param {Object} [opts] - Override attributes
 * @returns {Object} sensor state
 */
export function createDWDSensor(todayVal, tomorrowVal, twoDaysVal, opts = {}) {
  return {
    state: String(todayVal),
    attributes: {
      state_tomorrow: String(tomorrowVal),
      state_in_2_days: String(twoDaysVal),
      state_today_desc: "",
      state_tomorrow_desc: "",
      state_in_2_days_desc: "",
      ...opts,
    },
  };
}

/**
 * Create a sensor state object for PLU.
 * @param {number} value - Raw grain count value
 * @param {Object} [attrOverrides] - Override attributes
 * @returns {Object} sensor state
 */
export function createPLUSensor(value, attrOverrides = {}) {
  return {
    state: String(value),
    attributes: {
      unit_of_measurement: "grains/m\u00B3",
      ...attrOverrides,
    },
  };
}

/**
 * Create a sensor state object for PEU.
 * @param {number} level - Level value (0-4 scale for daily)
 * @param {number[]} forecastLevels - Additional forecast day levels
 * @param {Object} [opts] - Override attributes
 * @returns {Object} sensor state
 */
export function createPEUSensor(level, forecastLevels = [], opts = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const forecast = [level, ...forecastLevels].map((lv, i) => {
    const d = new Date(today.getTime() + i * 86400000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return { datetime: `${yyyy}-${mm}-${dd}T00:00:00`, native_value: lv };
  });
  return {
    state: String(level),
    attributes: {
      forecast,
      data_stale: false,
      ...opts,
    },
  };
}

/**
 * Create a minimal device registry entry.
 *
 * @param {object} opts
 * @param {string}   [opts.deviceId]    - Device ID. Auto-generated if omitted.
 * @param {Array[]}  opts.identifiers   - Array of [domain, unique_id] tuples.
 * @param {string[]} [opts.configEntries] - Config entry IDs. Default: ["cfg_default"].
 * @param {string}   [opts.name]        - Device name.
 * @param {string}   [opts.nameByUser]  - User-assigned device name.
 * @returns {object}
 */
export function makeDevice({ deviceId, identifiers, configEntries = ["cfg_default"], name, nameByUser } = {}) {
  return {
    device_id: deviceId || `device_${Math.random().toString(36).slice(2, 9)}`,
    identifiers: identifiers || [],
    config_entries: configEntries,
    name: name || null,
    name_by_user: nameByUser || null,
  };
}

/**
 * Create a minimal entity registry entry.
 *
 * @param {object} opts
 * @param {string} [opts.deviceId]        - Device ID the entity belongs to.
 * @param {string} [opts.platform]        - Integration platform name.
 * @param {string} [opts.translationKey]  - Translation key.
 * @param {string} [opts.uniqueId]        - Unique ID.
 * @param {string|null} [opts.entityCategory] - Entity category (e.g. "diagnostic"). Default: null.
 * @returns {object}
 */
export function makeEntityEntry({ deviceId, platform, translationKey, uniqueId, entityCategory = null } = {}) {
  return {
    device_id: deviceId || null,
    platform: platform || null,
    translation_key: translationKey || null,
    unique_id: uniqueId || null,
    entity_category: entityCategory,
  };
}

/**
 * Create a hass mock with wired states, entities, and devices registries.
 *
 * @param {Array} entries - Array of entity descriptors:
 *   { entityId, state, attributes, deviceId, platform, translationKey, uniqueId, entityCategory, deviceMeta }
 *   deviceMeta is passed to makeDevice() (keyed by deviceId, first occurrence wins).
 * @param {object} [opts]
 * @param {object} [opts.locale] - Default: { language: "en" }.
 * @returns {object} hass mock
 */
export function createHassWithRegistry(entries, { locale = { language: "en" } } = {}) {
  const states = {};
  const entities = {};
  const devices = {};
  const seenDevices = new Set();

  for (const entry of entries) {
    const {
      entityId,
      state: stateVal = "0",
      attributes = {},
      deviceId = null,
      platform = null,
      translationKey = null,
      uniqueId = null,
      entityCategory = null,
      deviceMeta = {},
    } = entry;

    // Build state
    states[entityId] = {
      state: String(stateVal),
      attributes: { friendly_name: entityId, ...attributes },
    };

    // Build entity registry entry
    entities[entityId] = makeEntityEntry({
      deviceId,
      platform,
      translationKey,
      uniqueId,
      entityCategory,
    });

    // Build device registry entry (first occurrence wins)
    if (deviceId && !seenDevices.has(deviceId)) {
      seenDevices.add(deviceId);
      const dev = makeDevice({ deviceId, ...deviceMeta });
      devices[deviceId] = {
        identifiers: dev.identifiers,
        config_entries: dev.config_entries,
        name: dev.name,
        name_by_user: dev.name_by_user,
      };
    }
  }

  return {
    states,
    entities,
    devices,
    locale,
    language: locale.language,
  };
}

/**
 * Assert the structural contract of a discoverEntitiesByDevice() result.
 *
 * @param {{ locations: Map, tierUsed: number }} discovery
 */
export function assertDiscoveryShape(discovery) {
  if (!discovery || typeof discovery !== "object") {
    throw new Error("discovery must be an object");
  }
  if (!(discovery.locations instanceof Map)) {
    throw new Error("discovery.locations must be a Map");
  }
  if (typeof discovery.tierUsed !== "number" || discovery.tierUsed < 0 || discovery.tierUsed > 3) {
    throw new Error(`discovery.tierUsed must be 0-3, got ${discovery.tierUsed}`);
  }
  for (const [key, loc] of discovery.locations) {
    if (typeof key !== "string") {
      throw new Error(`location key must be string, got ${typeof key}`);
    }
    if (typeof loc.label !== "string") {
      throw new Error(`location.label must be string, got ${typeof loc.label}`);
    }
    if (!(loc.entities instanceof Map)) {
      throw new Error("location.entities must be a Map");
    }
    for (const [allergenKey, entityId] of loc.entities) {
      if (typeof allergenKey !== "string") {
        throw new Error(`allergen key must be string, got ${typeof allergenKey}`);
      }
      if (typeof entityId !== "string") {
        throw new Error(`entity ID must be string, got ${typeof entityId}`);
      }
    }
  }
}

/**
 * Assert the contract shape of a sensor dict returned by any adapter's fetchForecast().
 * @param {Object} sensor - A single sensor dict from fetchForecast result
 * @param {Object} [opts] - Optional expectations
 */
export function assertSensorShape(sensor, opts = {}) {
  const { minDays = 1 } = opts;
  if (typeof sensor.allergenReplaced !== "string") {
    throw new Error(`allergenReplaced should be string, got ${typeof sensor.allergenReplaced}`);
  }
  if (typeof sensor.allergenCapitalized !== "string") {
    throw new Error(`allergenCapitalized should be string, got ${typeof sensor.allergenCapitalized}`);
  }
  if (typeof sensor.allergenShort !== "string") {
    throw new Error(`allergenShort should be string, got ${typeof sensor.allergenShort}`);
  }
  if (!Array.isArray(sensor.days)) {
    throw new Error(`days should be array, got ${typeof sensor.days}`);
  }
  if (sensor.days.length < minDays) {
    throw new Error(`days should have at least ${minDays} entries, got ${sensor.days.length}`);
  }
  if (sensor.day0 === undefined) {
    throw new Error("day0 should be defined");
  }
  if (typeof sensor.day0.state !== "number") {
    throw new Error(`day0.state should be number, got ${typeof sensor.day0.state}`);
  }
  if (typeof sensor.day0.day !== "string") {
    throw new Error(`day0.day (label) should be string, got ${typeof sensor.day0.day}`);
  }
}
