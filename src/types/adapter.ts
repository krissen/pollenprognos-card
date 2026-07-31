import type { HomeAssistant } from "./home-assistant.js";
import type { PollenSensor } from "./sensor.js";
import type { CardConfig } from "./config.js";

/**
 * A forecast event delivered via `hass.connection.subscribeMessage` (SILAM
 * hourly/twice_daily). Its shape is integration-defined; the card forwards it
 * opaquely to `fetchForecast`, so it stays permissive here.
 */
export type ForecastEvent = Record<string, unknown>;

/**
 * The common shape of an integration adapter module (the namespace object from
 * `import * as X`). Every adapter exports `fetchForecast`, `resolveEntityIds`,
 * and a `stubConfig*`. Discovery/classifier helpers are adapter-specific and
 * optional here.
 *
 * Call-site notes:
 * - `fetchForecast` takes an optional third `forecastEvent`; only SILAM reads
 *   it, the others ignore the extra argument.
 * - `resolveEntityIds` takes an optional fourth `precomputedDiscovery`; only
 *   SILAM uses it. It returns a Map of allergen key -> entity id (both
 *   auto-detect and manual mode); `findAvailableSensors` reads `.values()`.
 */
export interface AdapterModule {
  fetchForecast(
    hass: HomeAssistant,
    config: CardConfig,
    forecastEvent?: ForecastEvent | null,
  ): Promise<PollenSensor[]>;

  resolveEntityIds(
    cfg: CardConfig,
    hass: HomeAssistant,
    debug?: boolean,
    precomputedDiscovery?: unknown,
  ): Map<string, string>;

  /** Default configuration template consumed by the editor (`stubConfig*`). */
  stubConfig?: CardConfig;

  /**
   * Autodetection descriptor. Every adapter exports one so the shared
   * autodetect module (`src/utils/autodetect.ts`) can detect the integration,
   * run its discovery, and resolve legacy-config location slugs without
   * importing adapter internals. See {@link AdapterAutodetect}.
   */
  autodetect?: AdapterAutodetect;
}

/**
 * The discovery shape the autodetect module reads structurally. It is the
 * common denominator of the two concrete discovery return types:
 * `DeviceDiscovery` (device-based adapters expose `entities`) and
 * `SilamDiscovery` (exposes `sensors` plus an optional `weatherEntity`).
 * Autodetect only reads `locations` and, for reverse-mapping, each location's
 * `entities`/`sensors`/`weatherEntity`.
 */
export interface AutodetectLocation {
  label: string;
  entities?: Map<string, string>;
  sensors?: Map<string, string>;
  weatherEntity?: string;
  deviceId?: string;
}

export interface AutodetectDiscovery {
  locations: Map<string, AutodetectLocation>;
  tierUsed?: 0 | 1 | 2 | 3;
}

/**
 * Cross-adapter context the detection driver passes to every `detectStates`.
 * Computed once per detection pass so individual adapters don't re-scan
 * `hass.states` or rebuild the PLU alias set.
 */
export interface AutodetectContext {
  /** All entity ids in `hass.states`, computed once by the driver. */
  stateIds: string[];
  /**
   * PLU allergen slugs, for the PP-vs-PLU disambiguation (both integrations can
   * expose `sensor.pollen_<allergen>`). Sourced from the PLU descriptor's
   * `allergenSlugs` so PP never imports PLU internals.
   */
  pluAllergenSlugs: Set<string>;
}

/**
 * Result of an adapter's `detectStates`: the entity ids it owns, plus — for
 * discovery-primary adapters (silam/atmo/gp) — the discovery object it computed
 * eagerly, so `autoSelectLocation` can reuse it instead of recomputing.
 */
export interface AutodetectDetectResult {
  ids: string[];
  discovery?: AutodetectDiscovery;
}

/**
 * Per-adapter autodetection descriptor. Keeps every integration's detection
 * knowledge (entity-id regexes, platform checks, attribution strings, alias
 * disambiguation, discovery wrappers, legacy slug extraction) in the adapter
 * itself; the shared autodetect module orchestrates them uniformly via the
 * registry (`getAutodetect`/`getAllAutodetect`).
 */
export interface AdapterAutodetect {
  /** Position in the canonical autodetect precedence order (lower wins). */
  priority: number;
  /**
   * Return the entity ids this integration owns in `hass`. Encapsulates the
   * integration's full detection strategy: regex match, `hass.entities`
   * platform check, discovery-primary + regex fallback, attribution fallback,
   * and PP-vs-PLU disambiguation.
   */
  detectStates(
    hass: HomeAssistant,
    ctx: AutodetectContext,
    debug?: boolean,
  ): AutodetectDetectResult;
  /**
   * Run the integration's device/registry discovery. Absent for adapters with
   * no location dimension resolved via discovery (kleenex, plu).
   */
  discover?(hass: HomeAssistant, debug?: boolean): AutodetectDiscovery;
  /**
   * Derive the location/city/region slug from a single entity id (pp → city,
   * dwd → region_id, peu → location). Used by `autoSelectLocation` and
   * `deriveLocationForEntity`.
   */
  extractLocationSlug?(entityId: string): string | null;
  /**
   * Resolve a config location value against a discovery result using the
   * adapter's own complete candidate chain, including rename-stable knowledge
   * the generic `resolveLocationByKey`/`findLocationBySlug` helpers cannot
   * express (Kleenex: the device identifier).
   *
   * Callers -- card header, card editor, badge editor -- must use this as their
   * entire resolution rather than as one candidate among locally reproduced
   * others: a partial mirror of the chain drifts from the adapter and resolves
   * a different set of configs than the card actually renders.
   *
   * Returns the discovery entry, null when nothing matches, or `"ambiguous"`
   * when several locations answer to the value -- in which case callers must
   * resolve nothing rather than pick one by registry iteration order.
   */
  resolveLocation?(
    hass: HomeAssistant,
    discovery: AutodetectDiscovery,
    cfgLocation: string | null | undefined,
  ): [string, AutodetectLocation] | "ambiguous" | null;
  /**
   * True when the entity id is one the card can render a level for, as opposed
   * to a diagnostic/timestamp sibling. Lets the card pick a meaningful sensor
   * to derive a header from when only entity ids are available (Kleenex manual
   * mode), using the adapter's own classification instead of a heuristic.
   */
  isRenderableEntity?(entityId: string): boolean;
  /**
   * Narrow a manual-mode prefix match to a single location, so the card renders
   * and labels one place instead of merging two config entries whose entity ids
   * happen to share a prefix (Kleenex). Returns the entity ids to keep and, when
   * the narrowing actually happened, the label of the location that won.
   *
   * The adapter's `fetchForecast` applies the same function, so the header and
   * the rendered data cannot pick different locations.
   */
  scopeManualEntities?(
    hass: HomeAssistant,
    entityIds: string[],
    opts: {
      prefix: string;
      suffix?: string;
      discovery?: AutodetectDiscovery;
      debug?: boolean;
    },
  ): { entityIds: string[]; label: string | null };
  /**
   * PLU exposes its allergen slug set so the driver can build the PP-vs-PLU
   * disambiguation context without PP importing PLU.
   */
  allergenSlugs?: Set<string>;
}
