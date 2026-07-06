import { describe, it, expect } from "vitest";
import { buildLevelNamesForScale } from "../../src/utils/level-names.js";
import { SUPPORTED_LOCALES } from "../../src/i18n.js";

// The native five-step scale (card.levels5.*) is used by PEU, MeteoSwiss and
// IRM KMI. Its top index (4) must be a genuine "very high" term in every
// locale -- issue #277 found German flattened to the seven-step DWD wording,
// whose scale tops out at "hohe Belastung" ("high").

describe("card.levels5 locale ladders", () => {
  it("English reference ladder", () => {
    expect(buildLevelNamesForScale(5, [], "en")).toEqual([
      "No pollen",
      "Low levels",
      "Moderate levels",
      "High levels",
      "Very high levels",
    ]);
  });

  it("German ladder is an authored five-step scale with a very-high top (#277)", () => {
    expect(buildLevelNamesForScale(5, [], "de")).toEqual([
      "keine Belastung",
      "geringe Belastung",
      "mittlere Belastung",
      "hohe Belastung",
      "sehr hohe Belastung",
    ]);
  });

  it("no locale flattens the top of the five-step scale onto its 'high' step", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const ladder = buildLevelNamesForScale(5, [], locale);
      expect(ladder, locale).toHaveLength(5);
      // A flattened ladder repeats its "high" wording at the top (the #277
      // failure mode). Every step must be distinct.
      expect(new Set(ladder).size, `${locale}: ${ladder.join(" / ")}`).toBe(5);
    }
  });
});
