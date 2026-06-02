import { describe, it, expect } from "vitest";
import { pinBadgeSingleAllergen } from "../../src/utils/adapter-helpers.js";

// pinBadgeSingleAllergen rewrites the config so that when badge_content is
// "single" and badge_single_allergen names a specific allergen, that allergen
// is guaranteed to be fetched and kept. The fetch is based on the adapter's
// STUB allergen set (native slugs), not the possibly-custom configured list, so
// an adapter keyed by localized slugs (pp "bjork", dwd "birke") still fetches
// the native sensor when the user names a canonical key ("birch"). The named
// key is appended only when no stub allergen is canonically equivalent, so a
// canonical name the stub omits but the adapter resolves directly (gpl "birch")
// is still fetched, without double-fetching a localized stub key. Threshold is
// set to 0. Non-single modes and unconfigured single modes return the original
// config unchanged (same reference).

// pp-like stub: native Swedish slugs, "Björk" canonicalizes to "birch".
const PP_STUB = ["Al", "Björk", "Ek", "Gräs", "Hassel"];
// gpl-like stub: category keys, none canonicalizes to "birch".
const GPL_STUB = ["allergy_risk", "grass_cat", "trees_cat", "weeds_cat"];

describe("pinBadgeSingleAllergen", () => {
  it("uses the stub allergens (not the configured list) and drops the threshold", () => {
    const input = {
      integration: "pp",
      badge_content: "single",
      badge_single_allergen: "birch",
      allergens: ["Gräs"], // custom list WITHOUT the localized birch slug
      pollen_threshold: 3,
    };

    const result = pinBadgeSingleAllergen(input, PP_STUB);

    expect(result).not.toBe(input);
    // Localized "Björk" already covers canonical "birch", so the stub is used
    // as-is (the named canonical key is NOT appended, no double fetch).
    expect(result.allergens).toEqual(PP_STUB);
    expect(result.pollen_threshold).toBe(0);
    // Other keys preserved; input not mutated.
    expect(result.integration).toBe("pp");
    expect(result.badge_single_allergen).toBe("birch");
    expect(input.allergens).toEqual(["Gräs"]);
    expect(input.pollen_threshold).toBe(3);
  });

  it("does not duplicate when the named key matches a stub slug case-insensitively", () => {
    const input = {
      badge_content: "single",
      badge_single_allergen: "al", // lowercase variant of stub "Al"
    };
    const result = pinBadgeSingleAllergen(input, PP_STUB);
    expect(result.allergens).toEqual(PP_STUB);
    expect(result.pollen_threshold).toBe(0);
  });

  it("appends a canonical key the stub omits but the adapter resolves directly", () => {
    const input = {
      integration: "gpl",
      badge_content: "single",
      badge_single_allergen: "birch",
    };
    const result = pinBadgeSingleAllergen(input, GPL_STUB);
    expect(result.allergens).toEqual([...GPL_STUB, "birch"]);
    expect(result.pollen_threshold).toBe(0);
  });

  it("falls back to just the named key when no stub allergens are provided", () => {
    const input = {
      badge_content: "single",
      badge_single_allergen: "birch",
    };
    const result = pinBadgeSingleAllergen(input);
    expect(result.allergens).toEqual(["birch"]);
    expect(result.pollen_threshold).toBe(0);
  });

  it("returns the same reference when badge_single_allergen is absent", () => {
    const input = { badge_content: "single", allergens: ["grass"] };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });

  it("returns the same reference when badge_single_allergen is an empty string", () => {
    const input = { badge_content: "single", badge_single_allergen: "" };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });

  it("returns the same reference when badge_content is not 'single'", () => {
    const input = {
      badge_content: "worst",
      badge_single_allergen: "birch",
      allergens: ["grass", "birch"],
    };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });

  it("returns the same reference when badge_content is 'aggregate'", () => {
    const input = { badge_content: "aggregate", badge_single_allergen: "birch" };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });

  it("returns the same reference when badge_content is absent", () => {
    const input = { badge_single_allergen: "birch", allergens: ["grass"] };
    expect(pinBadgeSingleAllergen(input, PP_STUB)).toBe(input);
  });
});
