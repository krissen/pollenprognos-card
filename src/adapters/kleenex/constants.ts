// src/adapters/kleenex/constants.ts
import type { AdapterStubConfig } from "../../types/config.js";
import { LEVELS_DEFAULTS } from "../../utils/levels-defaults.js";

// Legacy entity-ID prefix: the slug of the integration's *default* device name
// ("Kleenex Pollen Radar (<instance>)"). It is not, and never was, the HA
// domain -- users who rename the device get entity IDs without it (issue #309).
// Kept for the pre-registry fallback paths only.
export const DOMAIN = "kleenex_pollen_radar";

// The actual HA platform/domain of the upstream integration. Used for
// registry-based discovery (device identifiers and entry.platform).
export const PLATFORM = "kleenex_pollenradar";

// Map kleenex allergen names to our canonical names (supports all regional language variations)
export const KLEENEX_ALLERGEN_MAP: Record<string, string> = {
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
  // The IT endpoint reports English allergen names, so the Italian aliases
  // below are never exercised in practice -- but it misspells chenopod as
  // "Chenepod" (Roma, Milano), which is the alias IT installs actually need.
  chenepod: "chenopod",
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

export const stubConfigKleenex: AdapterStubConfig = {
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
    // The three category totals are selectable in the editor
    // (KLEENEX_EDITOR_ALLERGENS) but off by default: an EU install gets the
    // per-allergen rows, and a US install gets the categories through the
    // fallback in forecast.ts without having to configure anything.
  ],
  minimal: false,
  minimal_gap: 35,
  background_color: "",
  icon_size: 48,
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
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

// Category-specific allergen mapping for kleenex integration
export const KLEENEX_ALLERGEN_CATEGORIES: Record<string, string> = {
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
export const INDIVIDUAL_TO_CATEGORY: Record<string, string> = {
  alder: "trees",
  birch: "trees",
  cypress: "trees",
  elm: "trees",
  hazel: "trees",
  oak: "trees",
  pine: "trees",
  plane: "trees",
  poplar: "trees",
  poaceae: "grass",
  mugwort: "weeds",
  ragweed: "weeds",
  chenopod: "weeds",
  nettle: "weeds",
};

/**
 * The allergen keys the editor offers for Kleenex: the stub's individual
 * allergens plus the three category totals.
 *
 * Selectable everywhere rather than only where discovery sees empty details.
 * Every zone has the category sensors -- the US zone has *only* those -- so a
 * list that changed shape as discovery data arrived would make the picker
 * depend on load timing for no gain. They stay out of `stubConfigKleenex`
 * .allergens, so the default selection is unchanged and no existing config is
 * touched; the US fallback in forecast.ts covers the users who never open the
 * editor at all.
 */
export const KLEENEX_EDITOR_ALLERGENS: string[] = [
  ...(stubConfigKleenex.allergens as string[]),
  "trees_cat",
  "grass_cat",
  "weeds_cat",
];

// Re-exported from the shared helper so the three adapter constants modules
// expose one identical capitalize (consumers keep their ./constants import).
export { capitalize } from "../../utils/adapter-helpers.js";
