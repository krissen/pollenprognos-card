// src/adapters/gpl/constants.ts
import type { AdapterStubConfig } from "../../types/config.js";
import { LEVELS_DEFAULTS } from "../../utils/levels-defaults.js";

/**
 * Match the attribution string published by the pollenlevels integration.
 * The wording changed in v3.0.0rc3 to
 * "Google Maps — Source: Includes pollen data from Google", so an exact
 * comparison against a single literal would silently drop tier-3 detection
 * for one half of the installed base.
 */
export function isGoogleAttribution(attr: unknown): boolean {
  return (
    typeof attr === "string" &&
    (attr.includes("pollen data from Google") ||
      // pollenlevels <= 3.0.0rc2 published this legacy wording
      attr === "Data provided by Google Maps Pollen API")
  );
}

// Map pollenlevels TYPE_ICONS to our canonical allergen keys
export const GPL_TYPE_ICON_MAP: Record<string, string> = {
  "mdi:grass": "grass_cat",
  "mdi:tree": "trees_cat",
  "mdi:flower-tulip": "weeds_cat",
};

// Base allergens always available (categories)
export const GPL_BASE_ALLERGENS = ["grass_cat", "trees_cat", "weeds_cat"];

export const stubConfigGPL: AdapterStubConfig = {
  integration: "gpl",
  location: "",
  entity_prefix: "",
  entity_suffix: "",
  allergens: ["allergy_risk", "grass_cat", "trees_cat", "weeds_cat"],
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
  // Google's attribution policy requires visible attribution for pollen data
  // sourced from Google, so this defaults on; the user may still opt out (#338).
  show_google_attribution: true,
  // Summary block (issue #222): opt-in, additive, never duplicates by default.
  // The two extras default true but stay invisible until show_summary_block is
  // turned on, so opting into the block gives the full rich GPL block at once.
  show_summary_block: false,
  show_summary_row: false,
  show_summary_separator: true,
  show_summary_top_types: true,
  show_summary_plants_in_season: true,
  allergens_abbreviated: false,
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

// Re-exported from the shared helper so the three adapter constants modules
// expose one identical capitalize (consumers keep their ./constants import).
export { capitalize } from "../../utils/adapter-helpers.js";
