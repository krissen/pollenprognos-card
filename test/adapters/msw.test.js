import { describe, it, expect } from "vitest";
import {
  discoverMswSensors,
  fetchForecast,
  resolveEntityIds,
  stubConfigMSW,
} from "../../src/adapters/msw.js";
import {
  createHass,
  createHassWithRegistry,
  createMSWSensor,
  assertSensorShape,
} from "../helpers.js";

function makeConfig(overrides = {}) {
  return { ...stubConfigMSW, ...overrides };
}

function makeHass(allergenMap) {
  // allergenMap: { canonical_allergen: [mswSlug, levelStr, postcode?, station?] }
  const states = {};
  for (const [canonical, [mswSlug, levelStr, postcode, station]] of Object.entries(allergenMap)) {
    const pc = postcode ?? "8000";
    const st = station ?? "za";
    states[`sensor.pollen_${mswSlug}_level_at_${pc}_${st}`] = createMSWSensor(levelStr);
  }
  return createHass(states, { language: "en" });
}

describe("MSW adapter: resolveEntityIds", () => {
  it("maps canonical allergen to hass-swissweather entity id", () => {
    const hass = makeHass({ birch: ["birch", "Low"] });
    const config = makeConfig({ allergens: ["birch"] });

    const result = resolveEntityIds(config, hass);

    expect(result.get("birch")).toBe("sensor.pollen_birch_level_at_8000_za");
  });

  it("maps grass (canonical) to grasses (swissweather slug) entity", () => {
    const hass = makeHass({ grass: ["grasses", "Medium"] });
    const config = makeConfig({ allergens: ["grass"] });

    const result = resolveEntityIds(config, hass);

    expect(result.get("grass")).toBe("sensor.pollen_grasses_level_at_8000_za");
  });

  it("ignores unknown allergens", () => {
    const hass = createHass({});
    const config = makeConfig({ allergens: ["unknownpollen"] });

    const result = resolveEntityIds(config, hass);

    expect(result.size).toBe(0);
  });

  it("skips allergen when no matching entity exists", () => {
    const hass = createHass({});
    const config = makeConfig({ allergens: ["birch"] });

    const result = resolveEntityIds(config, hass);

    expect(result.has("birch")).toBe(false);
  });
});

describe("MSW adapter: fetchForecast", () => {
  it("returns array of sensor dicts with correct contract shape", async () => {
    const hass = makeHass({ birch: ["birch", "Medium"] });
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    assertSensorShape(result[0]);
  });

  it("maps all 5 hass-swissweather levels to native 0-4 (no stretch to 0-6)", async () => {
    // Card-wide convention: keep the integration's native level count for
    // editor phrases, circles and colors. Do not stretch 5 native levels
    // onto the 0-6 visual scale (PEU does that today but pre-dates this
    // convention).
    const levelCases = [
      ["None", 0],
      ["Low", 1],
      ["Medium", 2],
      ["Strong", 3],
      ["Very Strong", 4],
    ];

    for (const [levelStr, expected] of levelCases) {
      const hass = makeHass({ birch: ["birch", levelStr] });
      // pollen_threshold: 0 lets the None case (level 0) through; the stub
      // default of 1 would filter it out.
      const config = makeConfig({ allergens: ["birch"], pollen_threshold: 0 });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].day0.state).toBe(expected);
      expect(result[0].day0.display_state).toBe(expected);
    }
  });

  it("returns only one day per allergen", async () => {
    const hass = makeHass({ birch: ["birch", "Low"] });
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(1);
  });

  it("allergenReplaced matches canonical key", async () => {
    const hass = makeHass({ grass: ["grasses", "Low"] });
    const config = makeConfig({ allergens: ["grass"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenReplaced).toBe("grass");
  });

  it("entity_id is set correctly", async () => {
    const hass = makeHass({ alder: ["alder", "Low"] });
    const config = makeConfig({ allergens: ["alder"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].entity_id).toBe("sensor.pollen_alder_level_at_8000_za");
  });

  it("skips allergen with unavailable / unknown state", async () => {
    const states = {
      "sensor.pollen_birch_level_at_8000_za": { state: "unavailable", attributes: {} },
    };
    const hass = createHass(states);
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });

  it("pollen_threshold=0 includes None-level allergens", async () => {
    const hass = makeHass({ birch: ["birch", "None"] });
    const config = makeConfig({ allergens: ["birch"], pollen_threshold: 0 });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].day0.state).toBe(0);
  });

  it("pollen_threshold>0 filters out None-level allergens", async () => {
    const hass = makeHass({
      birch: ["birch", "None"],
      oak: ["oak", "Low"],
    });
    const config = makeConfig({
      allergens: ["birch", "oak"],
      pollen_threshold: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("oak");
  });

  it("sorts by value_descending by default", async () => {
    const hass = makeHass({
      birch: ["birch", "Low"],
      oak: ["oak", "Strong"],
    });
    const config = makeConfig({
      allergens: ["birch", "oak"],
      sort: "value_descending",
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBeGreaterThanOrEqual(result[1].day0.state);
  });

  it("handles multiple allergens", async () => {
    const hass = makeHass({
      birch: ["birch", "Medium"],
      grass: ["grasses", "Low"],
      alder: ["alder", "None"],
    });
    const config = makeConfig({
      allergens: ["birch", "grass", "alder"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(3);
  });

  it("stubConfigMSW has days_to_show set to 1", () => {
    expect(stubConfigMSW.days_to_show).toBe(1);
  });

  it("stubConfigMSW.pollen_threshold defaults to 1 (hides None-level allergens)", () => {
    // Aligning with every other adapter's default of hiding None-level
    // allergens until a measurement crosses Low or higher, so newly created
    // MSW cards behave the same way out of the box. (DWD picks 0.5 instead
    // because of its native 0-3 scale; MSW's native 0-4 scale does not need
    // a non-integer threshold.)
    expect(stubConfigMSW.pollen_threshold).toBe(1);
  });

  it("integration key is msw", () => {
    expect(stubConfigMSW.integration).toBe("msw");
  });

  it("state_text reads from the 5-level scale, not the 7-level defaults", async () => {
    // card.levels5.* keys hold semantically-correct severity strings for the
    // five-level scale. Looking up at native indices in the legacy
    // card.levels.* (seven-level) defaults would surface
    // "Moderate-high levels" for state=4 (Very Strong) which is wrong.
    const cases = [
      ["None", "No pollen"],
      ["Low", "Low levels"],
      ["Medium", "Moderate levels"],
      ["Strong", "High levels"],
      ["Very Strong", "Very high levels"],
    ];
    for (const [levelStr, expectedText] of cases) {
      const hass = makeHass({ birch: ["birch", levelStr] });
      const config = makeConfig({ allergens: ["birch"], pollen_threshold: 0 });
      const result = await fetchForecast(hass, config);
      expect(result.length).toBe(1);
      expect(result[0].day0.state_text).toBe(expectedText);
    }
  });

  it("user-supplied phrases.levels override at native indices", async () => {
    const hass = makeHass({ birch: ["birch", "Very Strong"] });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      phrases: {
        full: {},
        short: {},
        levels: ["Inget", "Lite", "Måttligt", "Mycket", "Extremt"],
        days: {},
        no_information: "",
      },
    });
    const result = await fetchForecast(hass, config);
    expect(result[0].day0.state_text).toBe("Extremt");
  });
});

// ---------------------------------------------------------------------------
// Device-prefixed entity IDs and multi-station scenarios.
// HA prefixes entity_ids with the device-name slug, so the bare shape used
// above is the legacy / no-friendly-name case. The realistic shapes are:
//   sensor.meteoswiss_at_8000_klo_pollen_<allergen>_level_at_8000_pzh
//   sensor.bern_pollen_<allergen>_level_at_3000_pbe   (renamed device)
// ---------------------------------------------------------------------------

const ZURICH_ENTRY = "01KQVM6J4DC3BB3S3E9WC2DF5H";
const BERN_ENTRY = "01KQVM8D770Q9DJZMJKWCND1YJ";

function buildMultiStationEntries() {
  const allergens = ["birch", "grasses", "alder", "hazel", "beech", "ash", "oak"];
  const entries = [];
  for (const slug of allergens) {
    entries.push({
      entityId: `sensor.meteoswiss_at_8000_klo_pollen_${slug}_level_at_8000_pzh`,
      state: slug === "birch" ? "Low" : "None",
      attributes: createMSWSensor("Low").attributes,
      deviceId: "dev_zurich",
      platform: "swissweather",
      uniqueId: `pollen-level-8000.${slug}`,
      deviceMeta: {
        identifiers: [["swissweather", "swissweather-8000-KLO"]],
        configEntries: [ZURICH_ENTRY],
        name: "MeteoSwiss at 8000-KLO",
      },
    });
    entries.push({
      entityId: `sensor.bern_pollen_${slug}_level_at_3000_pbe`,
      state: slug === "birch" ? "Strong" : "None",
      attributes: createMSWSensor("Strong").attributes,
      deviceId: "dev_bern",
      platform: "swissweather",
      uniqueId: `pollen-level-3000.${slug}`,
      deviceMeta: {
        identifiers: [["swissweather", "swissweather-3000-BER"]],
        configEntries: [BERN_ENTRY],
        name: "MeteoSwiss at 3000-BER",
        nameByUser: "Bern",
      },
    });
  }
  return entries;
}

describe("MSW adapter: discoverMswSensors (device-based)", () => {
  it("discovers two locations keyed by config_entry_id", () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    const discovery = discoverMswSensors(hass);
    expect(discovery.locations.size).toBe(2);
    expect(discovery.locations.has(ZURICH_ENTRY)).toBe(true);
    expect(discovery.locations.has(BERN_ENTRY)).toBe(true);
  });

  it("uses name_by_user as label when present, falling back to stripped device.name", () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    const discovery = discoverMswSensors(hass);
    expect(discovery.locations.get(BERN_ENTRY).label).toBe("Bern");
    // Zurich device was not renamed; the redundant "MeteoSwiss at " prefix
    // is stripped (parallel to DWD region-ID-prefix and GPL/GP coord-suffix
    // cleanups), so the dropdown shows "8000-KLO" rather than the verbose
    // upstream default. Users can set a friendlier label via name_by_user.
    expect(discovery.locations.get(ZURICH_ENTRY).label).toBe("8000-KLO");
  });

  it("preserves device.name when there is no MeteoSwiss prefix", () => {
    // Custom device.name without the integration prefix is left intact.
    const entries = buildMultiStationEntries().map((e) =>
      e.deviceId === "dev_zurich"
        ? { ...e, deviceMeta: { ...e.deviceMeta, name: "Zürich Kloten" } }
        : e,
    );
    const hass = createHassWithRegistry(entries);
    const discovery = discoverMswSensors(hass);
    expect(discovery.locations.get(ZURICH_ENTRY).label).toBe("Zürich Kloten");
  });

  it("classifies prefixed entity_ids correctly (grasses -> grass)", () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    const discovery = discoverMswSensors(hass);
    const zurich = discovery.locations.get(ZURICH_ENTRY);
    expect(zurich.entities.get("grass")).toBe(
      "sensor.meteoswiss_at_8000_klo_pollen_grasses_level_at_8000_pzh",
    );
    expect(zurich.entities.get("birch")).toBe(
      "sensor.meteoswiss_at_8000_klo_pollen_birch_level_at_8000_pzh",
    );
  });

  it("returns empty map when hass has no swissweather entities", () => {
    const hass = createHass({});
    const discovery = discoverMswSensors(hass);
    expect(discovery.locations.size).toBe(0);
  });
});

describe("MSW adapter: resolveEntityIds (multi-station)", () => {
  it("respects cfg.location to pick the Bern station", () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    const map = resolveEntityIds(
      { allergens: ["birch"], location: BERN_ENTRY },
      hass,
    );
    expect(map.get("birch")).toBe("sensor.bern_pollen_birch_level_at_3000_pbe");
  });

  it("respects cfg.location to pick the Zurich station", () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    const map = resolveEntityIds(
      { allergens: ["birch"], location: ZURICH_ENTRY },
      hass,
    );
    expect(map.get("birch")).toBe(
      "sensor.meteoswiss_at_8000_klo_pollen_birch_level_at_8000_pzh",
    );
  });

  it("matches by case-insensitive label when location is a friendly name", () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    const map = resolveEntityIds(
      { allergens: ["birch"], location: "bern" },
      hass,
    );
    expect(map.get("birch")).toBe("sensor.bern_pollen_birch_level_at_3000_pbe");
  });

  it("falls back to first discovered location for stale config_entry_id", () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    const map = resolveEntityIds(
      // Valid Crockford-base32 ULID shape but does not match any discovered entry.
      { allergens: ["birch"], location: "01XXXXXXXXXXXXXXXXXXXXXXXX" },
      hass,
    );
    // resolveLocationByKey sorts keys lex when not all-numeric; the smaller
    // ULID (Zurich, 01KQVM6...) sorts before Bern (01KQVM8...).
    expect(map.has("birch")).toBe(true);
    expect(map.get("birch")).toBe(
      "sensor.meteoswiss_at_8000_klo_pollen_birch_level_at_8000_pzh",
    );
  });

  it("falls back to first discovered location when cfg.location is empty", () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    const map = resolveEntityIds(
      { allergens: ["birch"], location: "" },
      hass,
    );
    expect(map.get("birch")).toBe(
      "sensor.meteoswiss_at_8000_klo_pollen_birch_level_at_8000_pzh",
    );
  });

  it("does not mix allergens across stations (Copilot review fynd)", () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    const map = resolveEntityIds(
      { allergens: ["birch", "oak"], location: BERN_ENTRY },
      hass,
    );
    expect(map.get("birch")).toBe("sensor.bern_pollen_birch_level_at_3000_pbe");
    expect(map.get("oak")).toBe("sensor.bern_pollen_oak_level_at_3000_pbe");
    // Ensure no Zurich entity slipped in.
    for (const eid of map.values()) {
      expect(eid.includes("8000")).toBe(false);
    }
  });
});

describe("MSW adapter: fetchForecast (multi-station)", () => {
  it("returns the configured station's data, not a mix", async () => {
    const hass = createHassWithRegistry(buildMultiStationEntries());
    // Force Bern; birch state in fixtures is "Strong" -> level 3 on the
    // native 5-level scale (None/Low/Medium/Strong/Very Strong = 0..4).
    const result = await fetchForecast(hass, {
      ...stubConfigMSW,
      allergens: ["birch"],
      location: BERN_ENTRY,
    });
    expect(result.length).toBe(1);
    expect(result[0].entity_id).toBe("sensor.bern_pollen_birch_level_at_3000_pbe");
    expect(result[0].day0.state).toBe(3);
  });
});
