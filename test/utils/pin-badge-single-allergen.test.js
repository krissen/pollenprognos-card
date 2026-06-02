import { describe, it, expect } from "vitest";
import { pinBadgeSingleAllergen } from "../../src/utils/adapter-helpers.js";

// pinBadgeSingleAllergen rewrites the config so that when badge_content is
// "single" and badge_single_allergen names a specific allergen, that allergen
// is guaranteed to be fetched and kept: the named key is ADDED to allergens
// (deduped) and pollen_threshold is set to 0. The key is added, not
// substituted, so an adapter keyed by native names (e.g. pp "Bjork") still
// fetches its own sensors and selectBadgeSensor can resolve a canonical name
// against them. Non-single modes and unconfigured single modes get the
// original config back unchanged (same reference).

describe("pinBadgeSingleAllergen", () => {
  it("adds the named allergen and drops the threshold for a named single allergen", () => {
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

    // Core rewrite: the named key is added (not substituted) and threshold drops.
    expect(result.allergens).toEqual(["grass_cat", "birch"]);
    expect(result.pollen_threshold).toBe(0);

    // Other keys must be preserved unchanged.
    expect(result.integration).toBe("pp");
    expect(result.badge_content).toBe("single");
    expect(result.badge_single_allergen).toBe("birch");

    // Input must NOT be mutated.
    expect(input.allergens).toEqual(["grass_cat"]);
    expect(input.pollen_threshold).toBe(3);
  });

  it("does not duplicate the named allergen when it is already in allergens", () => {
    const input = {
      badge_content: "single",
      badge_single_allergen: "birch",
      allergens: ["grass", "birch"],
      pollen_threshold: 1,
    };

    const result = pinBadgeSingleAllergen(input);

    expect(result.allergens).toEqual(["grass", "birch"]);
    expect(result.pollen_threshold).toBe(0);
  });

  it("adds the named allergen when the config has no allergens array", () => {
    const input = {
      badge_content: "single",
      badge_single_allergen: "birch",
    };

    const result = pinBadgeSingleAllergen(input);

    expect(result.allergens).toEqual(["birch"]);
    expect(result.pollen_threshold).toBe(0);
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
