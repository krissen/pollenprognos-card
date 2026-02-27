// src/constants.js

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

// Per-adapter allergen alias maps.
// Each maps raw/localized allergen slugs to canonical keys.
// The global ALLERGEN_TRANSLATION is computed from these at the bottom.

const PP_ALIASES = {
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
};

const DWD_ALIASES = {
  erle: "alder",
  ambrosia: "ragweed",
  esche: "ash",
  birke: "birch",
  buche: "beech",
  hasel: "hazel",
  graser: "grass",
  graeser: "grass",
  beifuss: "mugwort",
  roggen: "rye",
};

const PEU_ALIASES = {
  olive: "olive",
  plane: "plane",
  cypress: "cypress",
  lime: "lime",
  mold_spores: "mold_spores",
  nettle_and_pellitory: "nettle_and_pellitory",
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
  allergy_risk: "allergy_risk",
  index: "allergy_risk",
};

const KLEENEX_ALIASES = {
  pine: "pine",
  poplar: "poplar",
  poaceae: "poaceae",
  chenopod: "chenopod",
  nettle: "nettle",
  grass_cat: "grass_cat",
  trees_cat: "trees_cat",
  weeds_cat: "weeds_cat",
};

const PLU_ALIASES = {
  sorrel: "sorrel",
  rumex: "sorrel",
  ampfer: "sorrel",
  oseille: "sorrel",
  artemisia: "mugwort",
  betula: "birch",
  bouleau: "birch",
  fagus: "beech",
  hetre: "beech",
  hetra: "beech",
  quercus: "oak",
  eiche: "oak",
  chene: "oak",
  alnus: "alder",
  aulne: "alder",
  fraxinus: "ash",
  frene: "ash",
  chenopodium: "goosefoot",
  goosefoot: "goosefoot",
  gaensefuss: "goosefoot",
  gansefuss: "goosefoot",
  chenopode: "goosefoot",
  poacea: "poaceae",
  graminees: "poaceae",
  corylus: "hazel",
  haselnussstrauch: "hazel",
  noisetier: "hazel",
  plantago: "plantain",
  plantain: "plantain",
  wegerich: "plantain",
  armoise: "mugwort",
};

const ATMO_ALIASES = {
  ambroisie: "ragweed",
  gramine: "grass",
  olivier: "olive",
  pm25: "pm25",
  pm10: "pm10",
  ozone: "ozone",
  no2: "no2",
  so2: "so2",
  dioxyde_d_azote: "no2",
  dioxyde_de_soufre: "so2",
  qualite_globale: "qualite_globale",
};

const GPL_ALIASES = {
  cottonwood: "poplar",
  juniper: "cypress",
  japanese_cedar: "cypress",
  japanese_cypress: "cypress",
  graminales: "grass",
  cypress_pine: "cypress",
};

// Merged map: computed from per-adapter aliases (order matches legacy map).
export const ALLERGEN_TRANSLATION = {
  ...PP_ALIASES,
  ...DWD_ALIASES,
  ...PEU_ALIASES,
  ...KLEENEX_ALIASES,
  ...PLU_ALIASES,
  ...ATMO_ALIASES,
  ...GPL_ALIASES,
};

/**
 * Resolve a raw allergen slug to its canonical key.
 * Returns the canonical key if found, otherwise the input unchanged.
 */
export function toCanonicalAllergenKey(raw) {
  return ALLERGEN_TRANSLATION[raw] || raw;
}

// Icon fallback mapping for allergens that don't have their own icons
export const ALLERGEN_ICON_FALLBACK = {
  trees_cat: "birch", // Use birch icon for trees category
  grass_cat: "grass", // Use grass icon for grass category
  weeds_cat: "mugwort", // Use mugwort icon for weeds category
  trees: "birch", // Keep original for compatibility
  weeds: "mugwort", // Keep original for compatibility
  // grass has its own icon, no fallback needed
  // Google Pollen Levels fallbacks
  cottonwood: "poplar",
  juniper: "cypress",
  japanese_cedar: "cypress",
  japanese_cypress: "cypress",
  graminales: "grass",
  cypress_pine: "cypress",
  maple: "oak",
};

// Mapping of localized category name prefixes to canonical names for Kleenex integration
// The Kleenex integration creates sensors with localized category names based on HA language
// Using prefixes to handle both singular and plural forms (e.g., onkruid/onkruiden)
export const KLEENEX_LOCALIZED_CATEGORY_NAMES = {
  // English
  tree: "trees", // matches trees
  grass: "grass",
  weed: "weeds", // matches weeds
  // Dutch
  bomen: "trees",
  gras: "grass",
  onkruid: "weeds", // matches both onkruid and onkruiden
  kruid: "weeds", // matches kruid and kruiden
  // French
  arbre: "trees", // matches arbres
  graminee: "grass", // matches graminees, graminées
  herbacee: "weeds", // matches herbacees, herbacées
  // Italian
  alber: "trees", // matches alberi
  graminace: "grass", // matches graminacee
  erbace: "weeds", // matches erbacee
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
  "show_block_separator",
  "title",
  "card_mod",
];
