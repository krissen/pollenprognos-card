import { normalizeDWD } from "../utils/normalize.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";
import { getLangAndLocale, mergePhrases, buildDayLabel, clampLevel, sortSensors, meetsThreshold, resolveAllergenNames, normalizeManualPrefix, resolveManualEntity, discoverEntitiesByDevice, resolveLocationByKey, isConfigEntryId } from "../utils/adapter-helpers.js";
import { DWD_REGIONS } from "../constants.js";

const DOMAIN = "dwd_pollenflug";
const ATTR_VAL_TOMORROW = "state_tomorrow";
const ATTR_VAL_IN_2_DAYS = "state_in_2_days";
const ATTR_DESC_TODAY = "state_today_desc";
const ATTR_DESC_TOMORROW = "state_tomorrow_desc";
const ATTR_DESC_IN_2_DAYS = "state_in_2_days_desc";

export const stubConfigDWD = {
  integration: "dwd",
  region_id: "",
  // Optional entity naming used when region_id is "manual"
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    "erle",
    "ambrosia",
    "esche",
    "birke",
    "hasel",
    "gräser",
    "beifuss",
    "roggen",
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
  days_to_show: 2,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 0.5,
  sort: "value_descending",
  allergy_risk_top: true,
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  phrases: {
    full: {},
    short: {},
    levels: [],
    days: {},
    no_information: "",
  },
};

/**
 * Match the integration's own naming segment in a DWD entity ID, allowing
 * for an optional device-name prefix that Home Assistant prepends to the
 * entity ID when the device has a friendly name. The DWD integration
 * (hacs_dwd_pollenflug) has shipped a device-entity since around v1.0.4
 * named "Pollenflug Gefahrenindex", so entity IDs created on those
 * installs look like
 *   sensor.pollenflug_gefahrenindex_pollenflug_<allergen>_<region_id>
 * instead of the legacy bare shape
 *   sensor.pollenflug_<allergen>_<region_id>.
 *
 * Anchored to `^sensor\.` so callers can run the regex against
 * `Object.keys(hass.states)` (which spans every HA domain) without
 * misclassifying unrelated entities whose object_id happens to end with
 * `_pollenflug_<token>_<digits>` (Copilot review on #218). Allows zero or
 * more `\w+_` segments between `sensor.` and the integration's own
 * `pollenflug_` marker so the device-name slug can be of any length.
 *
 * The integration's allergen segment is always a single lowercase token
 * (erle / ambrosia / esche / birke / buche / hasel / graser / graeser /
 * beifuss / roggen), so anchoring the inner pattern to `[a-z]+` lets the
 * regex engine pick the correct rightmost `pollenflug_<allergen>_<id>`
 * occurrence even when the device-name prefix happens to repeat
 * "pollenflug" earlier in the string. (#217)
 */
export const DWD_ENTITY_ID_RE =
  /^sensor\.(?:\w+_)*pollenflug_([a-z]+)_(\d+)$/;

/**
 * Extract the numeric region ID from a DWD entity ID, accepting both bare
 * and HA-device-prefixed shapes.
 *   "sensor.pollenflug_erle_50" -> "50"
 *   "sensor.pollenflug_gefahrenindex_pollenflug_erle_50" -> "50"
 * Returns null if the integration's pattern is not found.
 *
 * @param {string} entityId
 * @returns {string|null}
 */
function extractRegionIdFromEntityId(entityId) {
  return entityId.match(DWD_ENTITY_ID_RE)?.[2] || null;
}

/**
 * Extract the integration's allergen segment from a DWD entity ID, accepting
 * both bare and HA-device-prefixed shapes. Returns null if the pattern is
 * not found.
 *
 * @param {string} entityId
 * @returns {string|null}
 */
function extractAllergenFromEntityId(entityId) {
  return entityId.match(DWD_ENTITY_ID_RE)?.[1] || null;
}

/**
 * Extract a human-readable region label from a DWD entity ID by looking up
 * the region ID in DWD_REGIONS. Falls back to "Region {id}" for unknown IDs.
 *
 * @param {string} entityId
 * @returns {string|null}
 */
function extractRegionLabel(entityId) {
  const regionId = extractRegionIdFromEntityId(entityId);
  if (regionId === null) return null;
  const name = DWD_REGIONS[Number(regionId)];
  return name || `Region ${regionId}`;
}

/**
 * Discover all DWD Pollenflug sensors, grouped by region.
 *
 * Uses three-tier discovery via discoverEntitiesByDevice:
 *   Tier 1: device-based (hass.devices with identifiers["dwd_pollenflug", ...])
 *   Tier 2: entity-registry scan by platform === "dwd_pollenflug" or "pollenflug"
 *   Tier 3: regex fallback scanning hass.states for sensor.pollenflug_*
 *
 * NOTE: The official HA integration platform string is assumed to be
 * "dwd_pollenflug". The array ["dwd_pollenflug", "pollenflug"] is used as a
 * defensive default in case some installations use the shorter name. Tier 3
 * (regex fallback) guarantees discovery regardless of the actual platform name.
 *
 * In tier 3 the region ID (numeric suffix) is used as the location key so that
 * cfg.region_id = "50" matches entities like sensor.pollenflug_erle_50.
 *
 * @param {object}  hass
 * @param {boolean} [debug=false]
 * @returns {{ locations: Map<string, { label: string, entities: Map<string, string> }>, tierUsed: number }}
 */
export function discoverDwdSensors(hass, debug = false) {
  if (!hass) return { locations: new Map(), tierUsed: 0 };

  const { locations, tierUsed } = discoverEntitiesByDevice(hass, {
    platform: ["dwd_pollenflug", "pollenflug"],
    /**
     * Strict classifier: derive the normalized allergen key from the entity ID.
     * Accepts both the bare shape (sensor.pollenflug_<allergen>_<region>)
     * and the device-prefixed shape HA produces when a device-name slug
     * is prepended (e.g. sensor.pollenflug_gefahrenindex_pollenflug_<allergen>_<region>).
     * DWD allergens are single lowercase tokens, so the inner anchor in
     * DWD_ENTITY_ID_RE prevents misclassification when the device-name
     * happens to repeat "pollenflug". (#217)
     */
    classify: (eid) => {
      const allergen = extractAllergenFromEntityId(eid);
      return allergen ? normalizeDWD(allergen) : null;
    },
    classifyRelaxed: (eid) => {
      const allergen = extractAllergenFromEntityId(eid);
      return allergen ? normalizeDWD(allergen) : null;
    },
    /**
     * isRelevant: quick pre-filter before classify runs. The integration's
     * own naming segment ("pollenflug_<allergen>_<region>") may sit anywhere
     * in the entity ID after an optional device-name prefix, so check the
     * full pattern rather than just the entity-ID start.
     */
    isRelevant: (eid) => DWD_ENTITY_ID_RE.test(eid),
    /**
     * resolveLabel priority:
     *   1. device.name_by_user -- explicit user override always wins.
     *   2. Region name derived from the numeric suffix in the entity ID.
     *      The DWD integration sets a generic device.name ("Pollenflug
     *      Gefahrenindex") that is identical for every region, so region
     *      derivation must outrank device.name to produce usable titles.
     *   3. device.name -- last-resort generic label.
     *   4. "Auto" fallback.
     */
    resolveLabel: (ctx) => {
      if (ctx.device?.name_by_user) return ctx.device.name_by_user;
      const regionLabel = extractRegionLabel(ctx.entityId);
      if (regionLabel) return regionLabel;
      if (ctx.device?.name) return ctx.device.name;
      return "Auto";
    },
    /**
     * resolveLocationKey:
     *   - Tier 3 (regex fallback): use the numeric region ID as the location key
     *     so that cfg.region_id = "50" resolves directly via exact key match.
     *   - Tier 1/2 (device/registry): use config_entry_id as stable location key.
     */
    resolveLocationKey: (ctx) => {
      if (ctx.tier === 3) {
        return extractRegionIdFromEntityId(ctx.entityId) || "default";
      }
      return ctx.device?.config_entries?.[0] || "default";
    },
    /**
     * fallbackRegex: matches the integration's own pollenflug_<allergen>_<id>
     * segment whether or not HA has prepended a device-name slug.
     */
    fallbackRegex: DWD_ENTITY_ID_RE,
    debug,
    logTag: "DWD",
  });

  // Disambiguate duplicate labels. DWD_REGIONS is not a bijection: several
  // region IDs share the same name (e.g. 121/122/123/124 all "Bayern").
  // When discovery surfaces two or more locations with identical labels,
  // append the region ID in parens so the editor dropdown can distinguish
  // them. Unique labels stay clean ("Brandenburg und Berlin").
  const labelCounts = new Map();
  for (const loc of locations.values()) {
    labelCounts.set(loc.label, (labelCounts.get(loc.label) || 0) + 1);
  }
  for (const loc of locations.values()) {
    if ((labelCounts.get(loc.label) || 0) <= 1) continue;
    const anyEntityId = loc.entities.values().next().value;
    const regionId = anyEntityId
      ? extractRegionIdFromEntityId(anyEntityId)
      : null;
    if (regionId) {
      loc.label = `${loc.label} (${regionId})`;
    }
  }

  return { locations, tierUsed };
}

export function resolveEntityIds(cfg, hass, debug = false) {
  const map = new Map();

  // --- Path 1: Manual mode ---
  if (cfg.region_id === "manual") {
    const prefix = normalizeManualPrefix(cfg.entity_prefix);
    for (const allergen of cfg.allergens || []) {
      const rawKey = normalizeDWD(allergen);
      const sensorId = resolveManualEntity(hass, prefix, rawKey, cfg.entity_suffix || "");
      if (!sensorId) continue;
      if (debug) {
        console.debug(
          `[DWD:resolveEntityIds] manual allergen: '${allergen}', rawKey: '${rawKey}', sensorId: '${sensorId}'`,
        );
      }
      map.set(rawKey, sensorId);
    }
    return map;
  }

  // --- Path 2: Device-based discovery (tier 1/2) or regex fallback (tier 3) ---
  const discovery = discoverDwdSensors(hass, debug);

  if (discovery.locations.size > 0) {
    let match = resolveLocationByKey(discovery, cfg.region_id, {
      slugExtractor: extractRegionIdFromEntityId,
    });

    // Stale-config recovery: a saved ULID region_id from a removed/renamed
    // integration won't be in the discovered locations. Retry with autodetect
    // semantics so the card still finds sensors instead of silently going
    // empty and then template-falling back to "sensor.pollenflug_*_{ULID}".
    if (!match && isConfigEntryId(cfg.region_id)) {
      match = resolveLocationByKey(discovery, "");
    }

    if (match) {
      const [, location] = match;
      for (const allergen of cfg.allergens || []) {
        const rawKey = normalizeDWD(allergen);
        const eid = location.entities.get(rawKey);
        if (!eid) continue;
        if (debug) {
          console.debug(
            `[DWD:resolveEntityIds] discovery allergen: '${allergen}', rawKey: '${rawKey}', sensorId: '${eid}'`,
          );
        }
        map.set(rawKey, eid);
      }

      if (map.size > 0) return map;
    }
  }

  // --- Path 3: Template fallback (legacy / when discovery yields nothing) ---
  // Rebuilt around DWD_ENTITY_ID_RE so it accepts the device-name-prefixed
  // shape HA emits when the integration's device has a friendly name (#217).
  // The bare-shape direct lookup is tried first as a fast path; the regex
  // scan handles both shapes when that misses.
  for (const allergen of cfg.allergens || []) {
    const rawKey = normalizeDWD(allergen);
    let sensorId = null;
    if (cfg.region_id) {
      const direct = `sensor.pollenflug_${rawKey}_${cfg.region_id}`;
      if (hass.states[direct]) sensorId = direct;
    }
    if (!sensorId) {
      const candidates = Object.keys(hass.states).filter((id) => {
        const m = id.match(DWD_ENTITY_ID_RE);
        if (!m) return false;
        if (m[1] !== rawKey) return false;
        return cfg.region_id ? m[2] === String(cfg.region_id) : true;
      });
      if (candidates.length === 1) sensorId = candidates[0];
      else if (candidates.length > 1 && debug) {
        console.debug(
          `[DWD:resolveEntityIds] template fallback ambiguous for '${allergen}' (${candidates.length} candidates); skipping`,
        );
      }
    }
    if (!sensorId) continue;
    if (debug) {
      console.debug(
        `[DWD:resolveEntityIds] template fallback allergen: '${allergen}', rawKey: '${rawKey}', sensorId: '${sensorId}'`,
      );
    }
    map.set(rawKey, sensorId);
  }
  return map;
}

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } = getLangAndLocale(hass, config, stubConfigDWD.date_locale);

  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } = mergePhrases(config, lang);
  const levelNames = buildLevelNames(userLevels, lang);
  const days_to_show = config.days_to_show ?? stubConfigDWD.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigDWD.pollen_threshold;

  if (debug)
    console.debug("DWD adapter: start fetchForecast", { config, lang });

  const testVal = (v) => clampLevel(v, null, -1);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sensors = [];
  const entityMap = resolveEntityIds(config, hass, debug);

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      const rawKey = normalizeDWD(allergen);
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
      dict.entity_id = sensorId;

      // Råvärden
      const todayVal = testVal(sensor.state);
      const tomVal = testVal(sensor.attributes[ATTR_VAL_TOMORROW]);
      const twoVal = testVal(sensor.attributes[ATTR_VAL_IN_2_DAYS]);

      // Nivåer-datum
      const levels = [
        { date: today, level: todayVal },
        { date: new Date(today.getTime() + 86400000), level: tomVal },
        { date: new Date(today.getTime() + 2 * 86400000), level: twoVal },
      ];
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
        });
      }

      // Bygg dict.dayN
      dict.days = [];
      // Bygg dict.dayN och dict.days[]
      levels.forEach((entry, idx) => {
        if (entry.level !== null && entry.level >= 0) {
          const diff = Math.round((entry.date - today) / 86400000);
          const dayLabel = buildDayLabel(entry.date, diff, { daysRelative, dayAbbrev, daysUppercase, userDays, lang, locale });

          const sensorDesc =
            sensor.attributes[
              idx === 0
                ? ATTR_DESC_TODAY
                : idx === 1
                  ? ATTR_DESC_TOMORROW
                  : ATTR_DESC_IN_2_DAYS
            ] || "";

          const scaled = entry.level * 2;
          const lvlIndex = Math.min(Math.max(Math.round(scaled), 0), 6);
          const stateText =
            lvlIndex < 0 ? noInfoLabel : levelNames[lvlIndex] || sensorDesc;

          dict[`day${idx}`] = {
            name: dict.allergenCapitalized,
            day: dayLabel,
            state: entry.level,
            display_state: scaled,
            state_text: stateText,
          };
          dict.days.push(dict[`day${idx}`]);
        }
      });

      // Filtrera med tröskel
      if (meetsThreshold(dict.days, pollen_threshold)) sensors.push(dict);
    } catch (e) {
      console.warn(`DWD adapter error for allergen ${allergen}:`, e);
    }
  }

  // Sortering
  sortSensors(sensors, config.sort);

  if (debug) console.debug("DWD adapter complete sensors:", sensors);
  return sensors;
}
