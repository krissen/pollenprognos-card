// src/constants.js

import * as PP from "./adapters/pp.js";
import * as DWD from "./adapters/dwd.js";
import * as PEU from "./adapters/peu.js";
import * as SILAM from "./adapters/silam.js";
import * as KLEENEX from "./adapters/kleenex.js";

export const ADAPTERS = {
  pp: PP,
  dwd: DWD,
  peu: PEU,
  silam: SILAM,
  kleenex: KLEENEX,
};


export const DWD_REGIONS = {
  11: "Schleswig-Holstein und Hamburg",
  12: "Schleswig-Holstein und Hamburg",
  20: "Mecklenburg-Vorpommern",
  31: "Niedersachsen und Bremen",
  32: "Niedersachsen und Bremen",
  41: "Nordrhein-Westfalen",
  42: "Nordrhein-Westfalen",
  43: "Nordrhein-Westfalen",
  50: "Brandenburg und Berlin",
  61: "Sachsen-Anhalt",
  62: "Sachsen-Anhalt",
  71: "Thüringen",
  72: "Thüringen",
  81: "Sachsen",
  82: "Sachsen",
  91: "Hessen",
  92: "Hessen",
  101: "Rheinland-Pfalz und Saarland",
  102: "Rheinland-Pfalz und Saarland",
  103: "Rheinland-Pfalz und Saarland",
  111: "Baden-Württemberg",
  112: "Baden-Württemberg",
  113: "Baden-Württemberg",
  121: "Bayern",
  122: "Bayern",
  123: "Bayern",
  124: "Bayern",
};

export const ALLERGEN_TRANSLATION = {
  // Svenska
  al: "alder",
  alm: "elm",
  bok: "beech",
  bjork: "birch",
  ek: "oak",
  grabo: "mugwort",
  gras: "grass",
  hassel: "hazel",
  malortsambrosia: "ragweed",
  salg_och_viden: "willow",

  // Tyska (DWD), normaliserade via replaceAAO
  erle: "alder",
  ambrosia: "ragweed",
  esche: "ash",
  birke: "birch",
  buche: "beech",
  hasel: "hazel",
  graser: "grass", // från 'gräser'
  graeser: "grass", // från 'gräser'
  beifuss: "mugwort", // från 'beifuss'
  roggen: "rye",

  // Engelska (PEU)
  olive: "olive",
  plane: "plane",
  cypress: "cypress",
  lime: "lime",
  mold_spores: "mold_spores",
  nettle_and_pellitory: "nettle_and_pellitory",
  // Add PEU (new API) English names
  fungal_spores: "mold_spores",
  grasses: "grass",
  cypress_family: "cypress",
  nettle_family: "nettle_and_pellitory",
  plane_tree: "plane",
  rye: "rye",
  ragweed: "ragweed",
  birch: "birch",
  alder: "alder",
  hazel: "hazel",
  mugwort: "mugwort",
  olive: "olive",
  allergy_risk: "allergy_risk",
  index: "allergy_risk",

  // Kleenex pollen radar - individual allergens
  pine: "pine",
  poplar: "poplar",
  poaceae: "poaceae",
  chenopod: "chenopod", 
  nettle: "nettle",
  // Kleenex pollen radar - category allergens (to distinguish from individual allergens)
  grass_cat: "grass_cat",
  trees_cat: "trees_cat", 
  weeds_cat: "weeds_cat",
  // Note: Category allergens use _cat suffix to distinguish from individuals
  // Icon mapping is handled separately in the image system
};

// Icon fallback mapping for allergens that don't have their own icons
export const ALLERGEN_ICON_FALLBACK = {
  trees_cat: "birch",    // Use birch icon for trees category
  grass_cat: "grass",    // Use grass icon for grass category
  weeds_cat: "mugwort",  // Use mugwort icon for weeds category
  trees: "birch",        // Keep original for compatibility
  weeds: "mugwort",      // Keep original for compatibility
  // grass has its own icon, no fallback needed
};

// Mapping of localized category name prefixes to canonical names for Kleenex integration
// The Kleenex integration creates sensors with localized category names based on HA language
// Using prefixes to handle both singular and plural forms (e.g., onkruid/onkruiden)
export const KLEENEX_LOCALIZED_CATEGORY_NAMES = {
  // English
  'tree': 'trees',    // matches trees
  'grass': 'grass',
  'weed': 'weeds',    // matches weeds
  // Dutch
  'bomen': 'trees',
  'gras': 'grass',
  'onkruid': 'weeds', // matches both onkruid and onkruiden
  // French
  'arbre': 'trees',   // matches arbres
  'graminee': 'grass', // matches graminees, graminées
  'herbacee': 'weeds', // matches herbacees, herbacées
  // Italian
  'alber': 'trees',   // matches alberi
  'graminace': 'grass', // matches graminacee
  'erbace': 'weeds',  // matches erbacee
};

export const PP_POSSIBLE_CITIES = [
  "Borlänge",
  "Bräkne-Hoby",
  "Eskilstuna",
  "Forshaga",
  "Gävle",
  "Göteborg",
  "Hässleholm",
  "Jönköping",
  "Kristianstad",
  "Ljusdal",
  "Malmö",
  "Norrköping",
  "Nässjö",
  "Piteå",
  "Skövde",
  "Stockholm",
  "Storuman",
  "Sundsvall",
  "Umeå",
  "Visby",
  "Västervik",
  "Östersund",
];

export const COSMETIC_FIELDS = [
  "icon_size",
  "icon_color_mode",
  "icon_color",
  "allergen_color_mode",
  "allergen_colors",
  "allergen_outline_color",
  "allergen_stroke_width",
  "allergen_stroke_color_synced",
  "allergen_levels_gap_synced",
  "levels_inherit_mode",
  "background_color",
  "levels_colors",
  "levels_empty_color",
  "levels_gap_color",
  "levels_thickness",
  "levels_gap",
  "levels_text_color",
  "levels_text_size",
  "levels_icon_ratio",
  "levels_text_weight",
  "minimal",
  "show_text_allergen",
  "show_value_text",
  "show_value_numeric",
  "show_value_numeric_in_circle",
  "allergens_abbreviated",
  "days_boldfaced",
  "text_size_ratio",
  "minimal_gap",
  "title",
];
