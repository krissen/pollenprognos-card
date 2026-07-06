import type { HomeAssistant } from "../types/home-assistant.js";
import type { CardConfig, AdapterStubConfig } from "../types/config.js";
import type { PollenSensor, ForecastDay } from "../types/sensor.js";
import { normalize } from "../utils/normalize.js";
import { slugify } from "../utils/slugify.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { PP_POSSIBLE_CITIES, PP_ALLERGEN_SLUGS } from "../constants.js";
import {
  buildDayLabel,
  clampLevel,
  resolveAllergenNames,
  discoverEntitiesByDevice,
  isConfigEntryId,
  parseLocalDate,
  type DeviceDiscovery,
} from "../utils/adapter-helpers.js";
import {
  createEntityResolver,
  runForecastScaffold,
  padForecastDates,
  type BuildDictArgs,
} from "./base.js";

export const stubConfigPP: AdapterStubConfig = {
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
 * "sensor.pollen_goteborg_bjork" -> "Göteborg" when the slug matches a
 * canonical city in PP_POSSIBLE_CITIES (preserving diacritics), otherwise
 * falls back to "Goteborg" via simple capitalization.
 * Returns null if the entity ID does not match the expected pattern.
 */
function extractCityFromEntityId(entityId: string): string | null {
  const slug = extractCitySlugFromEntityId(entityId);
  if (!slug) return null;
  const canonical = PP_POSSIBLE_CITIES.find((c: string) => slugify(c) === slug);
  if (canonical) return canonical;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Extract the city slug from a PP entity ID by stripping a recognized
 * allergen suffix. PP allergen slugs may contain underscores (e.g.
 * "salg_och_viden"), so a naive `_[^_]+$` split would misclassify the
 * city. PP_ALLERGEN_SLUGS is sorted longest-first to ensure the longest
 * matching suffix wins.
 *
 * "sensor.pollen_goteborg_bjork" -> "goteborg"
 * "sensor.pollen_visby_salg_och_viden" -> "visby"
 * Returns null if the entity ID does not match the expected pattern or
 * its suffix isn't a known allergen.
 */
export function extractCitySlugFromEntityId(entityId: string): string | null {
  const prefix = "sensor.pollen_";
  if (!entityId.startsWith(prefix)) return null;
  const remainder = entityId.slice(prefix.length);
  for (const allergenSlug of PP_ALLERGEN_SLUGS) {
    const suffix = `_${allergenSlug}`;
    if (remainder.endsWith(suffix)) {
      const citySlug = remainder.slice(0, -suffix.length);
      return citySlug || null;
    }
  }
  return null;
}

/**
 * Extract the allergen slug from a PP entity ID using the same suffix
 * whitelist as extractCitySlugFromEntityId. Returns the canonical
 * (master) key via normalize() so callers can look it up directly in
 * cfg.allergens.
 */
function extractAllergenKeyFromEntityId(entityId: string): string | null {
  const prefix = "sensor.pollen_";
  if (!entityId.startsWith(prefix)) return null;
  const remainder = entityId.slice(prefix.length);
  for (const allergenSlug of PP_ALLERGEN_SLUGS) {
    const suffix = `_${allergenSlug}`;
    if (remainder.endsWith(suffix)) {
      return normalize(allergenSlug);
    }
  }
  return null;
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
 */
export function discoverPpSensors(
  hass: HomeAssistant,
  debug = false,
): DeviceDiscovery {
  if (!hass) return { locations: new Map(), tierUsed: 0 };

  const { locations, tierUsed } = discoverEntitiesByDevice(hass, {
    platform: ["pollenprognos"],
    /**
     * Strict classifier: derive the canonical allergen key from the entity ID.
     * PP entity IDs follow the pattern sensor.pollen_{city}_{allergen}, but
     * the allergen slug can contain underscores (e.g. "salg_och_viden"), so
     * use a longest-suffix whitelist match rather than splitting on `_`.
     */
    classify: (eid: string) => extractAllergenKeyFromEntityId(eid),
    /**
     * isRelevant: quick pre-filter before classify runs.
     */
    isRelevant: (eid: string) => eid.startsWith("sensor.pollen_"),
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
     * fallbackSelector: tier 3 uses the same allergen-suffix whitelist as
     * the classifier so multi-word allergen slugs are matched correctly.
     */
    fallbackSelector: (h: HomeAssistant) =>
      Object.keys(h.states).filter(
        (id) => extractAllergenKeyFromEntityId(id) !== null,
      ),
    debug,
    logTag: "PP",
  });

  return { locations, tierUsed };
}

function detectCity(cfg: CardConfig, hass: HomeAssistant): string {
  if (cfg.city === "manual") return "";
  // Treat a config_entry_id as autodetect: normalize() would otherwise produce
  // a non-empty cityKey from the ULID, blocking the entity-id scan below when
  // tier 1/2 discovery has already failed (e.g. unknown platform slug).
  const cityCfg = isConfigEntryId(cfg.city) ? "" : (cfg.city as string);
  let cityKey = normalize(cityCfg || "");
  if (!cityKey) {
    // Use the allergen-suffix whitelist to handle multi-word slugs like
    // "salg_och_viden" correctly when extracting the city.
    const ppStates = Object.keys(hass.states).filter(
      (id) => extractCitySlugFromEntityId(id) !== null,
    );
    if (ppStates.length) {
      cityKey = extractCitySlugFromEntityId(ppStates[0]) || "";
    }
  }
  return cityKey;
}

/**
 * Path 3 template fallback: build the allergen -> entity map from the legacy
 * `sensor.pollen_{city}_{allergen}` naming when discovery yields nothing. The
 * city is detected once, then each allergen is resolved by direct id or a
 * single-candidate suffix scan.
 */
function ppTemplateFallback({
  cfg,
  hass,
  debug,
}: {
  cfg: CardConfig;
  hass: HomeAssistant;
  debug: boolean;
}): Map<string, string> {
  const map = new Map<string, string>();
  const cityKey = detectCity(cfg, hass);
  for (const allergen of (cfg.allergens as string[] | undefined) || []) {
    const rawKey = normalize(allergen);
    let sensorId: string | null = cityKey
      ? `sensor.pollen_${cityKey}_${rawKey}`
      : null;
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

export const resolveEntityIds = createEntityResolver({
  locationKey: "city",
  normalize,
  discover: discoverPpSensors,
  slugExtractor: extractCitySlugFromEntityId,
  logTag: "PP",
  templateFallback: ppTemplateFallback,
});

// Clamp to the 0-6 PP scale; null (not -1) marks a missing reading so the
// day loop can emit the no-data sentinel only when the threshold is 0.
const testVal = (v: unknown): number | null => clampLevel<null>(v, 6, null);

/** Parse a forecast date key to LOCAL midnight (falls back to Invalid Date). */
const parseLocal = (s: string): Date => parseLocalDate(s) ?? new Date(NaN);

function buildPpDict({
  allergen,
  rawKey,
  sensorId,
  sensor,
  config,
  ctx,
}: BuildDictArgs): PollenSensor {
  const dict = { days: [] as ForecastDay[] } as PollenSensor;
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

  if (!sensor?.attributes?.forecast) throw "Missing forecast";
  dict.entity_id = sensorId;

  // Build forecastMap
  const rawForecast = sensor.attributes.forecast;
  const forecastMap: Record<string, { level?: unknown }> = Array.isArray(
    rawForecast,
  )
    ? rawForecast.reduce(
        (
          o: Record<string, { level?: unknown }>,
          entry: Record<string, unknown>,
        ) => {
          const key = (entry.time || entry.datetime) as string;
          o[key] = entry;
          return o;
        },
        {},
      )
    : rawForecast;

  // Sort and slice dates
  const rawDates = Object.keys(forecastMap).sort(
    (a, b) => parseLocal(a).getTime() - parseLocal(b).getTime(),
  );
  const upcoming = rawDates.filter(
    (d) => parseLocal(d).getTime() >= ctx.today.getTime(),
  );

  // Pad out to exactly days_to_show dates.
  const forecastDates = padForecastDates(
    upcoming,
    ctx.days_to_show,
    ctx.today,
    parseLocal,
  );

  // Iterate forecast days
  forecastDates.forEach((dateStr, idx) => {
    const raw = forecastMap[dateStr] || {};
    const level = testVal(raw.level);
    const d = parseLocal(dateStr);
    const diff = Math.round((d.getTime() - ctx.today.getTime()) / 86400000);
    const label = buildDayLabel(d, diff, {
      daysRelative: ctx.daysRelative,
      dayAbbrev: ctx.dayAbbrev,
      daysUppercase: ctx.daysUppercase,
      userDays: ctx.userDays,
      lang: ctx.lang,
      locale: ctx.locale,
    });

    if (level !== null) {
      const dayObj: ForecastDay = {
        name: dict.allergenCapitalized,
        day: label,
        state: level,
        // display_state mirrors state: PP has no separate display value, so the
        // contract's always-present display_state carries the same level.
        display_state: level,
        state_text: ctx.levelNames[level],
      };
      dict.days.push(dayObj);
    } else if (ctx.pollen_threshold === 0) {
      // When threshold is 0, show all allergens even with no data. Emit the
      // no-data sentinel (state -1), not 0: a missing reading is "no info",
      // not a real level 0. The render path then shows the no-data pattern
      // (LevelCircleMixin level < 0) so the ring matches the no-info label,
      // instead of a green no-pollen ring. Matters for badge single mode,
      // which forces threshold 0 to keep a named allergen.
      const dayObj: ForecastDay = {
        name: dict.allergenCapitalized,
        day: label,
        state: -1,
        display_state: -1,
        state_text: ctx.noInfoLabel,
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
    stub: stubConfigPP,
    normalize,
    resolveEntityIds,
    buildDict: buildPpDict,
    warnPrefix: (allergen) => `[PP] Error for allergen ${allergen}:`,
    onStart: (cfg, ctx) => {
      if (ctx.debug)
        console.debug("PP.fetchForecast — start", {
          city: cfg.city,
          lang: ctx.lang,
        });
    },
    onDone: (sensors, ctx) => {
      if (ctx.debug) console.debug("PP.fetchForecast — done", sensors);
    },
  });
}
