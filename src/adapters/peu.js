// src/adapters/peu.js
import { t } from "../i18n.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { indexToLevel } from "./silam.js";
import { slugify } from "../utils/slugify.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, clampLevel, sortSensors, meetsThreshold, resolveAllergenNames, normalizeManualPrefix, resolveManualEntity, discoverEntitiesByDevice, resolveLocationByKey } from "../utils/adapter-helpers.js";

// Skapa stubConfigPEU – allergener enligt din sensor.py, i engelsk slugform!
export const stubConfigPEU = {
  integration: "peu",
  location: "",
  // Optional entity naming used when location is "manual"
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    "alder",
    "ash",
    "beech",
    "birch",
    "cypress_family",
    "elm",
    "grasses",
    "hazel",
    "lime",
    "fungal_spores",
    "mugwort",
    "nettle_family",
    "oak",
    "olive",
    "plane_tree",
    "ragweed",
    "rye",
    "willow",
  ],
  minimal: false,
  minimal_gap: 35,
  mode: "daily",
  background_color: "",
  icon_size: "48",
  text_size_ratio: 1,
  ...LEVELS_DEFAULTS,
  show_text_allergen: true,
  show_value_text: true,
  show_value_numeric: false,
  show_value_numeric_in_circle: false,
  numeric_state_raw_risk: false,
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

// All possible allergens for the PEU integration
export const PEU_ALLERGENS = ["allergy_risk", ...stubConfigPEU.allergens];

const PEU_PREFIX = "sensor.polleninformation_";

/**
 * Classify a PEU entity ID using a whitelist of known allergen keys.
 *
 * Probes the longest suffix first to avoid greedy-split collisions when
 * allergen names contain underscores (e.g. "allergy_risk_hourly" must not
 * be classified as "allergy_risk" with an extra "_hourly" location suffix).
 *
 * Returns the allergen key string, or null if the entity ID does not match
 * any known PEU allergen pattern.
 *
 * @param {string} eid
 * @returns {string|null}
 */
// Precomputed longest-first whitelist. Sorting once at module load avoids
// reallocating and re-sorting on every classifier invocation during discovery.
const PEU_ALLERGEN_SUFFIXES_LONGEST_FIRST = [...PEU_ALLERGENS, "allergy_risk_hourly"]
  .sort((a, b) => b.length - a.length);

function classifyPeuEntity(eid) {
  if (!eid.startsWith(PEU_PREFIX)) return null;
  const rest = eid.substring(PEU_PREFIX.length);
  for (const allergen of PEU_ALLERGEN_SUFFIXES_LONGEST_FIRST) {
    const suffix = `_${allergen}`;
    if (rest.endsWith(suffix) && rest.length > suffix.length) {
      return allergen;
    }
  }
  return null;
}

/**
 * Extract the location slug from a PEU entity ID given a known allergen key.
 * "sensor.polleninformation_wien_birch" + "birch" -> "wien"
 *
 * Returns null if the entity ID does not follow the expected pattern.
 *
 * @param {string} eid
 * @param {string} allergenKey
 * @returns {string|null}
 */
function extractPeuLocationSlug(eid, allergenKey) {
  if (!eid.startsWith(PEU_PREFIX)) return null;
  const rest = eid.substring(PEU_PREFIX.length);
  const suffix = `_${allergenKey}`;
  if (!rest.endsWith(suffix) || rest.length <= suffix.length) return null;
  return rest.slice(0, rest.length - suffix.length);
}

/**
 * Extract the location slug from a PEU entity ID by running classifyPeuEntity
 * to discover the allergen key, then stripping it from the tail.
 *
 * Returns null if the entity ID cannot be classified.
 *
 * @param {string} eid
 * @returns {string|null}
 */
function extractPeuLocationSlugFromEntityId(eid) {
  const allergen = classifyPeuEntity(eid);
  if (!allergen) return null;
  return extractPeuLocationSlug(eid, allergen);
}

/**
 * Prettify a PEU location slug for display.
 * "wien" -> "Wien", "new_york" -> "New_york"
 *
 * Returns null when no slug can be extracted.
 *
 * @param {string} eid
 * @returns {string|null}
 */
function extractPeuLocationLabel(eid) {
  const slug = extractPeuLocationSlugFromEntityId(eid);
  if (!slug) return null;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Discover all PEU (Polleninformation EU) sensors, grouped by location/device.
 *
 * Uses three-tier discovery via discoverEntitiesByDevice:
 *   Tier 1: device-based (hass.devices with identifiers["polleninformation", ...])
 *   Tier 2: entity-registry scan by platform === "polleninformation"
 *   Tier 3: regex fallback scanning hass.states for sensor.polleninformation_*
 *
 * The whitelist classifier (classifyPeuEntity) avoids greedy-regex collisions
 * by probing allergen suffixes from longest to shortest. allergy_risk_hourly
 * is stored under its own key so that mode-mapping in resolveEntityIds can
 * look it up directly.
 *
 * @param {object}  hass
 * @param {boolean} [debug=false]
 * @returns {{ locations: Map<string, { label: string, entities: Map<string, string> }>, tierUsed: number }}
 */
export function discoverPeuSensors(hass, debug = false) {
  if (!hass) return { locations: new Map(), tierUsed: 0 };

  const { locations, tierUsed } = discoverEntitiesByDevice(hass, {
    platform: ["polleninformation"],
    /**
     * Strict classifier: use the whitelist to extract the allergen key.
     * Returns null for entity IDs that do not match any known allergen.
     */
    classify: (eid) => classifyPeuEntity(eid),
    classifyRelaxed: (eid) => classifyPeuEntity(eid),
    /**
     * isRelevant: quick pre-filter before classify runs.
     */
    isRelevant: (eid) => eid.startsWith(PEU_PREFIX),
    /**
     * resolveLabel priority:
     *   1. device.name_by_user -- explicit user override.
     *   2. state.attributes.location_title -- integration's clean location
     *      name when exposed.
     *   3. device.name with the "Polleninformation " prefix stripped and
     *      parenthesised wrappers unwrapped ("Polleninformation (Hamburg)"
     *      → "Hamburg"), since the HA integration often packages the
     *      location inside a generic device name.
     *   4. device.name as-is (uncommon but defensive).
     *   5. Prettified location slug from entity ID.
     *   6. "Auto" fallback.
     */
    resolveLabel: (ctx) => {
      if (ctx.device?.name_by_user) return ctx.device.name_by_user;

      const attrTitle = ctx.state?.attributes?.location_title;
      if (typeof attrTitle === "string" && attrTitle.trim()) {
        return attrTitle.trim();
      }

      const rawName = ctx.device?.name;
      if (typeof rawName === "string" && rawName.trim()) {
        // Strip a leading "Polleninformation" (any case, optional separators)
        // and unwrap a trailing "(location)" if present.
        const stripped = rawName
          .replace(/^\s*polleninformation\b[\s:\-–—]*/i, "")
          .trim();
        const paren = stripped.match(/^\(([^)]+)\)$/);
        if (paren) return paren[1].trim();
        if (stripped) return stripped;
        return rawName.trim();
      }

      return extractPeuLocationLabel(ctx.entityId) || "Auto";
    },
    /**
     * resolveLocationKey:
     *   - Tier 3 (state fallback): use location slug from entity ID as key
     *     so that cfg.location = "wien" matches directly via exact key match.
     *   - Tier 1/2 (device/registry): use config_entry_id as stable location key.
     */
    resolveLocationKey: (ctx) => {
      if (ctx.tier === 3) {
        return extractPeuLocationSlugFromEntityId(ctx.entityId) || "default";
      }
      return ctx.device?.config_entries?.[0] || "default";
    },
    /**
     * fallbackRegex: matches all PEU entity IDs; classifier filters further.
     */
    fallbackRegex: /^sensor\.polleninformation_.+$/,
    debug,
    logTag: "PEU",
  });

  return { locations, tierUsed };
}

function detectLocation(cfg, hass) {
  if (cfg.location === "manual") return "";
  let locationSlug = slugify(cfg.location || "");
  if (!locationSlug) {
    const peuStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.polleninformation_"),
    );
    if (peuStates.length) {
      const match = peuStates[0].match(/^sensor\.polleninformation_(.+)_[^_]+$/);
      locationSlug = match ? match[1] : "";
    }
  }
  return locationSlug;
}

export function resolveEntityIds(cfg, hass, debug = false) {
  const map = new Map();
  const mode = cfg.mode || stubConfigPEU.mode;

  // --- Path 1: Manual mode ---
  if (cfg.location === "manual") {
    const prefix = normalizeManualPrefix(cfg.entity_prefix);
    for (const allergen of cfg.allergens || []) {
      const allergenSlug = allergen;
      const coreSlug =
        mode !== "daily" && allergenSlug === "allergy_risk"
          ? "allergy_risk_hourly"
          : allergenSlug;
      const sensorId = resolveManualEntity(hass, prefix, coreSlug, cfg.entity_suffix || "");
      if (!sensorId) continue;
      if (debug) {
        console.debug(
          `[PEU:resolveEntityIds] manual allergen: '${allergen}', coreSlug: '${coreSlug}', sensorId: '${sensorId}'`,
        );
      }
      map.set(allergenSlug, sensorId);
    }
    return map;
  }

  // --- Path 2: Device-based discovery (tier 1/2) or state fallback (tier 3) ---
  const discovery = discoverPeuSensors(hass, debug);

  if (discovery.locations.size > 0) {
    const match = resolveLocationByKey(discovery, cfg.location, {
      slugExtractor: extractPeuLocationSlugFromEntityId,
    });

    if (match) {
      const [, location] = match;
      for (const allergen of cfg.allergens || []) {
        const allergenSlug = allergen;
        // Mode mapping: in non-daily modes, allergy_risk sensor is the hourly variant.
        const lookupKey =
          mode !== "daily" && allergenSlug === "allergy_risk"
            ? "allergy_risk_hourly"
            : allergenSlug;
        const eid = location.entities.get(lookupKey);
        if (!eid) continue;
        if (debug) {
          console.debug(
            `[PEU:resolveEntityIds] discovery allergen: '${allergen}', lookupKey: '${lookupKey}', sensorId: '${eid}'`,
          );
        }
        map.set(allergenSlug, eid);
      }

      if (map.size > 0) return map;
    }
  }

  // --- Path 3: Template fallback (legacy / when discovery yields nothing) ---
  const locationSlug = detectLocation(cfg, hass);
  const peuStates = Object.keys(hass.states).filter((id) =>
    id.startsWith(PEU_PREFIX),
  );

  for (const allergen of cfg.allergens || []) {
    const allergenSlug = allergen;
    let sensorId;
    if (mode !== "daily" && allergenSlug === "allergy_risk") {
      sensorId = locationSlug
        ? `${PEU_PREFIX}${locationSlug}_allergy_risk_hourly`
        : null;
    } else {
      sensorId = locationSlug
        ? `${PEU_PREFIX}${locationSlug}_${allergenSlug}`
        : null;
    }
    if (!sensorId || !hass.states[sensorId]) {
      const cands = peuStates.filter((id) => {
        const match = id.match(/^sensor\.polleninformation_(.+)_(.+)$/);
        if (!match) return false;
        const loc = match[1];
        const allg = match[2];
        if (mode !== "daily" && allergenSlug === "allergy_risk") {
          return (
            (!locationSlug || loc === locationSlug) &&
            allg === "allergy_risk_hourly"
          );
        }
        return (
          (!locationSlug || loc === locationSlug) &&
          allg === allergenSlug
        );
      });
      if (cands.length === 1) sensorId = cands[0];
      else continue;
    }
    if (debug) {
      console.debug(
        `[PEU:resolveEntityIds] template fallback allergen: '${allergen}', locationSlug: '${locationSlug}', sensorId: '${sensorId}'`,
      );
    }
    map.set(allergenSlug, sensorId);
  }
  return map;
}

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } = getLangAndLocale(hass, config);

  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } = mergePhrases(config, lang);
  // Levels from PEU are reported as 0-4 but scaled to 0-6 in the card.
  // Accept either five or seven custom names and map them to the 0-6 scale.
  const defaultNumLevels = 5; // original scale
  const levelNamesDefault = Array.from({ length: 7 }, (_, i) =>
    t(`card.levels.${i}`, lang),
  );
  let levelNames = levelNamesDefault.slice();
  if (Array.isArray(userLevels)) {
    if (userLevels.length === 7) {
      levelNames = buildLevelNames(userLevels, lang);
    } else if (userLevels.length === defaultNumLevels) {
      const map = [0, 1, 3, 5, 6];
      map.forEach((lvl, idx) => {
        const val = userLevels[idx];
        if (val != null && val !== "") levelNames[lvl] = val;
      });
    }
  }

  const testVal = (v) => clampLevel(v, 4, -1);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days_to_show = config.days_to_show ?? stubConfigPEU.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigPEU.pollen_threshold;
  const mode = config.mode || stubConfigPEU.mode;
  const stepMap = {
    hourly: 1,
    hourly_second: 2,
    hourly_third: 3,
    hourly_fourth: 4,
    hourly_sixth: 6,
    hourly_eighth: 8,
    twice_daily: 12,
  };

  const entityMap = resolveEntityIds(config, hass, debug);

  const sensors = [];
  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.days = [];
      const allergenSlug = allergen; // redan slugifierat i peu
      dict.allergenReplaced = allergenSlug;

      // Allergen name resolution
      const { allergenCapitalized, allergenShort } = resolveAllergenNames(allergenSlug, {
        fullPhrases, shortPhrases, abbreviated: config.allergens_abbreviated, lang,
      });
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = allergenShort;

      // Sensor lookup (delegated to resolveEntityIds)
      const sensorId = entityMap.get(allergenSlug);
      if (!sensorId) continue;
      const sensor = hass.states[sensorId];
      dict.entity_id = sensorId;

      const isStale = sensor?.attributes?.data_stale === true;
      const hasForecast = Array.isArray(sensor?.attributes?.forecast) && 
                          sensor?.attributes?.forecast?.length > 0;

      if (isStale || !hasForecast) {
        dict.stale = true;
        dict.staleSince = sensor?.attributes?.stale_since || null;
        dict.days = [];
        sensors.push(dict);
        continue;
      }

      const rawForecast = sensor.attributes.forecast;

      if (mode !== "daily" && allergenSlug === "allergy_risk") {
        const step = stepMap[mode] || 1;
        const maxItems = Math.min(
          Math.floor(rawForecast.length / step),
          days_to_show,
        );
        for (let i = 0; i < maxItems; ++i) {
          const entry = rawForecast[i * step] || {};
          const d = entry.time
            ? new Date(entry.time)
            : entry.datetime
              ? new Date(entry.datetime)
              : new Date(today.getTime() + i * step * 3600000);
          let label;
          let icon = null;
          if (mode === "twice_daily") {
            label = d
              .toLocaleDateString(locale, { weekday: "short" })
              .replace(/^./, (c) => c.toUpperCase());
            if (daysUppercase) label = label.toUpperCase();
            icon =
              i % 2 === 0 ? "mdi:weather-sunset-up" : "mdi:weather-sunset-down";
          } else {
            label =
              d.toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              }) || "";
          }
          // Use the normalized value for state so icons and circles are correct.
          let state = Number(entry.numeric_state ?? entry.level ?? -1);
          // By default the value shown to the user is the normalized state.
          let displayState = state;
          // For allergy risk we may optionally show the raw value instead.
          if (
            allergenSlug === "allergy_risk" &&
            config.numeric_state_raw_risk
          ) {
            displayState = Number(
              entry.numeric_state_raw ?? entry.level_raw ?? displayState,
            );
          }
          const scaledLevel = indexToLevel(state);
          const dayObj = {
            name: dict.allergenCapitalized,
            day: label,
            icon,
            state,
            // Separate property used purely for numeric display.
            display_state: displayState,
            state_text:
              scaledLevel < 0
                ? noInfoLabel
                : levelNames[scaledLevel] ||
                  t(`card.levels.${scaledLevel}`, lang),
          };
          dict[`day${i}`] = dayObj;
          dict.days.push(dayObj);
        }
      } else {
        // Create index for quick lookup of dates
        const forecastMap = rawForecast.reduce((o, entry) => {
          const key = entry.time || entry.datetime;
          o[key] = entry;
          return o;
        }, {});

        const rawDates = Object.keys(forecastMap).sort(
          (a, b) => new Date(a) - new Date(b),
        );
        const upcoming = rawDates.filter((d) => new Date(d) >= today);

        let forecastDates = [];
        if (upcoming.length >= days_to_show) {
          forecastDates = upcoming.slice(0, days_to_show);
        } else {
          forecastDates = upcoming.slice();
          let lastDate =
            upcoming.length > 0
              ? new Date(upcoming[upcoming.length - 1])
              : today;
          while (forecastDates.length < days_to_show) {
            lastDate = new Date(lastDate.getTime() + 86400000);
            const yyyy = lastDate.getFullYear();
            const mm = String(lastDate.getMonth() + 1).padStart(2, "0");
            const dd = String(lastDate.getDate()).padStart(2, "0");
            forecastDates.push(`${yyyy}-${mm}-${dd}T00:00:00`);
          }
        }

        forecastDates.forEach((dateStr, idx) => {
          const raw = forecastMap[dateStr] || {};
          // Normalized level is always used for rendering and sorting.
          let level = testVal(raw.level);
          // Value presented to the user, defaults to the normalized level.
          let displayLevel = level;
          // When requested we expose the raw value, which may exceed the
          // normalized 0–4 scale, purely for user display.
          if (
            allergenSlug === "allergy_risk" &&
            config.numeric_state_raw_risk
          ) {
            if (raw.numeric_state_raw != null) {
              displayLevel = Number(raw.numeric_state_raw);
            } else if (raw.level_raw != null) {
              displayLevel = Number(raw.level_raw);
            }
          }
          if (level !== null && level >= 0) {
            const d = new Date(dateStr);
            const diff = Math.round((d - today) / 86400000);
            const label = buildDayLabel(d, diff, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale });

            let scaledLevel;
            if (level < 2) {
              scaledLevel = Math.floor((level * 6) / 4);
            } else {
              scaledLevel = Math.ceil((level * 6) / 4);
            }

            const dayObj = {
              name: dict.allergenCapitalized,
              day: label,
              state: level,
              // Raw value used only for display when available.
              display_state: displayLevel,
              state_text:
                scaledLevel < 0
                  ? noInfoLabel
                  : levelNames[scaledLevel] ||
                    t(`card.levels.${scaledLevel}`, lang),
            };

            dict[`day${idx}`] = dayObj;
            dict.days.push(dayObj);
          }
        });
      }

      // Threshold-filter
      if (meetsThreshold(dict.days, pollen_threshold)) sensors.push(dict);
    } catch (e) {
      if (debug) console.warn(`Fel vid allergen ${allergen}:`, e);
    }
  }

  // Sortera
  sortSensors(sensors, config.sort);

  if (config.allergy_risk_top) {
    const idx = sensors.findIndex(
      (s) =>
        s.allergenReplaced === "allergy_risk" || s.allergenReplaced === "index",
    );
    if (idx > 0) {
      const [special] = sensors.splice(idx, 1);
      sensors.unshift(special);
    }
  }

  if (debug) console.debug("PEU.fetchForecast — done", sensors);
  return sensors;
}
