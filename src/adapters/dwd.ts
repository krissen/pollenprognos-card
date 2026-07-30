import type { HomeAssistant } from "../types/home-assistant.js";
import type { CardConfig, AdapterStubConfig } from "../types/config.js";
import type { PollenSensor, ForecastDay } from "../types/sensor.js";
import type {
  AdapterAutodetect,
  AutodetectContext,
  AutodetectDetectResult,
} from "../types/adapter.js";
import { normalizeDWD } from "../utils/normalize.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import {
  buildDayLabel,
  clampLevel,
  resolveAllergenNames,
  discoverEntitiesByDevice,
  type DeviceDiscovery,
} from "../utils/adapter-helpers.js";
import {
  createEntityResolver,
  runForecastScaffold,
  padDays,
  DWD_LEVEL_MULTIPLIER,
  type BuildDictArgs,
} from "./base.js";
import { DWD_REGIONS } from "../constants.js";

const ATTR_VAL_TOMORROW = "state_tomorrow";
const ATTR_VAL_IN_2_DAYS = "state_in_2_days";
const ATTR_DESC_TODAY = "state_today_desc";
const ATTR_DESC_TOMORROW = "state_tomorrow_desc";
const ATTR_DESC_IN_2_DAYS = "state_in_2_days_desc";

export const stubConfigDWD: AdapterStubConfig = {
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
  icon_size: 48,
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
export const DWD_ENTITY_ID_RE = /^sensor\.(?:\w+_)*pollenflug_([a-z]+)_(\d+)$/;

/**
 * Extract the numeric region ID from a DWD entity ID, accepting both bare
 * and HA-device-prefixed shapes.
 *   "sensor.pollenflug_erle_50" -> "50"
 *   "sensor.pollenflug_gefahrenindex_pollenflug_erle_50" -> "50"
 * Returns null if the integration's pattern is not found.
 */
function extractRegionIdFromEntityId(entityId: string): string | null {
  return entityId.match(DWD_ENTITY_ID_RE)?.[2] || null;
}

/**
 * Extract the integration's allergen segment from a DWD entity ID, accepting
 * both bare and HA-device-prefixed shapes. Returns null if the pattern is
 * not found.
 */
function extractAllergenFromEntityId(entityId: string): string | null {
  return entityId.match(DWD_ENTITY_ID_RE)?.[1] || null;
}

/**
 * Extract a human-readable region label from a DWD entity ID by looking up
 * the region ID in DWD_REGIONS. Falls back to "Region {id}" for unknown IDs.
 */
function extractRegionLabel(entityId: string): string | null {
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
 */
export function discoverDwdSensors(
  hass: HomeAssistant,
  debug = false,
): DeviceDiscovery {
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
    classify: (eid: string) => {
      const allergen = extractAllergenFromEntityId(eid);
      return allergen ? normalizeDWD(allergen) : null;
    },
    classifyRelaxed: (eid: string) => {
      const allergen = extractAllergenFromEntityId(eid);
      return allergen ? normalizeDWD(allergen) : null;
    },
    /**
     * isRelevant: quick pre-filter before classify runs. The integration's
     * own naming segment ("pollenflug_<allergen>_<region>") may sit anywhere
     * in the entity ID after an optional device-name prefix, so check the
     * full pattern rather than just the entity-ID start.
     */
    isRelevant: (eid: string) => DWD_ENTITY_ID_RE.test(eid),
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
  const labelCounts = new Map<string, number>();
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

/**
 * Path 3 template fallback. Rebuilt around DWD_ENTITY_ID_RE so it accepts the
 * device-name-prefixed shape HA emits when the integration's device has a
 * friendly name (#217). The bare-shape direct lookup is tried first as a fast
 * path; the regex scan handles both shapes when that misses.
 */
function dwdTemplateFallback({
  cfg,
  hass,
  debug,
}: {
  cfg: CardConfig;
  hass: HomeAssistant;
  debug: boolean;
}): Map<string, string> {
  const map = new Map<string, string>();
  const regionId = cfg.region_id as string | undefined;
  for (const allergen of (cfg.allergens as string[] | undefined) || []) {
    const rawKey = normalizeDWD(allergen);
    let sensorId: string | null = null;
    if (regionId) {
      const direct = `sensor.pollenflug_${rawKey}_${regionId}`;
      if (hass.states[direct]) sensorId = direct;
    }
    if (!sensorId) {
      const candidates = Object.keys(hass.states).filter((id) => {
        const m = id.match(DWD_ENTITY_ID_RE);
        if (!m) return false;
        if (m[1] !== rawKey) return false;
        return regionId ? m[2] === String(regionId) : true;
      });
      if (candidates.length === 1) sensorId = candidates[0]!;
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

export const resolveEntityIds = createEntityResolver({
  locationKey: "region_id",
  normalize: normalizeDWD,
  discover: discoverDwdSensors,
  slugExtractor: extractRegionIdFromEntityId,
  logTag: "DWD",
  // Stale-config recovery: a saved ULID region_id from a removed/renamed
  // integration won't be in the discovered locations. Retry with autodetect
  // semantics so the card still finds sensors instead of silently going empty
  // and then template-falling back to "sensor.pollenflug_*_{ULID}".
  recoverStaleConfig: true,
  templateFallback: dwdTemplateFallback,
});

// DWD reports a coarse 0-3 index; NaN/negative collapses to the -1 sentinel and
// there is no upper clamp (the 0-3 scale is doubled onto 0-6 during rendering).
const testVal = (v: unknown): number => clampLevel(v, null, -1);

interface DwdLevelDay {
  date: Date;
  level: number;
}

function buildDwdDict({
  allergen,
  rawKey,
  sensorId,
  sensor,
  config,
  ctx,
}: BuildDictArgs): PollenSensor {
  // Preserve the original key-insertion order (allergen fields, entity_id, then
  // days) so the serialized sensor dict stays byte-identical.
  const dict = {} as PollenSensor;
  dict.allergenReplaced = rawKey;

  // Allergen name resolution
  const { allergenCapitalized, allergenShort } = resolveAllergenNames(rawKey, {
    fullPhrases: ctx.fullPhrases,
    shortPhrases: ctx.shortPhrases,
    abbreviated: config.allergens_abbreviated as boolean,
    lang: ctx.lang,
    configKey: allergen,
  });
  dict.allergenCapitalized = allergenCapitalized;
  dict.allergenShort = allergenShort;

  dict.entity_id = sensorId;
  const attrs = sensor!.attributes;

  // Raw values (today / tomorrow / in 2 days).
  const todayVal = testVal(sensor!.state);
  const tomVal = testVal(attrs[ATTR_VAL_TOMORROW]);
  const twoVal = testVal(attrs[ATTR_VAL_IN_2_DAYS]);

  const today = ctx.today;
  const levels: DwdLevelDay[] = [
    { date: today, level: todayVal },
    { date: new Date(today.getTime() + 86400000), level: tomVal },
    { date: new Date(today.getTime() + 2 * 86400000), level: twoVal },
  ];
  padDays(levels, ctx.days_to_show, (idx) => ({
    date: new Date(today.getTime() + idx * 86400000),
    level: -1,
  }));

  dict.days = [];
  // Build dict.days[].
  levels.forEach((entry, idx) => {
    if (entry.level !== null && entry.level >= 0) {
      const diff = Math.round((entry.date.getTime() - today.getTime()) / 86400000);
      const dayLabel = buildDayLabel(entry.date, diff, {
        daysRelative: ctx.daysRelative,
        dayAbbrev: ctx.dayAbbrev,
        daysUppercase: ctx.daysUppercase,
        userDays: ctx.userDays,
        lang: ctx.lang,
        locale: ctx.locale,
      });

      const sensorDesc =
        attrs[
          idx === 0
            ? ATTR_DESC_TODAY
            : idx === 1
              ? ATTR_DESC_TOMORROW
              : ATTR_DESC_IN_2_DAYS
        ] || "";

      const scaled = entry.level * DWD_LEVEL_MULTIPLIER;
      const lvlIndex = Math.min(Math.max(Math.round(scaled), 0), 6);
      const stateText =
        lvlIndex < 0 ? ctx.noInfoLabel : ctx.levelNames[lvlIndex] || sensorDesc;

      const dayObj: ForecastDay = {
        name: dict.allergenCapitalized,
        day: dayLabel,
        state: entry.level,
        display_state: scaled,
        state_text: stateText,
      };
      dict.days.push(dayObj);
    }
  });

  return dict;
}

export async function fetchForecast(
  hass: HomeAssistant,
  config: CardConfig,
): Promise<PollenSensor[]> {
  return runForecastScaffold(hass, config, {
    stub: stubConfigDWD,
    normalize: normalizeDWD,
    resolveEntityIds,
    buildDict: buildDwdDict,
    useStubDateLocale: true,
    warnPrefix: (allergen) => `DWD adapter error for allergen ${allergen}:`,
    onStart: (cfg, ctx) => {
      if (ctx.debug)
        console.debug("DWD adapter: start fetchForecast", {
          config: cfg,
          lang: ctx.lang,
        });
    },
    onDone: (sensors, ctx) => {
      if (ctx.debug) console.debug("DWD adapter complete sensors:", sensors);
    },
  });
}

/**
 * Autodetect descriptor. Detection matches the `pollenflug_<allergen>_<region>`
 * segment whether or not HA has prepended a device-name slug (#217).
 * `extractLocationSlug` returns the numeric region id, used by
 * deriveLocationForEntity for the card-picker suggestion.
 */
export const autodetect: AdapterAutodetect = {
  priority: 3,
  detectStates(
    _hass: HomeAssistant,
    ctx: AutodetectContext,
  ): AutodetectDetectResult {
    const ids = ctx.stateIds.filter(
      (id) => typeof id === "string" && DWD_ENTITY_ID_RE.test(id),
    );
    return { ids };
  },
  discover: discoverDwdSensors,
  extractLocationSlug: (entityId: string) =>
    entityId.match(DWD_ENTITY_ID_RE)?.[2] || null,
};
