// src/adapters/kleenex/constants.js
import { LEVELS_DEFAULTS } from "../../utils/levels-defaults.js";

export const DOMAIN = "kleenex_pollen_radar";

// Map kleenex allergen names to our canonical names (supports all regional language variations)
export const KLEENEX_ALLERGEN_MAP = {
  // Trees - English (EN/US)
  hazel: "hazel",
  elm: "elm",
  pine: "pine",
  alder: "alder",
  poplar: "poplar",
  oak: "oak",
  plane: "plane",
  birch: "birch",
  cypress: "cypress",

  // Trees - French (FR)
  noisetier: "hazel",
  orme: "elm",
  pin: "pine",
  aulne: "alder",
  peuplier: "poplar",
  chêne: "oak",
  platane: "plane",
  bouleau: "birch",
  cyprès: "cypress",

  // Trees - Italian (IT)
  nocciolo: "hazel",
  olmo: "elm",
  pino: "pine",
  ontano: "alder",
  pioppo: "poplar",
  quercia: "oak",
  platano: "plane",
  betulla: "birch",
  cipresso: "cypress",

  // Trees - Dutch (NL)
  hazelaar: "hazel",
  iep: "elm",
  pijnboom: "pine",
  els: "alder",
  populier: "poplar",
  eik: "oak",
  plataan: "plane",
  berk: "birch",
  cipres: "cypress",

  // Grass - Multiple languages
  grass: "grass",
  poaceae: "poaceae", // EN/US/FR/NL
  graminacee: "poaceae", // IT

  // Weeds - English (EN/US)
  weeds: "weeds",
  ragweed: "ragweed",
  mugwort: "mugwort",
  chenopod: "chenopod",
  nettle: "nettle",

  // Weeds - French (FR)
  ambroisie: "ragweed",
  armoise: "mugwort",
  chénopodes: "chenopod",
  ortie: "nettle",

  // Weeds - Italian (IT)
  ambrosia: "ragweed",
  artemisia: "mugwort",
  chenopodio: "chenopod",
  ortica: "nettle",

  // Weeds - Dutch (NL)
  // ambrosia: "ragweed", // Same as Italian, already defined
  bijvoet: "mugwort",
  ganzevoet: "chenopod",
  brandnetel: "nettle",
};

export const stubConfigKleenex = {
  integration: "kleenex",
  location: "",
  // Optional entity naming used when location is "manual"
  entity_prefix: "",
  entity_suffix: "",
  allergens: [
    // Individual allergens (detailed sensors) - enabled by default, alphabetically ordered
    "alder",
    "birch",
    "chenopod",
    "cypress",
    "elm",
    "hazel",
    "mugwort",
    "nettle",
    "oak",
    "pine",
    "plane",
    "poaceae",
    "poplar",
    "ragweed",
    // General categories (broad sensors) - disabled by default
    // "trees_cat",
    // "grass_cat",
    // "weeds_cat",
  ],
  minimal: false,
  minimal_gap: 35,
  background_color: "",
  icon_size: "48",
  text_size_ratio: 1,
  ...LEVELS_DEFAULTS,
  show_text_allergen: true,
  show_value_text: true,
  show_value_numeric: false,
  show_value_numeric_in_circle: false,
  show_empty_days: false,
  debug: false,
  show_version: true,
  days_to_show: 5,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 1,
  sort: "value_descending",
  sort_category_allergens_first: true,
  allergy_risk_top: true,
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

// Category-specific allergen mapping for kleenex integration
export const KLEENEX_ALLERGEN_CATEGORIES = {
  // Trees category
  trees_cat: "trees",
  trees: "trees", // Keep compatibility for sensor mapping
  hazel: "trees",
  elm: "trees",
  pine: "trees",
  alder: "trees",
  poplar: "trees",
  oak: "trees",
  plane: "trees",
  birch: "trees",
  cypress: "trees",

  // Grass category
  grass_cat: "grass",
  grass: "grass", // Keep compatibility for sensor mapping
  poaceae: "grass",

  // Weeds category
  weeds_cat: "weeds",
  weeds: "weeds", // Keep compatibility for sensor mapping
  ragweed: "weeds",
  mugwort: "weeds",
  chenopod: "weeds",
  nettle: "weeds",
};

// Map allergens to the kleenex category they belong to
export const INDIVIDUAL_TO_CATEGORY = {
  alder: "trees", birch: "trees", cypress: "trees", elm: "trees",
  hazel: "trees", oak: "trees", pine: "trees", plane: "trees", poplar: "trees",
  poaceae: "grass",
  mugwort: "weeds", ragweed: "weeds", chenopod: "weeds", nettle: "weeds",
};

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
