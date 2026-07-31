import { describe, it, expect } from "vitest";
import {
  fetchForecast,
  stubConfigKleenex,
  KLEENEX_ALLERGEN_MAP,
  normalizeDetailName,
} from "../../src/adapters/kleenex/index.js";
import { createHass } from "../helpers.js";

/**
 * Every allergen name the Kleenex integration reports, per region and category.
 *
 * Source: live dump from an 8-location hass-test install on 2026-07-30,
 * integration v1.6.1 (tmp/final-verify/detail-names.txt in the repo). The
 * strings are verbatim, including the trailing space FR and IT put on
 * "Poaceae " and the IT misspelling "Chenepod" -- normalizing them here would
 * defeat the point of the matrix.
 *
 * The integration serves exactly five regions. US is a matrix case in its own
 * right: its endpoint hardcodes empty details[], so no per-allergen name ever
 * arrives and only the category totals are usable.
 *
 * A new upstream spelling belongs here as a row, alongside its alias in
 * KLEENEX_ALLERGEN_MAP -- not as a one-off fix at the call site.
 */
const REGION_DETAIL_NAMES: Record<
  string,
  { source: string; trees: string[]; grass: string[]; weeds: string[] }
> = {
  fr: {
    source: "Paris",
    trees: [
      "Noisetier",
      "Orme",
      "Pin",
      "Aulne",
      "Peuplier",
      "Chêne",
      "Platane",
      "Bouleau",
      "Cyprès",
    ],
    grass: ["Poaceae "],
    weeds: ["Armoise", "Chénopodes", "Ambroisie", "Ortie"],
  },
  it: {
    // The IT endpoint answers in English, so the Italian aliases in the map are
    // never exercised by it -- but it misspells chenopod as "Chenepod".
    source: "Roma, Milano",
    trees: [
      "Cypress",
      "Plane",
      "Alder",
      // "Hazel" is listed twice by the IT endpoint; kept as dumped.
      "Hazel",
      "Hazel",
      "Elm",
      "Oak",
      "Pine",
      "Poplar",
    ],
    grass: ["Poaceae "],
    weeds: ["Nettle", "Chenepod", "Mugwort", "Ragweed"],
  },
  nl: {
    source: "Utrecht",
    trees: [
      "Hazelaar",
      "Iep",
      "Pijnboom",
      "Els",
      "Populier",
      "Eik",
      "Plataan",
      "Berk",
      "Cipres",
    ],
    grass: ["Poaceae"],
    weeds: ["Bijvoet", "Ganzevoet", "Ambrosia", "Brandnetel"],
  },
  uk: {
    source: "London",
    trees: [
      "Hazel",
      "Elm",
      "Pine",
      "Alder",
      "Poplar",
      "Oak",
      "Plane",
      "Birch",
      "Cypress",
    ],
    grass: ["Poaceae"],
    weeds: ["Mugwort", "Chenopod", "Ragweed", "Nettle"],
  },
  us: {
    source: "Atlanta, Boise, New York",
    trees: [],
    grass: [],
    weeds: [],
  },
};

const CATEGORIES = ["trees", "grass", "weeds"] as const;

function detailSensor(
  category: string,
  names: string[],
  value: number,
): Record<string, unknown> {
  return {
    entity_id: `sensor.kleenex_pollen_radar_matrix_${category}`,
    state: String(value),
    attributes: {
      details: names.map((name) => ({ name, value })),
      forecast: [],
    },
  };
}

describe("Kleenex adapter: upstream allergen names per region", () => {
  for (const [region, data] of Object.entries(REGION_DETAIL_NAMES)) {
    for (const category of CATEGORIES) {
      const names = data[category];
      if (names.length === 0) continue;

      it(`resolves every ${region}/${category} name to a canonical allergen (${data.source})`, () => {
        const unresolved = names.filter(
          (name) => !KLEENEX_ALLERGEN_MAP[normalizeDetailName(name)],
        );
        expect(unresolved).toEqual([]);
      });
    }
  }

  it("renders a row for every reported name, in every region", async () => {
    for (const [region, data] of Object.entries(REGION_DETAIL_NAMES)) {
      const allNames = CATEGORIES.flatMap((c) => data[c]);
      if (allNames.length === 0) continue;

      // Unresolvable names are the per-region tests' business; this one checks
      // that everything which does resolve survives all the way to a row.
      const expected = new Set(
        allNames
          .map((name) => KLEENEX_ALLERGEN_MAP[normalizeDetailName(name)])
          .filter((key): key is string => !!key),
      );
      const states: Record<string, unknown> = {};
      let value = 10;
      for (const category of CATEGORIES) {
        if (data[category].length === 0) continue;
        const sensor = detailSensor(category, data[category], (value += 5));
        states[sensor.entity_id as string] = sensor;
      }

      const result = await fetchForecast(createHass(states as any), {
        ...stubConfigKleenex,
        location: "matrix",
        allergens: [...expected],
        pollen_threshold: 0,
      } as any);

      const rendered = new Set(result.map((s) => s.allergenReplaced));
      expect(
        [...expected].filter((key) => !rendered.has(key)),
        `region ${region} (${data.source}) lost allergen rows`,
      ).toEqual([]);
    }
  });

  // The US endpoint hardcodes empty details[], so the matrix has nothing to
  // resolve there; the card is expected to fall back to category totals.
  it("has no per-allergen names for us, and renders category totals instead", async () => {
    expect(CATEGORIES.flatMap((c) => REGION_DETAIL_NAMES.us![c])).toEqual([]);

    const states: Record<string, unknown> = {};
    for (const category of CATEGORIES) {
      const sensor = detailSensor(category, [], 40);
      states[sensor.entity_id as string] = sensor;
    }

    const result = await fetchForecast(createHass(states as any), {
      ...stubConfigKleenex,
      location: "matrix",
      allergens: ["trees_cat", "grass_cat", "weeds_cat"],
      pollen_threshold: 0,
    } as any);

    expect(result.map((s) => s.allergenReplaced).sort()).toEqual([
      "grass_cat",
      "trees_cat",
      "weeds_cat",
    ]);
  });

  it("normalizes padding, inner whitespace runs and case", () => {
    expect(normalizeDetailName("  Poaceae ")).toBe("poaceae");
    expect(normalizeDetailName("Grand\u00A0 Plane")).toBe("grand plane");
    expect(normalizeDetailName("\tNettle\n")).toBe("nettle");
    expect(normalizeDetailName(undefined)).toBe("");
    expect(normalizeDetailName(42)).toBe("");
  });

  // A key that isn't in normalized form can never be hit by a lookup, since
  // every lookup normalizes its needle first. Catches an alias added with
  // capitals or stray whitespace.
  it("keeps every alias key in normalized form", () => {
    const offending = Object.keys(KLEENEX_ALLERGEN_MAP).filter(
      (key) => normalizeDetailName(key) !== key,
    );
    expect(offending).toEqual([]);
  });
});
