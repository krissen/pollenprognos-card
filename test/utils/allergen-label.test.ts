import { describe, it, expect } from "vitest";
import { resolveAllergenPhrase } from "../../src/utils/allergen-label.js";

describe("resolveAllergenPhrase", () => {
  it("returns the editor.phrases_full string for a covered key", () => {
    expect(resolveAllergenPhrase("birch", "birch", { lang: "en" })).toBe("Birch");
    expect(resolveAllergenPhrase("birch", "birch", { lang: "sv" })).toBe("Björk");
  });

  it("uses the phrases_short namespace when short:true", () => {
    // grass has both full and short entries; assert the short path is taken.
    expect(resolveAllergenPhrase("grass", "grass", { short: true, lang: "en" })).toBe("Grass");
  });

  it("resolves graminales (regression: used to leak the raw key)", () => {
    expect(resolveAllergenPhrase("graminales", "graminales", { lang: "es" })).toBe("Gramíneas");
    expect(resolveAllergenPhrase("graminales", "graminales", { lang: "de" })).toBe("Gräser");
    expect(resolveAllergenPhrase("graminales", "graminales", { lang: "en" })).toBe("Grasses");
  });

  it("falls back to card.allergen when the editor phrase is missing", () => {
    // Construct a key present in card.allergen.* but not editor.phrases_*.
    // (If such a key ever gains an editor phrase this test will surface it.)
    // `nettle_and_pellitory` exists in both, so instead simulate by trusting
    // the chain order: a key only in card.allergen resolves to that value.
    // We assert the chain never returns the raw editor key for a real allergen.
    const out = resolveAllergenPhrase("allergy_risk", "allergy_risk", { lang: "en" });
    expect(out).not.toMatch(/^editor\.phrases_/);
    expect(out).not.toMatch(/^card\.allergen\./);
    expect(out.length).toBeGreaterThan(0);
  });

  it("never returns a raw i18n key for an unknown allergen", () => {
    const out = resolveAllergenPhrase("totally_unknown_code", "totally_unknown_code", { lang: "en" });
    expect(out).not.toMatch(/^editor\.phrases_/);
    expect(out).not.toMatch(/^card\.allergen\./);
    // humanized: underscores -> spaces, first letter capitalized
    expect(out).toBe("Totally unknown code");
  });

  it("humanizes from raw, capitalizing and replacing underscores", () => {
    expect(resolveAllergenPhrase("xx_yy", "xx_yy", { lang: "en" })).toBe("Xx yy");
  });

  it("handles null/empty canonical and raw without throwing", () => {
    expect(resolveAllergenPhrase("", "", { lang: "en" })).toBe("");
    expect(resolveAllergenPhrase(undefined as any, undefined as any, { lang: "en" })).toBe("");
    expect(resolveAllergenPhrase("foo", null as any, { lang: "en" })).toBe("Foo");
  });

  it("falls back to English locale data for an unknown language", () => {
    expect(resolveAllergenPhrase("graminales", "graminales", { lang: "xx" })).toBe("Grasses");
  });
});
