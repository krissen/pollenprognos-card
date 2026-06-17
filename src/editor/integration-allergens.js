// Single source for the per-integration allergen list used by the editor. Both
// the shared editor base (_currentAllergens) and the card editor's phrase reset
// previously inlined the same integration if-chain; keeping it here means a new
// integration's allergen list is declared in one place. (Level counts live in
// ../utils/level-counts.js, shared with the rendering mixin.)

import { stubConfigDWD } from "../adapters/dwd.js";
import { PEU_ALLERGENS } from "../adapters/peu.js";
import { SILAM_ALLERGENS } from "../adapters/silam.js";
import { stubConfigKleenex } from "../adapters/kleenex/index.js";
import { stubConfigPLU } from "../adapters/plu.js";
import { ATMO_ALLERGENS } from "../adapters/atmo.js";
import { GPL_BASE_ALLERGENS } from "../adapters/gpl/index.js";
import { GP_BASE_ALLERGENS } from "../adapters/gp/index.js";
import { stubConfigMSW } from "../adapters/msw.js";
import { stubConfigIRMKMI } from "../adapters/irmkmi.js";
import { stubConfigPP } from "../adapters/pp.js";

/**
 * The raw allergen keys for an integration, in editor-display order.
 *
 * GPL and GP append the location's discovered plants to their base list, so the
 * caller passes them in via opts (the base editor uses its stored
 * installedGplPlants/installedGpPlants; the card editor passes a fresh
 * discovery). Everything else returns its static stub list.
 *
 * @param {string} integration
 * @param {{installedGplPlants?: string[], installedGpPlants?: string[]}} [opts]
 * @returns {string[]}
 */
export function allergenListForIntegration(integration, opts = {}) {
  const { installedGplPlants = [], installedGpPlants = [] } = opts;
  switch (integration) {
    case "dwd":
      return stubConfigDWD.allergens;
    case "peu":
      return PEU_ALLERGENS;
    case "silam":
      return SILAM_ALLERGENS;
    case "kleenex":
      return stubConfigKleenex.allergens;
    case "plu":
      return stubConfigPLU.allergens;
    case "gpl":
      return [...GPL_BASE_ALLERGENS, ...installedGplPlants];
    case "gp":
      return [...GP_BASE_ALLERGENS, ...installedGpPlants];
    case "atmo":
      return ATMO_ALLERGENS;
    case "msw":
      return stubConfigMSW.allergens;
    case "irmkmi":
      return stubConfigIRMKMI.allergens;
    default:
      return stubConfigPP.allergens;
  }
}
