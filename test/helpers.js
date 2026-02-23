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
