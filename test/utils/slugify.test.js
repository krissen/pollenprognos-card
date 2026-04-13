import { describe, it, expect } from "vitest";
import { slugify } from "../../src/utils/slugify.js";
import { PP_POSSIBLE_CITIES } from "../../src/constants.js";

describe("slugify: backward compatibility", () => {
  it("produces expected slugs for all 22 PP cities", () => {
    const expected = [
      ["Borlänge", "borlange"],
      ["Bräkne-Hoby", "brakne_hoby"],
      ["Eskilstuna", "eskilstuna"],
      ["Forshaga", "forshaga"],
      ["Gävle", "gavle"],
      ["Göteborg", "goteborg"],
      ["Hässleholm", "hassleholm"],
      ["Jönköping", "jonkoping"],
      ["Kristianstad", "kristianstad"],
      ["Ljusdal", "ljusdal"],
      ["Malmö", "malmo"],
      ["Norrköping", "norrkoping"],
      ["Nässjö", "nassjo"],
      ["Piteå", "pitea"],
      ["Skövde", "skovde"],
      ["Stockholm", "stockholm"],
      ["Storuman", "storuman"],
      ["Sundsvall", "sundsvall"],
      ["Umeå", "umea"],
      ["Visby", "visby"],
      ["Västervik", "vastervik"],
      ["Östersund", "ostersund"],
    ];
    for (const [city, slug] of expected) {
      expect(slugify(city)).toBe(slug);
    }
  });

  it("PP_POSSIBLE_CITIES all produce non-empty slugs", () => {
    for (const city of PP_POSSIBLE_CITIES) {
      expect(slugify(city).length).toBeGreaterThan(0);
      expect(slugify(city)).not.toBe("unknown");
    }
  });
});

describe("slugify: Latin diacritics", () => {
  it("ä -> a", () => expect(slugify("Gräs")).toBe("gras"));
  it("ö -> o", () => expect(slugify("Björk")).toBe("bjork"));
  it("ü -> u", () => expect(slugify("München")).toBe("munchen"));
  it("å -> a", () => expect(slugify("Umeå")).toBe("umea"));
  it("é -> e", () => expect(slugify("café")).toBe("cafe"));
  it("ñ -> n", () => expect(slugify("España")).toBe("espana"));
});

describe("slugify: HA frontend character table behavior", () => {
  it("æ -> a (HA frontend maps æ to single a)", () => {
    expect(slugify("Træ")).toBe("tra");
    expect(slugify("Græs")).toBe("gras");
  });

  it("ß -> s (HA frontend maps ß to single s)", () => {
    expect(slugify("Beifuß")).toBe("beifus");
  });
});

describe("slugify: Cyrillic (basic Russian)", () => {
  it("common Russian letters produce valid slugs", () => {
    expect(slugify("Береза")).toBe("bereza");
    expect(slugify("Трава")).toBe("trava");
    expect(slugify("Сосна")).toBe("sosna");
  });

  it("complex Cyrillic (ж, ш, щ, я) handled", () => {
    expect(slugify("Жук")).toBe("zhuk");
    expect(slugify("Шум")).toBe("shum");
  });
});

describe("slugify: known limitations (character table)", () => {
  it("CJK produces 'unknown' (handled by GP display_name map instead)", () => {
    expect(slugify("草")).toBe("unknown");
    expect(slugify("잔디")).toBe("unknown");
  });

  it("Thai/Arabic produce 'unknown' (handled by GP display_name map instead)", () => {
    expect(slugify("หญ้า")).toBe("unknown");
    expect(slugify("شجرة")).toBe("unknown");
  });

  it("Ukrainian і (U+0456) falls through to delimiter (not in а-я range)", () => {
    // This is a known limitation of HA's frontend slugify.
    // GP adapter uses direct display_name lookup for Ukrainian.
    const result = slugify("Вільха");
    expect(result).toContain("lha");
  });
});

describe("slugify: edge cases", () => {
  it("empty string returns empty", () => {
    expect(slugify("")).toBe("");
  });

  it("custom delimiter", () => {
    expect(slugify("hello world", "-")).toBe("hello-world");
  });

  it("collapses multiple delimiters", () => {
    expect(slugify("a   b")).toBe("a_b");
  });

  it("trims leading/trailing delimiters", () => {
    expect(slugify(" hello ")).toBe("hello");
  });

  it("preserves numbers", () => {
    expect(slugify("test123")).toBe("test123");
  });

  it("removes commas between numbers", () => {
    expect(slugify("1,000")).toBe("1000");
  });
});
