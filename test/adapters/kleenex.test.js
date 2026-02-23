import { describe, it, expect } from "vitest";
import { fetchForecast, stubConfigKleenex } from "../../src/adapters/kleenex.js";
import { createHass, assertSensorShape } from "../helpers.js";

function makeConfig(overrides = {}) {
  return { ...stubConfigKleenex, ...overrides };
}

/**
 * Build a Kleenex sensor state object.
 *
 * @param {string} location  - Location slug, e.g. "amsterdam"
 * @param {string} category  - Entity suffix, e.g. "trees", "grass", "weeds"
 * @param {number} ppmValue  - Today's PPM reading (sensor state)
 * @param {Array}  details   - [{name, value}] for individual allergen breakdown
 * @param {Array}  forecast  - [{level, details}] per future day
 * @returns {Object} sensor state object with entity_id set
 */
function makeKleenexEntity(location, category, ppmValue, details = [], forecast = []) {
  return {
    entity_id: `sensor.kleenex_pollen_radar_${location}_${category}`,
    state: String(ppmValue),
    attributes: {
      details: details.map((d) => ({ name: d.name, value: d.value })),
      forecast: forecast.map((f, i) => ({
        datetime: new Date(Date.now() + (i + 1) * 86400000).toISOString(),
        level: f.level,
        details: f.details || [],
      })),
    },
  };
}

/**
 * Build a hass mock from an array of entity objects that already have entity_id.
 */
function makeHassFromEntities(entities) {
  const states = {};
  for (const entity of entities) {
    states[entity.entity_id] = entity;
  }
  return createHass(states);
}

// ---------------------------------------------------------------------------
// 1. Basic shape
// ---------------------------------------------------------------------------
describe("Kleenex adapter: basic shape", () => {
  it("returns an array of sensor dicts with the required fields", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [{ name: "Birch", value: 150 }, { name: "Oak", value: 50 }],
      [],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const sensor of result) {
      assertSensorShape(sensor);
    }
  });

  it("sets allergenReplaced to the canonical slug", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenReplaced).toBe("birch");
  });

  it("sets entity_id to the source sensor entity_id", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].entity_id).toBe("sensor.kleenex_pollen_radar_amsterdam_trees");
  });

  it("sets allergenCapitalized to a non-empty string", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(typeof result[0].allergenCapitalized).toBe("string");
    expect(result[0].allergenCapitalized.length).toBeGreaterThan(0);
  });

  it("day0 is defined and is the same object as days[0]", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0).toBeDefined();
    expect(result[0].day0).toBe(result[0].days[0]);
  });

  it("respects days_to_show", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
      [{ level: 1, details: [{ name: "Birch", value: 80 }] }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(3);
    expect(result[0].day2).toBeDefined();
    expect(result[0].day3).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. PPM to level (0-4) conversion using category-specific thresholds
// ---------------------------------------------------------------------------
describe("Kleenex adapter: PPM to level conversion", () => {
  // Trees thresholds: [95, 207, 703]
  // 0 -> 0, 1-95 -> 1, 96-207 -> 2, 208-703 -> 3, >703 -> 4
  it("maps 0 PPM to level 0 for trees allergens", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [{ name: "Birch", value: 0 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(0);
  });

  it("maps trees PPM within low threshold (<=95) to level 1", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 95,
      [{ name: "Birch", value: 95 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(1);
  });

  it("maps trees PPM within moderate threshold (96-207) to level 2", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [{ name: "Birch", value: 200 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(2);
  });

  it("maps trees PPM within high threshold (208-703) to level 3", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 703,
      [{ name: "Birch", value: 703 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(3);
  });

  it("maps trees PPM above high threshold (>703) to level 4", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 1000,
      [{ name: "Birch", value: 1000 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(4);
  });

  // Grass thresholds: [29, 60, 341]
  it("applies grass-specific thresholds: 30 PPM -> level 2", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "grass", 30,
      [{ name: "Grass", value: 30 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["grass"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // 30 > 29 (low threshold) so level 2 (moderate)
    expect(result[0].day0.state).toBe(2);
  });

  // Weeds thresholds: [20, 77, 266]
  it("applies weeds-specific thresholds: 15 PPM -> level 1", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "weeds", 15,
      [{ name: "Ragweed", value: 15 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["ragweed"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // 15 <= 20 (low threshold) so level 1
    expect(result[0].day0.state).toBe(1);
  });

  it("coerces 'unavailable' sensor state to level 0 for category sensors", async () => {
    // The adapter uses: Number(sensor.state) || 0
    // Number("unavailable") = NaN; NaN || 0 = 0; ppmToLevel(0) = 0.
    // This means "unavailable" is treated as zero pollen, not -1.
    const entity = {
      entity_id: "sensor.kleenex_pollen_radar_amsterdam_trees",
      state: "unavailable",
      attributes: {
        details: [],
        forecast: [],
      },
    };
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(0);
  });

  it("returns -1 for negative PPM values", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", -10,
      [{ name: "Birch", value: -5 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 3. Level scaling: raw 0-4 -> display 0-6
// ---------------------------------------------------------------------------
describe("Kleenex adapter: level scaling (0-4 to 0-6)", () => {
  // Formula: level < 2 ? floor(level*6/4) : ceil(level*6/4)
  // 0 -> 0, 1 -> 1, 2 -> 3, 3 -> 5, 4 -> 6

  const scalingCases = [
    // [ppmForBirch, expectedRawLevel, expectedScaledStateText]
    // We test that state (raw) and state_text (scaled) are consistent.
    [0, 0],    // raw 0 -> scaled 0
    [50, 1],   // raw 1 (<=95) -> scaled 1
    [150, 2],  // raw 2 (96-207) -> scaled 3
    [500, 3],  // raw 3 (208-703) -> scaled 5
    [1000, 4], // raw 4 (>703) -> scaled 6
  ];

  for (const [ppm, expectedRawLevel] of scalingCases) {
    it(`PPM ${ppm} produces raw state ${expectedRawLevel} with a non-empty state_text`, async () => {
      const entity = makeKleenexEntity(
        "amsterdam", "trees", ppm,
        [{ name: "Birch", value: ppm }],
      );
      const hass = makeHassFromEntities([entity]);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state).toBe(expectedRawLevel);
      expect(typeof result[0].day0.state_text).toBe("string");
    });
  }

  it("state_text for raw level 4 (PPM >703) differs from raw level 0 (PPM 0)", async () => {
    const entityHigh = makeKleenexEntity(
      "amsterdam", "trees", 1000,
      [{ name: "Birch", value: 1000 }],
    );
    const entityLow = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [{ name: "Birch", value: 0 }],
    );

    const hassHigh = makeHassFromEntities([entityHigh]);
    const hassLow = makeHassFromEntities([entityLow]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const resultHigh = await fetchForecast(hassHigh, config);
    const resultLow = await fetchForecast(hassLow, config);

    expect(resultHigh[0].day0.state_text).not.toBe(resultLow[0].day0.state_text);
  });
});

// ---------------------------------------------------------------------------
// 4. Category sensors (trees_cat / grass_cat / weeds_cat)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: category sensors", () => {
  it("includes trees_cat when included in allergens and trees sensor exists", async () => {
    const entity = makeKleenexEntity("amsterdam", "trees", 200, [], []);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("trees_cat");
  });

  it("includes grass_cat when included in allergens and grass sensor exists", async () => {
    const entity = makeKleenexEntity("amsterdam", "grass", 50, [], []);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["grass_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("grass_cat");
  });

  it("includes weeds_cat when included in allergens and weeds sensor exists", async () => {
    const entity = makeKleenexEntity("amsterdam", "weeds", 30, [], []);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["weeds_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("weeds_cat");
  });

  it("skips category sensor when the corresponding _cat key is not in allergens", async () => {
    const entity = makeKleenexEntity("amsterdam", "trees", 300, [], []);
    const hass = makeHassFromEntities([entity]);
    // allergens does NOT include trees_cat
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.every((s) => s.allergenReplaced !== "trees_cat")).toBe(true);
  });

  it("category sensor uses the PPM state to derive level", async () => {
    // 200 PPM for trees falls in 96-207 range -> level 2
    const entity = makeKleenexEntity("amsterdam", "trees", 200, [], []);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Individual allergens extracted from details array
// ---------------------------------------------------------------------------
describe("Kleenex adapter: individual allergens from details", () => {
  it("extracts individual allergens from the details attribute", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 300,
      [
        { name: "Birch", value: 250 },
        { name: "Oak", value: 50 },
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);
    const keys = result.map((s) => s.allergenReplaced);

    expect(keys).toContain("birch");
    expect(keys).toContain("oak");
  });

  it("maps localized French allergen names to canonical slugs", async () => {
    // "bouleau" -> "birch" via KLEENEX_ALLERGEN_MAP
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 150,
      [{ name: "Bouleau", value: 150 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("birch");
  });

  it("maps localized Dutch allergen names to canonical slugs", async () => {
    // "berk" -> "birch" via KLEENEX_ALLERGEN_MAP
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Berk", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("birch");
  });

  it("skips individual allergens not in config.allergens", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 300,
      [
        { name: "Birch", value: 250 },
        { name: "Pine", value: 50 },
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"], // pine not included
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.map((s) => s.allergenReplaced)).not.toContain("pine");
  });

  it("uses detail PPM value (not category PPM) for individual allergen level", async () => {
    // Category PPM 703 -> level 3; but birch detail 50 -> level 1
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 703,
      [{ name: "Birch", value: 50 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // 50 PPM for birch (trees category) <= 95 -> level 1
    expect(result[0].day0.state).toBe(1);
  });

  it("extracts forecast day data for individual allergens from forecast.details", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
      [
        { level: 1, details: [{ name: "Birch", value: 800 }] }, // day+1: level 4
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    // Today: 100 PPM <= 95? No: 100 > 95 so level 2
    expect(result[0].day0.state).toBe(2);
    // Tomorrow: 800 PPM > 703 -> level 4
    expect(result[0].day1.state).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 6. sort_category_allergens_first: two-tiered sorting
// ---------------------------------------------------------------------------
describe("Kleenex adapter: sort_category_allergens_first", () => {
  it("places category allergens before individual allergens when enabled", async () => {
    const treesEntity = makeKleenexEntity(
      "amsterdam", "trees", 100, // trees_cat level 1
      [
        { name: "Birch", value: 700 }, // birch level 3
        { name: "Oak", value: 200 },   // oak level 2
      ],
    );
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat", "birch", "oak"],
      pollen_threshold: 0,
      sort: "value_descending",
      sort_category_allergens_first: true,
    });

    const result = await fetchForecast(hass, config);

    // trees_cat should come first regardless of its lower value
    expect(result[0].allergenReplaced).toBe("trees_cat");
    // Individual allergens should be sorted by value_descending among themselves
    const individualKeys = result.slice(1).map((s) => s.allergenReplaced);
    expect(individualKeys[0]).toBe("birch"); // 700 PPM > oak 200 PPM
    expect(individualKeys[1]).toBe("oak");
  });

  it("sorts all allergens together without two-tiered split when disabled", async () => {
    const treesEntity = makeKleenexEntity(
      "amsterdam", "trees", 1000, // trees_cat level 4
      [
        { name: "Birch", value: 50 },  // birch level 1
      ],
    );
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat", "birch"],
      pollen_threshold: 0,
      sort: "value_descending",
      sort_category_allergens_first: false,
    });

    const result = await fetchForecast(hass, config);

    // Without two-tiered sort, trees_cat (level 4) should sort before birch (level 1)
    expect(result[0].allergenReplaced).toBe("trees_cat");
    expect(result[1].allergenReplaced).toBe("birch");
  });

  it("preserves config order when sort is 'none'", async () => {
    const treesEntity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [
        { name: "Oak", value: 200 },
        { name: "Birch", value: 50 },
      ],
    );
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["oak", "birch"], // oak first in config
      pollen_threshold: 0,
      sort: "none",
    });

    const result = await fetchForecast(hass, config);

    // Order in config: oak, birch
    expect(result[0].allergenReplaced).toBe("oak");
    expect(result[1].allergenReplaced).toBe("birch");
  });
});

// ---------------------------------------------------------------------------
// 7. Threshold filtering
// ---------------------------------------------------------------------------
describe("Kleenex adapter: threshold filtering", () => {
  it("excludes allergens where all days are below pollen_threshold", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 50, // level 1 (<=95)
      [
        { name: "Birch", value: 50 },  // level 1
        { name: "Oak", value: 0 },     // level 0
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch", "oak"],
      pollen_threshold: 2, // requires level >= 2
    });

    const result = await fetchForecast(hass, config);

    // birch level 1 < threshold 2, oak level 0 < threshold 2 -> both filtered
    expect(result.length).toBe(0);
  });

  it("includes all allergens when pollen_threshold is 0", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [
        { name: "Birch", value: 0 },
        { name: "Oak", value: 0 },
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(2);
  });

  it("includes allergen when any single forecast day meets threshold", async () => {
    // Today: 0 PPM (level 0); day+1: 800 PPM (level 4)
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [{ name: "Birch", value: 0 }],
      [{ level: 4, details: [{ name: "Birch", value: 800 }] }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 3,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    // Day+1 has level 4 which meets threshold 3
    expect(result.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. User level names (5 or 7 custom labels)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: user level names", () => {
  it("accepts 7 custom level labels mapping directly to scaled indices 0-6", async () => {
    const customLevels = ["None", "VeryLow", "Low", "Medium", "High", "VeryHigh", "Extreme"];
    // Birch 200 PPM (trees) -> raw level 2 -> scaled level ceil(2*6/4) = 3 -> "Medium"
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [{ name: "Birch", value: 200 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
    });

    const result = await fetchForecast(hass, config);

    // Raw level 2 -> scaled level 3 -> customLevels[3] = "Medium"
    expect(result[0].day0.state_text).toBe("Medium");
  });

  it("accepts 5 custom level labels mapped via index positions [0,1,3,5,6]", async () => {
    // 5 labels: idx0->scale0, idx1->scale1, idx2->scale3, idx3->scale5, idx4->scale6
    const customLevels = ["Zero", "Low", "Moderate", "High", "VeryHigh"];
    // Birch 200 PPM -> raw 2 -> scaled 3; map[2]=3 in 5-label -> customLevels[2] = "Moderate"
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [{ name: "Birch", value: 200 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
    });

    const result = await fetchForecast(hass, config);

    // Raw level 2 -> scaled 3; 5-label map[2] = 3 -> customLevels[2] = "Moderate"
    expect(result[0].day0.state_text).toBe("Moderate");
  });

  it("falls back to i18n default for empty string entries in 7-label array", async () => {
    const customLevels = ["CustomZero", "", "", "", "", "", ""];
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [{ name: "Birch", value: 0 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
    });

    const result = await fetchForecast(hass, config);

    // Level 0 -> scaled 0 -> customLevels[0] = "CustomZero"
    expect(result[0].day0.state_text).toBe("CustomZero");
  });
});

// ---------------------------------------------------------------------------
// 9. Manual mode (location="manual" with entity_prefix)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: manual mode", () => {
  it("filters sensors by entity_prefix in manual mode", async () => {
    // In manual mode the adapter still looks for sensor.kleenex_pollen_radar_ prefix
    // but further filters by the user-provided prefix within those entity IDs.
    const entity = makeKleenexEntity(
      "mypfx_amsterdam", "trees", 150,
      [{ name: "Birch", value: 150 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_radar_mypfx",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].entity_id).toBe(
      "sensor.kleenex_pollen_radar_mypfx_amsterdam_trees",
    );
  });

  it("returns empty array in manual mode when no sensor matches the prefix", async () => {
    // Entity exists at a different location, prefix won't match
    const entity = makeKleenexEntity("other_location", "trees", 150, [
      { name: "Birch", value: 150 },
    ]);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_radar_nonexistent",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Location filtering
// ---------------------------------------------------------------------------
describe("Kleenex adapter: location filtering", () => {
  it("only includes sensors for the configured location", async () => {
    const ams = makeKleenexEntity("amsterdam", "trees", 200, [
      { name: "Birch", value: 200 },
    ]);
    const bxl = makeKleenexEntity("brussels", "trees", 50, [
      { name: "Birch", value: 50 },
    ]);
    const hass = makeHassFromEntities([ams, bxl]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].entity_id).toContain("amsterdam");
    expect(result[0].entity_id).not.toContain("brussels");
  });

  it("returns empty array when no sensors match the configured location", async () => {
    const entity = makeKleenexEntity("amsterdam", "trees", 200, [
      { name: "Birch", value: 200 },
    ]);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "brussels",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. stubConfigKleenex shape
// ---------------------------------------------------------------------------
describe("stubConfigKleenex", () => {
  it("has integration set to 'kleenex'", () => {
    expect(stubConfigKleenex.integration).toBe("kleenex");
  });

  it("has sort_category_allergens_first enabled by default", () => {
    expect(stubConfigKleenex.sort_category_allergens_first).toBe(true);
  });

  it("does not include category allergens (trees_cat etc.) in default allergens list", () => {
    expect(stubConfigKleenex.allergens).not.toContain("trees_cat");
    expect(stubConfigKleenex.allergens).not.toContain("grass_cat");
    expect(stubConfigKleenex.allergens).not.toContain("weeds_cat");
  });

  it("includes common individual allergens in the default allergens list", () => {
    expect(stubConfigKleenex.allergens).toContain("birch");
    expect(stubConfigKleenex.allergens).toContain("oak");
    expect(stubConfigKleenex.allergens).toContain("ragweed");
    expect(stubConfigKleenex.allergens).toContain("poaceae");
  });
});
