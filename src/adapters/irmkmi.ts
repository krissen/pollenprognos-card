// src/adapters/irmkmi.ts
// IRM KMI / meteo.be adapter.
//
// Reads current pollen levels from the enum sensors created by the
// irm-kmi-ha integration (https://github.com/jdejaegh/irm-kmi-ha) for the
// Belgian Royal Meteorological Institute (meteo.be). Only a current-day value
// is published per allergen; there is no machine-readable multi-day forecast.
//
// The integration exposes the meteo.be pollen colour scale as enum states
// (green/yellow/orange/red/purple) plus the non-measurement states `none`
// (no data / not in season) and the legacy `active` flag. We map the five
// colours onto the card's native 5-level scale (0-4) and treat every other
// state as no-data (row skipped). Card-default level colours are used, not
// RMI's palette.
//
// Discovery uses the shared device-registry helper so that:
//   - Multi-location setups (one config entry per location, e.g. Antwerp and
//     Saint-Ghislain) are disambiguated by config entry rather than mixed.
//   - Stale config_entry_id values fall back to the first discovered location,
//     mirroring DWD/GPL/GP/SILAM/Atmo/MSW recovery behavior.
//
// IRM KMI keeps its own resolveEntityIds and fetchForecast rather than the
// shared base helpers: its discovery-only resolveEntityIds treats "manual" as
// autodetect and falls back to the first location for ANY unmatched key (not
// just config-entry ids as createEntityResolver's recoverStaleConfig does),
// with no manual/template path, and its fetchForecast emits a single
// current-day row rather than the multi-day window runForecastScaffold targets.

import type { HomeAssistant } from "../types/home-assistant.js";
import type { CardConfig, AdapterStubConfig } from "../types/config.js";
import type { PollenSensor, ForecastDay } from "../types/sensor.js";
import type {
  AdapterAutodetect,
  AutodetectContext,
  AutodetectDetectResult,
  AutodetectDiscovery,
} from "../types/adapter.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNamesForScale } from "../utils/level-names.js";
import {
  getLangAndLocale,
  mergePhrases,
  buildDayLabel,
  sortSensors,
  meetsThreshold,
  resolveAllergenNames,
  discoverEntitiesByDevice,
  resolveLocationByKey,
  deviceLocationKey,
  type DiscoveryContext,
  type DiscoveredLocation,
  memoizeByHass,
} from "../utils/adapter-helpers.js";

// The subset of the discovery result irmkmi uses (config-entry keyed locations).
type IrmkmiDiscovery = { locations: Map<string, DiscoveredLocation> };

// irm-kmi-ha entity slug -> canonical allergen key.
// "grasses" is the slug used in entity IDs by the integration.
const IRMKMI_POLLEN_TYPES: Record<string, string> = {
  alder: "alder",
  ash: "ash",
  birch: "birch",
  grasses: "grass",
  hazel: "hazel",
  mugwort: "mugwort",
  oak: "oak",
};

// meteo.be pollen colour -> the integration's native 5-level scale (0-4).
// Card-wide convention: each integration keeps its own native level count for
// editor phrases, level circles, and color mapping; we do not stretch native
// counts onto a shared 0-6 gradient. The upstream irm_kmi_api ranks these as
// green=null < yellow=low < orange=moderate < red=high < purple=very high.
// `none` (no data) and the legacy `active` flag are intentionally absent: any
// state not in this map is treated as no-data and the row is skipped.
// TODO(#259-normalize): preserve this native 0-4 level map.
const IRMKMI_LEVEL_MAP: Record<string, number> = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
  purple: 4,
};

// The integration sets entity_ids explicitly to
// sensor.<entry-title-slug>_<allergen>_level, where the title slug is the
// location (e.g. "antwerp", "saint_ghislain"). Anchoring on
// _<allergen>_level$ extracts the allergen regardless of how many underscores
// the location slug contains.
const IRMKMI_LEVEL_RE = /_(alder|ash|birch|grasses|hazel|mugwort|oak)_level$/;

function classifyIrmkmiEntity(eid: string): string | null {
  if (typeof eid !== "string") return null;
  const m = IRMKMI_LEVEL_RE.exec(eid);
  if (!m) return null;
  return IRMKMI_POLLEN_TYPES[m[1] ?? ""] || null;
}

// Extract the location slug from an IRM KMI entity_id
// (sensor.<location-slug>_<allergen>_level -> <location-slug>). The location
// slug is a PREFIX here, not a suffix, so resolveLocationByKey's default
// suffix-based slug fallback cannot match it; adapters with this shape pass a
// custom slugExtractor (mirrors DWD/PEU/PP). Lets a config that uses the
// entity-prefix slug (e.g. location: "saint_ghislain") resolve to the right
// location instead of silently falling back to the first one.
const IRMKMI_LOCATION_SLUG_RE =
  /^sensor\.(.+)_(?:alder|ash|birch|grasses|hazel|mugwort|oak)_level$/;

export function extractIrmkmiLocationSlugFromEntityId(
  eid: string,
): string | null {
  if (typeof eid !== "string") return null;
  const m = IRMKMI_LOCATION_SLUG_RE.exec(eid);
  return m?.[1] ?? null;
}

export const stubConfigIRMKMI: AdapterStubConfig = {
  integration: "irmkmi",
  location: "",
  allergens: ["alder", "ash", "birch", "grass", "hazel", "mugwort", "oak"],
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
  // Day-label display defaults matching every other adapter. They are mostly
  // cosmetic for IRM KMI (only one day is ever rendered upstream), but keeping
  // them in the stub means the editor's form generator surfaces the same
  // toggles users see for other integrations and merged-config comparisons
  // stay consistent.
  days_relative: true,
  days_abbreviated: false,
  days_boldfaced: false,
  days_uppercase: false,
  show_empty_days: false,
  days_to_show: 1,
  // Default threshold of 1 matches the other adapters' convention of hiding
  // None-level (green) allergens until a measurement crosses Low or higher.
  pollen_threshold: 1,
  sort: "value_descending",
  allergens_abbreviated: false,
  date_locale: undefined,
  title: undefined,
  debug: false,
  show_version: true,
  phrases: {
    full: {},
    short: {},
    levels: [],
    days: {},
    no_information: "",
  },
};

/**
 * Resolve a human-readable location label for an IRM KMI device. The device
 * name is the config-entry title, which is already the location (e.g.
 * "Antwerp", "Saint-Ghislain"); the RMI attribution lives in `manufacturer`,
 * not the name, so no prefix-stripping is needed.
 */
function resolveIrmkmiLabel(ctx: DiscoveryContext): string {
  const device = ctx?.device;
  if (device?.name_by_user) return device.name_by_user;
  if (device?.name) return device.name;
  if (ctx?.state?.attributes?.friendly_name)
    return ctx.state.attributes.friendly_name;
  return "Auto";
}

/**
 * Discover irm-kmi-ha pollen-level sensors grouped by config entry.
 *
 * Three-tier cascade via shared helper:
 *   1. Device registry: hass.devices with identifiers ["irm_kmi", ...].
 *   2. Entity registry: hass.entities filtered by platform === "irm_kmi".
 *   3. Regex fallback: hass.states scanned for the level-entity pattern.
 */
function discoverIrmkmiSensorsUncached(
  hass: HomeAssistant,
  debug = false,
): IrmkmiDiscovery {
  if (!hass) return { locations: new Map() };

  const fallbackRe =
    /^sensor\.\w+_(alder|ash|birch|grasses|hazel|mugwort|oak)_level$/;

  const { locations } = discoverEntitiesByDevice(hass, {
    platform: "irm_kmi",
    classify: classifyIrmkmiEntity,
    resolveLabel: resolveIrmkmiLabel,
    // Tiers 1/2 key by the device's config entry. The tier-3 fallback
    // (registryless HA) has no device context and would otherwise bucket every
    // location under "default", collapsing multi-location installs and dropping
    // all but the first location's entities. Key tier-3 locations by their
    // entity-prefix slug instead so they stay separate.
    resolveLocationKey: (ctx) =>
      ctx.device
        ? deviceLocationKey(ctx.device)
        : extractIrmkmiLocationSlugFromEntityId(ctx.entityId) || "default",
    fallbackRegex: fallbackRe,
    debug,
    logTag: "IRMKMI",
  });

  return { locations };
}

/**
 * Memoized per HA update cycle (#321): every code path that reaches
 * discovery within one tick shares a single sweep. The returned object is
 * shared -- callers must not mutate it.
 */
export const discoverIrmkmiSensors = memoizeByHass(
  discoverIrmkmiSensorsUncached,
);

/**
 * Map allergen keys from config to irm-kmi-ha entity IDs for the resolved
 * location. Falls back to the first discovered location when the configured
 * location key does not match (auto-recovery from stale config_entry_id).
 */
export function resolveEntityIds(
  cfg: CardConfig,
  hass: HomeAssistant,
  debug = false,
): Map<string, string> {
  if (!hass?.states) return new Map();

  const discovery = discoverIrmkmiSensors(hass, debug);
  if (discovery.locations.size === 0) {
    if (debug) console.debug("[IRMKMI:resolveEntityIds] No sensors discovered");
    return new Map();
  }

  // The shared location dropdown offers a "manual" option, but this is a
  // discovery-only adapter with no entity-prefix manual mode (like MSW/GPL/GP).
  // Treat "manual" as autodetect (first discovered location), matching the
  // card header's pervasive `location !== "manual"` handling, instead of
  // silently relying on the stale-location fallback below.
  const wantedLocation =
    cfg?.location === "manual" ? "" : (cfg?.location as string);
  let resolved = resolveLocationByKey(discovery, wantedLocation, {
    slugExtractor: extractIrmkmiLocationSlugFromEntityId,
  });
  if (!resolved) {
    // Stale or unknown location key: fall back to first discovered location
    // (sorted lex/numeric inside resolveLocationByKey when cfgLocation empty).
    resolved = resolveLocationByKey(discovery, "");
    if (debug && cfg?.location) {
      console.debug(
        `[IRMKMI:resolveEntityIds] Location '${cfg.location}' not found; falling back to first discovered location`,
      );
    }
  }
  if (!resolved) return new Map();

  const [, location] = resolved;
  const map = new Map<string, string>();
  for (const allergen of (cfg?.allergens as string[] | undefined) || []) {
    const eid = location.entities.get(allergen);
    if (eid) {
      map.set(allergen, eid);
      if (debug)
        console.debug(`[IRMKMI:resolveEntityIds] ${allergen} -> ${eid}`);
    } else if (debug) {
      console.debug(
        `[IRMKMI:resolveEntityIds] No entity for '${allergen}' in resolved location`,
      );
    }
  }
  return map;
}

/**
 * Fetch current pollen levels from irm-kmi-ha entities.
 * Returns one day (today) per allergen.
 */
export async function fetchForecast(
  hass: HomeAssistant,
  config: CardConfig,
): Promise<PollenSensor[]> {
  if (!hass?.states || !(config.allergens as string[] | undefined)?.length)
    return [];
  const debug = Boolean(config.debug);

  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } =
    getLangAndLocale(
      hass,
      config,
      stubConfigIRMKMI.date_locale as string | undefined,
    );
  const { fullPhrases, shortPhrases, userLevels, userDays } = mergePhrases(
    config,
    lang,
  );
  // Five-level scale: defaults from card.levels5.0..4, native-indexed.
  const levelNames = buildLevelNamesForScale(
    5,
    userLevels as Array<string | null | undefined>,
    lang,
  );
  const pollen_threshold =
    (config.pollen_threshold as number | undefined) ??
    (stubConfigIRMKMI.pollen_threshold as number);

  if (debug)
    console.debug("IRMKMI adapter: start fetchForecast", { config, lang });

  const sensors: PollenSensor[] = [];
  const entityMap = resolveEntityIds(config, hass, debug);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayLabel = buildDayLabel(today, 0, {
    daysRelative,
    dayAbbrev,
    daysUppercase,
    userDays,
    lang,
    locale,
  });

  for (const allergen of config.allergens as string[]) {
    try {
      const entityId = entityMap.get(allergen);
      if (!entityId) continue;

      const stateObj = hass.states[entityId];
      if (!stateObj) continue;

      const rawState =
        typeof stateObj.state === "string" ? stateObj.state.toLowerCase() : "";
      const level = IRMKMI_LEVEL_MAP[rawState];
      if (level === undefined) continue; // none / active / unavailable / unknown -> no-data

      const { allergenCapitalized, allergenShort } = resolveAllergenNames(
        allergen,
        {
          fullPhrases,
          shortPhrases,
          abbreviated: config.allergens_abbreviated as boolean,
          lang,
          configKey: allergen,
        },
      );

      const stateText = levelNames[level] ?? rawState;

      const day0: ForecastDay = {
        name: allergenCapitalized,
        day: dayLabel,
        state: level,
        display_state: level,
        state_text: stateText,
      };

      const dict: PollenSensor = {
        allergenReplaced: allergen,
        allergenCapitalized,
        allergenShort,
        entity_id: entityId,
        days: [day0],
      };

      if (meetsThreshold(dict.days, pollen_threshold)) sensors.push(dict);
    } catch (e) {
      console.warn(`IRMKMI adapter error for allergen ${allergen}:`, e);
    }
  }

  sortSensors(sensors, config.sort as string);

  if (debug) console.debug("IRMKMI adapter complete sensors:", sensors);
  return sensors;
}

/**
 * Autodetect descriptor. IRM KMI entity ids follow
 * sensor.<location-slug>_<allergen>_level. Detection uses the `irm_kmi`
 * platform in hass.entities (primary) with a regex fallback for older
 * registries. Discovery is lazy (used only by autoSelectLocation).
 */
export const autodetect: AdapterAutodetect = {
  priority: 10,
  detectStates(
    hass: HomeAssistant,
    ctx: AutodetectContext,
  ): AutodetectDetectResult {
    const irmkmiLevelRe =
      /_(?:alder|ash|birch|grasses|hazel|mugwort|oak)_level$/;
    let ids: string[] = [];
    if (hass && hass.entities) {
      ids = Object.entries(hass.entities)
        .filter(
          ([eid, entry]) =>
            (entry as { platform?: string }).platform === "irm_kmi" &&
            !(entry as { entity_category?: string }).entity_category &&
            irmkmiLevelRe.test(eid),
        )
        .map(([eid]) => eid);
    }
    if (!ids.length) {
      ids = ctx.stateIds.filter(
        (id) =>
          typeof id === "string" &&
          /^sensor\.\w+_(?:alder|ash|birch|grasses|hazel|mugwort|oak)_level$/.test(
            id,
          ),
      );
    }
    return { ids };
  },
  discover: (hass, debug) =>
    discoverIrmkmiSensors(hass, debug) as AutodetectDiscovery,
};
