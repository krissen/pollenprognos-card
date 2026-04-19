// src/utils/adapter-helpers.js
// Shared pure helpers used by multiple adapters.
import { t, detectLang } from "../i18n.js";
import { toCanonicalAllergenKey } from "../constants.js";
import { normalize, normalizeDWD } from "./normalize.js";
import { isConfigEntryId } from "./silam.js";

/**
 * Clamp a sensor value to a valid level range.
 *
 * @param {*}      v         - Raw sensor value (will be coerced via Number()).
 * @param {number|null} maxLevel - Upper clamp bound, or null for no upper clamp.
 * @param {*}      nanResult - Value returned for NaN / negative input.
 * @returns {number|null}
 */
export function clampLevel(v, maxLevel = 6, nanResult = -1) {
  if (v === null || v === undefined) return nanResult;
  const n = Number(v);
  if (isNaN(n) || n < 0) return nanResult;
  return maxLevel != null ? Math.min(n, maxLevel) : n;
}

/**
 * Sort a sensors array in-place using one of the standard sort keys.
 * Adapter-specific post-sorts (tiered, pin-to-top) are applied by the caller.
 *
 * @param {object[]} sensors  - Array of sensor dicts (mutated in-place).
 * @param {string}   sortKey  - One of "value_ascending", "value_descending",
 *                              "name_ascending", "name_descending", or "none".
 */
export function sortSensors(sensors, sortKey) {
  if (sortKey === "none") return;
  const sortFn = {
    value_ascending: (a, b) => (a.day0?.state ?? 0) - (b.day0?.state ?? 0),
    value_descending: (a, b) => (b.day0?.state ?? 0) - (a.day0?.state ?? 0),
    name_ascending: (a, b) =>
      a.allergenCapitalized.localeCompare(b.allergenCapitalized),
    name_descending: (a, b) =>
      b.allergenCapitalized.localeCompare(a.allergenCapitalized),
  }[sortKey] || ((a, b) => (b.day0?.state ?? 0) - (a.day0?.state ?? 0));
  sensors.sort(sortFn);
}

/**
 * Check whether any day in the array meets or exceeds the pollen threshold.
 * Returns true when threshold is 0 (show-all mode) or when at least one
 * day's state >= threshold.
 *
 * @param {object[]} days       - Array of day objects with a .state property.
 * @param {number}   threshold  - Minimum state value to qualify.
 * @returns {boolean}
 */
export function meetsThreshold(days, threshold) {
  return threshold === 0 || days.some((d) => d.state >= threshold);
}

/**
 * Resolve full and short allergen display names.
 *
 * @param {string} allergenKey - Normalized/slugified allergen key for toCanonicalAllergenKey().
 * @param {object} opts
 * @param {object}  opts.fullPhrases   - User phrase overrides (full names).
 * @param {object}  opts.shortPhrases  - User phrase overrides (short names).
 * @param {boolean} opts.abbreviated   - Whether to use abbreviated (short) names.
 * @param {string}  opts.lang          - Language code for i18n.
 * @param {Function} [opts.capitalize] - Custom capitalize function (default: first char upper).
 * @param {string}  [opts.configKey]   - Original config key for phrases lookup when it
 *                                       differs from allergenKey (e.g. PP/DWD raw names).
 * @returns {{ allergenCapitalized: string, allergenShort: string }}
 */
export function resolveAllergenNames(allergenKey, { fullPhrases, shortPhrases, abbreviated, lang, capitalize: capFn, configKey }) {
  const cap = capFn || ((s) => s.charAt(0).toUpperCase() + s.slice(1));
  const ck = configKey ?? allergenKey;
  const canonKey = toCanonicalAllergenKey(allergenKey);

  let allergenCapitalized;
  if (fullPhrases[ck]) {
    allergenCapitalized = fullPhrases[ck];
  } else {
    const nameKey = `card.allergen.${canonKey}`;
    const i18nName = t(nameKey, lang);
    allergenCapitalized = i18nName !== nameKey ? i18nName : cap(ck);
  }

  let allergenShort;
  if (abbreviated) {
    const shortKey = `editor.phrases_short.${canonKey}`;
    const i18nShort = t(shortKey, lang);
    allergenShort = shortPhrases[ck]
      || (i18nShort !== shortKey ? i18nShort : null)
      || allergenCapitalized;
  } else {
    allergenShort = allergenCapitalized;
  }

  return { allergenCapitalized, allergenShort };
}

/**
 * Merge user phrase overrides with defaults.
 *
 * Returns the five destructured fields adapters need. Custom level
 * mapping (e.g. PEU's 5-to-7, PLU's 4-level) stays in the adapter
 * and uses the returned userLevels array.
 *
 * @param {object} config - Card configuration (reads config.phrases).
 * @param {string} lang   - Language code for the noInfoLabel fallback.
 * @returns {{ fullPhrases: object, shortPhrases: object, userLevels: Array, userDays: object, noInfoLabel: string }}
 */
export function mergePhrases(config, lang) {
  const phrases = {
    full: {}, short: {}, levels: [], days: {}, no_information: "",
    ...(config.phrases || {}),
  };
  return {
    fullPhrases: phrases.full,
    shortPhrases: phrases.short,
    userLevels: phrases.levels,
    userDays: phrases.days,
    noInfoLabel: phrases.no_information || t("card.no_information", lang),
  };
}

/**
 * Derive language, locale, and day-display flags from hass and config.
 *
 * @param {object} hass   - Home Assistant state object.
 * @param {object} config - Card configuration.
 * @param {string|null} [defaultLocale=null]
 *   When null/omitted (default), locale cascades through hass fields.
 *   When a string is passed, it is used as the fallback locale.
 * @returns {{ lang: string, locale: string|undefined, daysRelative: boolean, dayAbbrev: boolean, daysUppercase: boolean }}
 */
export function getLangAndLocale(hass, config, defaultLocale = null) {
  const lang = detectLang(hass, config.date_locale);
  const locale = defaultLocale != null
    ? (config.date_locale || defaultLocale)
    : (config.date_locale || hass.locale?.language || hass.language || `${lang}-${lang.toUpperCase()}`);
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);
  return { lang, locale, daysRelative, dayAbbrev, daysUppercase };
}

/**
 * Normalize a manual-mode entity prefix.
 * Strips leading "sensor." and ensures a trailing "_" (unless empty).
 *
 * @param {string} raw - The raw entity_prefix from config.
 * @returns {string}
 */
export function normalizeManualPrefix(raw) {
  let p = raw || "";
  if (p.startsWith("sensor.")) p = p.substring(7);
  if (p && !p.endsWith("_")) p = p + "_";
  return p;
}

/**
 * Resolve a manual-mode entity ID from prefix + slug + suffix.
 * Falls back to unique-candidate matching when suffix is empty
 * and the exact ID is not found.
 *
 * @param {object} hass   - Home Assistant state object.
 * @param {string} prefix - Already normalized prefix (via normalizeManualPrefix).
 * @param {string} slug   - Allergen slug.
 * @param {string} suffix - Entity suffix from config.
 * @returns {string|null} - Matched entity ID or null.
 */
export function resolveManualEntity(hass, prefix, slug, suffix) {
  const sensorId = `sensor.${prefix}${slug}${suffix}`;
  if (hass.states[sensorId]) return sensorId;
  if (suffix === "") {
    const base = `sensor.${prefix}${slug}`;
    const candidates = Object.keys(hass.states).filter((id) =>
      id.startsWith(base),
    );
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

/**
 * Build a day column label from a date and its offset from today.
 *
 * @param {Date}   date  - The date to label.
 * @param {number} diff  - Day offset (0 = today, 1 = tomorrow, …).
 * @param {object} opts
 * @param {boolean} opts.daysRelative  - Show relative labels (today/tomorrow)?
 * @param {boolean} opts.dayAbbrev     - Abbreviate weekday names?
 * @param {boolean} opts.daysUppercase - Uppercase the final label?
 * @param {object}  opts.userDays      - User-defined day label overrides (keyed by diff).
 * @param {string}  opts.lang          - Language code for i18n.
 * @param {string}  opts.locale        - Locale tag for date formatting.
 * @returns {string}
 */
export function buildDayLabel(date, diff, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale }) {
  let label;
  if (!daysRelative) {
    label = date.toLocaleDateString(locale, {
      weekday: dayAbbrev ? "short" : "long",
    });
    label = label.charAt(0).toUpperCase() + label.slice(1);
  } else if (userDays[diff] != null) {
    label = userDays[diff];
  } else if (diff >= 0 && diff <= 2) {
    label = t(`card.days.${diff}`, lang);
  } else {
    label = date.toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
    });
  }
  if (daysUppercase) label = label.toUpperCase();
  return label;
}

/**
 * Filter adapter sensors after fetchForecast returns.
 *
 * Three branches:
 * 1. SILAM daily: entity_id-based filtering with reverse-map fallback.
 * 2. SILAM non-daily: no entity-level filtering (pass through).
 * 3. Other integrations: name-based filtering (DWD uses normalizeDWD).
 *
 * @param {object[]} sensors          - Sensor dicts from fetchForecast.
 * @param {object}   cfg              - Card config with integration, mode, location, allergens.
 * @param {string[]} availableSensors - Entity IDs from findAvailableSensors.
 * @param {string[]} hassStateKeys    - Object.keys(hass.states).
 * @param {object}   silamMapping     - silamAllergenMap.mapping object.
 * @returns {object[]}
 */
export function filterSensorsPostFetch(sensors, cfg, availableSensors, hassStateKeys, silamMapping) {
  // Precompute SILAM reverse mapping (master allergen -> HA slug) once,
  // rather than rebuilding it per sensor inside the filter callback.
  let silamReverse = null;
  let silamLoc = null;
  if (cfg.integration === "silam" && (!cfg.mode || cfg.mode === "daily")) {
    const configLocation = (cfg.location || "").toLowerCase();
    if (!isConfigEntryId(configLocation)) {
      silamLoc = configLocation;
      silamReverse = {};
      for (const id of hassStateKeys) {
        const m = id.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
        if (!m || m[1] !== silamLoc) continue;
        const haSlug = m[2];
        for (const [, mapping] of Object.entries(silamMapping)) {
          if (mapping[haSlug]) {
            silamReverse[mapping[haSlug]] = haSlug;
            break;
          }
        }
      }
    }
  }

  const availableSet = new Set(availableSensors);

  let filtered = sensors.filter((s) => {
    if (cfg.integration === "silam" && (!cfg.mode || cfg.mode === "daily")) {
      // allergy_risk is derived from the weather entity state, not an
      // individual sensor entity, so it has no entity_id to match.
      if (s.allergenReplaced === "allergy_risk") return true;
      if (s.entity_id) {
        return availableSet.has(s.entity_id);
      }
      if (silamReverse !== null) {
        const key = silamReverse[s.allergenReplaced] || s.allergenReplaced;
        const id = `sensor.silam_pollen_${silamLoc}_${key}`;
        return availableSet.has(id);
      }
      return false;
    }
    return true;
  });

  if (Array.isArray(cfg.allergens) && cfg.allergens.length > 0 && cfg.integration !== "silam") {
    let allowed;
    let getKey;
    if (cfg.integration === "dwd") {
      allowed = new Set(cfg.allergens.map((a) => normalizeDWD(a)));
      getKey = (s) => normalizeDWD(s.allergenReplaced || "");
    } else {
      allowed = new Set(cfg.allergens.map((a) => normalize(a)));
      getKey = (s) => normalize(s.allergenReplaced || "");
    }
    filtered = filtered.filter((s) => allowed.has(getKey(s)));
  }

  return filtered;
}

/**
 * Discover HA entities grouped by device/location using a three-tier strategy.
 *
 * Tier 1 (device-based): Scan hass.devices for devices whose identifiers match
 *   the given platform. Then collect entities from hass.entities whose device_id
 *   belongs to one of those devices.
 * Tier 2 (entity-registry): Scan hass.entities filtered by entry.platform.
 *   Used when hass.devices is unavailable or tier 1 yields no results.
 * Tier 3 (fallback): Scan hass.states using fallbackSelector or fallbackRegex.
 *   Used when both tier 1 and tier 2 yield no results.
 *
 * @param {object} hass - Home Assistant state object.
 * @param {object} opts
 * @param {string|string[]} opts.platform
 *   Platform name(s). Matched against entry.platform (tier 2) and against the
 *   first element of each device.identifiers tuple (tier 1).
 * @param {Function} opts.classify
 *   (entityId, ctx) => string|null. Strict classifier used in tiers 2 and 3.
 *   ctx = { state, entry?, device? }.
 * @param {Function} [opts.classifyRelaxed]
 *   (entityId, ctx) => string|null. Used only in tier 1. Defaults to opts.classify.
 * @param {Function} [opts.isRelevant]
 *   (entityId, ctx) => boolean. Pre-classification filter. Default: always true.
 * @param {Function} [opts.excludeEntry]
 *   (entry) => boolean. True means skip. Default: skip entries with entity_category.
 * @param {Function} [opts.resolveLabel]
 *   (ctx) => string. ctx includes { state, entry, device, entityId, tier, locationKey }.
 *   Default: device.name_by_user || device.name || state.attributes.friendly_name || "Auto".
 * @param {Function} [opts.resolveLocationKey]
 *   (ctx) => string. Default: device.config_entries[0] || "default".
 * @param {Function} [opts.onCollision]
 *   (ctx, { existingKey, existingEntityId, locEntities }) => string|null.
 *   Called when classify returns a key already present in the current location.
 *   Return a new key or null to skip the entity.
 * @param {RegExp|null} [opts.fallbackRegex]
 *   Regex to filter hass.states keys in tier 3. Null disables tier 3 regex path.
 * @param {Function} [opts.fallbackSelector]
 *   (hass) => string[]. Alternative to fallbackRegex; overrides it when provided.
 * @param {boolean} [opts.debug]
 * @param {string}  [opts.logTag]
 * @returns {{ locations: Map<string, { label: string, entities: Map<string, string>, deviceId?: string }>, tierUsed: 0|1|2|3 }}
 */
export function discoverEntitiesByDevice(hass, opts = {}) {
  const {
    platform,
    classify,
    classifyRelaxed,
    isRelevant,
    excludeEntry,
    resolveLabel,
    resolveLocationKey,
    onCollision,
    fallbackRegex,
    fallbackSelector,
    debug = false,
  } = opts;

  const platforms = Array.isArray(platform) ? platform : (platform ? [platform] : []);
  const logTag = opts.logTag || (platforms.length > 0 ? platforms[0] : "discovery");
  const classifyStrict = classify || (() => null);
  const classifyTier1 = classifyRelaxed || classifyStrict;

  const defaultExcludeEntry = (entry) => !!(entry !== null && entry !== undefined && entry.entity_category);
  const shouldExclude = excludeEntry || defaultExcludeEntry;

  const defaultIsRelevant = () => true;
  const checkRelevant = isRelevant || defaultIsRelevant;

  const defaultResolveLabel = (ctx) => {
    const { device, state } = ctx;
    if (device !== null && device !== undefined && device.name_by_user) return device.name_by_user;
    if (device !== null && device !== undefined && device.name) return device.name;
    if (state !== null && state !== undefined && state.attributes !== null && state.attributes !== undefined) {
      if (state.attributes.friendly_name) return state.attributes.friendly_name;
    }
    return "Auto";
  };
  const getLabel = resolveLabel || defaultResolveLabel;

  const defaultResolveLocationKey = (ctx) => {
    const { device } = ctx;
    if (device !== null && device !== undefined) {
      const entries = device.config_entries;
      if (Array.isArray(entries) && entries.length > 0) return entries[0];
    }
    return "default";
  };
  const getLocationKey = resolveLocationKey || defaultResolveLocationKey;

  const locations = new Map();

  /**
   * Add a single classified entity to locations.
   * @param {string}      eid
   * @param {string|null} allergenKey
   * @param {object}      ctx          - { state, entry, device, entityId, tier }
   */
  const addEntity = (eid, allergenKey, ctx) => {
    if (allergenKey === null || allergenKey === undefined) return;

    const locationKey = getLocationKey({ ...ctx, locationKey: undefined });
    const enrichedCtx = { ...ctx, locationKey };

    if (!locations.has(locationKey)) {
      const label = getLabel(enrichedCtx);
      locations.set(locationKey, { label, entities: new Map() });
    }

    // Set/backfill deviceId whenever ctx provides one and the location is
    // still missing it. Backfill handles the case where the first entity in a
    // bucket had no deviceId but a later entity does. Downstream consumers
    // (e.g. SILAM weather-entity postprocess) rely on this field.
    const location = locations.get(locationKey);
    if (
      (location.deviceId === null || location.deviceId === undefined) &&
      ctx.deviceId !== null &&
      ctx.deviceId !== undefined
    ) {
      location.deviceId = ctx.deviceId;
    }

    const locEntities = location.entities;
    if (locEntities.has(allergenKey)) {
      if (onCollision) {
        const newKey = onCollision(enrichedCtx, {
          existingKey: allergenKey,
          existingEntityId: locEntities.get(allergenKey),
          locEntities,
        });
        if (newKey !== null && newKey !== undefined) {
          locEntities.set(newKey, eid);
        }
      }
      // If no onCollision or it returned null, skip silently
    } else {
      locEntities.set(allergenKey, eid);
    }
  };

  // --- Tier 1: Device-based discovery ---
  if (hass !== null && hass !== undefined && hass.devices !== null && hass.devices !== undefined && hass.entities !== null && hass.entities !== undefined) {
    // Find devices whose identifiers contain a matching platform as first element
    const matchingDeviceIds = new Set();
    for (const [devId, dev] of Object.entries(hass.devices)) {
      if (dev === null || dev === undefined) continue;
      const identifiers = dev.identifiers;
      if (!Array.isArray(identifiers)) continue;
      for (const tuple of identifiers) {
        if (Array.isArray(tuple) && platforms.includes(tuple[0])) {
          matchingDeviceIds.add(devId);
          break;
        }
      }
    }

    if (matchingDeviceIds.size > 0) {
      if (debug) console.debug(`[${logTag}] Discovery tier 1 (device-based): found`, matchingDeviceIds.size, "devices");

      for (const [eid, entry] of Object.entries(hass.entities)) {
        if (entry === null || entry === undefined) continue;
        if (!matchingDeviceIds.has(entry.device_id)) continue;
        if (shouldExclude(entry)) continue;

        const state = hass.states !== null && hass.states !== undefined ? hass.states[eid] : undefined;
        if (state === null || state === undefined) continue;

        const deviceId = entry.device_id;
        const device = hass.devices[deviceId];
        const ctx = { state, entry, device, deviceId, entityId: eid, tier: 1 };

        if (!checkRelevant(eid, ctx)) continue;

        const allergenKey = classifyTier1(eid, ctx);
        addEntity(eid, allergenKey, ctx);
      }

      if (locations.size > 0) {
        if (debug) {
          console.debug(`[${logTag}] Discovery tier 1 result:`, locations.size, "locations");
          for (const [locId, loc] of locations) {
            console.debug(`  [${locId}] "${loc.label}":`, [...loc.entities.keys()]);
          }
        }
        return { locations, tierUsed: 1 };
      }
    }
  }

  // --- Tier 2: Entity-registry scan ---
  if (hass !== null && hass !== undefined && hass.entities !== null && hass.entities !== undefined) {
    for (const [eid, entry] of Object.entries(hass.entities)) {
      if (entry === null || entry === undefined) continue;
      if (!platforms.includes(entry.platform)) continue;
      if (shouldExclude(entry)) continue;

      const state = hass.states !== null && hass.states !== undefined ? hass.states[eid] : undefined;
      if (state === null || state === undefined) continue;

      const deviceId = entry.device_id;
      const device = (deviceId !== null && deviceId !== undefined && hass.devices !== null && hass.devices !== undefined)
        ? hass.devices[deviceId]
        : undefined;
      const ctx = { state, entry, device, deviceId, entityId: eid, tier: 2 };

      if (!checkRelevant(eid, ctx)) continue;

      const allergenKey = classifyStrict(eid, ctx);
      addEntity(eid, allergenKey, ctx);
    }

    if (locations.size > 0) {
      if (debug) {
        console.debug(`[${logTag}] Discovery tier 2 result:`, locations.size, "locations");
        for (const [locId, loc] of locations) {
          console.debug(`  [${locId}] "${loc.label}":`, [...loc.entities.keys()]);
        }
      }
      return { locations, tierUsed: 2 };
    }
  }

  // --- Tier 3: Fallback (selector or regex) ---
  if (hass !== null && hass !== undefined && hass.states !== null && hass.states !== undefined) {
    let candidates = null;

    if (typeof fallbackSelector === "function") {
      candidates = fallbackSelector(hass);
    } else if (fallbackRegex instanceof RegExp) {
      candidates = Object.keys(hass.states).filter((eid) => fallbackRegex.test(eid));
    }

    if (candidates !== null && candidates.length > 0) {
      if (debug) console.debug(`[${logTag}] Discovery tier 3 (fallback): found`, candidates.length, "candidates");

      for (const eid of candidates) {
        const state = hass.states[eid];
        if (state === null || state === undefined) continue;

        const ctx = { state, entry: undefined, device: undefined, deviceId: undefined, entityId: eid, tier: 3 };

        if (!checkRelevant(eid, ctx)) continue;

        const allergenKey = classifyStrict(eid, ctx);
        addEntity(eid, allergenKey, ctx);
      }
    }
  }

  if (debug) {
    console.debug(`[${logTag}] Discovery final result:`, locations.size, "locations");
    for (const [locId, loc] of locations) {
      console.debug(`  [${locId}] "${loc.label}":`, [...loc.entities.keys()]);
    }
  }

  return { locations, tierUsed: locations.size > 0 ? 3 : 0 };
}

/**
 * Find a location in a discovery result by matching entity IDs against a slug.
 *
 * Checks each entity ID using an optional slugExtractor, and also checks
 * suffix variants like `_{slug}` and `_{slug}_j_1` (suffix extras).
 *
 * @param {{ locations: Map }} discovery       - Result from discoverEntitiesByDevice.
 * @param {string}             slug            - Location slug to match against.
 * @param {object}             [opts]
 * @param {Function}           [opts.slugExtractor] - (entityId) => string|null. Custom slug extractor.
 * @param {string[]}           [opts.suffixExtras]  - Additional suffixes to test. Default: ["", "_j_1"].
 * @returns {[string, object]|null} - [locationKey, location] or null.
 */
export function findLocationBySlug(discovery, slug, opts = {}) {
  if (slug === null || slug === undefined || !slug) return null;
  if (discovery === null || discovery === undefined || !discovery.locations) return null;

  const { slugExtractor, suffixExtras = ["", "_j_1"] } = opts;
  const needle = String(slug).toLowerCase();
  const suffixVariants = suffixExtras.map((s) => `_${needle}${s}`);

  for (const [key, loc] of discovery.locations) {
    for (const eid of loc.entities.values()) {
      const lid = String(eid).toLowerCase();

      // Custom extractor path
      if (typeof slugExtractor === "function") {
        const extracted = slugExtractor(eid);
        if (extracted !== null && extracted !== undefined && String(extracted).toLowerCase() === needle) {
          return [key, loc];
        }
      }

      // Suffix variant path
      for (const variant of suffixVariants) {
        if (lid.endsWith(variant)) return [key, loc];
      }
    }
  }

  return null;
}

/**
 * Resolve a location from a discovery result using a priority chain.
 *
 * Priority:
 *   1. Empty cfgLocation -> first location in the map (or null if empty).
 *   2. Exact key match.
 *   3. Substring or exact match against location label.
 *   4. findLocationBySlug fallback.
 *   5. null if nothing matches.
 *
 * @param {{ locations: Map }} discovery    - Result from discoverEntitiesByDevice.
 * @param {string}             cfgLocation - Location value from card config.
 * @param {object}             [opts]
 * @param {Function}           [opts.slugExtractor] - Passed to findLocationBySlug.
 * @returns {[string, object]|null} - [locationKey, location] or null.
 */
export function resolveLocationByKey(discovery, cfgLocation, opts = {}) {
  if (discovery === null || discovery === undefined || !discovery.locations) return null;
  const locs = discovery.locations;

  // 1. Empty location -> pick first deterministically. Enumeration order of
  // hass.devices / hass.entities is insertion-order and stable within a
  // session, but can differ across HA restarts or integration reinstalls.
  // Sort by locationKey so auto-select is reproducible.
  if (!cfgLocation) {
    if (locs.size === 0) return null;
    const sortedKeys = Array.from(locs.keys()).sort();
    const key = sortedKeys[0];
    return [key, locs.get(key)];
  }

  // 2. Exact key match
  if (locs.has(cfgLocation)) {
    return [cfgLocation, locs.get(cfgLocation)];
  }

  // 3. Label substring / exact match
  for (const [key, loc] of locs) {
    if (loc.label && (loc.label === cfgLocation || loc.label.includes(cfgLocation))) {
      return [key, loc];
    }
  }

  // 4. Slug fallback
  const slugMatch = findLocationBySlug(discovery, cfgLocation, opts);
  if (slugMatch !== null) return slugMatch;

  // 5. No match
  return null;
}
