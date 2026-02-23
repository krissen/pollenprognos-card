// src/adapter-registry.js
// Thin alias layer: maps integration ID → { module, stub }.
// Replaces scattered if/else chains in card and editor.

import * as PP from "./adapters/pp.js";
import * as DWD from "./adapters/dwd.js";
import * as PEU from "./adapters/peu.js";
import * as SILAM from "./adapters/silam.js";
import * as KLEENEX from "./adapters/kleenex.js";
import * as PLU from "./adapters/plu.js";
import * as ATMO from "./adapters/atmo.js";
import * as GPL from "./adapters/gpl.js";

import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";
import { stubConfigPEU } from "./adapters/peu.js";
import { stubConfigSILAM } from "./adapters/silam.js";
import { stubConfigKleenex } from "./adapters/kleenex.js";
import { stubConfigPLU } from "./adapters/plu.js";
import { stubConfigATMO } from "./adapters/atmo.js";
import { stubConfigGPL } from "./adapters/gpl.js";

const registry = {
  pp: { module: PP, stub: stubConfigPP },
  dwd: { module: DWD, stub: stubConfigDWD },
  peu: { module: PEU, stub: stubConfigPEU },
  silam: { module: SILAM, stub: stubConfigSILAM },
  kleenex: { module: KLEENEX, stub: stubConfigKleenex },
  plu: { module: PLU, stub: stubConfigPLU },
  atmo: { module: ATMO, stub: stubConfigATMO },
  gpl: { module: GPL, stub: stubConfigGPL },
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
