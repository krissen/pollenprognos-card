import { describe, it, expect } from "vitest";
import {
  suggestEntityConfig,
  deriveLocationForEntity,
} from "../../src/utils/autodetect.js";
import { createHass } from "../helpers.js";

// Minimal sensor state object.
function s(state = "3", attrs = {}) {
  return { state, attributes: attrs };
}

// suggestEntityConfig powers HA 2026.6 card-picker suggestions
// (window.customCards getEntitySuggestion). Given a picked entity id it
// reverse-maps to an integration and derives that entity's specific location.

describe("suggestEntityConfig", () => {
  describe("guards", () => {
    it("returns null for a non-string entity id", () => {
      const hass = createHass({});
      expect(suggestEntityConfig(hass, undefined)).toBeNull();
      expect(suggestEntityConfig(hass, 42)).toBeNull();
    });

    it("returns null for non-sensor entities", () => {
      const hass = createHass({ "light.kitchen": s() });
      expect(suggestEntityConfig(hass, "light.kitchen")).toBeNull();
    });

    it("returns null when hass has no states", () => {
      expect(suggestEntityConfig(null, "sensor.pollen_stockholm_bjork")).toBeNull();
      expect(suggestEntityConfig({}, "sensor.pollen_stockholm_bjork")).toBeNull();
    });

    it("returns null for an unrecognised sensor", () => {
      const hass = createHass({ "sensor.living_room_temperature": s("21") });
      expect(
        suggestEntityConfig(hass, "sensor.living_room_temperature"),
      ).toBeNull();
    });
  });

  describe("PP (city-based)", () => {
    it("suggests a card with the picked entity's city", () => {
      const hass = createHass({
        "sensor.pollen_stockholm_bjork": s(),
        "sensor.pollen_stockholm_gras": s(),
      });

      const result = suggestEntityConfig(hass, "sensor.pollen_stockholm_bjork");

      expect(result).toEqual({
        config: {
          type: "custom:pollenprognos-card",
          integration: "pp",
          city: "stockholm",
        },
      });
    });
  });

  describe("DWD (region-based)", () => {
    it("derives region_id from the entity id (incl. device-prefixed)", () => {
      const hass = createHass({
        "sensor.pollenflug_birke_50": s(),
        "sensor.pollenflug_gefahrenindex_pollenflug_erle_91": s(),
      });

      expect(
        suggestEntityConfig(hass, "sensor.pollenflug_birke_50"),
      ).toEqual({
        config: {
          type: "custom:pollenprognos-card",
          integration: "dwd",
          region_id: "50",
        },
      });

      expect(
        suggestEntityConfig(
          hass,
          "sensor.pollenflug_gefahrenindex_pollenflug_erle_91",
        ),
      ).toEqual({
        config: {
          type: "custom:pollenprognos-card",
          integration: "dwd",
          region_id: "91",
        },
      });
    });
  });

  describe("GPL (discovery-based)", () => {
    it("resolves the location from the discovery map", () => {
      const deviceId = "gpl_device_1";
      const configEntryId = "abc123";
      // Non-pollen-prefixed ids so PP/PLU don't claim them; gpl is detected via
      // the pollenlevels platform regardless of id shape.
      const hass = createHass(
        {
          "sensor.gpl_grass": { state: "3", attributes: { icon: "mdi:grass" } },
          "sensor.gpl_tree": { state: "2", attributes: { icon: "mdi:tree" } },
        },
        {
          entities: {
            "sensor.gpl_grass": {
              platform: "pollenlevels",
              device_id: deviceId,
              entity_category: null,
            },
            "sensor.gpl_tree": {
              platform: "pollenlevels",
              device_id: deviceId,
              entity_category: null,
            },
          },
          devices: {
            [deviceId]: { name: "Home", config_entries: [configEntryId] },
          },
        },
      );

      const result = suggestEntityConfig(hass, "sensor.gpl_grass");

      expect(result).toEqual({
        config: {
          type: "custom:pollenprognos-card",
          integration: "gpl",
          location: configEntryId,
        },
      });
    });

    it("does not suggest for a non-data pollenlevels helper (e.g. update_time)", () => {
      // A timestamp helper on the pollenlevels platform must not be treated as a
      // pollen sensor, so picking it offers no card suggestion. (Codex #258)
      const deviceId = "gpl_device_1";
      const configEntryId = "abc123";
      const hass = createHass(
        {
          "sensor.gpl_grass": { state: "3", attributes: { icon: "mdi:grass" } },
          "sensor.pollenlevels_update_time": {
            state: "2026-06-04T08:00:00+00:00",
            attributes: { device_class: "timestamp" },
          },
        },
        {
          entities: {
            "sensor.gpl_grass": {
              platform: "pollenlevels",
              device_id: deviceId,
              entity_category: null,
            },
            "sensor.pollenlevels_update_time": {
              platform: "pollenlevels",
              device_id: deviceId,
              entity_category: null,
            },
          },
          devices: {
            [deviceId]: { name: "Home", config_entries: [configEntryId] },
          },
        },
      );

      expect(
        suggestEntityConfig(hass, "sensor.pollenlevels_update_time"),
      ).toBeNull();
      // The real pollen sensor on the same platform still works.
      expect(suggestEntityConfig(hass, "sensor.gpl_grass")).toEqual({
        config: {
          type: "custom:pollenprognos-card",
          integration: "gpl",
          location: configEntryId,
        },
      });
    });
  });

  describe("location fallback", () => {
    it("falls back to autoSelectLocation when per-entity derivation fails", () => {
      // The picked PEU entity lacks location_slug, but a sibling PEU entity has
      // one, so autoSelectLocation supplies it.
      const hass = createHass({
        "sensor.polleninformation_birch": s("2"), // picked, no location_slug
        "sensor.polleninformation_grasses": s("3", { location_slug: "wien" }),
      });

      const result = suggestEntityConfig(
        hass,
        "sensor.polleninformation_birch",
      );

      expect(result).toEqual({
        config: {
          type: "custom:pollenprognos-card",
          integration: "peu",
          location: "wien",
        },
      });
    });

    it("omits the location key when no location can be derived at all", () => {
      const hass = createHass({
        "sensor.polleninformation_birch": s("2"),
      });

      const result = suggestEntityConfig(
        hass,
        "sensor.polleninformation_birch",
      );

      expect(result).toEqual({
        config: {
          type: "custom:pollenprognos-card",
          integration: "peu",
        },
      });
    });
  });

  describe("SILAM weather-only install", () => {
    // A SILAM install with no allergen sensors still exposes the allergy_risk
    // index via a weather.* entity; the guard must let that domain through and
    // resolve its location from discovery (loc.weatherEntity). (Codex #258)
    it("suggests a card when the picked entity is the SILAM weather entity", () => {
      const deviceId = "silam_dev";
      const configEntryId = "silam_entry_1";
      const hass = createHass(
        { "weather.silam_pollen_oslo": { state: "sunny", attributes: {} } },
        {
          entities: {
            "weather.silam_pollen_oslo": {
              platform: "silam_pollen",
              device_id: deviceId,
              entity_category: null,
              translation_key: "forecast",
            },
          },
          devices: {
            [deviceId]: { name: "Oslo", config_entries: [configEntryId] },
          },
        },
      );

      const result = suggestEntityConfig(hass, "weather.silam_pollen_oslo");

      expect(result).toEqual({
        config: {
          type: "custom:pollenprognos-card",
          integration: "silam",
          location: configEntryId,
        },
      });
    });
  });
});

// deriveLocationForEntity per-integration branches. The discovery-backed
// integrations (atmo/silam/gp/gpl/msw) are exercised with hand-built detection
// objects so each findLocationKeyInDiscovery / regex branch is covered
// deterministically without depending on each adapter's discovery internals.
describe("deriveLocationForEntity", () => {
  // Build a minimal discovery: Map<locationKey, { entities | sensors | weatherEntity }>.
  function disc(entries) {
    return { locations: new Map(entries) };
  }

  it("PP: city from the entity id", () => {
    expect(
      deriveLocationForEntity("pp", "sensor.pollen_goteborg_bjork", {}, {}),
    ).toEqual({ key: "city", value: "goteborg" });
  });

  it("DWD: region_id from the entity id", () => {
    expect(
      deriveLocationForEntity("dwd", "sensor.pollenflug_erle_91", {}, {}),
    ).toEqual({ key: "region_id", value: "91" });
  });

  it("PEU: location from the location_slug attribute", () => {
    const hass = {
      states: {
        "sensor.polleninformation_x": { attributes: { location_slug: "wien" } },
      },
    };
    expect(
      deriveLocationForEntity("peu", "sensor.polleninformation_x", hass, {}),
    ).toEqual({ key: "location", value: "wien" });
  });

  it("ATMO: niveau entity yields the precise slug via regex, even with discovery present", () => {
    // Regex-first: the per-entity slug wins over the discovery config-entry key
    // so multi-location and no-registry setups stay precise. (Codex #258)
    const detection = {
      discovery: {
        atmo: disc([
          [
            "entry_atmo",
            { entities: new Map([["birch", "sensor.niveau_bouleau_paris"]]) },
          ],
        ]),
      },
    };
    expect(
      deriveLocationForEntity(
        "atmo",
        "sensor.niveau_bouleau_paris",
        {},
        detection,
      ),
    ).toEqual({ key: "location", value: "paris" });
  });

  it("ATMO: legacy niveau_ regex when discovery is empty", () => {
    const detection = { discovery: { atmo: disc([]) } };
    expect(
      deriveLocationForEntity(
        "atmo",
        "sensor.niveau_bouleau_paris",
        {},
        detection,
      ),
    ).toEqual({ key: "location", value: "paris" });
  });

  it("ATMO: a non-niveau entity resolves via a real discovery config entry", () => {
    const detection = {
      discovery: {
        atmo: disc([
          ["entry_atmo", { entities: new Map([["pm25", "sensor.pm25_paris"]]) }],
        ]),
      },
    };
    expect(
      deriveLocationForEntity("atmo", "sensor.pm25_paris", {}, detection),
    ).toEqual({ key: "location", value: "entry_atmo" });
  });

  it("ATMO: never pins a non-niveau entity to the tier-3 'default' bucket", () => {
    const detection = {
      discovery: {
        atmo: disc([
          ["default", { entities: new Map([["pm25", "sensor.pm25_paris"]]) }],
        ]),
      },
    };
    expect(
      deriveLocationForEntity("atmo", "sensor.pm25_paris", {}, detection),
    ).toBeNull();
  });

  it("SILAM: weatherEntity match in discovery", () => {
    const detection = {
      discovery: {
        silam: disc([
          [
            "entry_s",
            { weatherEntity: "weather.silam_pollen_oslo", sensors: new Map() },
          ],
        ]),
      },
    };
    expect(
      deriveLocationForEntity(
        "silam",
        "weather.silam_pollen_oslo",
        {},
        detection,
      ),
    ).toEqual({ key: "location", value: "entry_s" });
  });

  it("SILAM: regex fallback when discovery is empty", () => {
    const detection = { discovery: { silam: disc([]) } };
    expect(
      deriveLocationForEntity(
        "silam",
        "sensor.silam_pollen_helsinki_birch",
        {},
        detection,
      ),
    ).toEqual({ key: "location", value: "helsinki" });
  });

  it("Kleenex: longest matching location prefix wins", () => {
    const detection = {
      stateIds: [
        "sensor.kleenex_pollen_radar_noord_date",
        "sensor.kleenex_pollen_radar_noord_holland_date",
      ],
    };
    expect(
      deriveLocationForEntity(
        "kleenex",
        "sensor.kleenex_pollen_radar_noord_holland_trees",
        {},
        detection,
      ),
    ).toEqual({ key: "location", value: "noord_holland" });
  });

  it("GP: location from the discovery entities map", () => {
    const detection = {
      discovery: {
        gp: disc([
          ["entry_gp", { entities: new Map([["grass", "sensor.gp_grass"]]) }],
        ]),
      },
    };
    expect(
      deriveLocationForEntity("gp", "sensor.gp_grass", {}, detection),
    ).toEqual({ key: "location", value: "entry_gp" });
  });

  it("GPL: location from the lazy discovery getter", () => {
    const detection = {
      getGplDiscovery: () =>
        disc([
          ["entry_gpl", { entities: new Map([["tree", "sensor.gpl_tree"]]) }],
        ]),
    };
    expect(
      deriveLocationForEntity("gpl", "sensor.gpl_tree", {}, detection),
    ).toEqual({ key: "location", value: "entry_gpl" });
  });

  it("MSW: location from the lazy discovery getter", () => {
    const detection = {
      getMswDiscovery: () =>
        disc([
          [
            "entry_msw",
            {
              entities: new Map([
                ["birch", "sensor.bern_pollen_birch_level_at_3000"],
              ]),
            },
          ],
        ]),
    };
    expect(
      deriveLocationForEntity(
        "msw",
        "sensor.bern_pollen_birch_level_at_3000",
        {},
        detection,
      ),
    ).toEqual({ key: "location", value: "entry_msw" });
  });

  it("returns null for an unknown integration", () => {
    expect(deriveLocationForEntity("nope", "sensor.x", {}, {})).toBeNull();
  });
});
