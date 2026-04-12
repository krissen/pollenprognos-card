// src/adapters/gp/constants.js
import { LEVELS_DEFAULTS } from "../../utils/levels-defaults.js";

// Domain used by svenove/home-assistant-google-pollen
export const GP_DOMAIN = "google_pollen";

// Map category display_name slugs to canonical category keys
export const GP_CATEGORY_MAP = {
  grass: "grass_cat",
  tree: "trees_cat",
  weed: "weeds_cat",
};

// Base allergens (categories) always available
export const GP_BASE_ALLERGENS = ["grass_cat", "trees_cat", "weeds_cat"];

export const stubConfigGP = {
  integration: "gp",
  location: "",
  entity_prefix: "",
  entity_suffix: "",
  allergens: ["grass_cat", "trees_cat", "weeds_cat"],
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
  days_to_show: 4,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 1,
  sort: "value_descending",
  sort_category_allergens_first: true,
  allergens_abbreviated: false,
  link_to_sensors: true,
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
