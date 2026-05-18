// src/utils/levels-defaults.js
export const LEVELS_DEFAULTS = {
  levels_colors: [
    "#FFE55A",
    "#FFC84E",
    "#FFA53F",
    "#FF6E33",
    "#FF6140",
    "#FF001C",
  ],
  levels_empty_color: "rgba(200, 200, 200, 0.15)",
  levels_gap_color: "rgba(200, 200, 200, 1)",
  levels_thickness: 60,
  levels_gap: 1,
  levels_text_weight: "normal",
  levels_text_size: 0.2,
  levels_icon_ratio: 1,
  levels_text_color: "var(--primary-text-color)",
  
  // Default allergen colors: [empty_color, ...levels_colors]
  // This ensures both allergen icons and level circles use the same color mapping
  allergen_colors: [
    "rgba(200, 200, 200, 0.15)", // Level 0 (empty)
    "#FFE55A", // Level 1
    "#FFC84E", // Level 2
    "#FFA53F", // Level 3
    "#FF6E33", // Level 4
    "#FF6140", // Level 5
    "#FF001C", // Level 6
  ],
  
  // Default allergen stroke width - changed from old default to 15
  allergen_stroke_width: 15,
  
  // Sync allergen stroke color with allergen level color
  allergen_stroke_color_synced: true,
  
  // Sync allergen stroke width with level circle gap
  allergen_levels_gap_synced: true,
  
  // Default color for no allergens icon
  no_allergens_color: "#a9cfe0",

  // Render the "no data" state (adapter-emitted level=-1) with a distinct
  // fuzzy texture so it doesn't visually collapse into a real level=0.
  // Spread into every adapter's stub config so the editor / YAML can opt
  // out per card.
  show_no_data_distinct: true,

  // Icon-in-ring (#227): place the allergen icon inside the level-ring
  // donut hole instead of (or in addition to) the side icon column.
  // Two independent toggles plus the centered-icon color/size knobs.
  icon_in_ring: false,
  show_allergen_column: true,
  icon_in_ring_color_mode: "static",
  icon_in_ring_static_color: "var(--primary-text-color)",
  icon_in_ring_size_ratio: 0.75,
};

// When icon_in_ring is toggled on by the editor, levels_thickness auto-
// shifts from its normal default to a thinner default so the centered
// icon has room. Toggling back restores. The swap only fires when the
// current value still equals the previous mode's default, so manual
// customizations survive (see editor toggle handler).
export const NORMAL_DEFAULT_THICKNESS = 60;
export const ICON_IN_RING_DEFAULT_THICKNESS = 35;

// Conversion factor for stroke width to gap conversion
// This converts allergen stroke width (in pixels) to level gap units
// The divisor of 30 provides appropriate scaling for the UI components
export const STROKE_WIDTH_TO_GAP_RATIO = 30;

/**
 * Converts stroke width to appropriate gap value for level circles
 * @param {number} strokeWidth - The stroke width in pixels
 * @returns {number} The calculated gap value
 */
export function convertStrokeWidthToGap(strokeWidth) {
  return Math.round(strokeWidth / STROKE_WIDTH_TO_GAP_RATIO);
}
