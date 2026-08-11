// Global ambient declarations for the pollenprognos-card bundle.

// Injected at build time by Vite's `define` (see vite.config.js).
declare const __VERSION__: string;

// Home Assistant reads these registries off `window` to populate its
// Lovelace card and badge pickers. We only touch `push`, so a minimal
// array shape is enough (see src/index.js).
interface CustomCardEntry {
  type: string;
  name?: string;
  preview?: boolean;
  description?: string;
  documentationURL?: string;
  getEntitySuggestion?: (hass: unknown, entityId: string) => unknown;
}

interface CustomBadgeEntry {
  type: string;
  name?: string;
  preview?: boolean;
  description?: string;
  documentationURL?: string;
}

interface Window {
  customCards?: CustomCardEntry[];
  customBadges?: CustomBadgeEntry[];
  // Opt-in instrumentation: counts uncached entity-discovery sweeps per tag.
  // Create it from the browser console (`window.__ppDiscoveryScans = {}`) or
  // let a card running with `debug: true` create it. See recordDiscoveryScan
  // in src/utils/adapter-helpers.ts.
  __ppDiscoveryScans?: Record<string, number>;
}
