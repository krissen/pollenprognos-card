// src/pollenprognos-svgs.js

/**
 * This module imports all SVG icons as text strings at build time.
 * This follows Home Assistant best practices for custom cards.
 */

// Import SVGs as text strings (Vite will inline them at build time)
import alderSvg from "./images/alder.svg?raw";
import allergyRiskSvg from "./images/allergy_risk.svg?raw";
import allergyRisk1Svg from "./images/allergy_risk_1.svg?raw";
import allergyRisk2Svg from "./images/allergy_risk_2.svg?raw";
import allergyRisk3Svg from "./images/allergy_risk_3.svg?raw";
import allergyRisk4Svg from "./images/allergy_risk_4.svg?raw";
import allergyRisk5Svg from "./images/allergy_risk_5.svg?raw";
import allergyRisk6Svg from "./images/allergy_risk_6.svg?raw";
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
import plantainSvg from "./images/plantain.svg?raw";
import poaceaeSvg from "./images/poaceae.svg?raw";
import poplarSvg from "./images/poplar.svg?raw";
import ragweedSvg from "./images/ragweed.svg?raw";
import ryeSvg from "./images/rye.svg?raw";
import sorrelSvg from "./images/sorrel.svg?raw";
import sweetChestnutSvg from "./images/sweet_chestnut.svg?raw";
import treeOfHeavenSvg from "./images/tree_of_heaven.svg?raw";
import willowSvg from "./images/willow.svg?raw";

// Google Maps attribution wordmark (issue #338). Kept OUT of the `svgs` map
// below on purpose: that record is the allergen/pollution icon lookup, and this
// is a brand asset shipped verbatim from Google's official attribution asset
// package (Google_Maps_Attribution_Assets.zip, "Gray" variant). It must not be
// reshaped or recoloured beyond the two colours the attribution policy allows.
import googleMapsSvg from "./images/google_maps.svg?raw";
// The square Google Maps pin, used where the wordmark cannot reach a legible
// size (the badge pill). It is NOT part of the attribution asset package --
// that package only ships the wordmark -- so this is Google's product logo,
// taken verbatim from gstatic. It is full colour by design and must never be
// recoloured or reshaped.
import googleMapsPinSvgRaw from "./images/google_maps_pin.svg?raw";

// Pollution icons
import pm25Svg from "./images/pm25.svg?raw";
import pm10Svg from "./images/pm10.svg?raw";
import ozoneSvg from "./images/ozone.svg?raw";
import no2Svg from "./images/no2.svg?raw";
import so2Svg from "./images/so2.svg?raw";
import airQualitySvg from "./images/air_quality.svg?raw";

// Export SVG map - all SVGs are available immediately, no async loading needed
export const svgs: Record<string, string> = {
  alder: alderSvg,
  allergy_risk: allergyRiskSvg,
  allergy_risk_1: allergyRisk1Svg,
  allergy_risk_2: allergyRisk2Svg,
  allergy_risk_3: allergyRisk3Svg,
  allergy_risk_4: allergyRisk4Svg,
  allergy_risk_5: allergyRisk5Svg,
  allergy_risk_6: allergyRisk6Svg,
  ash: ashSvg,
  beech: beechSvg,
  birch: birchSvg,
  chenopod: chenopodSvg,
  goosefoot: chenopodSvg, // Alias until dedicated icon is available
  cypress: cypressSvg,
  elm: elmSvg,
  grass: grassSvg,
  plantain: plantainSvg,
  hazel: hazelSvg,
  lime: limeSvg,
  mold_spores: moldSporesSvg,
  mugwort: mugwortSvg,
  sorrel: sorrelSvg,
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
  sweet_chestnut: sweetChestnutSvg,
  tree_of_heaven: treeOfHeavenSvg,
  willow: willowSvg,
  // Pollution
  pm25: pm25Svg,
  pm10: pm10Svg,
  ozone: ozoneSvg,
  no2: no2Svg,
  so2: so2Svg,
  qualite_globale: airQualitySvg,
};

/** Official Google Maps attribution wordmark, 98x18 viewBox, fill #5E5E5E. */
export const googleMapsLogoSvg: string = googleMapsSvg;

/** Official Google Maps pin, 192x192 viewBox, full colour (source: gstatic). */
export const googleMapsPinSvg: string = googleMapsPinSvgRaw;

/**
 * Get SVG content for a given key
 * @param key - The allergen key
 * @returns SVG content or null if not found
 */
export function getSvgContent(key: unknown): string | null {
  if (!key || typeof key !== "string") {
    return null;
  }
  return svgs[key] || null;
}
