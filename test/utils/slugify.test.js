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

describe("slugify: HA compatibility fixes (æ, ß)", () => {
  it("æ -> ae (matches HA backend)", () => {
    expect(slugify("Træ")).toBe("trae");
    expect(slugify("Præstø")).toBe("praesto");
    expect(slugify("Græs")).toBe("graes");
  });

  it("ß -> ss (matches HA backend)", () => {
    expect(slugify("Beifuß")).toBe("beifuss");
    expect(slugify("Straße")).toBe("strasse");
  });
});

describe("slugify: Cyrillic transliteration", () => {
  it("Ukrainian names produce valid slugs", () => {
    expect(slugify("Береза")).toBe("bereza");
    expect(slugify("Трава")).toBe("trava");
    expect(slugify("Ясен")).toBe("yasen");
    expect(slugify("Сосна")).toBe("sosna");
  });

  it("Ukrainian names with special chars", () => {
    expect(slugify("Вільха")).toBe("vil_kha");
    expect(slugify("Ліщина")).toBe("lishchina");
    expect(slugify("Бур'ян")).toBe("bur_yan");
    expect(slugify("Амброзія")).toBe("ambroziya");
  });

  it("Russian names", () => {
    expect(slugify("Москва")).toBe("moskva");
    expect(slugify("Сорняки")).toBe("sornyaki");
  });
});

describe("slugify: CJK transliteration", () => {
  it("Chinese", () => {
    expect(slugify("草")).toBe("cao");
    expect(slugify("桦树")).toBe("huashu");
    expect(slugify("橡树")).toBe("xiangshu");
  });

  it("Japanese", () => {
    expect(slugify("ヨモギ")).toBe("yomogi");
    expect(slugify("スギ")).toBe("sugi");
    expect(slugify("マツ")).toBe("matsu");
  });

  it("Korean", () => {
    expect(slugify("잔디")).toBe("jandi");
    expect(slugify("자작나무")).toBe("jajagnamu");
  });
});

describe("slugify: Thai and other scripts", () => {
  it("Thai produces valid slug", () => {
    const result = slugify("หญ้า");
    expect(result).not.toBe("unknown");
    expect(result.length).toBeGreaterThan(0);
  });

  it("Arabic produces valid slug", () => {
    const result = slugify("شجرة");
    expect(result).not.toBe("unknown");
    expect(result.length).toBeGreaterThan(0);
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
