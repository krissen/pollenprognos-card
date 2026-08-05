import { describe, it, expect } from "vitest";
import {
  buildBadgeLabel,
  coerceBadgeLabelContent,
} from "../../src/utils/badge-label.js";

// buildBadgeLabel (polleninformation issue #63) decides what the badge's label
// says: the allergen name (the original behaviour), today's translated level
// text, or both.

const withLevel: any = {
  allergenShort: "Birch",
  allergenCapitalized: "Birch pollen",
  days: [{ state: 3, state_text: "High" }],
};
const noLevelText: any = {
  allergenShort: "Birch",
  allergenCapitalized: "Birch pollen",
  days: [{ state: 3, state_text: "" }],
};
const noDays: any = { allergenShort: "Birch", allergenCapitalized: "Birch p." };
const onlyLevel: any = {
  allergenShort: "",
  allergenCapitalized: "",
  days: [{ state: 3, state_text: "High" }],
};

describe("buildBadgeLabel", () => {
  it("defaults to the allergen short name", () => {
    expect(buildBadgeLabel(withLevel)).toBe("Birch");
    expect(buildBadgeLabel(withLevel, "allergen")).toBe("Birch");
  });

  it("falls back to the capitalized name when there is no short name", () => {
    const s: any = { allergenCapitalized: "Birch pollen", days: [] };
    expect(buildBadgeLabel(s, "allergen")).toBe("Birch pollen");
  });

  it("shows today's translated level text in level mode", () => {
    expect(buildBadgeLabel(withLevel, "level")).toBe("High");
  });

  it("returns empty in level mode when there is no level text", () => {
    // The badge skips the label element entirely on "", rather than rendering
    // an empty pill segment.
    expect(buildBadgeLabel(noLevelText, "level")).toBe("");
    expect(buildBadgeLabel(noDays, "level")).toBe("");
  });

  it("joins allergen and level the way the card's minimal mode does", () => {
    expect(buildBadgeLabel(withLevel, "allergen_level")).toBe("Birch: High");
  });

  it("drops the separator when one half is missing", () => {
    expect(buildBadgeLabel(noLevelText, "allergen_level")).toBe("Birch");
    expect(buildBadgeLabel(noDays, "allergen_level")).toBe("Birch");
    expect(buildBadgeLabel(onlyLevel, "allergen_level")).toBe("High");
  });

  it("returns empty for a missing sensor", () => {
    expect(buildBadgeLabel(undefined, "allergen_level")).toBe("");
    expect(buildBadgeLabel(null, "level")).toBe("");
  });
});

describe("coerceBadgeLabelContent", () => {
  it("passes through the three supported modes", () => {
    expect(coerceBadgeLabelContent("allergen")).toBe("allergen");
    expect(coerceBadgeLabelContent("level")).toBe("level");
    expect(coerceBadgeLabelContent("allergen_level")).toBe("allergen_level");
  });

  it("falls back to allergen for anything else", () => {
    // Absent key, typo, or a non-string YAML scalar must all land on the
    // pre-#63 behaviour rather than blanking the label.
    expect(coerceBadgeLabelContent(undefined)).toBe("allergen");
    expect(coerceBadgeLabelContent("levels")).toBe("allergen");
    expect(coerceBadgeLabelContent(true)).toBe("allergen");
    expect(coerceBadgeLabelContent(2)).toBe("allergen");
  });
});
