import { describe, it, expect } from "vitest";
import { pinBadgeSingleAllergen } from "../../src/utils/adapter-helpers.js";

// pinBadgeSingleAllergen rewrites the config so that when badge_content is
// "single" and badge_single_allergen names a specific allergen, the card's
// fetch/filter pipeline is scoped down to that allergen only (allergens:
// [named] + pollen_threshold: 0). This avoids leaking unrelated allergens
// into the fetch path. Non-single modes and unconfigured single modes get the
// original config back unchanged (same reference).

describe("pinBadgeSingleAllergen", () => {
  it("returns a new object with allergens and threshold overridden for a named single allergen", () => {
    const input = {
      integration: "pp",
      badge_content: "single",
      badge_single_allergen: "birch",
      allergens: ["grass_cat"],
      pollen_threshold: 3,
    };

    const result = pinBadgeSingleAllergen(input);

    // Must be a NEW object, not the same reference.
    expect(result).not.toBe(input);

    // Core rewrite: allergens narrows to the named allergen, threshold drops.
    expect(result.allergens).toEqual(["birch"]);
    expect(result.pollen_threshold).toBe(0);

    // Other keys must be preserved unchanged.
    expect(result.integration).toBe("pp");
    expect(result.badge_content).toBe("single");
    expect(result.badge_single_allergen).toBe("birch");

    // Input must NOT be mutated.
    expect(input.allergens).toEqual(["grass_cat"]);
    expect(input.pollen_threshold).toBe(3);
  });

  it("returns the same reference when badge_content is 'single' but badge_single_allergen is absent", () => {
    const input = {
      badge_content: "single",
      allergens: ["grass"],
      pollen_threshold: 2,
    };
    expect(pinBadgeSingleAllergen(input)).toBe(input);
  });

  it("returns the same reference when badge_content is 'single' but badge_single_allergen is an empty string", () => {
    const input = {
      badge_content: "single",
      badge_single_allergen: "",
      allergens: ["grass"],
    };
    expect(pinBadgeSingleAllergen(input)).toBe(input);
  });

  it("returns the same reference when badge_content is not 'single', even if badge_single_allergen is set", () => {
    const input = {
      badge_content: "worst",
      badge_single_allergen: "birch",
      allergens: ["grass", "birch"],
      pollen_threshold: 1,
    };
    expect(pinBadgeSingleAllergen(input)).toBe(input);
  });

  it("returns the same reference when badge_content is 'aggregate'", () => {
    const input = {
      badge_content: "aggregate",
      badge_single_allergen: "birch",
    };
    expect(pinBadgeSingleAllergen(input)).toBe(input);
  });

  it("returns the same reference when badge_content is absent (no mode set)", () => {
    const input = {
      badge_single_allergen: "birch",
      allergens: ["grass"],
    };
    expect(pinBadgeSingleAllergen(input)).toBe(input);
  });
});
