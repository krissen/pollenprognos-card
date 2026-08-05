// src/utils/badge-label.ts
import type { PollenSensor } from "../types/sensor.js";

/** Accepted values of `badge_label_content`. */
export type BadgeLabelContent = "allergen" | "level" | "allergen_level";

const CONTENTS: readonly BadgeLabelContent[] = [
  "allergen",
  "level",
  "allergen_level",
];

/**
 * Coerce a raw `badge_label_content` YAML value to a supported mode.
 * Anything unrecognised falls back to "allergen", which is the pre-#63
 * behaviour of the badge label.
 */
export function coerceBadgeLabelContent(raw: unknown): BadgeLabelContent {
  return typeof raw === "string" && CONTENTS.includes(raw as BadgeLabelContent)
    ? (raw as BadgeLabelContent)
    : "allergen";
}

/**
 * Build the text shown next to (or below) a badge visual.
 *
 * - "allergen"       — short allergen name, falling back to the capitalized one.
 * - "level"          — today's translated level text (e.g. "hoch"), as already
 *                      produced by the adapters in `days[0].state_text`.
 * - "allergen_level" — both, joined the same way the card's minimal mode joins
 *                      them ("Birch: High").
 *
 * Missing parts degrade instead of rendering separators around nothing: an
 * absent level text leaves the allergen alone (and vice versa), and a mode with
 * no data at all returns "" so the caller can skip the label element.
 */
export function buildBadgeLabel(
  sensor: PollenSensor | null | undefined,
  content: BadgeLabelContent = "allergen",
): string {
  if (!sensor) return "";
  const allergen = sensor.allergenShort ?? sensor.allergenCapitalized ?? "";
  const level = sensor.days?.[0]?.state_text ?? "";

  if (content === "level") return level;
  if (content === "allergen_level") {
    if (allergen && level) return `${allergen}: ${level}`;
    return allergen || level;
  }
  return allergen;
}
