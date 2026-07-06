import { describe, it, expect } from "vitest";
import { matchSensorByAllergenKey } from "../../src/utils/adapter-helpers.js";

// matchSensorByAllergenKey is the single shared "config allergen key -> sensor"
// resolver. Sensors store the adapter-normalized slug in allergenReplaced; the
// matcher reduces both that and the config key to the canonical allergen key so
// a key resolves regardless of the integration's key style, with a literal
// match taking priority.

const pp = { allergenReplaced: "bjork" }; // normalize("Björk")
const dwd = { allergenReplaced: "graeser" }; // normalizeDWD("gräser")
const silamIndex = { allergenReplaced: "allergy_risk" }; // SILAM index canonical
const english = { allergenReplaced: "birch" };

describe("matchSensorByAllergenKey", () => {
  it("matches a PP localized key (Björk -> bjork)", () => {
    expect(matchSensorByAllergenKey([pp, english], "Björk")).toBe(pp);
  });

  it("matches a DWD localized key (gräser -> graeser)", () => {
    expect(matchSensorByAllergenKey([dwd, english], "gräser")).toBe(dwd);
  });

  it("matches a DWD key with ß (Beifuß -> beifuss)", () => {
    // Generic normalize drops the ß ("beifu"); only normalizeDWD expands it to
    // "beifuss" to match the sensor. The matcher must try both.
    const dwdMugwort = { allergenReplaced: "beifuss" };
    expect(matchSensorByAllergenKey([dwdMugwort, english], "Beifuß")).toBe(
      dwdMugwort,
    );
  });

  it("matches the SILAM index by its user-facing key", () => {
    expect(matchSensorByAllergenKey([silamIndex, english], "index")).toBe(
      silamIndex,
    );
  });

  it("matches on the canonical key directly", () => {
    expect(matchSensorByAllergenKey([silamIndex], "allergy_risk")).toBe(
      silamIndex,
    );
    expect(matchSensorByAllergenKey([english], "birch")).toBe(english);
  });

  it("prefers a literal allergenReplaced match over a canonical-equal one", () => {
    // Both reduce to canonical "birch"; the literal "birch" sensor must win.
    const literal = { allergenReplaced: "birch" };
    const localized = { allergenReplaced: "bjork" };
    expect(matchSensorByAllergenKey([localized, literal], "birch")).toBe(
      literal,
    );
  });

  it("returns null when no sensor matches", () => {
    expect(matchSensorByAllergenKey([pp, dwd], "oak")).toBeNull();
  });

  it("is typeguarded against non-string keys and bad input", () => {
    expect(matchSensorByAllergenKey([english], 3)).toBeNull();
    expect(matchSensorByAllergenKey([english], null)).toBeNull();
    expect(matchSensorByAllergenKey([english], "")).toBeNull();
    expect(matchSensorByAllergenKey(null, "birch")).toBeNull();
    // A sensor without a string allergenReplaced is skipped, not thrown on.
    expect(matchSensorByAllergenKey([{ allergenReplaced: 5 }, english], "birch")).toBe(
      english,
    );
  });

  it("matches PP short config keys (capital initial) against lowercase allergenReplaced slugs", () => {
    // PP sensors store normalize(configKey) as lowercase slugs. The badge config
    // holds the original PP key as the user/editor wrote it (e.g. "Al", "Hassel",
    // "Ek"). The matcher must bridge the case difference via normalization so
    // single mode works for PP without requiring the user to know the slug.
    const al = { allergenReplaced: "al", days: [{ state: 2 }] };
    const hassel = { allergenReplaced: "hassel", days: [{ state: 1 }] };
    const ek = { allergenReplaced: "ek", days: [{ state: 4 }] };
    const sensors = [al, hassel, ek];

    expect(matchSensorByAllergenKey(sensors, "Al")).toBe(al);
    expect(matchSensorByAllergenKey(sensors, "Hassel")).toBe(hassel);
    expect(matchSensorByAllergenKey(sensors, "Ek")).toBe(ek);
  });
});
