import { describe, it, expect } from "vitest";
import { pinBadgeSingleAllergen } from "../../src/utils/adapter-helpers.js";

// pinBadgeSingleAllergen narrows the fetch to the one named allergen, resolved
// through the adapter's STUB allergen set (native slugs), not the possibly-
// custom configured list. It picks the stub key(s) whose canonical form matches
// the named key, so an adapter keyed by localized slugs (pp "Björk", dwd
// "Birke") fetches its native sensor when the user names a canonical key
// ("birch"). It falls back to [key] when the stub has no canonical match but
// the adapter resolves the key directly (gpl "birch"). Threshold is set to 0.
// Non-single modes and unconfigured single modes return the original config
// unchanged (same reference).

// pp-like stub: native Swedish slugs, "Björk" canonicalizes to "birch".
const PP_STUB = ["Al", "Björk", "Ek", "Gräs", "Hassel"];
// gpl-like stub: category keys, none canonicalizes to "birch".
const GPL_STUB = ["allergy_risk", "grass_cat", "trees_cat", "weeds_cat"];

describe("pinBadgeSingleAllergen", () => {
  it("narrows to the native stub slug for a canonical key and drops the threshold", () => {
    const input: any = {
      integration: "pp",
      badge_content: "single",
      badge_single_allergen: "birch",
      allergens: ["Gräs"], // custom list WITHOUT the localized birch slug
      pollen_threshold: 3,
    };

    const result = pinBadgeSingleAllergen(input, PP_STUB);

    expect(result).not.toBe(input);
    // Canonical "birch" resolves to the native stub slug "Björk"; the fetch is
    // narrowed to just that allergen (not the full stub, not the trimmed list).
    expect(result.allergens).toEqual(["Björk"]);
    expect(result.pollen_threshold).toBe(0);
    // Other keys preserved; input not mutated.
    expect(result.integration).toBe("pp");
    expect(result.badge_single_allergen).toBe("birch");
    expect(input.allergens).toEqual(["Gräs"]);
    expect(input.pollen_threshold).toBe(3);
  });

  it("matches a stub slug case-insensitively without duplicating it", () => {
    const input: any = {
      badge_content: "single",
      badge_single_allergen: "al", // lowercase variant of stub "Al"
    };
    const result = pinBadgeSingleAllergen(input, PP_STUB);
    expect(result.allergens).toEqual(["Al"]);
    expect(result.pollen_threshold).toBe(0);
  });

  it("falls back to the named key when no stub allergen canonically matches", () => {
    const input: any = {
      integration: "gpl",
      badge_content: "single",
      badge_single_allergen: "birch",
    };
    const result = pinBadgeSingleAllergen(input, GPL_STUB);
    expect(result.allergens).toEqual(["birch"]);
    expect(result.pollen_threshold).toBe(0);
  });

  it("falls back to just the named key when no stub allergens are provided", () => {
    const input: any = {
      badge_content: "single",
      badge_single_allergen: "birch",
    };
    const result = pinBadgeSingleAllergen(input);
    expect(result.allergens).toEqual(["birch"]);
    expect(result.pollen_threshold).toBe(0);
  });

  it("returns the same reference when badge_single_allergen is absent", () => {
    const input: any = { badge_content: "single", allergens: ["grass"] };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });

  it("returns the same reference when badge_single_allergen is an empty string", () => {
    const input: any = { badge_content: "single", badge_single_allergen: "" };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });

  it("returns the same reference when badge_content is not 'single'", () => {
    const input: any = {
      badge_content: "worst",
      badge_single_allergen: "birch",
      allergens: ["grass", "birch"],
    };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });

  it("returns the same reference when badge_content is 'aggregate'", () => {
    const input: any = {
      badge_content: "aggregate",
      badge_single_allergen: "birch",
    };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });

  it("returns the same reference when badge_content is absent", () => {
    const input: any = { badge_single_allergen: "birch", allergens: ["grass"] };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });
});
