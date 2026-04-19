import { normalize } from "../utils/normalize.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, clampLevel, sortSensors, meetsThreshold, resolveAllergenNames, normalizeManualPrefix, resolveManualEntity, discoverEntitiesByDevice, resolveLocationByKey } from "../utils/adapter-helpers.js";

export const stubConfigPP = {
  integration: "pp",
  city: "",
  // Optional entity naming used when city is "manual"
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    "Al",
    "Alm",
    "Bok",
    "Björk",
    "Ek",
    "Malörtsambrosia",
    "Gråbo",
    "Gräs",
    "Hassel",
    "Sälg och viden",
  ],
  minimal: false,
  minimal_gap: 35,
  background_color: "",
  icon_size: "48",
  text_size_ratio: 1,
  ...LEVELS_DEFAULTS,
  show_text_allergen: true,
  show_value_text: true,
  show_value_numeric: false,
  show_value_numeric_in_circle: false,
  show_empty_days: false,
  debug: false,
  show_version: true,
  days_to_show: 4,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 1,
  sort: "value_descending",
  allergy_risk_top: true,
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

/**
 * Extract a prettified city name from a PP entity ID.
 * "sensor.pollen_goteborg_bjork" -> "Goteborg"
 * Returns null if the entity ID does not match the expected pattern.
 *
 * @param {string} entityId
 * @returns {string|null}
 */
function extractCityFromEntityId(entityId) {
  const m = entityId.match(/^sensor\.pollen_(.+)_[^_]+$/);
  if (!m) return null;
  const slug = m[1];
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Extract the city slug from a PP entity ID.
 * "sensor.pollen_goteborg_bjork" -> "goteborg"
 * Returns null if the entity ID does not match the expected pattern.
 *
 * @param {string} entityId
 * @returns {string|null}
 */
function extractCitySlugFromEntityId(entityId) {
  const m = entityId.match(/^sensor\.pollen_(.+)_[^_]+$/);
  return m ? m[1] : null;
}

/**
 * Discover all Pollenprognos sensors, grouped by city/device.
 *
 * Uses three-tier discovery via discoverEntitiesByDevice:
 *   Tier 1: device-based (hass.devices with identifiers["pollenprognos", ...])
 *   Tier 2: entity-registry scan by platform === "pollenprognos"
 *   Tier 3: regex fallback scanning hass.states for sensor.pollen_*
 *
 * NOTE: The HA integration platform string "pollenprognos" is an assumption
 * based on the integration name. If the integration uses a different identifier
 * (e.g. after a rename), tier 1 and tier 2 will yield no results and tier 3
 * (regex fallback) will still provide discovery. Pass an array like
 * ["pollenprognos", "other_name"] to support multiple platform names.
 *
 * @param {object}  hass
 * @param {boolean} [debug=false]
 * @returns {{ locations: Map<string, { label: string, entities: Map<string, string> }>, tierUsed: number }}
 */
export function discoverPpSensors(hass, debug = false) {
  if (!hass) return { locations: new Map(), tierUsed: 0 };

  const { locations, tierUsed } = discoverEntitiesByDevice(hass, {
    platform: ["pollenprognos"],
    /**
     * Strict classifier: derive the canonical allergen key from the entity ID.
     * PP entity IDs follow the pattern sensor.pollen_{city}_{allergen}.
     * The allergen is the last underscore-separated segment.
     */
    classify: (eid) => {
      const m = eid.match(/^sensor\.pollen_(.+)_([^_]+)$/);
      if (!m) return null;
      return normalize(m[2]);
    },
    /**
     * isRelevant: quick pre-filter before classify runs.
     */
    isRelevant: (eid) => eid.startsWith("sensor.pollen_"),
    /**
     * resolveLabel priority:
     *   1. device.name_by_user -- explicit user override.
     *   2. device.name with a leading "Pollenprognos" prefix stripped
     *      ("Pollenprognos Visby" → "Visby"), since the HA integration
     *      packages the city inside a generic device name.
     *   3. device.name as-is (defensive).
     *   4. Prettified city slug from entity ID.
     *   5. "Auto" fallback.
     */
    resolveLabel: (ctx) => {
      if (ctx.device?.name_by_user) return ctx.device.name_by_user;

      const rawName = ctx.device?.name;
      if (typeof rawName === "string" && rawName.trim()) {
        const stripped = rawName
          .replace(/^\s*pollenprognos\b[\s:\-–—]*/i, "")
          .trim();
        if (stripped) return stripped;
        return rawName.trim();
      }

      return extractCityFromEntityId(ctx.entityId) || "Auto";
    },
    /**
     * resolveLocationKey:
     *   - Tier 3 (regex fallback): use city slug from entity ID as location key
     *     to preserve backwards compatibility with slug-based city configs.
     *   - Tier 1/2 (device/registry): use config_entry_id as stable location key.
     */
    resolveLocationKey: (ctx) => {
      if (ctx.tier === 3) {
        return extractCitySlugFromEntityId(ctx.entityId) || "default";
      }
      return ctx.device?.config_entries?.[0] || "default";
    },
    /**
     * fallbackRegex: matches the standard PP entity ID pattern used in tier 3.
     */
    fallbackRegex: /^sensor\.pollen_.+_[^_]+$/,
    debug,
    logTag: "PP",
  });

  return { locations, tierUsed };
}

function detectCity(cfg, hass) {
  if (cfg.city === "manual") return "";
  let cityKey = normalize(cfg.city || "");
  if (!cityKey) {
    const ppStates = Object.keys(hass.states).filter(
      (id) =>
        id.startsWith("sensor.pollen_") &&
        /^sensor\.pollen_(.+)_[^_]+$/.test(id),
    );
    if (ppStates.length) {
      const m = ppStates[0].match(/^sensor\.pollen_(.+)_[^_]+$/);
      cityKey = m ? m[1] : "";
    }
  }
  return cityKey;
}

export function resolveEntityIds(cfg, hass, debug = false) {
  const map = new Map();

  // --- Path 1: Manual mode ---
  if (cfg.city === "manual") {
    const prefix = normalizeManualPrefix(cfg.entity_prefix);
    for (const allergen of cfg.allergens || []) {
      const rawKey = normalize(allergen);
      const sensorId = resolveManualEntity(hass, prefix, rawKey, cfg.entity_suffix || "");
      if (!sensorId) continue;
      if (debug) {
        console.debug(
          `[PP:resolveEntityIds] manual allergen: '${allergen}', rawKey: '${rawKey}', sensorId: '${sensorId}'`,
        );
      }
      map.set(rawKey, sensorId);
    }
    return map;
  }

  // --- Path 2: Device-based discovery (tier 1/2) or regex fallback (tier 3) ---
  const discovery = discoverPpSensors(hass, debug);

  if (discovery.locations.size > 0) {
    const match = resolveLocationByKey(discovery, cfg.city, {
      slugExtractor: (eid) => {
        const m = eid.match(/^sensor\.pollen_(.+)_[^_]+$/);
        return m ? m[1] : null;
      },
    });

    if (match) {
      const [, location] = match;
      for (const allergen of cfg.allergens || []) {
        const rawKey = normalize(allergen);
        const eid = location.entities.get(rawKey);
        if (!eid) continue;
        if (debug) {
          console.debug(
            `[PP:resolveEntityIds] discovery allergen: '${allergen}', rawKey: '${rawKey}', sensorId: '${eid}'`,
          );
        }
        map.set(rawKey, eid);
      }

      if (map.size > 0) return map;
    }
  }

  // --- Path 3: Template fallback (legacy / when discovery yields nothing) ---
  const cityKey = detectCity(cfg, hass);
  for (const allergen of cfg.allergens || []) {
    const rawKey = normalize(allergen);
    let sensorId = cityKey ? `sensor.pollen_${cityKey}_${rawKey}` : null;
    if (!sensorId || !hass.states[sensorId]) {
      const base = cityKey ? `sensor.pollen_${cityKey}_` : "sensor.pollen_";
      const cands = Object.keys(hass.states).filter(
        (id) => id.startsWith(base) && id.endsWith(`_${rawKey}`),
      );
      if (cands.length === 1) sensorId = cands[0];
      else continue;
    }
    if (debug) {
      console.debug(
        `[PP:resolveEntityIds] template fallback allergen: '${allergen}', rawKey: '${rawKey}', sensorId: '${sensorId}'`,
      );
    }
    map.set(rawKey, sensorId);
  }
  return map;
}

export async function fetchForecast(hass, config) {
  const sensors = [];
  const debug = Boolean(config.debug);
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const parseLocal = (s) => {
    const [ymd] = s.split("T");
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } = getLangAndLocale(hass, config);

  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } = mergePhrases(config, lang);
  const levelNames = buildLevelNames(userLevels, lang);

  if (debug)
    console.debug("PP.fetchForecast — start", { city: config.city, lang });

  const testVal = (v) => clampLevel(v, 6, null);

  const days_to_show = config.days_to_show ?? stubConfigPP.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigPP.pollen_threshold;

  const entityMap = resolveEntityIds(config, hass, debug);

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.days = []; // Initialize a days array
      const rawKey = normalize(allergen);
      dict.allergenReplaced = rawKey;

      // Allergen name resolution
      const { allergenCapitalized, allergenShort } = resolveAllergenNames(rawKey, {
        fullPhrases, shortPhrases, abbreviated: config.allergens_abbreviated, lang, configKey: allergen,
      });
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = allergenShort;
      // Sensor lookup (delegated to resolveEntityIds)
      const sensorId = entityMap.get(rawKey);
      if (!sensorId) continue;
      const sensor = hass.states[sensorId];
      if (!sensor?.attributes?.forecast) throw "Missing forecast";
      dict.entity_id = sensorId;

      // Build forecastMap
      const rawForecast = sensor.attributes.forecast;
      const forecastMap = Array.isArray(rawForecast)
        ? rawForecast.reduce((o, entry) => {
            const key = entry.time || entry.datetime;
            o[key] = entry;
            return o;
          }, {})
        : rawForecast;

      // Sort and slice dates
      // Hämta och sortera prognosdatum
      const rawDates = Object.keys(forecastMap).sort(
        (a, b) => parseLocal(a) - parseLocal(b),
      );
      const upcoming = rawDates.filter((d) => parseLocal(d) >= today);

      // Padda ut till exactly days_to_show datum
      let forecastDates = [];
      if (upcoming.length >= days_to_show) {
        // Tillräckligt många kommande – ta de första N
        forecastDates = upcoming.slice(0, days_to_show);
      } else {
        // Lägg först in vad som finns
        forecastDates = upcoming.slice();
        // Sedan bygg på dag för dag framåt
        // (antingen från senast i upcoming, eller från idag)
        let lastDate =
          upcoming.length > 0
            ? parseLocal(upcoming[upcoming.length - 1])
            : today;

        while (forecastDates.length < days_to_show) {
          lastDate = new Date(lastDate.getTime() + 86400000);
          const yyyy = lastDate.getFullYear();
          const mm = String(lastDate.getMonth() + 1).padStart(2, "0");
          const dd = String(lastDate.getDate()).padStart(2, "0");
          forecastDates.push(`${yyyy}-${mm}-${dd}T00:00:00`);
        }
      }
      // Iterate forecast days
      forecastDates.forEach((dateStr, idx) => {
        const raw = forecastMap[dateStr] || {};
        const level = testVal(raw.level);
        const d = parseLocal(dateStr);
        const diff = Math.round((d - today) / 86400000);
        const label = buildDayLabel(d, diff, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale });

        if (level !== null) {
          const dayObj = {
            name: dict.allergenCapitalized,
            day: label,
            state: level,
            state_text: levelNames[level],
          };
          dict[`day${idx}`] = dayObj;
          dict.days.push(dayObj);
        } else if (pollen_threshold === 0) {
          // When threshold is 0, show all allergens even with no data
          const dayObj = {
            name: dict.allergenCapitalized,
            day: label,
            state: 0,
            state_text: noInfoLabel,
          };
          dict[`day${idx}`] = dayObj;
          dict.days.push(dayObj);
        }
      });

      // Threshold filtering
      if (meetsThreshold(dict.days, pollen_threshold)) sensors.push(dict);
    } catch (e) {
      console.warn(`[PP] Fel vid allergen ${allergen}:`, e);
    }
  }

  // Sorting
  sortSensors(sensors, config.sort);

  if (debug) console.debug("PP.fetchForecast — done", sensors);
  return sensors;
}
