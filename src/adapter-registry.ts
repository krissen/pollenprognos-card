// src/adapter-registry.ts
// Thin alias layer: maps integration ID → { module, stub }.
// Replaces scattered if/else chains in card and editor.

import type { AdapterModule, AdapterAutodetect } from "./types/adapter.js";
import type { AdapterStubConfig } from "./types/config.js";
import * as PP from "./adapters/pp.js";
import * as DWD from "./adapters/dwd.js";
import * as PEU from "./adapters/peu.js";
import * as SILAM from "./adapters/silam.js";
import * as KLEENEX from "./adapters/kleenex/index.js";
import * as PLU from "./adapters/plu.js";
import * as ATMO from "./adapters/atmo.js";
import * as GPL from "./adapters/gpl/index.js";
import * as GP from "./adapters/gp/index.js";
import * as MSW from "./adapters/msw.js";
import * as IRMKMI from "./adapters/irmkmi.js";

interface RegistryEntry {
  module: AdapterModule;
  stub: AdapterStubConfig;
}

const registry: Record<string, RegistryEntry> = {
  pp: { module: PP, stub: PP.stubConfigPP },
  dwd: { module: DWD, stub: DWD.stubConfigDWD },
  peu: { module: PEU, stub: PEU.stubConfigPEU },
  silam: { module: SILAM, stub: SILAM.stubConfigSILAM },
  kleenex: { module: KLEENEX, stub: KLEENEX.stubConfigKleenex },
  plu: { module: PLU, stub: PLU.stubConfigPLU },
  atmo: { module: ATMO, stub: ATMO.stubConfigATMO },
  gpl: { module: GPL, stub: GPL.stubConfigGPL },
  gp: { module: GP, stub: GP.stubConfigGP },
  msw: { module: MSW, stub: MSW.stubConfigMSW },
  irmkmi: { module: IRMKMI, stub: IRMKMI.stubConfigIRMKMI },
};

export function getAdapter(id: string | undefined): AdapterModule | undefined {
  return id ? registry[id]?.module : undefined;
}

export function getStubConfig(
  id: string | undefined,
): AdapterStubConfig | undefined {
  return id ? registry[id]?.stub : undefined;
}

export function getAllAdapterIds(): string[] {
  return Object.keys(registry);
}

/**
 * Return an integration's autodetect descriptor, or undefined if the id is
 * unknown or the adapter exposes none. The shared autodetect module
 * (`src/utils/autodetect.ts`) uses this instead of importing adapter internals.
 */
export function getAutodetect(
  id: string | undefined,
): AdapterAutodetect | undefined {
  return id ? registry[id]?.module.autodetect : undefined;
}

/**
 * Return every `[id, descriptor]` pair sorted by the descriptor's `priority`
 * (lowest first). This is the single source of truth for the autodetect
 * precedence order that INTEGRATION_PRIORITY used to hardcode.
 */
export function getAllAutodetect(): Array<[string, AdapterAutodetect]> {
  const out: Array<[string, AdapterAutodetect]> = [];
  for (const [id, entry] of Object.entries(registry)) {
    if (entry.module.autodetect) out.push([id, entry.module.autodetect]);
  }
  out.sort((a, b) => a[1].priority - b[1].priority);
  return out;
}
