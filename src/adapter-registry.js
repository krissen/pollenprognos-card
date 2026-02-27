// src/adapter-registry.js
// Thin alias layer: maps integration ID → { module, stub }.
// Replaces scattered if/else chains in card and editor.

import * as PP from "./adapters/pp.js";
import * as DWD from "./adapters/dwd.js";
import * as PEU from "./adapters/peu.js";
import * as SILAM from "./adapters/silam.js";
import * as KLEENEX from "./adapters/kleenex/index.js";
import * as PLU from "./adapters/plu.js";
import * as ATMO from "./adapters/atmo.js";
import * as GPL from "./adapters/gpl/index.js";

const registry = {
  pp: { module: PP, stub: PP.stubConfigPP },
  dwd: { module: DWD, stub: DWD.stubConfigDWD },
  peu: { module: PEU, stub: PEU.stubConfigPEU },
  silam: { module: SILAM, stub: SILAM.stubConfigSILAM },
  kleenex: { module: KLEENEX, stub: KLEENEX.stubConfigKleenex },
  plu: { module: PLU, stub: PLU.stubConfigPLU },
  atmo: { module: ATMO, stub: ATMO.stubConfigATMO },
  gpl: { module: GPL, stub: GPL.stubConfigGPL },
};

export function getAdapter(id) {
  return registry[id]?.module;
}

export function getStubConfig(id) {
  return registry[id]?.stub;
}

export function getAllAdapterIds() {
  return Object.keys(registry);
}
