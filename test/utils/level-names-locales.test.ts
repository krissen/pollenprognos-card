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

  it("every locale has five distinct steps on the five-step scale", () => {
    // Note: this cheap invariant would NOT have caught #277 (the flattened
    // German ladder had five literally-distinct strings; the defect was that
    // the top step carried the SEVEN-scale's "high" wording). The exact-match
    // ladder assertions above are the real regression net; this guard only
    // catches literal duplicates from future copy-paste mistakes.
    for (const locale of SUPPORTED_LOCALES) {
      const ladder = buildLevelNamesForScale(5, [], locale);
      expect(ladder, locale).toHaveLength(5);
      expect(new Set(ladder).size, `${locale}: ${ladder.join(" / ")}`).toBe(5);
    }
  });
});
