// src/utils/adapter-helpers.ts
// Shared pure helpers used by multiple adapters.
import { t, detectLang } from "../i18n.js";
import { toCanonicalAllergenKey, ALLERGEN_TRANSLATION } from "../constants.js";
import { normalize, normalizeDWD } from "./normalize.js";
import type {
  HomeAssistant,
  HassEntity,
  DeviceRegistryEntry,
  EntityRegistryDisplayEntry,
} from "../types/home-assistant.js";
import type { PollenSensor, ForecastDay } from "../types/sensor.js";
import type { CardConfig } from "../types/config.js";
import type { AdapterModule, ForecastEvent } from "../types/adapter.js";

/** A user phrase-override map (config.phrases.full / .short): raw name -> text. */
type PhraseMap = Record<string, string> | null | undefined;

/**
 * One location discovered by {@link discoverEntitiesByDevice}: a display label,
 * an allergen-key -> entity-id map, and (when known) the backing device id.
 */
export interface DiscoveredLocation {
  label: string;
  entities: Map<string, string>;
  deviceId?: string;
}

/**
 * The return shape of {@link discoverEntitiesByDevice}: a per-location map plus
 * the primary tier that produced it (1 device-based, 2 entity-registry, 3
 * fallback, 0 nothing found). Consumed loosely by adapters and utils/silam.ts.
 */
export interface DeviceDiscovery {
  locations: Map<string, DiscoveredLocation>;
  tierUsed: 0 | 1 | 2 | 3;
}

/**
 * Per-entity context passed to the discovery callbacks (classify, resolveLabel,
 * resolveLocationKey, isRelevant, onCollision). `tier` reports which pass is
 * handling the entity; `state`/`entry`/`device` are the registry lookups for it.
 */
export interface DiscoveryContext {
  state: HassEntity | undefined;
  entry: EntityRegistryDisplayEntry | null | undefined;
  device: DeviceRegistryEntry | null | undefined;
  deviceId?: string | null;
  entityId: string;
  tier: 1 | 2 | 3;
  locationKey?: string;
}

/** Options accepted by {@link discoverEntitiesByDevice}. */
export interface DiscoverEntitiesOpts {
  platform?: string | string[];
  classify?: (entityId: string, ctx: DiscoveryContext) => string | null;
  classifyRelaxed?: (entityId: string, ctx: DiscoveryContext) => string | null;
  isRelevant?: (entityId: string, ctx: DiscoveryContext) => boolean;
  excludeEntry?: (
    entry: EntityRegistryDisplayEntry | null | undefined,
  ) => boolean;
  resolveLabel?: (ctx: DiscoveryContext) => string | null | undefined;
  resolveLocationKey?: (ctx: DiscoveryContext) => string;
  onCollision?: (
    ctx: DiscoveryContext,
    info: {
      existingKey: string;
      existingEntityId: string | undefined;
      locEntities: Map<string, string>;
    },
  ) => string | null;
  fallbackRegex?: RegExp | null;
  fallbackSelector?: (hass: HomeAssistant) => string[] | null | undefined;
  debug?: boolean;
  logTag?: string;
}

/** Fields returned by {@link mergePhrases}. */
export interface MergedPhrases {
  fullPhrases: Record<string, string>;
  shortPhrases: Record<string, string>;
  userLevels: unknown[];
  userDays: Record<string, string>;
  noInfoLabel: string;
}

/** Uppercase the first character of a string. */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Test if a value is a Home Assistant config_entry_id (ULID-format string,
 * 26 Crockford base32 characters). Crockford base32 excludes I, L, O, and U
 * to avoid ambiguity with 1/0 and offensive substrings, so this regex does
 * not allow those letters; because it uses the /i flag, that exclusion
 * applies to both uppercase and lowercase input.
 *
 * Used by adapters to distinguish between new-style config_entry_id location
 * keys and legacy slug configs.
 *
 * Defined here (rather than in silam.js) to avoid a circular dependency,
 * since silam.js also imports discoverEntitiesByDevice from this module.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isConfigEntryId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/i.test(value)
  );
}

/**
 * Derive a stable per-location key from a device registry entry.
 *
 * Default location grouping used to key on `device.config_entries[0]`, which
 * breaks for integrations using Home Assistant config subentries (one parent
 * config entry, one subentry per location, e.g. Pollen Levels v3 / issue #262):
 * every location's device belongs to the same parent entry, so all locations
 * collapse into one bucket and their allergens collide.
 *
 * The frontend's reduced `hass.entities` does not expose `config_subentry_id`,
 * but the full `hass.devices` does, via `config_entries_subentries`
 * ({ configEntryId: [subentryId | null, ...] }). When the device's primary
 * config entry carries a non-null subentry id, that subentry id (itself a ULID)
 * is the location key; otherwise we fall back to the (top-level) config entry
 * id, preserving legacy behavior exactly (legacy devices report `[null]`).
 *
 * @param {object|null|undefined} device - hass.devices entry.
 * @returns {string} location key, or "default" when no device/entry is present.
 */
export function deviceLocationKey(
  device: DeviceRegistryEntry | null | undefined,
): string {
  if (device === null || device === undefined) return "default";
  const entries = device.config_entries;
  const primary =
    device.primary_config_entry ||
    (Array.isArray(entries) && entries.length > 0 ? entries[0] : null);
  if (!primary) return "default";
  const subentries = device.config_entries_subentries;
  const subs =
    subentries !== null && subentries !== undefined
      ? subentries[primary]
      : undefined;
  if (Array.isArray(subs)) {
    const sub = subs.find((s) => s !== null && s !== undefined);
    if (sub) return sub; // subentry ULID -- one bucket per location
  }
  return primary; // legacy / top-level entry -- unchanged behavior
}

/**
 * Coerce a YAML-or-boolean config flag to a real boolean. YAML lets a value
 * arrive as the string "true"/"false", so a strict === true check would
 * silently ignore a quoted value. Mirrors the defensive-typeguard policy used
 * for other config flags.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function coerceBool(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Summary block (issue #222): pick which sensors the card renders, and in
 * what order, given the summary-block config. Pure so both the normal-mode and
 * minimal-mode render paths share one tested rule.
 *
 * - block off (default): return the sensors unchanged (today's behaviour; the
 *   aggregate keeps whatever position the adapter's *_top pinning gave it).
 * - block on: the aggregate (isSummary) is pinned first. By default only the
 *   aggregate is shown (the standalone overall-risk overview); when
 *   show_summary_row is on, the per-allergen detail sensors follow it.
 *
 * The aggregate renders through the ordinary row / minimal-icon path, so it is
 * visually identical to a normal entry, just first.
 *
 * @param {object[]} sensors - normalized sensor array from the adapter.
 * @param {object}   config  - card config.
 * @returns {object[]}
 */
export function selectDisplaySensors(
  sensors: PollenSensor[],
  config: CardConfig,
): PollenSensor[] {
  if (!Array.isArray(sensors)) return [];
  const summary = sensors.find((s) => s && s.isSummary) || null;
  if (!coerceBool(config?.show_summary_block) || !summary) return sensors;
  if (!coerceBool(config?.show_summary_row)) return [summary];
  return [summary, ...sensors.filter((s) => s !== summary)];
}

/**
 * Resolve a user-facing allergen config key to its sensor.
 *
 * Sensors carry the adapter-normalized slug in `allergenReplaced` (PP
 * "Björk" -> "bjork", DWD "gräser" -> "graeser", SILAM "index" ->
 * "allergy_risk"), while config keys (config.allergens, badge_single_allergen)
 * hold whatever the user/editor wrote. The config key is reduced to a canonical
 * allergen key via BOTH the generic slug normalization and DWD's umlaut/ß
 * expansion (ä->ae, ß->ss); the sensor side reduces via the generic
 * normalization (its value is already adapter-normalized). A match on either
 * canonical form resolves the sensor, so a key works regardless of the
 * integration's key style. Trying normalizeDWD as well matters for DWD keys
 * like "Beifuß", where generic normalize would drop the ß ("beifu") and miss
 * the "beifuss" sensor. A literal match on the raw `allergenReplaced` is tried
 * first, so an exact key always wins over a merely canonical-equal one.
 *
 * This is the single shared "config allergen key -> sensor" resolver. The badge
 * uses it for single mode today; the card can reuse it if it ever gains a
 * single-allergen display. Typeguarded so a non-string key (YAML can deliver a
 * number/null) or a sensor without a string allergenReplaced is skipped, never
 * thrown on.
 *
 * @param {object[]} sensors   - normalized sensor dicts.
 * @param {string}   configKey - the user-facing allergen key to resolve.
 * @returns {object|null} the matching sensor, or null.
 */
export function matchSensorByAllergenKey(
  sensors: PollenSensor[],
  configKey: unknown,
): PollenSensor | null {
  if (!Array.isArray(sensors) || typeof configKey !== "string" || !configKey) {
    return null;
  }
  // Literal match first: an exact allergenReplaced wins over a normalized one.
  const literal = sensors.find(
    (s) =>
      s &&
      typeof s.allergenReplaced === "string" &&
      s.allergenReplaced === configKey,
  );
  if (literal) return literal;
  // Canonical candidates for the config key, via both the generic slug
  // normalization and DWD's umlaut/ß expansion, so DWD keys resolve too.
  const wanted = new Set([
    toCanonicalAllergenKey(normalize(configKey)),
    toCanonicalAllergenKey(normalizeDWD(configKey)),
  ]);
  return (
    sensors.find(
      (s) =>
        s &&
        typeof s.allergenReplaced === "string" &&
        wanted.has(toCanonicalAllergenKey(normalize(s.allergenReplaced))),
    ) || null
  );
}

/**
 * Badge support (issue #235): pick which sensor(s) a compact badge renders,
 * given the badge content mode. A badge is tiny and typically shows ONE thing,
 * so this returns a short list (usually length 1) that the badge render path
 * maps to icon-in-ring visuals. Pure, so it can be unit-tested in isolation and
 * shared by the badge element and any future caller.
 *
 * Modes (config.badge_content), defaulting to "worst":
 * - "worst"     — the single per-allergen sensor with the highest current
 *                 (days[0]) level. The universal default: works for every adapter,
 *                 since no integration-specific aggregate is required.
 * - "aggregate" — the adapter's overall-risk sensor (isSummary, e.g. GPL/Atmo
 *                 allergy_risk). Falls back to "worst" for adapters that expose
 *                 no aggregate (PP/DWD/SILAM/PEU/MSW).
 * - "single"    — the one allergen named in config.badge_single_allergen.
 *                 Returns empty (no-data) if a named allergen is not present, so
 *                 the miss is visible; only falls back to "worst" when no
 *                 allergen was named.
 * - "row"       — all sensors, in their existing order, for a compact multi-ring
 *                 badge.
 *
 * No-data sensors (days[0].state < 0) rank below a real level 0 in the "worst"
 * comparison, so a badge prefers a sensor that actually has data.
 *
 * @param {object[]} sensors - normalized sensor array from the adapter.
 * @param {object}   config  - card/badge config.
 * @returns {object[]} sensors to render (length 0 when nothing is available).
 */
export function selectBadgeSensor(
  sensors: PollenSensor[],
  config: CardConfig,
): PollenSensor[] {
  if (!Array.isArray(sensors) || sensors.length === 0) return [];

  const mode =
    typeof config?.badge_content === "string" ? config.badge_content : "worst";

  const perAllergen = sensors.filter((s) => s && !s.isSummary);
  const summary = sensors.find((s) => s && s.isSummary) || null;

  // Highest-level per-allergen sensor. Falls back to the full list when every
  // sensor is a summary (so the aggregate can still surface as "worst").
  const worst = () => {
    const pool = perAllergen.length ? perAllergen : sensors;
    const best = pool.reduce<PollenSensor | null>((acc, s) => {
      if (!acc) return s;
      const lvl = Number(s?.days?.[0]?.state);
      const accLvl = Number(acc?.days?.[0]?.state);
      const safeLvl = Number.isNaN(lvl) ? -Infinity : lvl;
      const safeAcc = Number.isNaN(accLvl) ? -Infinity : accLvl;
      return safeLvl > safeAcc ? s : acc;
    }, null);
    return best ? [best] : [];
  };

  switch (mode) {
    case "aggregate":
      return summary ? [summary] : worst();
    case "single": {
      const key = config?.badge_single_allergen;
      const found = matchSensorByAllergenKey(sensors, key);
      if (found) return [found];
      // Explicitly named but absent: surface a visible miss (no-data) instead
      // of silently swapping in the worst other allergen. Fall back to worst()
      // only when no allergen was named (misconfigured single mode).
      return typeof key === "string" && key ? [] : worst();
    }
    case "row":
      return sensors;
    case "worst":
    default:
      return worst();
  }
}

/**
 * Single-mode badge pinning. When a badge names one allergen, make sure it is
 * fetched and survives the post-fetch filter, then disable the threshold so a
 * no-data / level-0 named allergen still reaches selectBadgeSensor instead of
 * being dropped.
 *
 * The fetch is narrowed to the one named allergen, resolved through the
 * adapter's STUB allergen set (passed in): pick the stub key(s) whose canonical
 * form matches the named key, so an adapter keyed by localized slugs fetches its
 * native sensor (pp "Björk" / dwd "Birke" for a canonical "birch") rather than a
 * bare canonical key it cannot resolve. Fall back to [key] when the stub has no
 * canonical match but the adapter resolves the key directly (e.g. gpl "birch",
 * which its stub omits). Resolving against the stub (not the possibly-custom
 * configured list) means a trimmed allergens list cannot hide the named
 * allergen, and matching canonically (not by exact string) avoids double-
 * fetching the same entity from a casing/diacritic variant. The threshold is set
 * to 0 so a level-0 / no-data named allergen still reaches selectBadgeSensor,
 * which resolves the name canonically; a genuine miss then surfaces as no-data
 * rather than the wrong allergen. Pure: returns the input unchanged for any
 * non-single / unnamed config, else a shallow-merged copy.
 *
 * @param {object} config - badge config (already typeguarded by _buildConfig).
 * @param {string[]} stubAllergens - the adapter's stub allergens (native slugs).
 * @returns {object} the config, or a shallow copy with allergens/threshold pinned.
 */
export function pinBadgeSingleAllergen(
  config: CardConfig,
  stubAllergens: string[] = [],
): CardConfig {
  if (config?.badge_content !== "single") return config;
  const key = config.badge_single_allergen;
  if (typeof key !== "string" || !key) return config;
  const base = Array.isArray(stubAllergens) ? stubAllergens : [];
  // Canonical forms of the named key, via both normalizers, mirroring how
  // matchSensorByAllergenKey later resolves it (so the match agrees with the
  // eventual lookup, and dwd umlaut/ß keys are matched too).
  const wanted = new Set([
    toCanonicalAllergenKey(normalize(key)),
    toCanonicalAllergenKey(normalizeDWD(key)),
  ]);
  const matches = base.filter((a) => {
    const s = String(a);
    return (
      wanted.has(toCanonicalAllergenKey(normalize(s))) ||
      wanted.has(toCanonicalAllergenKey(normalizeDWD(s)))
    );
  });
  const allergens = matches.length ? matches : [key];
  return { ...config, allergens, pollen_threshold: 0 };
}

/**
 * Ring level for a badge sensor's current day, preserving the no-data sentinel.
 * Returns the canonical `state` (a level >= 0) so the caller can scale it with
 * scaleRingLevel (DWD doubles it); a missing / null / NaN / non-numeric state
 * becomes -1 so the render path shows the no-data noise pattern instead of a
 * level-0 ring. The null/undefined guard is explicit because Number(null) is 0,
 * which would otherwise mask a no-data reading as a real level 0.
 *
 * `display_state` is consulted only as a no-data OVERRIDE: some adapters keep a
 * non-negative `state` but flag "no information" via `display_state: -1` (atmo
 * "Indisponible" maps raw 0 to state 0 / display_state -1; plu/gp/gpl do the
 * same for missing readings). A negative display_state therefore forces -1. It
 * is NOT used as the level itself, because for DWD `display_state` is already
 * the SCALED value and scaleRingLevel would double it again. Pure.
 *
 * @param {object|undefined} day - the representative day (sensor.days[0]), may be undefined.
 * @returns {number} the level (>= 0), or -1 when there is no usable reading.
 */
export function badgeRingLevel(day: ForecastDay | null | undefined): number {
  if (day == null) return -1;
  // No-data override: a negative display_state means "no information" even when
  // state is a non-negative placeholder (atmo unavailable = state 0).
  if (day.display_state != null && Number(day.display_state) < 0) return -1;
  if (day.state == null) return -1;
  const n = Number(day.state);
  return Number.isFinite(n) ? n : -1;
}

/**
 * True when at least one configured allergen has a valid current reading,
 * ignoring the threshold. Re-fetches at pollen_threshold 0 and checks for any
 * sensor whose days[0] resolves to a real level via badgeRingLevel (>= 0), so a
 * caller can tell genuine "no pollen" (data exists, all below threshold) from
 * "no usable data" (entities exist but no valid forecast) and show the
 * no_allergens image only for the former. Reusing badgeRingLevel keeps the
 * no-data rule identical to the render path: null/NaN state and the atmo-style
 * `display_state: -1` placeholder both count as no-data, not as level 0.
 * Defensive: returns false on any fetch error. forecastEvent is forwarded for
 * silam; other adapters ignore it.
 *
 * @param {object} adapter - the integration adapter (has fetchForecast).
 * @param {object} hass
 * @param {object} cfg - badge/card config.
 * @param {object|null} forecastEvent - silam forecast event, or null.
 * @returns {Promise<boolean>}
 */
export async function hasValidPollenData(
  adapter: AdapterModule,
  hass: HomeAssistant,
  cfg: CardConfig,
  forecastEvent: ForecastEvent | null = null,
): Promise<boolean> {
  try {
    const sensors = await adapter.fetchForecast(
      hass,
      { ...cfg, pollen_threshold: 0 },
      forecastEvent,
    );
    return (
      Array.isArray(sensors) &&
      sensors.some((s) => badgeRingLevel(s?.days?.[0]) >= 0)
    );
  } catch {
    return false;
  }
}

/**
 * Compute the number of day columns to render for a given sensor list and
 * config. Extracted from _updateSensorsAndColumns so that _renderNormalHtml
 * can recompute columns from the *displayed* row set rather than the full
 * unfiltered sensor list -- needed for standalone summary mode where
 * selectDisplaySensors returns only the aggregate (which has no future days)
 * while the detail sensors it hides may have several.
 *
 * Reproduces the logic in _updateSensorsAndColumns exactly:
 *   - MSW and IRM KMI are always clamped to 1 day regardless of days_to_show.
 *   - show_empty_days skips the sensor scan and returns the configured count.
 *   - Otherwise: max over sensors of min(realDays, effectiveDaysToShow),
 *     where realDays = days with state >= 0; sensors without a days array are
 *     skipped.
 *
 * @param {object[]} sensors - Sensor array to derive column count from.
 * @param {object}   cfg     - Card config object.
 * @returns {number}
 */
export function computeDisplayDays(
  sensors: PollenSensor[],
  cfg: CardConfig,
): number {
  const effectiveDaysToShow =
    cfg.integration === "msw" || cfg.integration === "irmkmi"
      ? 1
      : (cfg.days_to_show as number);
  if (cfg.show_empty_days) return effectiveDaysToShow;
  let daysCount = 0;
  for (const s of sensors) {
    if (!s.days || !s.days.length) continue;
    const realDays = s.days.filter((d) => d.state >= 0).length;
    const count = Math.min(realDays, effectiveDaysToShow);
    if (count > daysCount) daysCount = count;
  }
  return daysCount;
}

/**
 * Clamp a sensor value to a valid level range.
 *
 * @param {*}      v         - Raw sensor value (will be coerced via Number()).
 * @param {number|null} maxLevel - Upper clamp bound, or null for no upper clamp.
 * @param {*}      nanResult - Value returned for NaN / negative input.
 * @returns {number|null}
 */
export function clampLevel<N = number>(
  v: unknown,
  maxLevel: number | null = 6,
  nanResult: N = -1 as N,
): number | N {
  if (v === null || v === undefined) return nanResult;
  const n = Number(v);
  if (isNaN(n) || n < 0) return nanResult;
  return maxLevel != null ? Math.min(n, maxLevel) : n;
}

/**
 * Parse a date string to LOCAL midnight. `new Date("YYYY-MM-DD")` parses as
 * UTC midnight, which lands on the wrong calendar day when compared against a
 * local-midnight "today" anchor in timezones away from UTC (issue #271, Sydney
 * UTC+10). Accepts plain dates and datetime strings (time part is dropped).
 *
 * @param {string} dateStr - "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm..." string.
 * @returns {Date|null} Local-midnight Date, or null for unparsable input.
 */
export function parseLocalDate(dateStr: unknown): Date | null {
  if (typeof dateStr !== "string") return null;
  const ymd = dateStr.split("T")[0] ?? "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Scale a normalized pollen level for ring rendering. DWD reports a coarse
 * 0-3 scale, but the doughnut ring is drawn on the shared 0-6 geometry, so DWD
 * levels are doubled to fill the ring; every other integration renders its
 * level unchanged. Single source for the card (normal + minimal modes) and the
 * badge, which previously each inlined the `integration === "dwd" ? n * 2 : n`
 * rule.
 *
 * @param {string} integration   - The card/badge `integration` id.
 * @param {number} normalizedLevel - The sensor's normalized level. A negative
 *   no-data sentinel (e.g. -1) is preserved (and doubled to -2 for DWD), so the
 *   caller's no-data handling still sees a negative value; non-numeric input
 *   coerces to 0.
 * @returns {number} The level to render the ring at.
 */
export function scaleRingLevel(
  integration: string | undefined,
  normalizedLevel: unknown,
): number {
  const n = Number(normalizedLevel) || 0;
  return integration === "dwd" ? n * 2 : n;
}

/**
 * Resolve the NUMBER to display for a pollen reading: the calculated level by
 * default, or the raw measurement (concentration / index) when the user opts in.
 *
 * The single shared decision point for every numeric render path (card
 * show_value_numeric, card numeric-in-circle, badge ring_value). By default it
 * returns `display_state ?? state` (the level). When raw is requested AND the
 * day carries a numeric `raw_value` (>= 0), it returns that instead. Raw is
 * requested via the shared `numeric_value_raw` flag, or via the legacy PEU
 * `numeric_state_raw_risk` flag (kept working for existing configs).
 *
 * Adapters that have no distinct raw value never set `raw_value`, so this is a
 * no-op for them regardless of the flag. Typeguarded against a null day or
 * non-numeric fields.
 *
 * @param {object} day    - A day object (e.g. sensor.days[i]).
 * @param {object} config - The card/badge config.
 * @returns {*} The value to display (number, or display_state/state fallback).
 */
export function resolveNumericValue(
  day: ForecastDay | null | undefined,
  config: CardConfig,
): number | string | null {
  if (!day) return null;
  const level = day.display_state ?? day.state;
  const wantRaw =
    config?.numeric_value_raw === true ||
    // numeric_state_raw_risk is a PEU-specific legacy key; honour it only for
    // PEU so a stale value left after switching integrations cannot force raw
    // on another integration.
    (config?.integration === "peu" && config?.numeric_state_raw_risk === true);
  if (wantRaw && day.raw_value != null) {
    const raw = Number(day.raw_value);
    if (Number.isFinite(raw) && raw >= 0) return raw;
  }
  return level;
}

/**
 * Sort a sensors array in-place using one of the standard sort keys.
 * Adapter-specific post-sorts (tiered, pin-to-top) are applied by the caller.
 *
 * @param {object[]} sensors  - Array of sensor dicts (mutated in-place).
 * @param {string}   sortKey  - One of "value_ascending", "value_descending",
 *                              "name_ascending", "name_descending", or "none".
 */
export function sortSensors(sensors: PollenSensor[], sortKey: string): void {
  if (sortKey === "none") return;
  const sortFns: Record<string, (a: PollenSensor, b: PollenSensor) => number> =
    {
      value_ascending: (a, b) =>
        (a.days?.[0]?.state ?? 0) - (b.days?.[0]?.state ?? 0),
      value_descending: (a, b) =>
        (b.days?.[0]?.state ?? 0) - (a.days?.[0]?.state ?? 0),
      name_ascending: (a, b) =>
        a.allergenCapitalized.localeCompare(b.allergenCapitalized),
      name_descending: (a, b) =>
        b.allergenCapitalized.localeCompare(a.allergenCapitalized),
    };
  const sortFn =
    sortFns[sortKey] ||
    ((a, b) => (b.days?.[0]?.state ?? 0) - (a.days?.[0]?.state ?? 0));
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
export function meetsThreshold(
  days: ForecastDay[],
  threshold: number,
): boolean {
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
export function resolveAllergenNames(
  allergenKey: string,
  {
    fullPhrases,
    shortPhrases,
    abbreviated,
    lang,
    capitalize: capFn,
    configKey,
  }: {
    fullPhrases: PhraseMap;
    shortPhrases: PhraseMap;
    abbreviated: boolean;
    lang: string;
    capitalize?: (s: string) => string;
    configKey?: string;
  },
): { allergenCapitalized: string; allergenShort: string } {
  const cap = capFn || ((s: string) => s.charAt(0).toUpperCase() + s.slice(1));
  const ck = configKey ?? allergenKey;
  const canonKey = toCanonicalAllergenKey(allergenKey);

  let allergenCapitalized;
  const fullOverride = resolvePhraseOverride(fullPhrases, ck, canonKey);
  if (fullOverride) {
    allergenCapitalized = fullOverride;
  } else {
    const nameKey = `card.allergen.${canonKey}`;
    const i18nName = t(nameKey, lang);
    allergenCapitalized = i18nName !== nameKey ? i18nName : cap(ck);
  }

  let allergenShort;
  if (abbreviated) {
    const shortKey = `editor.phrases_short.${canonKey}`;
    const i18nShort = t(shortKey, lang);
    allergenShort =
      resolvePhraseOverride(shortPhrases, ck, canonKey) ||
      (i18nShort !== shortKey ? i18nShort : null) ||
      allergenCapitalized;
  } else {
    allergenShort = allergenCapitalized;
  }

  return { allergenCapitalized, allergenShort };
}

/**
 * Resolve a single phrase override (full or short) for an allergen, honoring
 * both the exact per-integration config key and the shared canonical key.
 *
 * A *present* exact key wins, even an empty string (which the editor writes
 * when a phrase field is cleared) — so a user can opt out of a carried-over
 * cross-integration override; an empty value falls through to the caller's
 * default name. Only a genuinely *absent* exact key consults the canonical
 * index, letting an override keyed by one integration's raw name (PP "Gräs")
 * apply to another that names the same allergen differently (MSW/SILAM
 * "grass"). The hasOwnProperty test also makes a null or array phrase map a
 * safe no-op.
 *
 * Shared by resolveAllergenNames and SILAM's getAllergenNames so both
 * integrations resolve overrides identically (issue #253).
 *
 * @param {object} phrases   - User phrase map (config.phrases.full / .short).
 * @param {string} configKey - Raw per-integration allergen key to match exactly.
 * @param {string} canonKey  - Canonical allergen key for the cross-integration fallback.
 * @returns {string|undefined} The override value, or undefined if none applies.
 */
export function resolvePhraseOverride(
  phrases: PhraseMap,
  configKey: string,
  canonKey: string,
): string | undefined {
  return phrases != null &&
    Object.prototype.hasOwnProperty.call(phrases, configKey)
    ? phrases[configKey]
    : getCanonicalPhraseIndex(phrases)[canonKey];
}

/**
 * Build a { canonicalAllergenKey: overrideValue } index from a user phrase map
 * (config.phrases.full / .short), whose keys are raw, per-integration allergen
 * names (e.g. PP's "Gräs", MSW's "grass", DWD's "Gräser"). This lets a phrase
 * override carry across integrations that share an allergen: resolveAllergenNames
 * falls back to this index by canonical key after the exact raw-key lookup misses.
 *
 * Canonicalization uses normalize() as the primary path. It covers alias hits
 * (PP "Gräs" → gras → grass), keys already written as a canonical name
 * ("grass" → grass), and DWD umlaut keys (NFD strips ä/ö/ü, so "Gräser" →
 * graser → grass, an alias). normalizeDWD() is consulted only as a fallback for
 * keys the primary path does NOT recognize as an alias — its sole added value
 * is the ß→ss expansion (e.g. "Beifuß" → beifuss → mugwort, where normalize
 * yields the unrecognized "beifu"). Restricting the DWD path to unrecognized
 * keys prevents cross-aliasing a recognized non-DWD key onto a different
 * canonical allergen (e.g. PP "Gräs", whose DWD form "graes" is GP's distinct
 * "graminales", must not relabel Graminales).
 *
 * First-defined-wins; since the exact raw-key match in resolveAllergenNames
 * takes precedence over this fallback, any residual canonical collisions are
 * low-impact.
 *
 * Memoized per phrase-object via a WeakMap: a single fetchForecast reuses the
 * same fullPhrases/shortPhrases reference across all allergens, so the index is
 * built once rather than per allergen.
 *
 * @param {object} phrases - User phrase map keyed by raw allergen names.
 * @returns {Object<string,string>} Canonical-key → override-value lookup.
 */
const _canonicalPhraseCache = new WeakMap<object, Record<string, string>>();

/**
 * Count one uncached entity-discovery sweep under `tag`.
 *
 * Opt-in instrumentation for before/after measurements of the discovery
 * memoization (#321): it is a no-op unless `window.__ppDiscoveryScans` already
 * holds a plain object, or `debug` is true (in which case one is installed).
 * A tester can therefore enable it live from the browser console with
 * `window.__ppDiscoveryScans = {}` without editing the card config, and
 * production installs pay nothing but one property read per sweep.
 *
 * The global is shared with everything else on the page, so its value is
 * type-guarded rather than trusted: a non-object (or an array) left there by
 * another script counts as "not opted in", since assigning a property to a
 * primitive throws in the module's strict-mode code and would take discovery
 * down with it.
 *
 * @param {string} tag - Counter key, typically the adapter's discovery logTag.
 * @param {boolean} [debug] - When true, install a counter object if the global
 *   is missing or holds something unusable.
 */
export function recordDiscoveryScan(tag: string, debug = false): void {
  if (typeof window === "undefined") return;
  const existing: unknown = window.__ppDiscoveryScans;
  const usable =
    !!existing && typeof existing === "object" && !Array.isArray(existing);
  if (!usable) {
    if (!debug) return;
    window.__ppDiscoveryScans = {};
  }
  const counters = window.__ppDiscoveryScans!;
  const previous = counters[tag];
  counters[tag] = (typeof previous === "number" ? previous : 0) + 1;
}

/**
 * Memoize a discovery function on the identity of the `hass` object.
 *
 * Home Assistant hands the card a NEW `hass` object on every state update, so
 * a WeakMap keyed on that object caches only within one update cycle: the
 * card, the badge, the editors and every adapter code path (detection,
 * resolveEntityIds, fetchForecast) share one result per tick, and the entry
 * becomes unreachable as soon as HA moves on. There is no staleness window and
 * no cache invalidation to get wrong.
 *
 * Two contracts callers must respect:
 *
 * 1. **The result is shared — never mutate it.** All code paths within a tick
 *    get the same object reference, so mutating a returned discovery (adding
 *    to `locations`/`entities`, deleting a location) leaks into unrelated
 *    callers. Copy before modifying.
 * 2. **`hass` is the whole cache key.** The signature therefore admits only
 *    the discovery shape `(hass, debug?)`: `debug` is passed through on a miss
 *    and ignored on a hit (the first call of a tick wins, so a later call with
 *    `debug: true` returns the cached result without logging), which is
 *    harmless because it only affects logging. A function taking a further
 *    argument that selects WHAT to discover — `discoverGplAllergens(hass,
 *    configEntryId, debug)` and its GP twin, which the editor calls with
 *    different config entries under one `hass` — must not be wrapped: it would
 *    silently serve the first entry's data to every later entry. Keeping the
 *    parameter list narrow turns that mistake into a compile error instead of
 *    a wrong-location bug.
 *
 * A falsy or non-object `hass` is passed straight through uncached (WeakMap
 * keys must be objects, and adapters already handle a missing `hass`).
 *
 * Wrap once, at module level (`export const discoverX = memoizeByHass(...)`):
 * the WeakMap is created when the wrapper is created, so a wrapper built
 * inside a function caches nothing.
 *
 * @param fn - Discovery function taking `hass` and an optional `debug` flag.
 * @param countTag - Optional instrumentation tag; when given, every uncached
 *   call is counted via {@link recordDiscoveryScan} (only once the counter
 *   object exists). Leave unset for functions that already count their own
 *   sweep inside `discoverEntitiesByDevice`, otherwise the same sweep is
 *   counted twice under two keys. It exists for the sweeps that never reach
 *   the engine and so count nothing on their own: Kleenex's `kleenexDeviceIds`
 *   (#322) and Atmo's `detectLocation` (#323).
 * @returns A wrapper with the same signature as `fn`.
 */
export function memoizeByHass<R>(
  fn: (hass: HomeAssistant, debug?: boolean) => R,
  countTag?: string,
): (hass: HomeAssistant, debug?: boolean) => R {
  const cache = new WeakMap<object, R>();
  return (hass: HomeAssistant, debug?: boolean): R => {
    if (!hass || typeof hass !== "object") return fn(hass, debug);
    if (cache.has(hass)) return cache.get(hass) as R;
    const result = fn(hass, debug);
    if (countTag) recordDiscoveryScan(countTag);
    cache.set(hass, result);
    return result;
  };
}

function getCanonicalPhraseIndex(phrases: PhraseMap): Record<string, string> {
  // Arrays satisfy typeof === "object" but would index numeric keys into a
  // meaningless map; the editor type-guards phrases.full/short to non-array
  // objects, so mirror that and treat anything else as no overrides.
  if (!phrases || typeof phrases !== "object" || Array.isArray(phrases))
    return {};
  let idx = _canonicalPhraseCache.get(phrases);
  if (idx) return idx;
  idx = {};
  // Own-property check: `in` would match inherited keys ("constructor",
  // "toString", …), through which toCanonicalAllergenKey can hand back a
  // non-string (a prototype function), so the string guard in addCanon backstops
  // it at the storage point too.
  const isAlias = (k: string) =>
    Object.prototype.hasOwnProperty.call(ALLERGEN_TRANSLATION, k);
  for (const rawKey of Object.keys(phrases)) {
    // rawKey comes from Object.keys(phrases), so the lookup is always present.
    const value = phrases[rawKey]!;
    const addCanon = (canon: unknown) => {
      if (typeof canon === "string" && canon && !(canon in idx))
        idx[canon] = value;
    };
    const n = normalize(rawKey);
    addCanon(toCanonicalAllergenKey(n));
    // DWD ß→ss fallback only for keys normalize() did not recognize as an alias.
    if (!isAlias(n)) {
      const nd = normalizeDWD(rawKey);
      if (isAlias(nd)) addCanon(toCanonicalAllergenKey(nd));
    }
  }
  _canonicalPhraseCache.set(phrases, idx);
  return idx;
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
export function mergePhrases(config: CardConfig, lang: string): MergedPhrases {
  const phrases = {
    full: {},
    short: {},
    levels: [] as unknown[],
    days: {},
    no_information: "",
    ...((config.phrases as Record<string, unknown>) || {}),
  };
  return {
    fullPhrases: phrases.full as Record<string, string>,
    shortPhrases: phrases.short as Record<string, string>,
    userLevels: phrases.levels as unknown[],
    userDays: phrases.days as Record<string, string>,
    noInfoLabel:
      (phrases.no_information as string) || t("card.no_information", lang),
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
export function getLangAndLocale(
  hass: HomeAssistant,
  config: CardConfig,
  defaultLocale: string | null = null,
): {
  lang: string;
  locale: string;
  daysRelative: boolean;
  dayAbbrev: boolean;
  daysUppercase: boolean;
} {
  const dateLocale = config.date_locale as string | undefined;
  const lang = detectLang(hass, dateLocale);
  const locale =
    defaultLocale != null
      ? dateLocale || defaultLocale
      : dateLocale ||
        hass.locale?.language ||
        hass.language ||
        `${lang}-${lang.toUpperCase()}`;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);
  return { lang, locale, daysRelative, dayAbbrev, daysUppercase };
}

/**
 * Normalize a manual-mode entity prefix.
 * Strips leading "sensor." and ensures a trailing "_" (unless empty).
 * Non-string input (e.g. a number/object from YAML misconfiguration)
 * is coerced to "" so downstream consumers don't crash on .startsWith.
 *
 * @param {*} raw - The raw entity_prefix from config.
 * @returns {string}
 */
export function normalizeManualPrefix(raw: unknown): string {
  let p = typeof raw === "string" ? raw : "";
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
export function resolveManualEntity(
  hass: HomeAssistant,
  prefix: string,
  slug: string,
  suffix: string,
): string | null {
  const sensorId = `sensor.${prefix}${slug}${suffix}`;
  if (hass.states[sensorId]) return sensorId;
  if (suffix === "") {
    const base = `sensor.${prefix}${slug}`;
    const candidates = Object.keys(hass.states).filter((id) =>
      id.startsWith(base),
    );
    if (candidates.length === 1) return candidates[0]!;
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
export function buildDayLabel(
  date: Date,
  diff: number,
  {
    daysRelative,
    dayAbbrev,
    daysUppercase,
    userDays,
    lang,
    locale,
  }: {
    daysRelative: boolean;
    dayAbbrev: boolean;
    daysUppercase: boolean;
    userDays: Record<string, string>;
    lang: string;
    locale: string;
  },
): string {
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
export function filterSensorsPostFetch(
  sensors: PollenSensor[],
  cfg: CardConfig,
  availableSensors: string[],
  hassStateKeys: string[],
  silamMapping: Record<string, Record<string, string>>,
): PollenSensor[] {
  // Precompute SILAM reverse mapping (master allergen -> HA slug) once,
  // rather than rebuilding it per sensor inside the filter callback.
  let silamReverse: Record<string, string> | null = null;
  let silamLoc: string | null = null;
  if (cfg.integration === "silam" && (!cfg.mode || cfg.mode === "daily")) {
    const configLocation = ((cfg.location as string) || "").toLowerCase();
    if (!isConfigEntryId(configLocation)) {
      silamLoc = configLocation;
      silamReverse = {};
      for (const id of hassStateKeys) {
        const m = id.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
        if (!m || m[1] !== silamLoc) continue;
        const haSlug = m[2];
        if (!haSlug) continue;
        for (const [, mapping] of Object.entries(silamMapping)) {
          const canon = mapping[haSlug];
          if (canon) {
            silamReverse[canon] = haSlug;
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

  if (
    Array.isArray(cfg.allergens) &&
    cfg.allergens.length > 0 &&
    cfg.integration !== "silam"
  ) {
    let allowed: Set<string>;
    let getKey: (s: PollenSensor) => string;
    if (cfg.integration === "dwd") {
      allowed = new Set(cfg.allergens.map((a) => normalizeDWD(a)));
      getKey = (s) => normalizeDWD(s.allergenReplaced || "");
    } else {
      allowed = new Set(cfg.allergens.map((a) => normalize(a)));
      getKey = (s) => normalize(s.allergenReplaced || "");
    }
    if (cfg.integration === "kleenex") {
      // The Kleenex adapter substitutes the category totals when the zone has
      // no per-allergen data to give (US/NA, issue #313). Those keys are by
      // construction absent from cfg.allergens, so filtering on the configured
      // list alone drops the only rows such a location can produce and leaves
      // the card empty. The adapter is the authority on which category rows
      // exist -- it emits them only when the user configured them or when the
      // fallback fired -- so let them through.
      for (const key of ["trees_cat", "grass_cat", "weeds_cat"]) {
        allowed.add(normalize(key));
      }
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
 * Tier 2 (entity-registry): For entities filtered by entry.platform whose
 *   device was NOT in the tier-1 set. Tops up tier 1 with entities whose
 *   device lacks identifiers metadata (mixed-registry scenarios where one
 *   config entry's devices are tagged and another's are not). Entities whose
 *   device tier 1 already matched stay on the tier-1 path (relaxed classifier)
 *   and are not also offered to the strict classifier, so the two classifiers
 *   never run on the same entity. When tier 1 found no devices at all
 *   (matchingDeviceIds empty), tier 2 covers all platform-matching entities,
 *   preserving the pre-existing tier 2 behavior for adapters that do not use
 *   device-based discovery. Implementation: a single pass over hass.entities
 *   routes each entity to the tier-1 or tier-2 path based on its device's
 *   identifier match.
 * Tier 3 (fallback): Scan hass.states using fallbackSelector or fallbackRegex.
 *   Used when neither tier 1 nor tier 2 produced any locations.
 *
 * `tierUsed` in the returned object reports the primary mechanism: 1 if tier 1
 * contributed any entity, 2 if only tier 2 contributed, 3 if only tier 3
 * contributed, 0 if no tier produced locations.
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
 *   (ctx) => string. Default: deviceLocationKey(ctx.device) -- subentry id when
 *   the device's primary config entry has one, else the config entry id, else
 *   "default".
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
export function discoverEntitiesByDevice(
  hass: HomeAssistant,
  opts: DiscoverEntitiesOpts = {},
): DeviceDiscovery {
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

  const platforms = Array.isArray(platform)
    ? platform
    : platform
      ? [platform]
      : [];
  const logTag =
    opts.logTag || (platforms.length > 0 ? platforms[0] : "discovery");
  // Every call here is a full registry sweep; memoized callers reach this
  // point only on a cache miss, so the tally is the before/after metric.
  recordDiscoveryScan(logTag || "discovery", debug);
  const classifyStrict = classify || (() => null);
  const classifyTier1 = classifyRelaxed || classifyStrict;

  const defaultExcludeEntry = (
    entry: EntityRegistryDisplayEntry | null | undefined,
  ) => !!(entry !== null && entry !== undefined && entry.entity_category);
  const shouldExclude = excludeEntry || defaultExcludeEntry;

  const defaultIsRelevant = () => true;
  const checkRelevant = isRelevant || defaultIsRelevant;

  const defaultResolveLabel = (ctx: DiscoveryContext) => {
    const { device, state } = ctx;
    if (device !== null && device !== undefined && device.name_by_user)
      return device.name_by_user;
    if (device !== null && device !== undefined && device.name)
      return device.name;
    if (
      state !== null &&
      state !== undefined &&
      state.attributes !== null &&
      state.attributes !== undefined
    ) {
      if (state.attributes.friendly_name) return state.attributes.friendly_name;
    }
    return "Auto";
  };
  const getLabel = resolveLabel || defaultResolveLabel;

  const defaultResolveLocationKey = (ctx: DiscoveryContext) =>
    deviceLocationKey(ctx.device);
  const getLocationKey = resolveLocationKey || defaultResolveLocationKey;

  const locations = new Map<string, DiscoveredLocation>();

  /**
   * Add a single classified entity to locations.
   * @param {string}      eid
   * @param {string|null} allergenKey
   * @param {object}      ctx          - { state, entry, device, entityId, tier }
   */
  const addEntity = (
    eid: string,
    allergenKey: string | null | undefined,
    ctx: DiscoveryContext,
  ) => {
    if (allergenKey === null || allergenKey === undefined) return;

    const locationKey = getLocationKey({ ...ctx, locationKey: undefined });
    const enrichedCtx = { ...ctx, locationKey };

    if (!locations.has(locationKey)) {
      const label = getLabel(enrichedCtx) as string;
      locations.set(locationKey, { label, entities: new Map() });
    }

    const location = locations.get(locationKey)!;

    // Set/backfill deviceId whenever ctx provides one and the location is
    // still missing it. Backfill handles the case where the first entity in a
    // bucket had no deviceId but a later entity does. Downstream consumers
    // (e.g. SILAM weather-entity postprocess) rely on this field.
    //
    // Recompute the label when device context first becomes available: the
    // first entity in this bucket may have produced a fallback label (e.g.
    // friendly_name or "Auto") because it lacked device info; now that a
    // later entity has the device, prefer the richer resolver output.
    if (
      (location.deviceId === null || location.deviceId === undefined) &&
      ctx.deviceId !== null &&
      ctx.deviceId !== undefined
    ) {
      location.deviceId = ctx.deviceId;
      const updatedLabel = getLabel(enrichedCtx);
      if (
        updatedLabel !== null &&
        updatedLabel !== undefined &&
        updatedLabel !== location.label
      ) {
        location.label = updatedLabel;
      }
    }

    const locEntities = location.entities;
    if (locEntities.has(allergenKey)) {
      if (onCollision) {
        const newKey = onCollision(enrichedCtx, {
          existingKey: allergenKey,
          existingEntityId: locEntities.get(allergenKey),
          locEntities,
        });
        // Only accept a non-null new key that is not already in use. Overwriting
        // would silently drop an existing sensor mapping.
        if (
          newKey !== null &&
          newKey !== undefined &&
          !locEntities.has(newKey)
        ) {
          locEntities.set(newKey, eid);
        }
      }
      // If no onCollision, it returned null, or the returned key collides, skip.
    } else {
      locEntities.set(allergenKey, eid);
    }
  };

  // --- Tier 1 + Tier 2: Single-pass entity discovery ---
  // Find devices whose identifiers contain a matching platform as first element.
  // Used to decide tier-1 precedence per entity below.
  const matchingDeviceIds = new Set<string>();
  if (
    hass !== null &&
    hass !== undefined &&
    hass.devices !== null &&
    hass.devices !== undefined
  ) {
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
  }
  if (debug && matchingDeviceIds.size > 0) {
    console.debug(
      `[${logTag}] Discovery tier 1 (device-based): found`,
      matchingDeviceIds.size,
      "devices",
    );
  }

  // Single walk over hass.entities. Tier 1 path handles entities whose device
  // has matching identifiers (with the relaxed classifier); tier 2 path handles
  // remaining entities whose entry.platform matches (with the strict classifier).
  // Entities considered by tier 1 are NOT also offered to tier 2, so the strict
  // classifier never second-guesses the relaxed result on the same entity.
  let tier1Contributed = false;
  let tier2Contributed = false;
  if (
    hass !== null &&
    hass !== undefined &&
    hass.entities !== null &&
    hass.entities !== undefined
  ) {
    for (const [eid, entry] of Object.entries(hass.entities)) {
      if (entry === null || entry === undefined) continue;
      const inTier1 = matchingDeviceIds.has(entry.device_id as string);
      const platformMatch = platforms.includes(entry.platform as string);
      if (!inTier1 && !platformMatch) continue;
      if (shouldExclude(entry)) continue;

      const state =
        hass.states !== null && hass.states !== undefined
          ? hass.states[eid]
          : undefined;
      if (state === null || state === undefined) continue;

      const deviceId = entry.device_id;
      const device =
        deviceId !== null &&
        deviceId !== undefined &&
        hass.devices !== null &&
        hass.devices !== undefined
          ? hass.devices[deviceId]
          : undefined;
      const tier = inTier1 ? 1 : 2;
      const ctx: DiscoveryContext = {
        state,
        entry,
        device,
        deviceId,
        entityId: eid,
        tier,
      };

      if (!checkRelevant(eid, ctx)) continue;

      const allergenKey = inTier1
        ? classifyTier1(eid, ctx)
        : classifyStrict(eid, ctx);
      if (allergenKey === null || allergenKey === undefined) continue;

      addEntity(eid, allergenKey, ctx);
      if (inTier1) tier1Contributed = true;
      else tier2Contributed = true;
    }

    if (locations.size > 0) {
      const tierUsed = tier1Contributed ? 1 : 2;
      if (debug) {
        if (tier1Contributed && tier2Contributed) {
          console.debug(
            `[${logTag}] Discovery tier 1+2 result:`,
            locations.size,
            "locations (tier 1 + tier 2 top-up)",
          );
        } else if (tier1Contributed) {
          console.debug(
            `[${logTag}] Discovery tier 1 result:`,
            locations.size,
            "locations",
          );
        } else {
          console.debug(
            `[${logTag}] Discovery tier 2 result:`,
            locations.size,
            "locations",
          );
        }
        for (const [locId, loc] of locations) {
          console.debug(`  [${locId}] "${loc.label}":`, [
            ...loc.entities.keys(),
          ]);
        }
      }
      return { locations, tierUsed };
    }
  }

  // --- Tier 3: Fallback (selector or regex) ---
  if (
    hass !== null &&
    hass !== undefined &&
    hass.states !== null &&
    hass.states !== undefined
  ) {
    let candidates: string[] | null = null;

    if (typeof fallbackSelector === "function") {
      const raw = fallbackSelector(hass);
      // Be permissive: a misbehaving selector returning null/undefined or a
      // non-array shouldn't crash discovery. Treat anything non-array as no
      // candidates.
      candidates = Array.isArray(raw) ? raw : null;
    } else if (fallbackRegex instanceof RegExp) {
      candidates = Object.keys(hass.states).filter((eid) =>
        fallbackRegex.test(eid),
      );
    }

    if (candidates !== null && candidates.length > 0) {
      if (debug)
        console.debug(
          `[${logTag}] Discovery tier 3 (fallback): found`,
          candidates.length,
          "candidates",
        );

      for (const eid of candidates) {
        const state = hass.states[eid];
        if (state === null || state === undefined) continue;

        const ctx: DiscoveryContext = {
          state,
          entry: undefined,
          device: undefined,
          deviceId: undefined,
          entityId: eid,
          tier: 3,
        };

        if (!checkRelevant(eid, ctx)) continue;

        const allergenKey = classifyStrict(eid, ctx);
        addEntity(eid, allergenKey, ctx);
      }
    }
  }

  if (debug) {
    console.debug(
      `[${logTag}] Discovery final result:`,
      locations.size,
      "locations",
    );
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
export function findLocationBySlug(
  discovery: { locations: Map<string, DiscoveredLocation> } | null | undefined,
  slug: string | null | undefined,
  opts: {
    slugExtractor?: (entityId: string) => string | null | undefined;
    suffixExtras?: string[];
  } = {},
): [string, DiscoveredLocation] | null {
  if (slug === null || slug === undefined || !slug) return null;
  if (discovery === null || discovery === undefined || !discovery.locations)
    return null;

  const { slugExtractor, suffixExtras = ["", "_j_1"] } = opts;
  const needle = String(slug).toLowerCase();
  const suffixVariants = suffixExtras.map((s) => `_${needle}${s}`);

  for (const [key, loc] of discovery.locations) {
    for (const eid of loc.entities.values()) {
      const lid = String(eid).toLowerCase();

      // Custom extractor path
      if (typeof slugExtractor === "function") {
        const extracted = slugExtractor(eid);
        if (
          extracted !== null &&
          extracted !== undefined &&
          String(extracted).toLowerCase() === needle
        ) {
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
 *   1. Empty cfgLocation -> first location (numeric or lex sort, see body).
 *   2. Exact key match.
 *   3. Exact case-insensitive match against location label.
 *   4. findLocationBySlug fallback.
 *   5. Fuzzy substring (case-insensitive) match against location label.
 *   6. null if nothing matches.
 *
 * @param {{ locations: Map }} discovery    - Result from discoverEntitiesByDevice.
 * @param {string}             cfgLocation - Location value from card config.
 * @param {object}             [opts]
 * @param {Function}           [opts.slugExtractor] - Passed to findLocationBySlug.
 * @returns {[string, object]|null} - [locationKey, location] or null.
 */
export function resolveLocationByKey(
  discovery: { locations: Map<string, DiscoveredLocation> } | null | undefined,
  cfgLocation: string | null | undefined,
  opts: {
    slugExtractor?: (entityId: string) => string | null | undefined;
    suffixExtras?: string[];
  } = {},
): [string, DiscoveredLocation] | null {
  if (discovery === null || discovery === undefined || !discovery.locations)
    return null;
  const locs = discovery.locations;

  // 1. Empty location -> pick first deterministically. Enumeration order of
  // hass.devices / hass.entities is insertion-order and stable within a
  // session, but can differ across HA restarts or integration reinstalls.
  // Sort numerically for all-digit keys (DWD region IDs), lexicographically
  // otherwise, so auto-select is reproducible and intuitive.
  if (!cfgLocation) {
    if (locs.size === 0) return null;
    const keys = Array.from(locs.keys());
    const allNumeric = keys.every((k) => /^\d+$/.test(String(k)));
    const sortedKeys = allNumeric
      ? keys.sort((a, b) => Number(a) - Number(b))
      : keys.sort();
    // locs.size > 0 was checked above, so sortedKeys[0] exists.
    const key = sortedKeys[0]!;
    return [key, locs.get(key)!];
  }

  // 2. Exact key match.
  if (locs.has(cfgLocation)) {
    return [cfgLocation, locs.get(cfgLocation)!];
  }

  // 3. Exact case-insensitive label equality. Quick, precise path for user
  // configs that mirror the device name ("Hamburg" == label "Hamburg").
  const cfgLower = String(cfgLocation).toLowerCase();
  for (const [key, loc] of locs) {
    if (!loc.label) continue;
    if (String(loc.label).toLowerCase() === cfgLower) {
      return [key, loc];
    }
  }

  // 4. Slug fallback. Respects entity-ID structure via slugExtractor, so
  // short/numeric configs like DWD region_id "50" resolve to entity suffix
  // "_50" without being confused by fuzzy label matching.
  const slugMatch = findLocationBySlug(discovery, cfgLocation, opts);
  if (slugMatch !== null) return slugMatch;

  // 5. Fuzzy label includes (last resort). Kept so configs that were a
  // substring of a legacy friendly_name still resolve when no slugExtractor
  // is supplied. Placed after the slug match so specific entity-structure
  // resolution wins over loose substring matches (e.g. region_id "50" must
  // not bind to a label containing "150").
  for (const [key, loc] of locs) {
    if (!loc.label) continue;
    if (String(loc.label).toLowerCase().includes(cfgLower)) {
      return [key, loc];
    }
  }

  // 6. No match.
  return null;
}
