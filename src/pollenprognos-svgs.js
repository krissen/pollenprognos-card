// src/pollenprognos-svgs.js

/**
 * This module imports all SVG icons as text strings at build time.
 * This follows Home Assistant best practices for custom cards.
 */

// Import SVGs as text strings (Vite will inline them at build time)
import alderSvg from "./images/alder.svg?raw";
import allergyRiskSvg from "./images/allergy_risk.svg?raw";
import ashSvg from "./images/ash.svg?raw";
import beechSvg from "./images/beech.svg?raw";
import birchSvg from "./images/birch.svg?raw";
import chenopodSvg from "./images/chenopod.svg?raw";
import cypressSvg from "./images/cypress.svg?raw";
import elmSvg from "./images/elm.svg?raw";
import grassSvg from "./images/grass.svg?raw";
import hazelSvg from "./images/hazel.svg?raw";
import limeSvg from "./images/lime.svg?raw";
import moldSporesSvg from "./images/mold_spores.svg?raw";
import mugwortSvg from "./images/mugwort.svg?raw";
import nettleAndPellitorySvg from "./images/nettle_and_pellitory.svg?raw";
import noAllergensSvg from "./images/no_allergens.svg?raw";
import oakSvg from "./images/oak.svg?raw";
import oliveSvg from "./images/olive.svg?raw";
import pineSvg from "./images/pine.svg?raw";
import planeSvg from "./images/plane.svg?raw";
import poaceaeSvg from "./images/poaceae.svg?raw";
import poplarSvg from "./images/poplar.svg?raw";
import ragweedSvg from "./images/ragweed.svg?raw";
import ryeSvg from "./images/rye.svg?raw";
import willowSvg from "./images/willow.svg?raw";

// Export SVG map - all SVGs are available immediately, no async loading needed
export const svgs = {
  alder: alderSvg,
  allergy_risk: allergyRiskSvg,
  ash: ashSvg,
  beech: beechSvg,
  birch: birchSvg,
  chenopod: chenopodSvg,
  goosefoot: chenopodSvg, // Alias until dedicated icon is available
  cypress: cypressSvg,
  elm: elmSvg,
  grass: grassSvg,
  plantain: mugwortSvg, // Temporary alias (weed category)
  hazel: hazelSvg,
  lime: limeSvg,
  mold_spores: moldSporesSvg,
  mugwort: mugwortSvg,
  sorrel: mugwortSvg, // Temporary alias (weed category)
  nettle_and_pellitory: nettleAndPellitorySvg,
  nettle: nettleAndPellitorySvg, // Alias for compatibility
  no_allergens: noAllergensSvg,
  oak: oakSvg,
  olive: oliveSvg,
  pine: pineSvg,
  plane: planeSvg,
  poaceae: poaceaeSvg,
  poplar: poplarSvg,
  ragweed: ragweedSvg,
  rye: ryeSvg,
  willow: willowSvg,
};

/**
 * Get SVG content for a given key
 * @param {string} key - The allergen key
 * @returns {string|null} SVG content or null if not found
 */
export function getSvgContent(key) {
  if (!key || typeof key !== 'string') {
    return null;
  }
  return svgs[key] || null;
}