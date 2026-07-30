// src/adapters/kleenex/discovery.ts
import type {
  HassEntity,
  HomeAssistant,
  DeviceRegistryEntry,
} from "../../types/home-assistant.js";
import type { CardConfig } from "../../types/config.js";
import { KLEENEX_LOCALIZED_CATEGORY_NAMES } from "../../constants.js";
import { slugify } from "../../utils/slugify.js";
import {
  normalizeManualPrefix,
  discoverEntitiesByDevice,
  deviceLocationKey,
  resolveLocationByKey,
  type DeviceDiscovery,
  type DiscoveredLocation,
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
export const CATEGORY_KEYS = new Set(["trees", "grass", "weeds"]);

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

/**
 * Normalize an allergen name as reported by the integration, for lookups
 * against KLEENEX_ALLERGEN_MAP and the configured allergen list.
 *
 * The feed is not whitespace-clean: the FR and IT zones report names like
 * `"Poaceae "`, and an unnormalized key matches neither the alias map nor the
 * config, so the row disappears without a trace. Leading/trailing whitespace is
 * stripped, runs of inner whitespace collapse to a single space, and the result
 * is lowercased. Every name-to-allergen lookup in this adapter goes through
 * here, so a new upstream spelling only ever needs an alias, never a second
 * normalization rule. Returns an empty string for anything unusable.
 */
export function normalizeDetailName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
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
 * Classify an entity from its ID alone: the classified key
 * (`trees`/`grass`/`weeds` or a canonical allergen), or null for diagnostics
 * and anything unrecognised.
 *
 * Used for entities without a registry entry (tier 3), as the fallback for
 * unknown translation keys, and by the card header to tell a renderable sensor
 * from a diagnostic one in manual mode: the last token decides a category,
 * otherwise the trailing slug is matched against the allergen alias table.
 */
export function classifyKleenexEntityId(entityId: string): string | null {
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
 * Read the allergen out of a detail sensor's registry unique_id, which the
 * integration builds as
 * `<entry_id>-Kleenex Pollen Radar<group>_details-<PollenName>-<value|level>`.
 * The name is the second-to-last dash-separated segment.
 *
 * This is the only non-user-editable carrier of the allergen name, so it is
 * tried first -- but only when present: the frontend's reduced `hass.entities`
 * usually omits unique_id, hence the name-based candidates below.
 */
function allergenFromUniqueId(
  uniqueId: string | null | undefined,
): string | null {
  if (typeof uniqueId !== "string" || !uniqueId) return null;
  const parts = uniqueId.split("-");
  if (parts.length < 2) return null;
  const name = normalizeDetailName(parts[parts.length - 2]);
  if (!name) return null;
  const canonical = KLEENEX_ALLERGEN_MAP[name];
  return canonical && !CATEGORY_KEYS.has(canonical) ? canonical : null;
}

/**
 * Resolve the canonical allergen behind a per-allergen detail sensor. All of
 * them share the `detail_value` translation key, so the allergen name survives
 * in the registry unique_id when the frontend exposes it, and otherwise only in
 * the entity-ID slug and the friendly name -- both of which the user can edit.
 */
function classifyDetailEntity(
  entityId: string,
  ctx: DiscoveryContext,
): string | null {
  const byUniqueId = allergenFromUniqueId(ctx.entry?.unique_id);
  if (byUniqueId) return byUniqueId;

  const canonical = canonicalAllergenFromSlug(entityIdSuffix(entityId));
  if (canonical && !CATEGORY_KEYS.has(canonical)) return canonical;

  // The ID slug follows the HA language at first registration, which may use
  // an allergen spelling the alias table doesn't cover; the friendly name ends
  // with the same word and is worth one more try.
  const friendly = ctx.state?.attributes?.friendly_name;
  if (typeof friendly === "string") {
    const lastWord = friendly.trim().split(/\s+/).pop();
    if (lastWord) {
      const byName = KLEENEX_ALLERGEN_MAP[normalizeDetailName(lastWord)];
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
  return classifyKleenexEntityId(entityId);
}

/**
 * The location name a device stands for: the user's own rename verbatim,
 * otherwise the instance inside the default name "Kleenex Pollen Radar
 * (<instance>)", which is what the user configured as the location. Null when
 * the device carries no name at all.
 *
 * Both user-visible label paths go through here -- the discovered location
 * label and the manual-scoping warning/header -- so an upstream change to the
 * default naming cannot make them disagree.
 */
function deviceDisplayLabel(
  device: DeviceRegistryEntry | null | undefined,
): string | null {
  if (device?.name_by_user) return device.name_by_user;
  if (device?.name) {
    const m = /^Kleenex Pollen Radar\s*\((.+)\)\s*$/.exec(device.name);
    return m?.[1]?.trim() || device.name;
  }
  return null;
}

/** Resolve a human-readable location label for a discovered device. */
function resolveKleenexLabel(ctx: DiscoveryContext): string {
  const fromDevice = deviceDisplayLabel(ctx.device);
  if (fromDevice) return fromDevice;

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

/** Slugified instance name from a device's `kleenex_pollenradar` identifier. */
function deviceIdentifierSlug(
  device: DeviceRegistryEntry | null | undefined,
): string | null {
  const identifiers = device?.identifiers;
  if (!Array.isArray(identifiers)) return null;
  for (const tuple of identifiers) {
    if (!Array.isArray(tuple) || tuple[0] !== PLATFORM || !tuple[1]) continue;
    const slug = slugify(String(tuple[1]));
    if (slug) return slug;
  }
  return null;
}

/**
 * Map device id -> identifier slug, for devices whose slug is unambiguous.
 *
 * Two config entries created with the same instance name slugify to the same
 * key and would merge into one location, so those devices are dropped here and
 * fall back to the unique config-entry key.
 */
function buildIdentifierKeys(hass: HomeAssistant): Map<string, string> {
  const byDevice = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const [deviceId, device] of Object.entries(hass.devices || {})) {
    const slug = deviceIdentifierSlug(device);
    if (!slug) continue;
    byDevice.set(deviceId, slug);
    counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  for (const [deviceId, slug] of [...byDevice]) {
    if ((counts.get(slug) || 0) > 1) byDevice.delete(deviceId);
  }
  return byDevice;
}

/**
 * Discover Kleenex Pollen Radar entities grouped by location (one config entry
 * and one device per configured location).
 *
 * Thin wrapper around discoverEntitiesByDevice. Locations are keyed by the
 * slugified device identifier (the config-entry instance name), which is both
 * human-readable in YAML and stable across renames *and* across removing and
 * re-adding the integration -- unlike the config-entry id, which is a fresh
 * ULID every time. It is also the exact string the legacy entity-ID slug was
 * minted from, so pre-existing configs match on the key directly. Devices
 * without a usable identifier keep the config-entry key; tier 3 (no registry at
 * all) keys by the legacy `sensor.kleenex_pollen_radar_<location>_<sensor>`
 * slug. Collisions keep the first entity seen -- detail sensors that would alias
 * onto a category key are already rejected by the classifier, so a category
 * sensor can never be displaced by a detail sensor.
 */
export function discoverKleenex(
  hass: HomeAssistant,
  debug = false,
): DeviceDiscovery {
  if (!hass) return { locations: new Map(), tierUsed: 0 };

  const identifierKeys = buildIdentifierKeys(hass);

  return discoverEntitiesByDevice(hass, {
    platform: PLATFORM,
    classify: classifyKleenexEntity,
    resolveLabel: resolveKleenexLabel,
    resolveLocationKey: (ctx) => {
      if (ctx.tier === 3) {
        const slug = entityIdSuffix(ctx.entityId).replace(/_[^_]+$/, "");
        return slug || "default";
      }
      const identifierSlug = ctx.deviceId
        ? identifierKeys.get(ctx.deviceId)
        : undefined;
      return identifierSlug || deviceLocationKey(ctx.device);
    },
    fallbackRegex: /^sensor\.kleenex_pollen_radar_/,
    debug,
    logTag: "Kleenex",
  });
}

/**
 * Extract the legacy location slug from an entity ID
 * (`sensor.kleenex_pollen_radar_<location>_<sensor>` -> `<location>`), so
 * configs written before registry discovery keep resolving.
 */
export function kleenexSlugExtractor(entityId: string): string | null {
  const slug = entityIdSuffix(entityId).replace(/_[^_]+$/, "");
  return slug || null;
}

/**
 * Match a config location against the slugified device identifier
 * (`("kleenex_pollenradar", "<instance>")`).
 *
 * The identifier carries the config-entry instance name, which is exactly what
 * the legacy entity-ID slug was minted from (default device name
 * "Kleenex Pollen Radar (Home)" -> `..._home_trees`). Unlike the entity IDs and
 * the device name, it survives a rename, so a legacy `location: home` config
 * still resolves for a user who has renamed both the device and its entities.
 *
 * Mirrors the ambiguity rule of buildIdentifierKeys: when two instance names
 * normalize to the same slug ("St. John" and "St John"), the config value
 * cannot say which one it meant. That outcome is reported as `"ambiguous"`
 * rather than as `null`, because the two are not interchangeable: `null` means
 * "no identifier knows this value, try the generic label/entity-ID chain",
 * while `"ambiguous"` means "the identifiers know it and disagree". Falling
 * through to the generic chain on an ambiguous slug would just re-pick one of
 * the same two devices by registry iteration order -- silently showing another
 * location's forecast -- so callers must stop instead.
 */
export type KleenexIdentifierMatch =
  | [string, DiscoveredLocation]
  | "ambiguous"
  | null;

export function matchKleenexLocationByIdentifier(
  hass: HomeAssistant,
  discovery: { locations: Map<string, DiscoveredLocation> },
  cfgLocation: string | null | undefined,
): KleenexIdentifierMatch {
  if (!cfgLocation) return null;
  const needle = slugify(String(cfgLocation));
  if (!needle) return null;

  let found: [string, DiscoveredLocation] | null = null;
  for (const [key, loc] of discovery.locations) {
    const device = loc.deviceId ? hass.devices?.[loc.deviceId] : undefined;
    if (deviceIdentifierSlug(device) !== needle) continue;
    if (found) return "ambiguous";
    found = [key, loc];
  }
  return found;
}

/**
 * The name-based candidate steps, in precedence order, each as the list of
 * locations it matches:
 *
 *   1. exact (case-insensitive) label equality,
 *   2. entity-ID slug (what findLocationBySlug matches),
 *   3. slugified label -- so a legacy multiword slug like `new_york` still
 *      finds the device labelled "New York" once its entity IDs are re-minted;
 *      neither literal nor fuzzy matching gets there, because the label
 *      contains a space and the config value an underscore,
 *   4. fuzzy label containment.
 *
 * Steps 1, 2 and 4 mirror resolveLocationByKey's order so existing configs keep
 * resolving to the same location; step 3 sits before the fuzzy step, i.e. it
 * can only catch configs that previously fell through to fuzzy matching or
 * failed outright.
 *
 * Whole lists rather than a single match, because the caller must be able to
 * tell "one location matched" from "several did".
 */
function nameCandidateSteps(
  discovery: { locations: Map<string, DiscoveredLocation> },
  cfgLocation: string,
): [string, DiscoveredLocation][][] {
  // findLocationBySlug lowercases the needle and compares it to the extracted
  // slug verbatim, so the same lowercased value is used for both steps here.
  const needle = String(cfgLocation).toLowerCase();
  const needleSlug = slugify(String(cfgLocation));
  const labelExact: [string, DiscoveredLocation][] = [];
  const entitySlug: [string, DiscoveredLocation][] = [];
  const labelSlug: [string, DiscoveredLocation][] = [];
  const fuzzyLabel: [string, DiscoveredLocation][] = [];

  for (const [key, loc] of discovery.locations) {
    const label = loc.label ? String(loc.label).toLowerCase() : "";
    if (label && label === needle) labelExact.push([key, loc]);
    if (label && needleSlug && slugify(String(loc.label)) === needleSlug) {
      labelSlug.push([key, loc]);
    }
    if (label && label.includes(needle)) fuzzyLabel.push([key, loc]);

    for (const eid of loc.entities.values()) {
      const lid = String(eid).toLowerCase();
      const extracted = kleenexSlugExtractor(eid);
      if (
        (extracted && extracted.toLowerCase() === needle) ||
        lid.endsWith(`_${needle}`) ||
        lid.endsWith(`_${needle}_j_1`)
      ) {
        entitySlug.push([key, loc]);
        break;
      }
    }
  }

  return [labelExact, entitySlug, labelSlug, fuzzyLabel];
}

/**
 * Resolve a config location value against a discovery result, using the full
 * Kleenex candidate chain:
 *
 *   1. exact discovery key (the identifier slug for modern installs),
 *   2. device identifier (rename-stable; `"ambiguous"` when several match),
 *   3. the name-based steps in nameCandidateSteps, which cover devices with no
 *      usable identifier. Every step is checked for multiplicity, so two
 *      devices both labelled "Home" yield `"ambiguous"` instead of whichever
 *      the registry lists first.
 *
 * This is the single definition of "which location does this config mean" for
 * Kleenex. The card, both editors and the adapter all go through it (via the
 * autodetect descriptor for the UI layers), because three hand-mirrored copies
 * of the chain drifted apart three times during review: each caller that
 * reproduces only part of it silently resolves a different set of configs.
 */
export function resolveKleenexLocationEntry(
  hass: HomeAssistant,
  discovery: { locations: Map<string, DiscoveredLocation> },
  cfgLocation: string | null | undefined,
): KleenexIdentifierMatch {
  if (cfgLocation && discovery.locations.has(cfgLocation)) {
    return [cfgLocation, discovery.locations.get(cfgLocation)!];
  }

  const byIdentifier = matchKleenexLocationByIdentifier(
    hass,
    discovery,
    cfgLocation,
  );
  if (byIdentifier === "ambiguous") return "ambiguous";
  if (byIdentifier) return byIdentifier;

  // The name-based steps run here rather than in resolveLocationByKey: the
  // generic helper is shared with atmo/pp/gpl and keeps its first-match
  // semantics for them, while Kleenex needs both the extra slugified-label
  // candidate and the multiplicity rule on every step.
  if (cfgLocation) {
    for (const step of nameCandidateSteps(discovery, cfgLocation)) {
      if (step.length === 0) continue;
      // The first step with any match decides; more than one match there means
      // the config value cannot say which location it meant.
      return step.length > 1 ? "ambiguous" : step[0]!;
    }
    return null;
  }

  // Empty cfgLocation means "auto-pick the first location" -- the helper's own
  // deterministic sort, deliberately unchanged.
  return resolveLocationByKey(discovery, cfgLocation, {
    slugExtractor: kleenexSlugExtractor,
  });
}

// Manual-mode narrowing is silent by design in the common case, but the one
// time it drops data the user must hear about it. Dedup keyed on the config
// identity, mirroring the NA-zone warning in forecast.ts, so a warning is
// emitted once per configuration rather than on every HA state update.
const MANUAL_SCOPE_WARNED_KEYS = new Set<string>();

/** Test-only hook to clear the dedup state between cases. */
export function _resetManualScopeWarningsForTest(): void {
  MANUAL_SCOPE_WARNED_KEYS.clear();
}

/**
 * Tell the user, once per configuration, that a manual prefix matched more
 * than one location and which one survived. Narrowing removes rows and renames
 * the header, so it must never be a silent decision.
 */
function warnOnceAboutNarrowing(
  prefix: string,
  suffix: string,
  kept: string,
  dropped: string[],
): void {
  const warnKey = `${prefix}|${suffix}`;
  if (MANUAL_SCOPE_WARNED_KEYS.has(warnKey)) return;
  MANUAL_SCOPE_WARNED_KEYS.add(warnKey);
  console.warn(
    `[Kleenex] The configured entity_prefix '${prefix}' matches entities from several locations. Showing '${kept}' and ignoring: ${dropped.join(", ")}. Use a prefix that only matches the location you want, or switch from manual to a location-based config.`,
  );
}

/**
 * Every slug a discovered location can reasonably be addressed by: its
 * discovery key (the config-entry instance slug), its label, and both device
 * names. A manual `entity_prefix` is minted from one of these, so they are what
 * prefix ownership is decided on.
 */
function locationSlugCandidates(
  hass: HomeAssistant,
  key: string,
  loc: DiscoveredLocation | undefined,
): Set<string> {
  const out = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string" || !value) return;
    const slug = slugify(value);
    if (slug) out.add(slug);
  };
  add(key);
  add(loc?.label);
  const device = loc?.deviceId ? hass.devices?.[loc.deviceId] : undefined;
  add(device?.name_by_user);
  add(device?.name);
  return out;
}

/** Every slug a *device* can be addressed by, for prefix-ownership matching. */
function deviceSlugCandidates(
  device: DeviceRegistryEntry | null | undefined,
): Set<string> {
  const out = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string" || !value) return;
    const slug = slugify(value);
    if (slug) out.add(slug);
  };
  add(deviceIdentifierSlug(device));
  add(device?.name_by_user);
  add(device?.name);
  return out;
}

/**
 * Device ids of every Kleenex device the registry knows, from both signals
 * discovery itself accepts: a `kleenex_pollenradar` device identifier (tier 1)
 * and an entity registry entry whose platform is ours (tier 2).
 *
 * A mixed registry exposes some devices only the second way. Recognising just
 * the first would leave those devices outside the integration's membership, so
 * scoping would treat their entities as somebody else's and keep them --
 * merging two locations after all (Codex round 3 on PR #315).
 */
function kleenexDeviceIds(hass: HomeAssistant): Set<string> {
  const out = new Set<string>();
  for (const [deviceId, device] of Object.entries(hass?.devices || {})) {
    if (deviceIdentifierSlug(device)) out.add(deviceId);
  }
  for (const entry of Object.values(hass?.entities || {})) {
    const deviceId = entry?.device_id;
    if (deviceId && entry?.platform === PLATFORM) out.add(deviceId);
  }
  return out;
}

/**
 * The Kleenex device a manual `entity_prefix` was minted from, if any.
 *
 * Read from the device registry rather than from discovery, because discovery
 * only sees devices with state-backed entities: when the intended config entry
 * is down, its device is absent from discovery entirely, and deciding ownership
 * on discovery alone would silently hand the prefix to whichever *other*
 * location it happens to match (Codex round 2 on PR #315). Ownership must
 * survive the owner having no data -- the card then shows its usual empty state
 * for the right place instead of another city's forecast.
 */
function findPrefixOwnerDevice(
  hass: HomeAssistant,
  needle: string,
): string | null {
  if (!needle) return null;
  let found: string | null = null;
  for (const deviceId of kleenexDeviceIds(hass)) {
    const device = hass?.devices?.[deviceId];
    if (!device) continue;
    if (!deviceSlugCandidates(device).has(needle)) continue;
    // Two devices answering to the same slug cannot say which was meant; the
    // discovery-based path below applies its own tie-breaks instead.
    if (found) return null;
    found = deviceId;
  }
  return found;
}

/** Outcome of scoping a manual-mode prefix match to a single location. */
export interface KleenexManualScope {
  /** The entity IDs the card should use, in the order they were given. */
  entityIds: string[];
  /**
   * Label of the location the match was narrowed to, or null when nothing was
   * dropped and the input is returned as it came in.
   */
  label: string | null;
}

/**
 * Narrow a manual-mode `entity_prefix` match to one location.
 *
 * A prefix is a substring test, so a prefix minted from a renamed device
 * (`kleenex_pollen_`) also matches another config entry's legacy IDs
 * (`sensor.kleenex_pollen_radar_utrecht_grass`). The card would then merge two
 * cities into one set of allergen rows and name the header after whichever one
 * `hass.states` happened to list first (issue #309 follow-up).
 *
 * Three ordered steps, each with its own guard:
 *
 *   1. Device registry (runs whenever at least one entity matched). A prefix is
 *      minted from a device name, so a Kleenex device whose own slug -- its
 *      identifier, name or user rename -- equals the prefix owns it:
 *      `kleenex_pollen_` belongs to the device named "Kleenex pollen",
 *      `kleenex_pollen_radar_utrecht_` to "Kleenex Pollen Radar (Utrecht)".
 *      Everything belonging to another Kleenex device is then dropped, however
 *      many entities that leaves -- including none. This step needs no
 *      discovery at all, which is the point: an owner whose config entry is
 *      down has no state-backed entities and is invisible to discovery, yet it
 *      still owns its prefix. Membership follows discovery's own two signals, a
 *      `kleenex_pollenradar` device identifier or an entity registry entry with
 *      that platform, so a device exposed only the second way counts too.
 *   2. Discovered locations (runs when no device owned the prefix, at least two
 *      entities matched, and they span more than one discovered location). A
 *      location may still answer to the prefix through its discovery key or
 *      label -- shapes the device registry does not carry.
 *   3. Remainder fallback (same guard as step 2, when no location's slug
 *      matches either). Keep the location whose entity IDs have the least left
 *      over after the prefix and suffix are removed. A weak signal, since the
 *      remainder is an allergen name and a location may only have long-named
 *      detail sensors enabled -- but it still beats merging two cities. Ties
 *      here and in step 2 are broken on the total remainder and finally on the
 *      location key, so the choice never depends on registry iteration order.
 *
 * "Unattributable" means two different things, deliberately:
 *   - unknown to the *entity registry* (template sensors, a frontend without
 *     registry access): always kept. Manual mode is the fallback for exactly
 *     those setups, and such an entity cannot be evidence of a second location.
 *   - known to the registry but not placeable by *discovery* (the owner's own
 *     entities while its entry is down): under step 1 these are simply the
 *     owner's, and another location's entities are dropped even though nothing
 *     replaces them.
 *
 * What is still guaranteed, now that step 1 can act on a single entity and can
 * leave nothing behind: an entity that *nothing* can attribute -- no registry
 * entry and no discovered location -- is never dropped, and no narrowing is
 * reported (neither a label nor a warning) unless something actually was.
 * Note that "no registry" does not by itself mean "untouched": tier-3 discovery
 * attributes legacy `sensor.kleenex_pollen_radar_<location>_*` IDs by their
 * slug, so a registry-less install holding two legacy locations is still
 * narrowed to one.
 */
export function scopeManualEntities(
  hass: HomeAssistant,
  entityIds: string[],
  opts: {
    prefix: string;
    suffix?: string;
    discovery?: { locations: Map<string, DiscoveredLocation> };
    debug?: boolean;
  },
): KleenexManualScope {
  const { prefix, suffix = "", debug = false } = opts;
  if (entityIds.length === 0 || !prefix) return { entityIds, label: null };

  const needle = slugify(prefix.replace(/_+$/, ""));

  // Step 1, registry-level: a device whose own slug is the prefix owns it,
  // whether or not it currently has usable states. Everything belonging to
  // another Kleenex device is dropped; entities with no registry entry, and
  // entities on devices from other integrations, are none of our business and
  // stay.
  const ownerDeviceId = findPrefixOwnerDevice(hass, needle);
  if (ownerDeviceId) {
    const kleenexDevices = kleenexDeviceIds(hass);
    const kept = entityIds.filter((eid) => {
      const deviceId = hass?.entities?.[eid]?.device_id;
      if (!deviceId || deviceId === ownerDeviceId) return true;
      return !kleenexDevices.has(deviceId);
    });
    if (kept.length === entityIds.length) return { entityIds, label: null };

    const droppedDevices = new Set<string>();
    for (const eid of entityIds) {
      if (kept.includes(eid)) continue;
      const deviceId = hass?.entities?.[eid]?.device_id;
      if (deviceId) droppedDevices.add(deviceId);
    }
    const ownerDevice = hass?.devices?.[ownerDeviceId];
    const label = deviceDisplayLabel(ownerDevice);
    warnOnceAboutNarrowing(
      prefix,
      suffix,
      label || ownerDeviceId,
      [...droppedDevices].map(
        (deviceId) => deviceDisplayLabel(hass?.devices?.[deviceId]) || deviceId,
      ),
    );
    if (debug) {
      console.debug(
        `[Kleenex] Manual prefix owned by device '${ownerDeviceId}'`,
        kept,
      );
    }
    return { entityIds: kept, label };
  }

  if (entityIds.length < 2) return { entityIds, label: null };

  const discovery = opts.discovery ?? discoverKleenex(hass, debug);
  if (!discovery || discovery.locations.size < 2) {
    return { entityIds, label: null };
  }

  // entity_id -> location key, for the discovered locations only.
  const locationOf = new Map<string, string>();
  for (const [key, loc] of discovery.locations) {
    for (const eid of loc.entities.values()) locationOf.set(eid, key);
  }

  const base = `sensor.${prefix}`;
  // Per location: shortest and total remainder length after prefix and suffix.
  const scores = new Map<string, { min: number; total: number }>();
  for (const entityId of entityIds) {
    const key = locationOf.get(entityId);
    if (!key) continue;
    let rest = entityId.startsWith(base)
      ? entityId.slice(base.length)
      : entityId;
    if (suffix && rest.endsWith(suffix)) rest = rest.slice(0, -suffix.length);
    const score = scores.get(key);
    if (!score) {
      scores.set(key, { min: rest.length, total: rest.length });
    } else {
      score.min = Math.min(score.min, rest.length);
      score.total += rest.length;
    }
  }
  if (scores.size < 2) return { entityIds, label: null };

  // Step 2: no device owned the prefix outright, but a discovered location may
  // still answer to it through its discovery key or label -- shapes the device
  // registry alone does not carry.
  const owners = [...scores.keys()].filter((key) =>
    locationSlugCandidates(hass, key, discovery.locations.get(key)).has(needle),
  );
  const candidates =
    owners.length > 0 ? new Set(owners) : new Set(scores.keys());

  let winner: string | null = null;
  let best: { min: number; total: number } | null = null;
  for (const [key, score] of [...scores]
    .filter(([key]) => candidates.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (
      !best ||
      score.min < best.min ||
      (score.min === best.min && score.total < best.total)
    ) {
      winner = key;
      best = score;
    }
  }

  const kept = entityIds.filter((eid) => {
    const key = locationOf.get(eid);
    return !key || key === winner;
  });

  const label = winner ? (discovery.locations.get(winner)?.label ?? null) : null;

  warnOnceAboutNarrowing(
    prefix,
    suffix,
    label || winner || "",
    [...scores.keys()]
      .filter((key) => key !== winner)
      .map((key) => discovery.locations.get(key)?.label || key),
  );
  if (debug) {
    console.debug(`[Kleenex] Manual prefix narrowed to '${winner}'`, kept);
  }

  return { entityIds: kept, label };
}

/** One discovered Kleenex location, resolved against the card config. */
export interface KleenexLocationMatch {
  locationKey: string;
  label: string;
  /** classified key (`trees`/`grass`/`weeds` or canonical allergen) -> entity_id */
  entities: Map<string, string>;
  /** entity_id -> classified key, for the forecast passes */
  keyByEntityId: Map<string, string>;
  /** state objects of the location's entities, in discovery order */
  states: HassEntity[];
}

/**
 * Resolve the location the card config points at, via registry discovery.
 *
 * Three outcomes, all distinct on purpose:
 *   - a match,
 *   - `null`: discovery found nothing, or nothing matched the config -- the
 *     caller may fall back to its legacy entity-ID scan,
 *   - `"ambiguous"`: several locations answer to the config value. The caller
 *     must stop. Falling back to the legacy scan would pick up
 *     `sensor.kleenex_pollen_radar_<slug>_*` from whichever colliding device
 *     kept the unsuffixed IDs, i.e. re-introduce the arbitrary choice one layer
 *     down.
 *
 * An empty `cfg.location` picks the first discovered location.
 */
export function resolveKleenexLocation(
  hass: HomeAssistant,
  cfg: CardConfig,
  debug = false,
): KleenexLocationMatch | "ambiguous" | null {
  const discovery = discoverKleenex(hass, debug);
  if (discovery.locations.size === 0) return null;

  const cfgLocation = cfg.location as string | undefined;
  const resolved = resolveKleenexLocationEntry(hass, discovery, cfgLocation);
  if (resolved === "ambiguous") {
    if (debug) {
      console.debug(
        `[Kleenex] Location '${cfgLocation}' matches more than one device; not resolving`,
      );
    }
    return "ambiguous";
  }
  if (!resolved) return null;
  const match = resolved;

  const [locationKey, loc] = match;
  const keyByEntityId = new Map<string, string>();
  const states: HassEntity[] = [];
  for (const [key, eid] of loc.entities) {
    const state = hass.states?.[eid];
    if (!state) continue;
    keyByEntityId.set(eid, key);
    states.push(state);
  }
  if (states.length === 0) return null;

  if (debug) {
    console.debug(
      `[Kleenex] Registry discovery matched location '${locationKey}' (${loc.label}) with entities:`,
      [...loc.entities.keys()],
    );
  }

  return {
    locationKey,
    label: loc.label,
    entities: loc.entities,
    keyByEntityId,
    states,
  };
}

/** Category keys the config asks for, derived from the allergen list. */
function requestedCategories(cfg: CardConfig): Set<string> {
  const needsCategories = new Set<string>();
  for (const allergen of (cfg.allergens as string[] | undefined) || []) {
    if (CATEGORY_KEYS.has(allergen)) {
      needsCategories.add(allergen);
    } else if (allergen.endsWith("_cat")) {
      const categoryName = allergen.replace("_cat", "");
      if (CATEGORY_KEYS.has(categoryName)) needsCategories.add(categoryName);
    } else {
      const category = INDIVIDUAL_TO_CATEGORY[allergen];
      if (category) needsCategories.add(category);
    }
  }
  return needsCategories;
}

/** The non-category allergens the config asks for. */
function requestedIndividualAllergens(cfg: CardConfig): string[] {
  return ((cfg.allergens as string[] | undefined) || []).filter(
    (a) =>
      !["trees_cat", "grass_cat", "weeds_cat", "trees", "grass", "weeds"].includes(
        a,
      ),
  );
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
  const needsCategories = requestedCategories(cfg);

  // Registry-first path. Entity IDs carry no reliable structure (the device is
  // renameable and the sensor part is translated), so the registry is the only
  // dependable source; the entity-ID probing below stays as the fallback for
  // installs whose registry isn't exposed to the frontend.
  if (cfg.location !== "manual") {
    const located = resolveKleenexLocation(hass, cfg, debug);
    // Several locations answer to the configured value: stop rather than fall
    // through to the entity-ID probing below, which would pick the colliding
    // device that happens to still carry legacy-shaped IDs.
    if (located === "ambiguous") return map;
    if (located) {
      const wantedIndividual = new Set(requestedIndividualAllergens(cfg));
      for (const [key, entityId] of located.entities) {
        if (!hass.states[entityId]) continue;
        if (CATEGORY_KEYS.has(key)) {
          if (needsCategories.has(key)) map.set(key, entityId);
        } else if (wantedIndividual.has(key)) {
          map.set(key, entityId);
        }
      }
      if (map.size > 0) return map;
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
          const suffix = parts[parts.length - 1] ?? "";
          return possiblePrefixes.some((lp) => suffix.startsWith(lp));
        });
        if (candidates.length >= 1) sensorId = candidates[0]!;
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
  const individualAllergens = requestedIndividualAllergens(cfg);

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
