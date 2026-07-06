// ------------------------------------------------------------------ //
// Per-section reset-key registry.                                     //
//                                                                     //
// The static portion of each section's reset-key list, extracted from //
// PollenEditorBase so the section-reset behaviour lives in one place. //
// The base-class getters spread these constants (returning a fresh    //
// array each call) and layer any dynamic keys on top.                 //
// ------------------------------------------------------------------ //

// §5 Card appearance. The badge editor extends this with its badge_* keys.
export const APPEARANCE_RESET_KEYS = [
  "background_color",
  "icon_size",
  "text_size_ratio",
];

// §6 Allergen icons. Static base; the getter conditionally appends
// levels_gap / levels_empty_color for inherit_allergen mode.
export const ALLERGEN_ICONS_RESET_KEYS = [
  "allergen_color_mode",
  "allergen_colors",
  "allergen_outline_color",
  "allergen_stroke_color_synced",
  "allergen_stroke_width",
  "no_allergens_color",
];

// §7 Level circles.
export const LEVEL_CIRCLES_RESET_KEYS = [
  "levels_inherit_mode",
  "levels_colors",
  "levels_empty_color",
  "levels_thickness",
  "levels_gap",
  "levels_gap_color",
  "levels_icon_ratio",
  "levels_text_size",
  "levels_text_color",
  "levels_text_weight",
  "allergen_levels_gap_synced",
  "numeric_value_raw",
  "numeric_state_raw_risk",
  "show_value_numeric_in_circle",
];

// §8 Icon in ring. Static base; the getter conditionally appends
// levels_thickness when it was auto-thinned by enabling icon_in_ring.
export const ICON_IN_RING_RESET_KEYS = [
  "icon_in_ring",
  "icon_in_ring_color_mode",
  "icon_in_ring_size_ratio",
  "icon_in_ring_static_color",
];

// §1 Integration & Location. Static base; the getter conditionally appends
// mode / days_to_show / show_empty_days for SILAM/PEU.
export const INTEGRATION_RESET_KEYS = [
  "city",
  "region_id",
  "location",
  "entity_prefix",
  "entity_suffix",
  "entity_weather",
  "title",
];

// §2 Allergens: selection, threshold, sort, pin-to-top, summary/pollution toggles.
export const ALLERGENS_RESET_KEYS = [
  "allergens",
  "pollen_threshold",
  "sort",
  "sort_category_allergens_first",
  "sort_pollution_block",
  "pollution_block_position",
  "show_block_separator",
  "show_summary_block",
  "show_summary_row",
  "show_summary_separator",
  "show_summary_top_types",
  "show_summary_plants_in_season",
  "allergy_risk_top",
  "index_top",
];

// §9 Translations & strings: custom phrase overrides + date locale.
export const PHRASES_RESET_KEYS = ["phrases", "date_locale"];
