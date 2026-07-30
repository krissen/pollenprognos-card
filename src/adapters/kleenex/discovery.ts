// src/adapters/kleenex/discovery.ts
import type { HomeAssistant } from "../../types/home-assistant.js";
import type { CardConfig } from "../../types/config.js";
import { KLEENEX_LOCALIZED_CATEGORY_NAMES } from "../../constants.js";
import { slugify } from "../../utils/slugify.js";
import {
  normalizeManualPrefix,
  discoverEntitiesByDevice,
  deviceLocationKey,
  type DeviceDiscovery,
  type DiscoveryContext,
} from "../../utils/adapter-helpers.js";
import {
  INDIVIDUAL_TO_CATEGORY,
  KLEENEX_ALLERGEN_MAP,
  DOMAIN,
  PLATFORM,
} from "./constants.js";

// The three category keys the integration exposes as first-class sensors.
// They are reserved for the category sensors: a per-allergen detail sensor that
// happens to alias onto one of them (e.g. a detail literally named "Grass") is
// dropped rather than allowed to shadow the category sensor.
const CATEGORY_KEYS = new Set(["trees", "grass", "weeds"]);

// Translation keys of entities that carry no allergen reading: the enum level
// mirrors of the category sensors, the timestamps and the diagnostics. Several
// of these have no entity_category upstream, so discovery's default exclusion
// does not filter them -- the classifier must reject them explicitly.
const NON_ALLERGEN_TRANSLATION_KEYS = new Set([
  "trees_level",
  "grass_level",
  "weeds_level",
  "detail_level",
  "date",
  "last_updated",
  "latitude",
  "longitude",
  "city",
  "region",
  "error",
]);

// Static lookup: slugified alias key -> canonical allergen name. Built once
// from KLEENEX_ALLERGEN_MAP since the map is module-level constant data.
const SLUGIFIED_ALIAS_MAP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [alias, canonical] of Object.entries(KLEENEX_ALLERGEN_MAP)) {
    const slug = slugify(alias);
    if (!m.has(slug)) m.set(slug, canonical);
  }
  return m;
})();

/**
 * Resolve a canonical allergen name from an entity-ID suffix.
 *
 * Tries the whole suffix first, then progressively shorter trailing segments,
 * so `amsterdam_noord_bouleau` still resolves to `birch` when the location part
 * could not be stripped up front.
 */
export function canonicalAllergenFromSlug(
  suffix: string,
): string | undefined {
  const direct = SLUGIFIED_ALIAS_MAP.get(suffix);
  if (direct) return direct;
  if (!suffix.includes("_")) return undefined;
  const parts = suffix.split("_");
  for (let i = 1; i < parts.length; i++) {
    const match = SLUGIFIED_ALIAS_MAP.get(parts.slice(i).join("_"));
    if (match) return match;
  }
  return undefined;
}

// Static reverse index: canonical allergen name -> Set of slugified alias
// entity-suffixes. Built once from KLEENEX_ALLERGEN_MAP since the map is
// module-level constant data.
const CANONICAL_TO_ALIAS_SLUGS: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const [alias, canonical] of Object.entries(KLEENEX_ALLERGEN_MAP)) {
    let slugs = m.get(canonical);
    if (!slugs) {
      slugs = new Set<string>();
      m.set(canonical, slugs);
    }
    slugs.add(slugify(alias));
  }
  return m;
})();

// Entity-ID suffixes that are diagnostics rather than allergen readings. Used
// by the legacy (registry-less) classification paths here and in forecast.ts.
export const DIAGNOSTIC_SUFFIXES = new Set([
  "level",
  "date",
  "last_updated",
  "latitude",
  "longitude",
  "city",
  "region",
  "error",
]);

/** Strip `sensor.` and the legacy default-device prefix from an entity ID. */
function entityIdSuffix(entityId: string): string {
  const legacy = `sensor.${DOMAIN}_`;
  if (entityId.startsWith(legacy)) return entityId.slice(legacy.length);
  return entityId.startsWith("sensor.") ? entityId.slice(7) : entityId;
}

/** True when the suffix is (or ends with) a known diagnostic token. */
function isDiagnosticSuffix(suffix: string): boolean {
  if (suffix.endsWith("_level")) return true;
  for (const diag of DIAGNOSTIC_SUFFIXES) {
    if (suffix === diag || suffix.endsWith(`_${diag}`)) return true;
  }
  return false;
}

/**
 * Classify an entity from its ID alone. Used for entities without a registry
 * entry (tier 3) and as the fallback for unknown translation keys: the last
 * token decides a category, otherwise the trailing slug is matched against the
 * allergen alias table.
 */
function classifyByEntityId(entityId: string): string | null {
  const suffix = entityIdSuffix(entityId);
  const lastToken = suffix.split("_").pop() as string;
  for (const [localizedPrefix, canonicalCategory] of Object.entries(
    KLEENEX_LOCALIZED_CATEGORY_NAMES,
  )) {
    if (lastToken.startsWith(localizedPrefix)) return canonicalCategory;
  }
  if (isDiagnosticSuffix(suffix)) return null;
  const canonical = canonicalAllergenFromSlug(suffix);
  return canonical && !CATEGORY_KEYS.has(canonical) ? canonical : null;
}

/**
 * Resolve the canonical allergen behind a per-allergen detail sensor. All of
 * them share the `detail_value` translation key, so the allergen name survives
 * only in the entity-ID slug and the friendly name.
 */
function classifyDetailEntity(
  entityId: string,
  ctx: DiscoveryContext,
): string | null {
  const canonical = canonicalAllergenFromSlug(entityIdSuffix(entityId));
  if (canonical && !CATEGORY_KEYS.has(canonical)) return canonical;

  // The ID slug follows the HA language at first registration, which may use
  // an allergen spelling the alias table doesn't cover; the friendly name ends
  // with the same word and is worth one more try.
  const friendly = ctx.state?.attributes?.friendly_name;
  if (typeof friendly === "string") {
    const lastWord = friendly.trim().split(/\s+/).pop();
    if (lastWord) {
      const byName = KLEENEX_ALLERGEN_MAP[lastWord.toLowerCase()];
      if (byName && !CATEGORY_KEYS.has(byName)) return byName;
    }
  }
  return null;
}

/**
 * Classify a Kleenex entity into a category key (`trees`/`grass`/`weeds`), a
 * canonical allergen name, or null (not an allergen reading).
 *
 * Registry entries are classified on translation_key, which is the only stable
 * signal: entity IDs are derived from the (renameable) device name plus the
 * translated sensor name, so neither a domain prefix nor a location slug can be
 * assumed (issue #309).
 */
function classifyKleenexEntity(
  entityId: string,
  ctx: DiscoveryContext,
): string | null {
  const tk = ctx.entry?.translation_key;
  if (typeof tk === "string" && tk) {
    if (CATEGORY_KEYS.has(tk)) return tk;
    if (NON_ALLERGEN_TRANSLATION_KEYS.has(tk)) return null;
    if (tk === "detail_value") return classifyDetailEntity(entityId, ctx);
    // Unknown key from a future integration version: fall through to the
    // entity-ID heuristic instead of guessing from the key.
  }
  return classifyByEntityId(entityId);
}

/** Resolve a human-readable location label for a discovered device. */
function resolveKleenexLabel(ctx: DiscoveryContext): string {
  const device = ctx.device;
  if (device?.name_by_user) return device.name_by_user;
  if (device?.name) {
    // Default device name is "Kleenex Pollen Radar (<instance>)"; the instance
    // is what the user configured as the location.
    const m = /^Kleenex Pollen Radar\s*\((.+)\)\s*$/.exec(device.name);
    if (m) return m[1].trim();
    return device.name;
  }

  const friendly = ctx.state?.attributes?.friendly_name;
  if (typeof friendly === "string") {
    const cleaned = friendly
      .replace(/^Kleenex Pollen Radar\s*[(-]?\s*/i, "")
      .replace(
        /[)\s]+(?:Trees|Grass|Weeds|Bomen|Gras|Kruiden|Onkruid|Arbres|Gramin[eé]+s?|Herbac[eé]+s?|Alberi|Graminacee|Erbacee).*$/i,
        "",
      )
      .replace(
        /^(?:Trees|Grass|Weeds|Bomen|Gras|Kruiden|Onkruid|Arbres|Gramin[eé]+s?|Herbac[eé]+s?|Alberi|Graminacee|Erbacee)(?:\s.*)?$/i,
        "",
      )
      .trim();
    if (cleaned) return cleaned;
  }

  const slug = entityIdSuffix(ctx.entityId).replace(/_[^_]+$/, "");
  if (slug) return slug.charAt(0).toUpperCase() + slug.slice(1);
  return "Auto";
}

/**
 * Discover Kleenex Pollen Radar entities grouped by location (one config entry
 * and one device per configured location).
 *
 * Thin wrapper around discoverEntitiesByDevice. Tiers 1/2 key locations by the
 * device's config entry; tier 3 (no registry at all) keys them by the legacy
 * `sensor.kleenex_pollen_radar_<location>_<sensor>` slug so old configs keep
 * resolving. Collisions keep the first entity seen -- detail sensors that would
 * alias onto a category key are already rejected by the classifier, so a
 * category sensor can never be displaced by a detail sensor.
 */
export function discoverKleenex(
  hass: HomeAssistant,
  debug = false,
): DeviceDiscovery {
  if (!hass) return { locations: new Map(), tierUsed: 0 };

  return discoverEntitiesByDevice(hass, {
    platform: PLATFORM,
    classify: classifyKleenexEntity,
    resolveLabel: resolveKleenexLabel,
    resolveLocationKey: (ctx) => {
      if (ctx.tier === 3) {
        const slug = entityIdSuffix(ctx.entityId).replace(/_[^_]+$/, "");
        return slug || "default";
      }
      return deviceLocationKey(ctx.device);
    },
    fallbackRegex: /^sensor\.kleenex_pollen_radar_/,
    debug,
    logTag: "Kleenex",
  });
}

/**
 * Resolve entity IDs for sensor detection.
 *
 * Returns Map<key, entityId> where each key is either:
 *   - a category name (`trees`/`grass`/`weeds`) mapped to the category sensor,
 *     covered when the configured allergens include that category or any
 *     individual allergen belonging to it; or
 *   - an individual allergen name (e.g. `birch`, `oak`) mapped to a per-allergen
 *     `KleenexDetailSensor` entity, covered when such an entity exists in HA
 *     (the user has manually enabled the disabled-by-default detail sensors).
 */
export function resolveEntityIds(
  cfg: CardConfig,
  hass: HomeAssistant,
  debug = false,
): Map<string, string> {
  const map = new Map<string, string>();
  const locationSlug = slugify((cfg.location as string) || "");
  const categoryAllergens = ["trees", "grass", "weeds"];

  // Determine which categories are needed
  const needsCategories = new Set<string>();
  for (const allergen of (cfg.allergens as string[] | undefined) || []) {
    if (categoryAllergens.includes(allergen)) {
      needsCategories.add(allergen);
    } else if (allergen.endsWith("_cat")) {
      const categoryName = allergen.replace("_cat", "");
      if (categoryAllergens.includes(categoryName)) {
        needsCategories.add(categoryName);
      }
    } else {
      const category = INDIVIDUAL_TO_CATEGORY[allergen];
      if (category) needsCategories.add(category);
    }
  }

  for (const category of needsCategories) {
    let sensorId: string | undefined;
    if (cfg.location === "manual") {
      const prefix = normalizeManualPrefix(cfg.entity_prefix);
      const suffix = (cfg.entity_suffix as string) || "";

      sensorId = `sensor.${prefix}${category}${suffix}`;
      if (!hass.states[sensorId]) {
        const possiblePrefixes = Object.entries(KLEENEX_LOCALIZED_CATEGORY_NAMES)
          .filter(([, canonical]) => canonical === category)
          .map(([localPrefix]) => localPrefix);

        const expectedPrefix = `sensor.${prefix}`;
        const candidates = Object.keys(hass.states).filter((id) => {
          if (!id.startsWith(expectedPrefix)) return false;
          const middle = id.substring(expectedPrefix.length);
          if (suffix && !middle.endsWith(suffix)) return false;
          const categoryPart = suffix
            ? middle.substring(0, middle.length - suffix.length)
            : middle;
          return possiblePrefixes.some((lp) => categoryPart.startsWith(lp));
        });
        if (candidates.length >= 1) sensorId = candidates[0];
      }
    } else {
      sensorId = locationSlug
        ? `sensor.kleenex_pollen_radar_${locationSlug}_${category}`
        : undefined;
      if (!sensorId || !hass.states[sensorId]) {
        const possiblePrefixes = Object.entries(KLEENEX_LOCALIZED_CATEGORY_NAMES)
          .filter(([, canonical]) => canonical === category)
          .map(([lp]) => lp);

        const candidates = Object.keys(hass.states).filter((id) => {
          if (!id.startsWith("sensor.kleenex_pollen_radar_")) return false;
          if (locationSlug) {
            const afterPrefix = id.substring(
              "sensor.kleenex_pollen_radar_".length,
            );
            if (!afterPrefix.startsWith(locationSlug + "_")) return false;
          }
          const parts = id.split("_");
          const suffix = parts[parts.length - 1];
          return possiblePrefixes.some((lp) => suffix.startsWith(lp));
        });
        if (candidates.length >= 1) sensorId = candidates[0];
      }
    }

    if (debug) {
      console.debug(
        `[Kleenex:resolveEntityIds] category: '${category}', sensorId: '${sensorId}', exists: ${!!(sensorId && hass.states[sensorId])}`,
      );
    }
    if (sensorId && hass.states[sensorId]) map.set(category, sensorId);
  }

  // Also probe for individually-enabled DetailSensor entities.
  // These are disabled by default in HA (entity_registry_enabled_default=False) but
  // users may enable them. For NA zones they don't exist at all; for EU/UK zones they
  // give per-allergen data when the category sensor's details[] is empty.
  const individualAllergens = ((cfg.allergens as string[] | undefined) || []).filter(
    (a) =>
      !["trees_cat", "grass_cat", "weeds_cat", "trees", "grass", "weeds"].includes(
        a,
      ),
  );

  for (const allergen of individualAllergens) {
    // map already has this allergen (from some other path) — skip.
    if (map.has(allergen)) continue;

    let detailSensorId: string | undefined;
    // Cover both alias-keyed slugs and the canonical name itself (in case the
    // canonical isn't an alias key in KLEENEX_ALLERGEN_MAP).
    const aliasesForCanonical = new Set(
      CANONICAL_TO_ALIAS_SLUGS.get(allergen) || [],
    );
    aliasesForCanonical.add(slugify(allergen));

    if (cfg.location === "manual") {
      const prefix = normalizeManualPrefix(cfg.entity_prefix);
      const suffix = (cfg.entity_suffix as string) || "";
      for (const aliasSlug of aliasesForCanonical) {
        const candidate = `sensor.${prefix}${aliasSlug}${suffix}`;
        if (hass.states[candidate]) {
          detailSensorId = candidate;
          break;
        }
      }
    } else if (locationSlug) {
      for (const aliasSlug of aliasesForCanonical) {
        const candidate = `sensor.kleenex_pollen_radar_${locationSlug}_${aliasSlug}`;
        if (hass.states[candidate]) {
          detailSensorId = candidate;
          break;
        }
      }
    }

    if (detailSensorId) {
      if (debug) {
        console.debug(
          `[Kleenex:resolveEntityIds] DetailSensor for '${allergen}': '${detailSensorId}'`,
        );
      }
      map.set(allergen, detailSensorId);
    }
  }

  return map;
}
