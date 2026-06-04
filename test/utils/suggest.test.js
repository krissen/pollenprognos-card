import { describe, it, expect } from "vitest";
import { suggestEntityConfig } from "../../src/utils/autodetect.js";
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
});
