// src/adapters/kleenex/levels.js
import { KLEENEX_ALLERGEN_CATEGORIES } from "./constants.js";

// Convert numeric ppm values to level (0-4) using category-specific thresholds
// Based on kleenex integration thresholds: trees [95, 207, 703], weeds [20, 77, 266], grass [29, 60, 341]
export function ppmToLevel(value, allergenName) {
  const numVal = Number(value);
  if (isNaN(numVal) || numVal < 0) return -1;
  if (numVal === 0) return 0;

  // Get category for this allergen
  const category = KLEENEX_ALLERGEN_CATEGORIES[allergenName] || "trees"; // Default to trees

  // Category-specific thresholds: [low, moderate, high] -> levels 1, 2, 3, with 4 being very-high
  let thresholds;
  switch (category) {
    case "trees":
      thresholds = [95, 207, 703];
      break;
    case "weeds":
      thresholds = [20, 77, 266];
      break;
    case "grass":
      thresholds = [29, 60, 341];
      break;
    default:
      thresholds = [95, 207, 703]; // Default to trees
  }

  if (numVal <= thresholds[0]) return 1; // low
  if (numVal <= thresholds[1]) return 2; // moderate
  if (numVal <= thresholds[2]) return 3; // high
  return 4; // very-high
}
