import { describe, it, expect } from "vitest";
import { normalize, normalizeDWD } from "../../src/utils/normalize.js";

describe("normalize()", () => {
  it("lowercases and strips diacritics", () => {
    expect(normalize("Björk")).toBe("bjork");
  });

  it("handles Swedish names", () => {
    expect(normalize("Al")).toBe("al");
    expect(normalize("Gråbo")).toBe("grabo");
    expect(normalize("Malörtsambrosia")).toBe("malortsambrosia");
    expect(normalize("Sälg och viden")).toBe("salg_och_viden");
    expect(normalize("Gräs")).toBe("gras");
    expect(normalize("Hassel")).toBe("hassel");
  });

  it("replaces non-alnum with underscores", () => {
    expect(normalize("foo bar/baz")).toBe("foo_bar_baz");
  });

  it("trims leading and trailing underscores", () => {
    expect(normalize("  hello  ")).toBe("hello");
    expect(normalize("_test_")).toBe("test");
  });

  it("handles empty string", () => {
    expect(normalize("")).toBe("");
  });

  it("handles already-normalized strings", () => {
    expect(normalize("birch")).toBe("birch");
    expect(normalize("grass")).toBe("grass");
  });

  it("handles accented characters", () => {
    expect(normalize("café")).toBe("cafe");
    expect(normalize("naïve")).toBe("naive");
  });
});

describe("normalizeDWD()", () => {
  it("maps German umlauts to ae/oe/ue", () => {
    expect(normalizeDWD("Gräser")).toBe("graeser");
    expect(normalizeDWD("Beifuß")).toBe("beifuss");
  });

  it("handles already lowercase German names", () => {
    expect(normalizeDWD("erle")).toBe("erle");
    expect(normalizeDWD("ambrosia")).toBe("ambrosia");
    expect(normalizeDWD("birke")).toBe("birke");
    expect(normalizeDWD("roggen")).toBe("roggen");
  });

  it("preserves German ae/oe/ue in input", () => {
    expect(normalizeDWD("graeser")).toBe("graeser");
  });

  it("lowercases first", () => {
    expect(normalizeDWD("Erle")).toBe("erle");
    expect(normalizeDWD("BIRKE")).toBe("birke");
  });

  it("handles empty string", () => {
    expect(normalizeDWD("")).toBe("");
  });
});
