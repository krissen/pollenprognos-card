// Shared adapter skeleton extracted from the hand-copied boilerplate in the
// per-integration adapters (pp, dwd, peu, ...). These are parameterized factory
// helpers, not classes, matching the module shape every adapter exports.
//
// The goal is to remove the identical resolveEntityIds 3-path cascade and the
// fetchForecast opening scaffold from each adapter WITHOUT changing behavior.
// The adapter-specific parts (path-3 template fallback, the per-allergen dict
// builder, level scaling) stay in the adapter as callbacks/parameters, so each
// integration keeps its quirks. See src/adapters/pp.ts and dwd.ts for the
// reference wrappers.

import type { HomeAssistant } from "../types/home-assistant.js";
import type { CardConfig, AdapterStubConfig } from "../types/config.js";
import type { PollenSensor } from "../types/sensor.js";
import type { DeviceDiscovery } from "../utils/adapter-helpers.js";
import {
  getLangAndLocale,
  mergePhrases,
  clampLevel,
  sortSensors,
  meetsThreshold,
  normalizeManualPrefix,
  resolveManualEntity,
  resolveLocationByKey,
  isConfigEntryId,
} from "../utils/adapter-helpers.js";
import { buildLevelNames } from "../utils/level-names.js";

// ---------------------------------------------------------------------------
// createEntityResolver: the resolveEntityIds 3-path cascade.
// ---------------------------------------------------------------------------

/**
 * Options for {@link createEntityResolver}. The uniform paths (1 manual, 2
 * discovery) are handled by the factory; the divergent path 3 (template
 * fallback) is supplied by the adapter as `templateFallback`.
 */
export interface EntityResolverOptions {
  /** Config field naming the location: "city" (pp), "region_id" (dwd), "location" (peu/...). */
  locationKey: string;
  /** Allergen -> raw key normalizer (normalize / normalizeDWD / identity). */
  normalize: (allergen: string) => string;
  /** Three-tier discovery for this integration. */
  discover: (hass: HomeAssistant, debug: boolean) => DeviceDiscovery;
  /** Slug extractor passed to resolveLocationByKey for backward-compatible config resolution. */
  slugExtractor: (entityId: string) => string | null | undefined;
  /** Short tag for debug log lines (e.g. "PP", "DWD"). */
  logTag: string;
  /**
   * Manual-mode slug hook. Maps the raw key to the slug used in the manual
   * entity lookup. Default: identity. (PEU maps allergy_risk -> allergy_risk_hourly
   * in non-daily modes.)
   */
  manualSlug?: (rawKey: string, cfg: CardConfig) => string;
  /**
   * Discovery-lookup-key hook. Maps the raw key to the key used to read
   * location.entities. Default: identity. (PEU mode mapping.)
   */
  discoveryLookupKey?: (rawKey: string, cfg: CardConfig) => string;
  /**
   * When true, and the configured location is a stale config-entry ULID that
   * no longer matches any discovered location, retry discovery with autodetect
   * ("") semantics instead of going empty. (DWD only, #stale-config recovery.)
   */
  recoverStaleConfig?: boolean;
  /**
   * Path 3: adapter-specific template/regex fallback used when discovery yields
   * nothing (legacy installs). Returns the full allergen-key -> entity-id map.
   */
  templateFallback: (args: {
    cfg: CardConfig;
    hass: HomeAssistant;
    debug: boolean;
    normalize: (allergen: string) => string;
  }) => Map<string, string>;
}

/**
 * Build a `resolveEntityIds(cfg, hass, debug)` function implementing the shared
 * three-path cascade: (1) manual mode, (2) device/registry/regex discovery,
 * (3) adapter-supplied template fallback. The returned map is allergen raw key
 * -> HA entity id.
 */
export function createEntityResolver(
  opts: EntityResolverOptions,
): (
  cfg: CardConfig,
  hass: HomeAssistant,
  debug?: boolean,
  precomputedDiscovery?: DeviceDiscovery | null,
) => Map<string, string> {
  const {
    locationKey,
    normalize,
    discover,
    slugExtractor,
    logTag,
    manualSlug,
    discoveryLookupKey,
    recoverStaleConfig,
    templateFallback,
  } = opts;

  return function resolveEntityIds(
    cfg: CardConfig,
    hass: HomeAssistant,
    debug = false,
    // Discovery the caller has already run for this same hass. Threaded through
    // so an adapter that needs the discovered entities for its own purposes
    // (PEU's canonical fallback) scans the registry once per resolve, not twice.
    precomputedDiscovery: DeviceDiscovery | null = null,
  ): Map<string, string> {
    const map = new Map<string, string>();
    const locationVal = cfg[locationKey] as string | undefined;
    const allergens = (cfg.allergens as string[] | undefined) || [];

    // --- Path 1: Manual mode ---
    if (locationVal === "manual") {
      const prefix = normalizeManualPrefix(cfg.entity_prefix);
      for (const allergen of allergens) {
        const rawKey = normalize(allergen);
        const slug = manualSlug ? manualSlug(rawKey, cfg) : rawKey;
        const sensorId = resolveManualEntity(
          hass,
          prefix,
          slug,
          (cfg.entity_suffix as string) || "",
        );
        if (!sensorId) continue;
        if (debug) {
          console.debug(
            `[${logTag}:resolveEntityIds] manual allergen: '${allergen}', slug: '${slug}', sensorId: '${sensorId}'`,
          );
        }
        map.set(rawKey, sensorId);
      }
      return map;
    }

    // --- Path 2: Device-based discovery (tier 1/2) or regex fallback (tier 3) ---
    const discovery = precomputedDiscovery ?? discover(hass, debug);

    if (discovery.locations.size > 0) {
      let match = resolveLocationByKey(discovery, locationVal, {
        slugExtractor,
      });

      if (!match && recoverStaleConfig && isConfigEntryId(locationVal)) {
        match = resolveLocationByKey(discovery, "");
      }

      if (match) {
        const [, location] = match;
        for (const allergen of allergens) {
          const rawKey = normalize(allergen);
          const lookupKey = discoveryLookupKey
            ? discoveryLookupKey(rawKey, cfg)
            : rawKey;
          const eid = location.entities.get(lookupKey);
          if (!eid) continue;
          if (debug) {
            console.debug(
              `[${logTag}:resolveEntityIds] discovery allergen: '${allergen}', lookupKey: '${lookupKey}', sensorId: '${eid}'`,
            );
          }
          map.set(rawKey, eid);
        }

        if (map.size > 0) return map;
      }
    }

    // --- Path 3: Template fallback (legacy / when discovery yields nothing) ---
    return templateFallback({ cfg, hass, debug, normalize });
  };
}

// ---------------------------------------------------------------------------
// runForecastScaffold: the fetchForecast opening block + per-allergen loop.
// ---------------------------------------------------------------------------

/**
 * The derived context the scaffold hands to the per-allergen dict builder. It
 * bundles the locale/phrase/day-flag values the opening block computes once, so
 * the builder does not recompute them.
 */
export interface ScaffoldContext {
  lang: string;
  locale: string;
  daysRelative: boolean;
  dayAbbrev: boolean;
  daysUppercase: boolean;
  fullPhrases: Record<string, string>;
  shortPhrases: Record<string, string>;
  userLevels: unknown[];
  userDays: Record<string, string>;
  noInfoLabel: string;
  levelNames: string[];
  today: Date;
  days_to_show: number;
  pollen_threshold: number;
  debug: boolean;
}

/** Arguments passed to the per-allergen dict builder. */
export interface BuildDictArgs {
  allergen: string;
  rawKey: string;
  sensorId: string;
  sensor: HomeAssistant["states"][string] | undefined;
  entityMap: Map<string, string>;
  hass: HomeAssistant;
  config: CardConfig;
  ctx: ScaffoldContext;
}

/** Options for {@link runForecastScaffold}. */
export interface ForecastScaffoldOptions {
  /** The adapter's stubConfig (for days_to_show / pollen_threshold / date_locale defaults). */
  stub: AdapterStubConfig;
  /** Allergen -> raw key normalizer. */
  normalize: (allergen: string) => string;
  /** The adapter's own resolveEntityIds. */
  resolveEntityIds: (
    cfg: CardConfig,
    hass: HomeAssistant,
    debug?: boolean,
  ) => Map<string, string>;
  /**
   * Per-allergen dict builder. Returns the sensor dict, or null to skip the
   * allergen. Runs inside a try/catch; throwing is caught and logged with
   * `warnPrefix`.
   */
  buildDict: (args: BuildDictArgs) => PollenSensor | null;
  /** console.warn prefix used in the per-allergen catch. */
  warnPrefix: (allergen: string) => string;
  /**
   * Only emit the per-allergen catch warning when config.debug is set. Some
   * adapters (peu, silam) gate their error log behind debug rather than
   * always warning like pp/dwd; set this to preserve that. Default: false
   * (always warn).
   */
  warnOnlyWhenDebug?: boolean;
  /**
   * Level-name builder. Default: shared buildLevelNames(userLevels, lang).
   * (PEU/PLU pass scale-specific builders.)
   */
  levelNamesBuilder?: (userLevels: unknown[], lang: string) => string[];
  /** Pass stub.date_locale as the 3rd arg to getLangAndLocale (DWD). */
  useStubDateLocale?: boolean;
  /** Inclusion predicate. Default: meetsThreshold(dict.days, pollen_threshold). */
  shouldInclude?: (dict: PollenSensor, pollen_threshold: number) => boolean;
  /** Optional debug hook fired after the opening block (before the loop). */
  onStart?: (config: CardConfig, ctx: ScaffoldContext) => void;
  /** Optional debug hook fired after sorting (before return). */
  onDone?: (sensors: PollenSensor[], ctx: ScaffoldContext) => void;
}

/**
 * Run the shared fetchForecast skeleton: compute locale/phrases/level-names and
 * the days_to_show/pollen_threshold defaults, resolve the entity map, iterate
 * config.allergens calling `buildDict` per allergen inside a try/catch, filter
 * by threshold, then sortSensors. Semantics (including the catch's warn format
 * via `warnPrefix`) are preserved exactly.
 */
export function runForecastScaffold(
  hass: HomeAssistant,
  config: CardConfig,
  opts: ForecastScaffoldOptions,
): PollenSensor[] {
  const {
    stub,
    normalize,
    resolveEntityIds,
    buildDict,
    warnPrefix,
    levelNamesBuilder,
    useStubDateLocale,
    shouldInclude,
    onStart,
    onDone,
    warnOnlyWhenDebug,
  } = opts;

  const debug = Boolean(config.debug);

  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } =
    getLangAndLocale(
      hass,
      config,
      useStubDateLocale ? (stub.date_locale as string | undefined) : undefined,
    );

  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } =
    mergePhrases(config, lang);
  const levelNames = levelNamesBuilder
    ? levelNamesBuilder(userLevels, lang)
    : buildLevelNames(userLevels as Array<string | null | undefined>, lang);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days_to_show =
    (config.days_to_show as number | undefined) ??
    (stub.days_to_show as number);
  const pollen_threshold =
    (config.pollen_threshold as number | undefined) ??
    (stub.pollen_threshold as number);

  const ctx: ScaffoldContext = {
    lang,
    locale,
    daysRelative,
    dayAbbrev,
    daysUppercase,
    fullPhrases,
    shortPhrases,
    userLevels,
    userDays,
    noInfoLabel,
    levelNames,
    today,
    days_to_show,
    pollen_threshold,
    debug,
  };

  onStart?.(config, ctx);

  const entityMap = resolveEntityIds(config, hass, debug);
  const sensors: PollenSensor[] = [];
  const include = shouldInclude ?? ((dict, t) => meetsThreshold(dict.days, t));

  const allergens = (config.allergens as string[] | undefined) || [];
  for (const allergen of allergens) {
    try {
      const rawKey = normalize(allergen);
      const sensorId = entityMap.get(rawKey);
      if (!sensorId) continue;
      const sensor = hass.states[sensorId];
      const dict = buildDict({
        allergen,
        rawKey,
        sensorId,
        sensor,
        entityMap,
        hass,
        config,
        ctx,
      });
      if (dict && include(dict, pollen_threshold)) sensors.push(dict);
    } catch (e) {
      if (!warnOnlyWhenDebug || debug) console.warn(warnPrefix(allergen), e);
    }
  }

  sortSensors(sensors, config.sort as string);

  onDone?.(sensors, ctx);
  return sensors;
}

// ---------------------------------------------------------------------------
// Padding helpers.
// ---------------------------------------------------------------------------

/**
 * Generic day-padding: append `makePlaceholder(index)` to `items` until it
 * reaches `daysToShow` entries. Used by DWD, which pads its fixed
 * today/tomorrow/in-2-days level array with `{ date, level: -1 }` placeholders.
 * Mutates and returns `items` (matching the original in-place `while` loop).
 *
 * @param items         The level/day array to pad in place.
 * @param daysToShow    Target length.
 * @param makePlaceholder Builds the placeholder for the given (post-pad) index.
 */
export function padDays<T>(
  items: T[],
  daysToShow: number,
  makePlaceholder: (index: number) => T,
): T[] {
  while (items.length < daysToShow) {
    items.push(makePlaceholder(items.length));
  }
  return items;
}

/**
 * Date-string padding for the "forecast keyed by date" adapters (PP, PEU). Given
 * the `upcoming` sorted date strings, return exactly `daysToShow` date strings:
 * either the first N of `upcoming`, or all of `upcoming` plus forward-filled
 * `YYYY-MM-DDT00:00:00` strings advancing one day at a time from the last real
 * date (or `today` when `upcoming` is empty).
 *
 * @param upcoming     Sorted date strings that are >= today.
 * @param daysToShow   Target count.
 * @param today        Local-midnight anchor for the empty-upcoming case.
 * @param parseDate    Parses a date string to a Date (pp: parseLocalDate; peu: new Date).
 */
export function padForecastDates(
  upcoming: string[],
  daysToShow: number,
  today: Date,
  parseDate: (s: string) => Date,
): string[] {
  if (upcoming.length >= daysToShow) {
    return upcoming.slice(0, daysToShow);
  }
  const forecastDates = upcoming.slice();
  let lastDate =
    upcoming.length > 0 ? parseDate(upcoming[upcoming.length - 1]!) : today;
  while (forecastDates.length < daysToShow) {
    lastDate = new Date(lastDate.getTime() + 86400000);
    const yyyy = lastDate.getFullYear();
    const mm = String(lastDate.getMonth() + 1).padStart(2, "0");
    const dd = String(lastDate.getDate()).padStart(2, "0");
    forecastDates.push(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  return forecastDates;
}

// ---------------------------------------------------------------------------
// Level-scaling tables.
//
// Each integration reports pollen on its own native scale and stretches it onto
// the card's shared seven-bucket (0-6) level-name palette differently. These
// tables are the source of that per-adapter drift. They are deliberately kept
// SEPARATE (not unified): the drift is intentional and predates this extraction.
// Each is owned by exactly one adapter; do not "fix" the divergence here.
// ---------------------------------------------------------------------------

/**
 * SILAM allergy_risk spread. Maps a 0-4 categorical index (very_low..very_high)
 * onto the 0-6 palette positions [No pollen / Low / Moderate / High / Very high].
 * Owner: src/adapters/silam.js (indexToLevel). PEU used the same [0,1,3,5,6]
 * positions historically for its legacy 7-phrase backward-compat extraction.
 */
export const SILAM_LEVEL_SPREAD_0_6: readonly number[] = [0, 1, 3, 5, 6];

/**
 * PEU legacy-phrase extraction indices. A length-7 user `phrases.levels` array
 * (from configs written before native 5-level locale strings existed) is
 * down-sampled to 5 entries by pulling positions [0,1,3,5,6]. Owner:
 * src/adapters/peu.js.
 */
export const PEU_LEGACY_PHRASE_INDICES: readonly number[] = [0, 1, 3, 5, 6];

/**
 * PLU level-name indices. PLU is a 0-3 (four-level) integration; its four level
 * names are pulled from palette positions [0,1,3,5] of the seven-level defaults.
 * Owner: src/adapters/plu.js.
 */
export const PLU_LEVEL_INDICES: readonly number[] = [0, 1, 3, 5];

/**
 * Scale a Google (0-5 UPI) level onto the 0-6 display palette. Negative
 * sentinels pass through; `level < 2` floors and `level >= 2` ceils
 * `level*6/5`, giving 0->0, 1->1, 2->3, 3->4, 4->5, 5->6. Owner:
 * src/adapters/gp/ and src/adapters/gpl/ (identical formula in both).
 */
export function scaleUpi0_5To0_6(level: number): number {
  if (level < 0) return level;
  if (level < 2) return Math.floor((level * 6) / 5);
  return Math.ceil((level * 6) / 5);
}

/**
 * DWD ring/level scale: DWD reports a coarse 0-3 index and doubles it to fill
 * the 0-6 palette (`level * 2`). Owner: src/adapters/dwd.js. Exposed as a named
 * helper so the adapter's inline `entry.level * 2` reads intentionally.
 */
export const DWD_LEVEL_MULTIPLIER = 2;

/** Re-export the shared level clamp so adapters can build their testVal locally. */
export { clampLevel };
