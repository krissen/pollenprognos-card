import { describe, it, expect, vi } from "vitest";
import {
  discoverEntitiesByDevice,
  findLocationBySlug,
  resolveLocationByKey,
} from "../../src/utils/adapter-helpers.js";
import {
  createHassWithRegistry,
  assertDiscoveryShape,
} from "../helpers.js";

// ---------------------------------------------------------------------------
// Test fixtures and helpers
// ---------------------------------------------------------------------------

/**
 * Build a simple classify function that maps entity IDs to allergen keys
 * based on a lookup map.
 */
function makeClassifier(mapping) {
  return (eid) => {
    for (const [pattern, key] of Object.entries(mapping)) {
      if (eid.includes(pattern)) return key;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// discoverEntitiesByDevice
// ---------------------------------------------------------------------------

describe("discoverEntitiesByDevice", () => {
  // --- Tier 1 ---

  it("tier 1 hit: device identifier matches platform, entities mapped correctly", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.testint_birch_loc1",
        state: "3",
        deviceId: "dev_abc",
        platform: "testint",
        deviceMeta: {
          identifiers: [["testint", "loc1"]],
          configEntries: ["cfg_loc1"],
          name: "Location One",
        },
      },
      {
        entityId: "sensor.testint_grass_loc1",
        state: "2",
        deviceId: "dev_abc",
        platform: "testint",
      },
    ]);

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: makeClassifier({ birch: "birch", grass: "grass" }),
    });

    assertDiscoveryShape(discovery);
    expect(discovery.tierUsed).toBe(1);
    expect(discovery.locations.size).toBe(1);
    const loc = discovery.locations.get("cfg_loc1");
    expect(loc).toBeDefined();
    expect(loc.entities.get("birch")).toBe("sensor.testint_birch_loc1");
    expect(loc.entities.get("grass")).toBe("sensor.testint_grass_loc1");
  });

  it("tier 1 hit: two entities from same device, label from device.name", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.testint_birch_loc1",
        state: "3",
        deviceId: "dev_abc",
        platform: "testint",
        deviceMeta: {
          identifiers: [["testint", "loc1"]],
          configEntries: ["cfg_loc1"],
          name: "MyCity",
        },
      },
    ]);

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: makeClassifier({ birch: "birch" }),
    });

    expect(discovery.tierUsed).toBe(1);
    expect(discovery.locations.get("cfg_loc1").label).toBe("MyCity");
  });

  it("tier 1: entities filtered by isRelevant fall through to tier 2 if tier 2 matches", () => {
    // Set up: device exists (tier 1 capable) but isRelevant filters all out.
    // tier 2 entities have matching platform, so tier 2 should fire.
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.testint_birch_loc1",
        state: "3",
        deviceId: "dev_abc",
        platform: "testint",
        deviceMeta: {
          identifiers: [["testint", "loc1"]],
          configEntries: ["cfg_loc1"],
        },
      },
    ]);

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: makeClassifier({ birch: "birch" }),
      isRelevant: () => false, // filter everything
    });

    // Tier 1 and tier 2 both produce nothing (isRelevant blocks all).
    // Result should be tierUsed 0.
    expect(discovery.tierUsed).toBe(0);
    expect(discovery.locations.size).toBe(0);
  });

  it("tier 1: isRelevant blocks tier-1 entities but tier-2 entity without device matches", () => {
    // One entity with device (tier 1 candidate), blocked by isRelevant.
    // Another entity without device but with matching platform (tier 2 candidate).
    // isRelevant applied in both tiers; first entity still blocked.
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.testint_birch_loc1",
        state: "3",
        deviceId: "dev_abc",
        platform: "testint",
        deviceMeta: {
          identifiers: [["testint", "loc1"]],
          configEntries: ["cfg_loc1"],
        },
      },
      {
        entityId: "sensor.testint_grass_noloc",
        state: "1",
        deviceId: null,
        platform: "testint",
      },
    ]);

    // isRelevant only blocks entities containing "birch"
    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: makeClassifier({ birch: "birch", grass: "grass" }),
      isRelevant: (eid) => !eid.includes("birch"),
    });

    // Tier 1: device found, but birch is blocked -> no entities -> tier 1 produces 0 locations
    // Tier 2: platform match, birch still blocked, grass passes -> tier 2 fires
    expect(discovery.tierUsed).toBe(2);
    expect(discovery.locations.size).toBe(1);
    const loc = discovery.locations.values().next().value;
    expect(loc.entities.has("grass")).toBe(true);
    expect(loc.entities.has("birch")).toBe(false);
  });

  // --- Tier 2 ---

  it("tier 2 hit: no devices, entities with matching platform", () => {
    const hass = {
      states: {
        "sensor.myint_birch": { state: "2", attributes: { friendly_name: "Birch" } },
      },
      entities: {
        "sensor.myint_birch": { device_id: null, platform: "myint", entity_category: null },
      },
      // No hass.devices
      locale: { language: "en" },
      language: "en",
    };

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "myint",
      classify: makeClassifier({ birch: "birch" }),
    });

    assertDiscoveryShape(discovery);
    expect(discovery.tierUsed).toBe(2);
    expect(discovery.locations.size).toBe(1);
    const loc = discovery.locations.values().next().value;
    expect(loc.entities.get("birch")).toBe("sensor.myint_birch");
  });

  it("tier 2: location key defaults to 'default' when no device config_entries", () => {
    const hass = {
      states: {
        "sensor.myint_birch": { state: "2", attributes: {} },
      },
      entities: {
        "sensor.myint_birch": { device_id: null, platform: "myint", entity_category: null },
      },
      locale: { language: "en" },
      language: "en",
    };

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "myint",
      classify: () => "birch",
    });

    expect(discovery.tierUsed).toBe(2);
    expect(discovery.locations.has("default")).toBe(true);
  });

  // --- Tier 3 ---

  it("tier 3 regex hit: no entities registry, fallback regex matches states", () => {
    const hass = {
      states: {
        "sensor.abc_birch_stadtx": { state: "1", attributes: {} },
        "sensor.abc_grass_stadtx": { state: "2", attributes: {} },
        "sensor.unrelated_sensor": { state: "0", attributes: {} },
      },
      locale: { language: "en" },
      language: "en",
    };

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "abc",
      classify: makeClassifier({ birch: "birch", grass: "grass" }),
      fallbackRegex: /^sensor\.abc_/,
    });

    assertDiscoveryShape(discovery);
    expect(discovery.tierUsed).toBe(3);
    expect(discovery.locations.size).toBe(1);
    const loc = discovery.locations.values().next().value;
    expect(loc.entities.get("birch")).toBe("sensor.abc_birch_stadtx");
    expect(loc.entities.get("grass")).toBe("sensor.abc_grass_stadtx");
  });

  it("tier 3 selector hit: fallbackSelector overrides regex", () => {
    const hass = {
      states: {
        "sensor.selected_birch": { state: "3", attributes: {} },
        "sensor.not_selected": { state: "1", attributes: {} },
      },
      locale: { language: "en" },
      language: "en",
    };

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "abc",
      classify: (eid) => eid.includes("birch") ? "birch" : null,
      fallbackRegex: /^sensor\.not_/, // would match "not_selected" — should be ignored
      fallbackSelector: () => ["sensor.selected_birch"],
    });

    assertDiscoveryShape(discovery);
    expect(discovery.tierUsed).toBe(3);
    expect(discovery.locations.size).toBe(1);
    const loc = discovery.locations.values().next().value;
    expect(loc.entities.get("birch")).toBe("sensor.selected_birch");
  });

  // --- No match ---

  it("no match in any tier: returns empty locations with tierUsed 0", () => {
    const hass = {
      states: {
        "sensor.unrelated": { state: "0", attributes: {} },
      },
      entities: {
        "sensor.unrelated": { device_id: null, platform: "other_platform", entity_category: null },
      },
      locale: { language: "en" },
      language: "en",
    };

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "myint",
      classify: () => null,
    });

    assertDiscoveryShape(discovery);
    expect(discovery.tierUsed).toBe(0);
    expect(discovery.locations.size).toBe(0);
  });

  // --- classifyRelaxed only used in tier 1 ---

  it("classifyRelaxed used in tier 1, strict returns null in tier 2/3", () => {
    // Tier 1: device found, classifyRelaxed returns "birch" (strict returns null)
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.testint_birch_loc1",
        state: "3",
        deviceId: "dev_abc",
        platform: "testint",
        deviceMeta: {
          identifiers: [["testint", "loc1"]],
          configEntries: ["cfg_loc1"],
        },
      },
    ]);

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: () => null,          // strict: never classifies
      classifyRelaxed: (eid) => eid.includes("birch") ? "birch" : null,
    });

    // Tier 1 uses relaxed -> succeeds
    expect(discovery.tierUsed).toBe(1);
    expect(discovery.locations.size).toBe(1);
    expect(discovery.locations.values().next().value.entities.get("birch")).toBe("sensor.testint_birch_loc1");
  });

  it("classifyRelaxed irrelevant when no device: tier 2 uses strict (which returns null) -> no results", () => {
    const hass = {
      states: {
        "sensor.testint_birch": { state: "2", attributes: {} },
      },
      entities: {
        "sensor.testint_birch": { device_id: null, platform: "testint", entity_category: null },
      },
      locale: { language: "en" },
      language: "en",
    };

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: () => null,
      classifyRelaxed: () => "birch", // relaxed would classify but should not be used in tier 2
    });

    expect(discovery.tierUsed).toBe(0);
    expect(discovery.locations.size).toBe(0);
  });

  // --- excludeEntry ---

  it("excludeEntry: entries with entity_category skipped by default", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.testint_diagnostic",
        state: "1",
        deviceId: "dev_abc",
        platform: "testint",
        entityCategory: "diagnostic",
        deviceMeta: {
          identifiers: [["testint", "loc1"]],
          configEntries: ["cfg_loc1"],
        },
      },
      {
        entityId: "sensor.testint_birch",
        state: "2",
        deviceId: "dev_abc",
        platform: "testint",
        entityCategory: null,
      },
    ]);

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: (eid) => eid.includes("birch") ? "birch" : eid.includes("diagnostic") ? "diag" : null,
    });

    expect(discovery.tierUsed).toBe(1);
    const loc = discovery.locations.values().next().value;
    expect(loc.entities.has("diag")).toBe(false);
    expect(loc.entities.has("birch")).toBe(true);
  });

  // --- onCollision ---

  it("onCollision triggered when two entities map to the same key", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.testint_birch_a",
        state: "3",
        deviceId: "dev_abc",
        platform: "testint",
        deviceMeta: {
          identifiers: [["testint", "loc1"]],
          configEntries: ["cfg_loc1"],
        },
      },
      {
        entityId: "sensor.testint_birch_b",
        state: "2",
        deviceId: "dev_abc",
        platform: "testint",
      },
    ]);

    const collisionCtx = [];
    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: () => "birch", // both map to "birch"
      onCollision: (ctx, info) => {
        collisionCtx.push({ ctx, info });
        return "birch_alt";
      },
    });

    expect(discovery.tierUsed).toBe(1);
    expect(collisionCtx.length).toBe(1);
    const loc = discovery.locations.values().next().value;
    expect(loc.entities.has("birch")).toBe(true);
    expect(loc.entities.has("birch_alt")).toBe(true);
  });

  it("onCollision returning null skips the colliding entity", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.testint_birch_a",
        state: "3",
        deviceId: "dev_abc",
        platform: "testint",
        deviceMeta: {
          identifiers: [["testint", "loc1"]],
          configEntries: ["cfg_loc1"],
        },
      },
      {
        entityId: "sensor.testint_birch_b",
        state: "2",
        deviceId: "dev_abc",
        platform: "testint",
      },
    ]);

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: () => "birch",
      onCollision: () => null, // skip
    });

    const loc = discovery.locations.values().next().value;
    expect(loc.entities.size).toBe(1); // only the first one kept
  });

  // --- platform as array ---

  it("platform array: tier 1 matches device identifier with alternative platform name", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.altname_birch",
        state: "2",
        deviceId: "dev_abc",
        platform: "primary",
        deviceMeta: {
          identifiers: [["altname", "loc1"]],
          configEntries: ["cfg_alt"],
        },
      },
    ]);

    const discovery = discoverEntitiesByDevice(hass, {
      platform: ["primary", "altname"],
      classify: (eid) => eid.includes("birch") ? "birch" : null,
    });

    expect(discovery.tierUsed).toBe(1);
    expect(discovery.locations.has("cfg_alt")).toBe(true);
  });

  // --- Missing hass sub-objects ---

  it("hass.entities missing: tier 1 and tier 2 skipped, tier 3 (regex) used", () => {
    const hass = {
      states: {
        "sensor.abc_birch": { state: "1", attributes: {} },
      },
      // No hass.entities, no hass.devices
      locale: { language: "en" },
      language: "en",
    };

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "abc",
      classify: (eid) => eid.includes("birch") ? "birch" : null,
      fallbackRegex: /^sensor\.abc_/,
    });

    expect(discovery.tierUsed).toBe(3);
    expect(discovery.locations.size).toBe(1);
  });

  it("hass.devices missing but hass.entities present: tier 1 skipped, tier 2 activated", () => {
    const hass = {
      states: {
        "sensor.abc_birch": { state: "1", attributes: {} },
      },
      entities: {
        "sensor.abc_birch": { device_id: null, platform: "abc", entity_category: null },
      },
      // No hass.devices
      locale: { language: "en" },
      language: "en",
    };

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "abc",
      classify: (eid) => eid.includes("birch") ? "birch" : null,
    });

    expect(discovery.tierUsed).toBe(2);
    expect(discovery.locations.size).toBe(1);
  });

  it("tier 2 without hass.devices still sets loc.deviceId when entry.device_id is present", () => {
    // Regression: early versions only set loc.deviceId when ctx.device was
    // non-null, which meant tier 2 without hass.devices lost deviceId even
    // though entry.device_id was available. SILAM weather postprocess relies
    // on this.
    const hass = {
      states: {
        "sensor.abc_birch": { state: "1", attributes: {} },
      },
      entities: {
        "sensor.abc_birch": {
          device_id: "dev_known",
          platform: "abc",
          entity_category: null,
        },
      },
      // No hass.devices — lookup of ctx.device will fail.
      locale: { language: "en" },
      language: "en",
    };

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "abc",
      classify: (eid) => eid.includes("birch") ? "birch" : null,
    });

    expect(discovery.tierUsed).toBe(2);
    const [, location] = discovery.locations.entries().next().value;
    expect(location.deviceId).toBe("dev_known");
  });

  // --- Multi-instance ---

  it("multi-instance: two devices produce two separate locations", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.testint_birch_loc1",
        state: "3",
        deviceId: "dev_loc1",
        platform: "testint",
        deviceMeta: {
          identifiers: [["testint", "loc1"]],
          configEntries: ["cfg_loc1"],
          name: "Location One",
        },
      },
      {
        entityId: "sensor.testint_birch_loc2",
        state: "1",
        deviceId: "dev_loc2",
        platform: "testint",
        deviceMeta: {
          identifiers: [["testint", "loc2"]],
          configEntries: ["cfg_loc2"],
          name: "Location Two",
        },
      },
    ]);

    const discovery = discoverEntitiesByDevice(hass, {
      platform: "testint",
      classify: makeClassifier({ birch: "birch" }),
    });

    assertDiscoveryShape(discovery);
    expect(discovery.tierUsed).toBe(1);
    expect(discovery.locations.size).toBe(2);
    expect(discovery.locations.has("cfg_loc1")).toBe(true);
    expect(discovery.locations.has("cfg_loc2")).toBe(true);
    expect(discovery.locations.get("cfg_loc1").entities.get("birch")).toBe("sensor.testint_birch_loc1");
    expect(discovery.locations.get("cfg_loc2").entities.get("birch")).toBe("sensor.testint_birch_loc2");
  });
});

// ---------------------------------------------------------------------------
// resolveLocationByKey
// ---------------------------------------------------------------------------

describe("resolveLocationByKey", () => {
  function makeDiscovery(entries) {
    const locations = new Map();
    for (const [key, label, entities] of entries) {
      const entMap = new Map(Object.entries(entities));
      locations.set(key, { label, entities: entMap });
    }
    return { locations, tierUsed: 2 };
  }

  it("empty cfgLocation returns first location", () => {
    const discovery = makeDiscovery([
      ["cfg_abc", "City A", { birch: "sensor.birch_a" }],
      ["cfg_xyz", "City X", { grass: "sensor.grass_x" }],
    ]);

    const result = resolveLocationByKey(discovery, "");
    expect(result).not.toBeNull();
    expect(result[0]).toBe("cfg_abc");
  });

  it("empty cfgLocation with empty map returns null", () => {
    const discovery = { locations: new Map(), tierUsed: 0 };
    const result = resolveLocationByKey(discovery, "");
    expect(result).toBeNull();
  });

  it("empty cfgLocation picks deterministically by sorted key, not insertion order", () => {
    // Insert cfg_xyz first, cfg_abc second. Insertion-order "first" would be
    // cfg_xyz, but sorted-key "first" must be cfg_abc.
    const discovery = makeDiscovery([
      ["cfg_xyz", "City X", { grass: "sensor.grass_x" }],
      ["cfg_abc", "City A", { birch: "sensor.birch_a" }],
    ]);

    const result = resolveLocationByKey(discovery, "");
    expect(result).not.toBeNull();
    expect(result[0]).toBe("cfg_abc");
  });

  it("exact key match", () => {
    const discovery = makeDiscovery([
      ["cfg_abc", "City A", { birch: "sensor.birch_a" }],
    ]);

    const result = resolveLocationByKey(discovery, "cfg_abc");
    expect(result).not.toBeNull();
    expect(result[0]).toBe("cfg_abc");
  });

  it("label substring match", () => {
    const discovery = makeDiscovery([
      ["cfg_abc", "City of Nice", { birch: "sensor.birch_nice" }],
    ]);

    const result = resolveLocationByKey(discovery, "Nice");
    expect(result).not.toBeNull();
    expect(result[0]).toBe("cfg_abc");
  });

  it("slug fallback via suffix matching", () => {
    const discovery = makeDiscovery([
      ["cfg_abc", "Auto", { birch: "sensor.niveau_bouleau_paris" }],
    ]);

    // "paris" matches because "sensor.niveau_bouleau_paris" ends with "_paris"
    const result = resolveLocationByKey(discovery, "paris");
    expect(result).not.toBeNull();
    expect(result[0]).toBe("cfg_abc");
  });

  it("no match returns null", () => {
    const discovery = makeDiscovery([
      ["cfg_abc", "City A", { birch: "sensor.birch_a" }],
    ]);

    const result = resolveLocationByKey(discovery, "completely_unknown_xyz");
    expect(result).toBeNull();
  });

  it("null discovery returns null", () => {
    expect(resolveLocationByKey(null, "paris")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findLocationBySlug
// ---------------------------------------------------------------------------

describe("findLocationBySlug", () => {
  function makeDiscovery(entries) {
    const locations = new Map();
    for (const [key, label, entities] of entries) {
      const entMap = new Map(Object.entries(entities));
      locations.set(key, { label, entities: entMap });
    }
    return { locations, tierUsed: 2 };
  }

  it("matches entity ending with _{slug}", () => {
    const discovery = makeDiscovery([
      ["cfg_paris", "Auto", { birch: "sensor.niveau_bouleau_paris" }],
    ]);

    const result = findLocationBySlug(discovery, "paris");
    expect(result).not.toBeNull();
    expect(result[0]).toBe("cfg_paris");
  });

  it("matches entity ending with _{slug}_j_1 via default suffixExtras", () => {
    const discovery = makeDiscovery([
      ["cfg_paris", "Auto", { birch: "sensor.niveau_bouleau_paris_j_1" }],
    ]);

    const result = findLocationBySlug(discovery, "paris");
    expect(result).not.toBeNull();
    expect(result[0]).toBe("cfg_paris");
  });

  it("custom suffixExtras: matches _{slug}_v2 if provided", () => {
    const discovery = makeDiscovery([
      ["cfg_abc", "Auto", { birch: "sensor.birch_cityname_v2" }],
    ]);

    const result = findLocationBySlug(discovery, "cityname", { suffixExtras: ["", "_v2"] });
    expect(result).not.toBeNull();
    expect(result[0]).toBe("cfg_abc");
  });

  it("does not match _{slug}_j_1 when suffixExtras is empty array", () => {
    const discovery = makeDiscovery([
      ["cfg_paris", "Auto", { birch: "sensor.niveau_bouleau_paris_j_1" }],
    ]);

    // Without "_j_1" in suffixExtras, only plain suffix matches
    const result = findLocationBySlug(discovery, "paris", { suffixExtras: [] });
    expect(result).toBeNull();
  });

  it("no match returns null", () => {
    const discovery = makeDiscovery([
      ["cfg_abc", "Auto", { birch: "sensor.niveau_bouleau_abc" }],
    ]);

    expect(findLocationBySlug(discovery, "xyz")).toBeNull();
  });

  it("null slug returns null", () => {
    const discovery = makeDiscovery([
      ["cfg_abc", "Auto", { birch: "sensor.birch_abc" }],
    ]);

    expect(findLocationBySlug(discovery, null)).toBeNull();
    expect(findLocationBySlug(discovery, "")).toBeNull();
  });

  it("slugExtractor used for custom matching", () => {
    const discovery = makeDiscovery([
      ["cfg_abc", "Auto", { birch: "sensor.prefix_birch_NICE_extra" }],
    ]);

    // Extractor pulls out the city name from a known position
    const slugExtractor = (eid) => {
      const m = eid.match(/_([A-Z]+)_extra$/);
      return m ? m[1].toLowerCase() : null;
    };

    const result = findLocationBySlug(discovery, "nice", { slugExtractor });
    expect(result).not.toBeNull();
    expect(result[0]).toBe("cfg_abc");
  });
});
