import { describe, it, expect } from "vitest";
import {
  discoverIrmkmiSensors,
  fetchForecast,
  resolveEntityIds,
  stubConfigIRMKMI,
} from "../../src/adapters/irmkmi.js";
import {
  createHass,
  createHassWithRegistry,
  assertSensorShape,
} from "../helpers.js";

function makeConfig(overrides = {}) {
  return { ...stubConfigIRMKMI, ...overrides };
}

// irm-kmi-ha exposes pollen as enum sensors whose state is one of the meteo.be
// colours (green/yellow/orange/red/purple) plus the non-measurement states
// `none` and the legacy `active`.
function createIrmkmiSensor(colorState, attrOverrides = {}) {
  return {
    state: colorState,
    attributes: {
      device_class: "enum",
      options: ["green", "yellow", "orange", "red", "purple", "active", "none"],
      attribution:
        "Weather data from the Royal Meteorological Institute of Belgium meteo.be",
      ...attrOverrides,
    },
  };
}

function makeHass(allergenMap, location = "home") {
  // allergenMap: { canonical_allergen: [irmkmiSlug, colorState] }
  const states = {};
  for (const [, [slug, colorState]] of Object.entries(allergenMap)) {
    states[`sensor.${location}_${slug}_level`] = createIrmkmiSensor(colorState);
  }
  return createHass(states, { language: "en" });
}

describe("IRMKMI adapter: resolveEntityIds", () => {
  it("maps canonical allergen to irm-kmi entity id", () => {
    const hass = makeHass({ birch: ["birch", "yellow"] });
    const config = makeConfig({ allergens: ["birch"] });

    const result = resolveEntityIds(config, hass);

    expect(result.get("birch")).toBe("sensor.home_birch_level");
  });

  it("maps grass (canonical) to grasses (irm-kmi slug) entity", () => {
    const hass = makeHass({ grass: ["grasses", "orange"] });
    const config = makeConfig({ allergens: ["grass"] });

    const result = resolveEntityIds(config, hass);

    expect(result.get("grass")).toBe("sensor.home_grasses_level");
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

describe("IRMKMI adapter: fetchForecast", () => {
  it("returns array of sensor dicts with correct contract shape", async () => {
    const hass = makeHass({ birch: ["birch", "orange"] });
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    assertSensorShape(result[0]);
  });

  it("maps all 5 meteo.be colours to native 0-4 (no stretch to 0-6)", async () => {
    // Card-wide convention: keep the integration's native level count; do not
    // stretch 5 native levels onto the shared 0-6 visual scale.
    const levelCases = [
      ["green", 0],
      ["yellow", 1],
      ["orange", 2],
      ["red", 3],
      ["purple", 4],
    ];

    for (const [colorState, expected] of levelCases) {
      const hass = makeHass({ birch: ["birch", colorState] });
      // pollen_threshold: 0 lets the green case (level 0) through; the stub
      // default of 1 would filter it out.
      const config = makeConfig({ allergens: ["birch"], pollen_threshold: 0 });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].day0.state).toBe(expected);
      expect(result[0].day0.display_state).toBe(expected);
    }
  });

  it("skips the no-data `none` state (most sensors out of season)", async () => {
    const hass = makeHass({ birch: ["birch", "none"] });
    const config = makeConfig({ allergens: ["birch"], pollen_threshold: 0 });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });

  it("skips the legacy `active` state (no precise level)", async () => {
    const hass = makeHass({ birch: ["birch", "active"] });
    const config = makeConfig({ allergens: ["birch"], pollen_threshold: 0 });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });

  it("skips unavailable / unknown states", async () => {
    const states = {
      "sensor.home_birch_level": { state: "unavailable", attributes: {} },
      "sensor.home_oak_level": { state: "unknown", attributes: {} },
    };
    const hass = createHass(states);
    const config = makeConfig({
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });

  it("returns only one day per allergen", async () => {
    const hass = makeHass({ birch: ["birch", "yellow"] });
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(1);
  });

  it("allergenReplaced matches canonical key", async () => {
    const hass = makeHass({ grass: ["grasses", "yellow"] });
    const config = makeConfig({ allergens: ["grass"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenReplaced).toBe("grass");
  });

  it("entity_id is set correctly", async () => {
    const hass = makeHass({ mugwort: ["mugwort", "yellow"] });
    const config = makeConfig({ allergens: ["mugwort"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].entity_id).toBe("sensor.home_mugwort_level");
  });

  it("pollen_threshold=0 includes green (level 0) allergens", async () => {
    const hass = makeHass({ birch: ["birch", "green"] });
    const config = makeConfig({ allergens: ["birch"], pollen_threshold: 0 });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].day0.state).toBe(0);
  });

  it("pollen_threshold>0 filters out green (level 0) allergens", async () => {
    const hass = makeHass({
      birch: ["birch", "green"],
      oak: ["oak", "yellow"],
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
      birch: ["birch", "yellow"],
      oak: ["oak", "red"],
    });
    const config = makeConfig({
      allergens: ["birch", "oak"],
      sort: "value_descending",
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBeGreaterThanOrEqual(result[1].day0.state);
  });

  it("handles multiple allergens, hiding out-of-season (none) ones", async () => {
    // Mirrors the live June data: only grass is active; the trees read none.
    const hass = makeHass({
      grass: ["grasses", "purple"],
      birch: ["birch", "none"],
      alder: ["alder", "none"],
    });
    const config = makeConfig({
      allergens: ["grass", "birch", "alder"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("grass");
    expect(result[0].day0.state).toBe(4);
  });

  it("stubConfigIRMKMI has days_to_show set to 1", () => {
    expect(stubConfigIRMKMI.days_to_show).toBe(1);
  });

  it("stubConfigIRMKMI.pollen_threshold defaults to 1", () => {
    expect(stubConfigIRMKMI.pollen_threshold).toBe(1);
  });

  it("integration key is irmkmi", () => {
    expect(stubConfigIRMKMI.integration).toBe("irmkmi");
  });

  it("state_text reads from the 5-level scale, not the 7-level defaults", async () => {
    const cases = [
      ["green", "No pollen"],
      ["yellow", "Low levels"],
      ["orange", "Moderate levels"],
      ["red", "High levels"],
      ["purple", "Very high levels"],
    ];
    for (const [colorState, expectedText] of cases) {
      const hass = makeHass({ birch: ["birch", colorState] });
      const config = makeConfig({ allergens: ["birch"], pollen_threshold: 0 });
      const result = await fetchForecast(hass, config);
      expect(result.length).toBe(1);
      expect(result[0].day0.state_text).toBe(expectedText);
    }
  });

  it("user-supplied phrases.levels override at native indices", async () => {
    const hass = makeHass({ birch: ["birch", "purple"] });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      phrases: {
        full: {},
        short: {},
        levels: ["Geen", "Laag", "Matig", "Hoog", "Zeer hoog"],
        days: {},
        no_information: "",
      },
    });
    const result = await fetchForecast(hass, config);
    expect(result[0].day0.state_text).toBe("Zeer hoog");
  });
});

// ---------------------------------------------------------------------------
// Multi-location scenarios. Each meteo.be location is its own config entry /
// device; entity_ids follow sensor.<location-slug>_<allergen>_level (the
// integration sets them explicitly from the entry title, so multi-word slugs
// like "saint_ghislain" occur). Mirrors the live hass-test fixtures.
// ---------------------------------------------------------------------------

const ANTWERP_ENTRY = "01KQVM6J4DC3BB3S3E9WC2DF5H";
const SAINT_GHISLAIN_ENTRY = "01KQVM8D770Q9DJZMJKWCND1YJ";

function buildMultiLocationEntries() {
  const slugs = ["alder", "ash", "birch", "grasses", "hazel", "mugwort", "oak"];
  const entries = [];
  for (const slug of slugs) {
    entries.push({
      entityId: `sensor.antwerp_${slug}_level`,
      state: slug === "grasses" ? "purple" : "none",
      attributes: createIrmkmiSensor("none").attributes,
      deviceId: "dev_antwerp",
      platform: "irm_kmi",
      uniqueId: `${ANTWERP_ENTRY}-pollen-${slug}`,
      deviceMeta: {
        identifiers: [["irm_kmi", ANTWERP_ENTRY]],
        configEntries: [ANTWERP_ENTRY],
        name: "Antwerp",
      },
    });
    entries.push({
      entityId: `sensor.saint_ghislain_${slug}_level`,
      state: slug === "grasses" ? "red" : "none",
      attributes: createIrmkmiSensor("none").attributes,
      deviceId: "dev_saint_ghislain",
      platform: "irm_kmi",
      uniqueId: `${SAINT_GHISLAIN_ENTRY}-pollen-${slug}`,
      deviceMeta: {
        identifiers: [["irm_kmi", SAINT_GHISLAIN_ENTRY]],
        configEntries: [SAINT_GHISLAIN_ENTRY],
        name: "Saint-Ghislain",
      },
    });
  }
  return entries;
}

describe("IRMKMI adapter: discoverIrmkmiSensors (device-based)", () => {
  it("discovers two locations keyed by config_entry_id", () => {
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    const discovery = discoverIrmkmiSensors(hass);
    expect(discovery.locations.size).toBe(2);
    expect(discovery.locations.has(ANTWERP_ENTRY)).toBe(true);
    expect(discovery.locations.has(SAINT_GHISLAIN_ENTRY)).toBe(true);
  });

  it("uses the device name (location) as label", () => {
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    const discovery = discoverIrmkmiSensors(hass);
    expect(discovery.locations.get(ANTWERP_ENTRY).label).toBe("Antwerp");
    expect(discovery.locations.get(SAINT_GHISLAIN_ENTRY).label).toBe(
      "Saint-Ghislain",
    );
  });

  it("prefers name_by_user when present", () => {
    const entries = buildMultiLocationEntries().map((e) =>
      e.deviceId === "dev_antwerp"
        ? { ...e, deviceMeta: { ...e.deviceMeta, nameByUser: "Home" } }
        : e,
    );
    const hass = createHassWithRegistry(entries);
    const discovery = discoverIrmkmiSensors(hass);
    expect(discovery.locations.get(ANTWERP_ENTRY).label).toBe("Home");
  });

  it("classifies entity_ids correctly, incl. grasses -> grass and multi-word slug", () => {
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    const discovery = discoverIrmkmiSensors(hass);
    const sg = discovery.locations.get(SAINT_GHISLAIN_ENTRY);
    expect(sg.entities.get("grass")).toBe("sensor.saint_ghislain_grasses_level");
    expect(sg.entities.get("birch")).toBe("sensor.saint_ghislain_birch_level");
  });

  it("returns empty map when hass has no irm_kmi entities", () => {
    const hass = createHass({});
    const discovery = discoverIrmkmiSensors(hass);
    expect(discovery.locations.size).toBe(0);
  });
});

describe("IRMKMI adapter: resolveEntityIds (multi-location)", () => {
  it("respects cfg.location to pick Saint-Ghislain", () => {
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    const map = resolveEntityIds(
      { allergens: ["grass"], location: SAINT_GHISLAIN_ENTRY },
      hass,
    );
    expect(map.get("grass")).toBe("sensor.saint_ghislain_grasses_level");
  });

  it("matches by case-insensitive label when location is a friendly name", () => {
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    const map = resolveEntityIds(
      { allergens: ["grass"], location: "antwerp" },
      hass,
    );
    expect(map.get("grass")).toBe("sensor.antwerp_grasses_level");
  });

  it("resolves a prefix-slug location (entity-prefix style) to the right location", () => {
    // location: "saint_ghislain" is the entity-prefix slug, which the default
    // suffix-based slug fallback cannot match (IRM KMI ids end with the
    // allergen). The custom slugExtractor must resolve it instead of silently
    // falling back to the first (Antwerp) location.
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    const map = resolveEntityIds(
      { allergens: ["grass"], location: "saint_ghislain" },
      hass,
    );
    expect(map.get("grass")).toBe("sensor.saint_ghislain_grasses_level");
  });

  it("falls back to first discovered location for stale config_entry_id", () => {
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    const map = resolveEntityIds(
      { allergens: ["grass"], location: "01XXXXXXXXXXXXXXXXXXXXXXXX" },
      hass,
    );
    // resolveLocationByKey sorts keys lex; Antwerp (01KQVM6...) sorts before
    // Saint-Ghislain (01KQVM8...).
    expect(map.get("grass")).toBe("sensor.antwerp_grasses_level");
  });

  it("does not mix allergens across locations", () => {
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    const map = resolveEntityIds(
      { allergens: ["grass", "birch"], location: SAINT_GHISLAIN_ENTRY },
      hass,
    );
    for (const eid of map.values()) {
      expect(eid.startsWith("sensor.saint_ghislain_")).toBe(true);
    }
  });
});

describe("IRMKMI adapter: fetchForecast (multi-location)", () => {
  it("returns the configured location's data, not a mix", async () => {
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    // Saint-Ghislain grass reads "red" -> level 3 on the native scale.
    const result = await fetchForecast(hass, {
      ...stubConfigIRMKMI,
      allergens: ["grass"],
      location: SAINT_GHISLAIN_ENTRY,
    });
    expect(result.length).toBe(1);
    expect(result[0].entity_id).toBe("sensor.saint_ghislain_grasses_level");
    expect(result[0].day0.state).toBe(3);
  });

  it("hides out-of-season allergens by default (only grass shows)", async () => {
    const hass = createHassWithRegistry(buildMultiLocationEntries());
    const result = await fetchForecast(hass, {
      ...stubConfigIRMKMI,
      location: ANTWERP_ENTRY,
    });
    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("grass");
    expect(result[0].day0.state).toBe(4); // purple
  });
});
