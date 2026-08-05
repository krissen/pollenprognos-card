import type { HomeAssistant } from "../types/home-assistant.js";
import type { CardConfig, AdapterStubConfig } from "../types/config.js";
import type { PollenSensor, ForecastDay } from "../types/sensor.js";
import type {
  AdapterAutodetect,
  AutodetectContext,
  AutodetectDetectResult,
} from "../types/adapter.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNamesForScale } from "../utils/level-names.js";
import { slugify } from "../utils/slugify.js";
import { toCanonicalAllergenKey } from "../constants.js";
import {
  buildDayLabel,
  clampLevel,
  resolveAllergenNames,
  discoverEntitiesByDevice,
  isConfigEntryId,
  normalizeManualPrefix,
  resolveLocationByKey,
  type DeviceDiscovery,
} from "../utils/adapter-helpers.js";
import {
  createEntityResolver,
  runForecastScaffold,
  padForecastDates,
  PEU_LEGACY_PHRASE_INDICES,
  type BuildDictArgs,
} from "./base.js";

// Skapa stubConfigPEU – allergener enligt din sensor.py, i engelsk slugform!
export const stubConfigPEU: AdapterStubConfig = {
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
    "dock_sorrel",
    "elm",
    "grasses",
    "hazel",
    "linden",
    "fungal_spores",
    "mugwort",
    "nettle_family",
    "oak",
    "olive",
    "plane_tree",
    "plantain",
    "ragweed",
    "rye",
    "sweet_chestnut",
    "tree_of_heaven",
    "willow",
  ],
  minimal: false,
  minimal_gap: 35,
  mode: "daily",
  background_color: "",
  icon_size: 48,
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
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

// All possible allergens for the PEU integration
export const PEU_ALLERGENS = [
  "allergy_risk",
  ...(stubConfigPEU.allergens as string[]),
];

const PEU_PREFIX = "sensor.polleninformation_";

/**
 * Hourly-mode step map. Each PEU display mode slices the hourly forecast array
 * at a fixed stride (e.g. hourly_third takes every third entry). twice_daily
 * takes every 12th (morning/evening columns). Unknown modes fall back to 1.
 */
const PEU_STEP_MAP: Record<string, number> = {
  hourly: 1,
  hourly_second: 2,
  hourly_third: 3,
  hourly_fourth: 4,
  hourly_sixth: 6,
  hourly_eighth: 8,
  twice_daily: 12,
};

// PEU allergen keys are already slugs (the integration exposes English slugs),
// so the shared scaffold's normalize step is identity here.
const identity = (allergen: string): string => allergen;

/** Read the effective display mode, defaulting to the stub's "daily". */
function peuMode(cfg: CardConfig): string {
  return (cfg.mode as string) || (stubConfigPEU.mode as string);
}

/**
 * Classify a PEU entity ID using a whitelist of known allergen keys.
 *
 * Probes the longest suffix first to avoid greedy-split collisions when
 * allergen names contain underscores (e.g. "allergy_risk_hourly" must not
 * be classified as "allergy_risk" with an extra "_hourly" location suffix).
 *
 * Returns the allergen key string, or null if the entity ID does not match
 * any known PEU allergen pattern.
 */
// Precomputed longest-first whitelist. Sorting once at module load avoids
// reallocating and re-sorting on every classifier invocation during discovery.
const PEU_ALLERGEN_SUFFIXES_LONGEST_FIRST = [
  ...PEU_ALLERGENS,
  "allergy_risk_hourly",
].sort((a, b) => b.length - a.length);

function classifyPeuEntity(eid: string): string | null {
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
 */
function extractPeuLocationSlug(
  eid: string,
  allergenKey: string,
): string | null {
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
 */
export function extractPeuLocationSlugFromEntityId(eid: string): string | null {
  const allergen = classifyPeuEntity(eid);
  if (!allergen) return null;
  return extractPeuLocationSlug(eid, allergen);
}

/**
 * Prettify a PEU location slug for display.
 * "wien" -> "Wien", "new_york" -> "New_york"
 *
 * Returns null when no slug can be extracted.
 */
function extractPeuLocationLabel(eid: string): string | null {
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
 */
export function discoverPeuSensors(
  hass: HomeAssistant,
  debug = false,
): DeviceDiscovery {
  if (!hass) return { locations: new Map(), tierUsed: 0 };

  const { locations, tierUsed } = discoverEntitiesByDevice(hass, {
    platform: ["polleninformation"],
    /**
     * Strict classifier: use the whitelist to extract the allergen key.
     * Returns null for entity IDs that do not match any known allergen.
     */
    classify: (eid: string) => classifyPeuEntity(eid),
    classifyRelaxed: (eid: string) => classifyPeuEntity(eid),
    /**
     * isRelevant: quick pre-filter before classify runs.
     */
    isRelevant: (eid: string) => eid.startsWith(PEU_PREFIX),
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
        if (paren?.[1]) return paren[1].trim();
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

function detectLocation(cfg: CardConfig, hass: HomeAssistant): string {
  if (cfg.location === "manual") return "";
  // Treat a config_entry_id as autodetect: slugify() would otherwise produce
  // a non-empty locationSlug from the ULID, blocking the entity-id scan below
  // when tier 1/2 discovery has already failed (e.g. unknown platform slug).
  const locCfg = isConfigEntryId(cfg.location) ? "" : (cfg.location as string);
  let locationSlug = slugify(locCfg || "");
  if (!locationSlug) {
    const peuStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.polleninformation_"),
    );
    if (peuStates.length) {
      // Strip the allergen as a whole tail rather than splitting on the last
      // underscore: a greedy `(.+)_[^_]+$` reads
      // sensor.polleninformation_wien_sweet_chestnut as location "wien_sweet".
      // Known allergens come from the whitelist; the configured allergens are
      // tried too so a slug upstream ships before we do still resolves.
      const configured = ((cfg.allergens as string[] | undefined) || [])
        .slice()
        .sort((a, b) => b.length - a.length);
      const known = peuStates
        .map(
          (id) =>
            extractPeuLocationSlugFromEntityId(id) ??
            configured
              .map((allergen) => extractPeuLocationSlug(id, allergen))
              .find((slug): slug is string => Boolean(slug)),
        )
        .find((slug): slug is string => Boolean(slug));
      if (known) {
        locationSlug = known;
      } else {
        const match = peuStates[0]!.match(
          /^sensor\.polleninformation_(.+)_[^_]+$/,
        );
        locationSlug = match?.[1] ?? "";
      }
    }
  }
  return locationSlug;
}

/**
 * Path 3 template fallback: build the allergen -> entity map from the legacy
 * `sensor.polleninformation_{location}_{allergen}` naming when discovery yields
 * nothing. In non-daily modes, allergy_risk maps to the hourly variant. Each
 * allergen is resolved by direct id or a single-candidate scan.
 */
function peuTemplateFallback({
  cfg,
  hass,
  debug,
}: {
  cfg: CardConfig;
  hass: HomeAssistant;
  debug: boolean;
}): Map<string, string> {
  const map = new Map<string, string>();
  const mode = peuMode(cfg);
  const locationSlug = detectLocation(cfg, hass);
  const peuStates = Object.keys(hass.states).filter((id) =>
    id.startsWith(PEU_PREFIX),
  );

  for (const allergen of (cfg.allergens as string[] | undefined) || []) {
    const allergenSlug = allergen;
    let sensorId: string | null;
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
      // Match the allergen as a whole tail rather than splitting on a greedy
      // regex: `(.+)_(.+)` reads sensor.polleninformation_wien_sweet_chestnut
      // as location "wien_sweet" + allergen "chestnut", so every allergen
      // containing an underscore (sweet_chestnut, tree_of_heaven,
      // cypress_family, allergy_risk_hourly) failed this scan.
      const wanted =
        mode !== "daily" && allergenSlug === "allergy_risk"
          ? "allergy_risk_hourly"
          : allergenSlug;
      const cands = peuStates.filter((id) => {
        const loc = extractPeuLocationSlug(id, wanted);
        if (loc === null) return false;
        return !locationSlug || loc === locationSlug;
      });
      if (cands.length === 1) sensorId = cands[0]!;
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

// Mode mapping: in non-daily modes, allergy_risk resolves to the hourly variant
// sensor. Shared by the manual-mode slug hook and the discovery-lookup hook so
// both paths agree with the template fallback above.
const peuModeSlug = (rawKey: string, cfg: CardConfig): string =>
  peuMode(cfg) !== "daily" && rawKey === "allergy_risk"
    ? "allergy_risk_hourly"
    : rawKey;

const resolvePeuEntityIds = createEntityResolver({
  locationKey: "location",
  normalize: identity,
  discover: discoverPeuSensors,
  slugExtractor: extractPeuLocationSlugFromEntityId,
  logTag: "PEU",
  manualSlug: peuModeSlug,
  discoveryLookupKey: peuModeSlug,
  templateFallback: peuTemplateFallback,
});

/**
 * Every entity the configured location can offer, keyed by its allergen slug.
 * Mirrors whichever path the resolver itself used: the manual naming scheme,
 * the discovered location, or the legacy `{location}_{allergen}` template.
 *
 * `discovery` is the result the literal pass already computed (null in manual
 * mode, where no discovery runs), so building the pool costs no second scan.
 */
function peuEntityPool(
  cfg: CardConfig,
  hass: HomeAssistant,
  discovery: DeviceDiscovery | null,
): Map<string, string> {
  const pool = new Map<string, string>();

  if (cfg.location === "manual") {
    const prefix = normalizeManualPrefix(cfg.entity_prefix);
    const suffix = (cfg.entity_suffix as string) || "";
    const base = `sensor.${prefix}`;
    for (const eid of Object.keys(hass.states)) {
      if (!eid.startsWith(base) || !eid.endsWith(suffix)) continue;
      const slug = eid.slice(base.length, eid.length - suffix.length);
      if (slug) pool.set(slug, eid);
    }
    return pool;
  }

  const match = discovery
    ? resolveLocationByKey(discovery, cfg.location as string, {
        slugExtractor: extractPeuLocationSlugFromEntityId,
      })
    : null;
  if (match) return match[1].entities;

  const locationSlug = detectLocation(cfg, hass);
  for (const eid of Object.keys(hass.states)) {
    const allergen = classifyPeuEntity(eid);
    if (!allergen) continue;
    if (locationSlug && extractPeuLocationSlug(eid, allergen) !== locationSlug) {
      continue;
    }
    pool.set(allergen, eid);
  }
  return pool;
}

/**
 * Resolve configured allergen keys to entity IDs.
 *
 * PEU keys are used verbatim as entity-ID suffixes, so a config naming an
 * allergen by any other spelling than the integration's current one resolves to
 * nothing and the row disappears without a word. That happens to every config
 * written before polleninformation 0.5.3 renamed Tilia from "lime" to "linden",
 * and to anyone who picked the canonical key ("sorrel") over the upstream slug
 * ("dock_sorrel").
 *
 * So: after the literal pass, retry the unresolved keys through
 * toCanonicalAllergenKey and match them against the location's entities
 * canonicalized the same way. A literal match always wins, and entities already
 * claimed are skipped, so having both spellings in one config yields one row.
 *
 * Both passes share one discovery result: it is computed here and threaded into
 * the literal pass, so a config that triggers the fallback still scans the
 * registry once per resolve.
 */
export function resolveEntityIds(
  cfg: CardConfig,
  hass: HomeAssistant,
  debug = false,
  precomputedDiscovery: DeviceDiscovery | null = null,
): Map<string, string> {
  // Manual mode resolves by entity naming and never looks at discovery.
  const discovery =
    !hass || cfg.location === "manual"
      ? null
      : (precomputedDiscovery ?? discoverPeuSensors(hass, debug));

  const map = resolvePeuEntityIds(cfg, hass, debug, discovery);
  const allergens = (cfg.allergens as string[] | undefined) || [];
  const unresolved = allergens.filter((allergen) => !map.has(allergen));
  if (unresolved.length === 0 || !hass) return map;

  const pool = peuEntityPool(cfg, hass, discovery);
  const claimed = new Set(map.values());

  for (const allergen of unresolved) {
    const wanted = toCanonicalAllergenKey(peuModeSlug(allergen, cfg));
    for (const [slug, eid] of pool) {
      if (claimed.has(eid)) continue;
      if (toCanonicalAllergenKey(slug) !== wanted) continue;
      if (debug) {
        console.debug(
          `[PEU:resolveEntityIds] canonical fallback allergen: '${allergen}', canonical: '${wanted}', sensorId: '${eid}'`,
        );
      }
      map.set(allergen, eid);
      claimed.add(eid);
      break;
    }
  }

  return map;
}

// PEU is natively a five-level integration; clamp raw states to the 0-4 lookup
// range. -1 marks a missing/invalid reading (the day loop then drops it).
const testVal = (v: unknown): number => clampLevel(v, 4, -1);

// Clamp a native-scale level value to an integer 0-4 lookup index.
// Rounds first so float inputs (e.g. raw.level = 2.7 in hourly forecast
// entries) still bucket into a valid severity label instead of returning
// a fractional index that would resolve to undefined and fall back to
// noInfoLabel. Returns -1 for non-finite inputs (NaN / null / undefined)
// so callers can show the no-info label. Negative finite values clamp to
// 0, matching the legacy behavior where indexToLevel(-1) resolved to
// scale[0] = 0.
const lookupIndex = (level: number): number =>
  Number.isFinite(level) ? Math.max(0, Math.min(Math.round(level), 4)) : -1;

/**
 * Extract the raw risk value (allergy_risk only) from a forecast entry. The raw
 * risk may exceed the normalized 0-4 scale; the user opts into displaying it via
 * numeric_value_raw. Guards null/"" so a missing field stays null (Number(null)
 * is 0) and the display falls back to the level. A real 0 is kept.
 */
function extractRawValue(
  allergenSlug: string,
  src: unknown,
): number | null {
  if (allergenSlug !== "allergy_risk") return null;
  if (src == null || src === "") return null;
  const r = Number(src);
  return Number.isFinite(r) ? r : null;
}

function buildPeuDict({
  rawKey,
  sensorId,
  sensor,
  config,
  ctx,
}: BuildDictArgs): PollenSensor {
  // allergenSlug is already a slug in PEU (identity normalize); the original
  // code called this variable allergenSlug.
  const allergenSlug = rawKey;
  // Preserve the original key-insertion order (days first, then allergen
  // fields, entity_id, then stale/staleSince) so the serialized sensor
  // dict stays byte-identical.
  const dict = { days: [] as ForecastDay[] } as PollenSensor;
  dict.allergenReplaced = allergenSlug;

  // Allergen name resolution
  const { allergenCapitalized, allergenShort } = resolveAllergenNames(
    allergenSlug,
    {
      fullPhrases: ctx.fullPhrases,
      shortPhrases: ctx.shortPhrases,
      abbreviated: config.allergens_abbreviated as boolean,
      lang: ctx.lang,
    },
  );
  dict.allergenCapitalized = allergenCapitalized;
  dict.allergenShort = allergenShort;

  dict.entity_id = sensorId;

  const attrs = sensor?.attributes;
  const isStale = attrs?.data_stale === true;
  const hasForecast =
    Array.isArray(attrs?.forecast) && attrs.forecast.length > 0;

  // TODO(#259-normalize): the stale/staleSince fields are a PEU-only contract
  // quirk. A stale sensor is emitted with an empty days array and always kept
  // (see shouldInclude below), bypassing the pollen threshold.
  if (isStale || !hasForecast) {
    dict.stale = true;
    dict.staleSince = (attrs?.stale_since as string) || null;
    dict.days = [];
    return dict;
  }

  const rawForecast = attrs.forecast as Array<Record<string, unknown>>;
  const mode = peuMode(config);

  if (mode !== "daily" && allergenSlug === "allergy_risk") {
    const step = PEU_STEP_MAP[mode] || 1;
    const maxItems = Math.min(
      Math.floor(rawForecast.length / step),
      ctx.days_to_show,
    );
    for (let i = 0; i < maxItems; ++i) {
      const entry = rawForecast[i * step] || {};
      let label: string;
      let icon: string | null = null;
      const d = entry.time
        ? new Date(entry.time as string)
        : entry.datetime
          ? new Date(entry.datetime as string)
          : new Date(ctx.today.getTime() + i * step * 3600000);
      if (mode === "twice_daily") {
        label = d
          .toLocaleDateString(ctx.locale, { weekday: "short" })
          .replace(/^./, (c) => c.toUpperCase());
        if (ctx.daysUppercase) label = label.toUpperCase();
        icon =
          i % 2 === 0 ? "mdi:weather-sunset-up" : "mdi:weather-sunset-down";
      } else {
        label =
          d.toLocaleTimeString(ctx.locale, {
            hour: "2-digit",
            minute: "2-digit",
          }) || "";
      }
      // Use the normalized value for state so icons and circles are correct.
      const state = Number(entry.numeric_state ?? entry.level ?? -1);
      // display_state shows the normalized level. The raw risk value is kept
      // in raw_value (allergy_risk only) so the user can opt into showing it
      // via numeric_value_raw; resolveNumericValue picks level or raw.
      const rawValue = extractRawValue(
        allergenSlug,
        entry.numeric_state_raw ?? entry.level_raw,
      );
      const levelIdx = lookupIndex(state);
      const dayObj: ForecastDay = {
        name: dict.allergenCapitalized,
        day: label,
        icon: icon as string,
        state,
        display_state: state,
        raw_value: rawValue,
        state_text:
          levelIdx < 0 ? ctx.noInfoLabel : ctx.levelNames[levelIdx] || ctx.noInfoLabel,
      };
      dict.days.push(dayObj);
    }
    return dict;
  }

  // Daily (and per-allergen non-daily) path: index forecast by date, take the
  // upcoming window, pad out to days_to_show.
  const forecastMap = rawForecast.reduce(
    (o: Record<string, Record<string, unknown>>, entry) => {
      const key = (entry.time || entry.datetime) as string;
      o[key] = entry;
      return o;
    },
    {},
  );

  // PEU forecast keys are full ISO datetime strings; keep the original
  // permissive new Date() parsing rather than the strict shared
  // parseLocalDate (which only accepts zero-padded YYYY-MM-DD).
  const parseDate = (s: string): Date => new Date(s);
  const rawDates = Object.keys(forecastMap).sort(
    (a, b) => parseDate(a).getTime() - parseDate(b).getTime(),
  );
  const upcoming = rawDates.filter(
    (d) => parseDate(d).getTime() >= ctx.today.getTime(),
  );

  const forecastDates = padForecastDates(
    upcoming,
    ctx.days_to_show,
    ctx.today,
    parseDate,
  );

  forecastDates.forEach((dateStr) => {
    const raw = forecastMap[dateStr] || {};
    // Normalized level is always used for rendering and sorting.
    const level = testVal(raw.level);
    const rawValue = extractRawValue(
      allergenSlug,
      raw.numeric_state_raw ?? raw.level_raw,
    );
    if (level !== null && level >= 0) {
      const d = parseDate(dateStr);
      const diff = Math.round((d.getTime() - ctx.today.getTime()) / 86400000);
      const label = buildDayLabel(d, diff, {
        daysRelative: ctx.daysRelative,
        dayAbbrev: ctx.dayAbbrev,
        daysUppercase: ctx.daysUppercase,
        userDays: ctx.userDays,
        lang: ctx.lang,
        locale: ctx.locale,
      });

      const levelIdx = lookupIndex(level);
      const dayObj: ForecastDay = {
        name: dict.allergenCapitalized,
        day: label,
        state: level,
        display_state: level,
        raw_value: rawValue,
        state_text:
          levelIdx < 0 ? ctx.noInfoLabel : ctx.levelNames[levelIdx] || ctx.noInfoLabel,
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
    stub: stubConfigPEU,
    normalize: identity,
    resolveEntityIds,
    buildDict: buildPeuDict,
    warnPrefix: (allergen) => `[PEU] Error for allergen ${allergen}:`,
    warnOnlyWhenDebug: true,
    // PEU is natively five-level (0-4: None/Low/Medium/High/Very High). Earlier
    // versions stretched native states onto the seven-bucket card.levels palette
    // via a [0,1,3,5,6] runtime spread. Now that card.levels5.0..4 exists in
    // every locale (added in 3.2.0 for MSW), names are looked up at native
    // indices instead.
    // Backwards compat: legacy configs that supplied seven custom phrases
    // (phrases.levels length 7) had their entries placed at indices 0,1,3,5,6
    // of the seven-bucket array under the spread. Extracting those positions
    // (PEU_LEGACY_PHRASE_INDICES) preserves the user-visible labels exactly.
    // TODO(#259-normalize): retire the length-7 remap once no legacy configs
    // carry seven-entry phrases.levels.
    levelNamesBuilder: (userLevels, lang) => {
      let normalizedUserLevels = userLevels as Array<
        string | null | undefined
      >;
      if (Array.isArray(userLevels) && userLevels.length === 7) {
        normalizedUserLevels = PEU_LEGACY_PHRASE_INDICES.map(
          (i) => userLevels[i] as string | null | undefined,
        );
      }
      return buildLevelNamesForScale(5, normalizedUserLevels, lang);
    },
    // Stale PEU sensors carry no days but must always be shown; otherwise apply
    // the standard threshold filter.
    shouldInclude: (dict, pollen_threshold) =>
      dict.stale === true ||
      pollen_threshold === 0 ||
      dict.days.some((d) => d.state >= pollen_threshold),
    onDone: (sensors, ctx) => {
      // Pin the allergy_risk / index aggregate to the top when configured.
      if (config.allergy_risk_top) {
        const idx = sensors.findIndex(
          (s) =>
            s.allergenReplaced === "allergy_risk" ||
            s.allergenReplaced === "index",
        );
        if (idx > 0) {
          const [special] = sensors.splice(idx, 1);
          sensors.unshift(special!);
        }
      }
      if (ctx.debug) console.debug("PEU.fetchForecast — done", sensors);
    },
  });
}

/**
 * Autodetect descriptor. Detection matches the `sensor.polleninformation_`
 * prefix. `extractLocationSlug` derives the location from the entity id, used
 * as the fallback when the integration's `location_slug` attribute is absent.
 */
export const autodetect: AdapterAutodetect = {
  priority: 2,
  detectStates(
    _hass: HomeAssistant,
    ctx: AutodetectContext,
  ): AutodetectDetectResult {
    const ids = ctx.stateIds.filter(
      (id) =>
        typeof id === "string" && id.startsWith("sensor.polleninformation_"),
    );
    return { ids };
  },
  discover: discoverPeuSensors,
  extractLocationSlug: extractPeuLocationSlugFromEntityId,
};
