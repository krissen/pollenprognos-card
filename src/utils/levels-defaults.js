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
};
