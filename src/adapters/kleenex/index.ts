// src/adapters/kleenex/index.ts
// Public facade: re-exports all named exports from sub-modules.
export {
  stubConfigKleenex,
  KLEENEX_ALLERGEN_MAP,
  KLEENEX_ALLERGEN_CATEGORIES,
  INDIVIDUAL_TO_CATEGORY,
  DOMAIN,
  PLATFORM,
  capitalize,
} from "./constants.js";
export { ppmToLevel } from "./levels.js";
export {
  resolveEntityIds,
  discoverKleenex,
  kleenexSlugExtractor,
  matchKleenexLocationByIdentifier,
  resolveKleenexLocationEntry,
  canonicalAllergenFromSlug,
  classifyKleenexEntityId,
} from "./discovery.js";
export { fetchForecast } from "./forecast.js";

import {
  discoverKleenex,
  kleenexSlugExtractor,
  resolveKleenexLocationEntry,
  classifyKleenexEntityId,
} from "./discovery.js";
import type { DiscoveredLocation } from "../../utils/adapter-helpers.js";
import type { HomeAssistant } from "../../types/home-assistant.js";
import type {
  AdapterAutodetect,
  AutodetectContext,
  AutodetectDetectResult,
  AutodetectDiscovery,
} from "../../types/adapter.js";

/**
 * Autodetect descriptor. Detection is the union of the legacy
 * `sensor.kleenex_pollen_radar_` prefix and everything registry discovery
 * finds: since integration v1.6.1 a renamed device leaves entity IDs with
 * neither the `radar_` prefix nor a location slug (issue #309), so the prefix
 * alone misses those installs entirely.
 *
 * Discovery runs eagerly here (like silam/atmo/gp) because detection needs it
 * anyway; `discover` is also exposed so callers that only want the locations
 * can reach it through the registry.
 */
export const autodetect: AdapterAutodetect = {
  priority: 5,
  detectStates(
    hass: HomeAssistant,
    ctx: AutodetectContext,
    debug = false,
  ): AutodetectDetectResult {
    const discovery = discoverKleenex(hass, debug) as AutodetectDiscovery;
    const ids = new Set(
      ctx.stateIds.filter(
        (id) =>
          typeof id === "string" &&
          id.startsWith("sensor.kleenex_pollen_radar_"),
      ),
    );
    for (const loc of discovery.locations.values()) {
      for (const eid of loc.entities?.values() ?? []) {
        if (hass?.states?.[eid]) ids.add(eid);
      }
    }
    return { ids: Array.from(ids), discovery };
  },
  discover: (hass, debug) => discoverKleenex(hass, debug) as AutodetectDiscovery,
  extractLocationSlug: kleenexSlugExtractor,
  // The one definition of "which location does this config mean": exact key,
  // then the rename-stable device identifier, then label/entity-ID matching.
  // The card and both editors resolve through this instead of rebuilding the
  // chain locally. The cast narrows the structural discovery type back to the
  // device discovery Kleenex always produces.
  resolveLocation: (hass, discovery, cfgLocation) =>
    resolveKleenexLocationEntry(
      hass,
      discovery as { locations: Map<string, DiscoveredLocation> },
      cfgLocation,
    ),
  // `sensor.<prefix>_date` / `_last_updated` carry no level and their friendly
  // names would yield a header like "Kleenex pollen Date", so the card asks
  // the adapter which entity IDs are renderable before deriving a title.
  isRenderableEntity: (entityId) => classifyKleenexEntityId(entityId) !== null,
};
