/**
 * Characterization tests for src/utils/autodetect.js.
 *
 * These lock the OBSERVABLE behaviour of the shared autodetection module before
 * the descriptor-registry refactor (PR 9b). They are the contract: the refactor
 * must keep every value here byte-identical. Where existing suites already pin a
 * behaviour (test/card/autodetect.test.ts covers detection precedence and the
 * PP/PLU, DWD, MSW, ATMO, SILAM, GPL matchers; test/utils/suggest.test.ts covers
 * suggestEntityConfig and every deriveLocationForEntity branch) this file does
 * NOT duplicate it. It adds the three facits those suites leave thin:
 *
 *   1. detectIntegrationStates -> the FULL per-integration `states` partition
 *      for one combined fixture (locks all 11 matchers simultaneously; this is
 *      the single strongest guard for the "matchStateId moves home" step).
 *   2. autoSelectLocation -> per-integration branch outcomes (only ever tested
 *      indirectly through suggestEntityConfig before).
 *   3. pickIntegration explicit/skip semantics, normalizeIntegration, and
 *      detectedIntegrationIds ordering.
 *
 * The autoSelectLocation cases hand-build `detection` objects (mirroring
 * suggest.test's deriveLocationForEntity style) so each branch is exercised
 * deterministically without depending on any adapter's discovery internals.
 */

import { describe, it, expect } from "vitest";
import {
  detectIntegrationStates,
  pickIntegration,
  autoSelectLocation,
  normalizeIntegration,
  detectedIntegrationIds,
  INTEGRATION_PRIORITY,
} from "../../src/utils/autodetect.js";
import { createHassWithRegistry } from "../helpers.js";

// ---------------------------------------------------------------------------
// 1. detectIntegrationStates — full per-integration partition
// ---------------------------------------------------------------------------

/**
 * One realistic entity per integration, wired through the entity/device
 * registry so the platform-based matchers (silam/gpl/gp/msw/irmkmi) and the
 * id-pattern matchers (pp/plu/peu/dwd/kleenex/atmo) all fire from the same hass.
 */
function combinedHass() {
  return createHassWithRegistry([
    { entityId: "sensor.pollen_stockholm_bjork" }, // pp (city suffix)
    { entityId: "sensor.pollen_bouleau" }, // plu (known allergen, no suffix)
    {
      entityId: "sensor.polleninformation_wien_birch",
      attributes: { location_slug: "wien" },
    }, // peu
    { entityId: "sensor.pollenflug_erle_11" }, // dwd
    {
      entityId: "sensor.silam_pollen_birch_home",
      platform: "silam_pollen",
      deviceId: "dev_s",
      translationKey: "birch",
      deviceMeta: { configEntries: ["entry_s"], name: "Home" },
    }, // silam
    { entityId: "sensor.kleenex_pollen_radar_amsterdam_trees" }, // kleenex
    { entityId: "sensor.niveau_bouleau_montpellier" }, // atmo
    {
      entityId: "sensor.gpl_grass",
      platform: "pollenlevels",
      deviceId: "dev_g",
      deviceMeta: { configEntries: ["entry_gpl"], name: "Home" },
    }, // gpl
    {
      entityId: "sensor.google_pollen_grass",
      platform: "google_pollen",
      deviceId: "dev_gp",
      deviceMeta: { configEntries: ["entry_gp"], name: "Home" },
    }, // gp
    {
      entityId: "sensor.bern_pollen_birch_level_at_3000_pbe",
      platform: "swissweather",
      deviceId: "dev_m",
      deviceMeta: { configEntries: ["entry_msw"], name: "Bern" },
    }, // msw
    {
      entityId: "sensor.antwerp_birch_level",
      platform: "irm_kmi",
      deviceId: "dev_i",
      deviceMeta: { configEntries: ["entry_irm"], name: "Antwerp" },
    }, // irmkmi
  ]);
}

describe("detectIntegrationStates: full partition (all matchers at once)", () => {
  it("assigns each entity to exactly its owning integration", () => {
    const detection = detectIntegrationStates(combinedHass());
    expect(detection.states).toEqual({
      pp: ["sensor.pollen_stockholm_bjork"],
      dwd: ["sensor.pollenflug_erle_11"],
      peu: ["sensor.polleninformation_wien_birch"],
      silam: ["sensor.silam_pollen_birch_home"],
      kleenex: ["sensor.kleenex_pollen_radar_amsterdam_trees"],
      plu: ["sensor.pollen_bouleau"],
      atmo: ["sensor.niveau_bouleau_montpellier"],
      gpl: ["sensor.gpl_grass"],
      gp: ["sensor.google_pollen_grass"],
      msw: ["sensor.bern_pollen_birch_level_at_3000_pbe"],
      irmkmi: ["sensor.antwerp_birch_level"],
    });
  });

  it("exposes the canonical priority order (facit for descriptor priority)", () => {
    expect(INTEGRATION_PRIORITY).toEqual([
      "pp",
      "plu",
      "peu",
      "dwd",
      "silam",
      "kleenex",
      "atmo",
      "gp",
      "gpl",
      "msw",
      "irmkmi",
    ]);
  });

  it("detectedIntegrationIds returns every installed id in priority order", () => {
    const detection = detectIntegrationStates(combinedHass());
    expect([...detectedIntegrationIds(detection)]).toEqual([
      "pp",
      "plu",
      "peu",
      "dwd",
      "silam",
      "kleenex",
      "atmo",
      "gp",
      "gpl",
      "msw",
      "irmkmi",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. pickIntegration — explicit / skip semantics
// ---------------------------------------------------------------------------

describe("pickIntegration: explicit and skip", () => {
  it("picks the highest-priority installed integration (pp over plu here)", () => {
    expect(pickIntegration(detectIntegrationStates(combinedHass()))).toBe("pp");
  });

  it("explicit user choice wins unchanged, normalized", () => {
    const detection = detectIntegrationStates(combinedHass());
    expect(
      pickIntegration(detection, { explicit: true, userIntegration: " DWD " }),
    ).toBe("dwd");
  });

  it("skip set removes candidates in priority order", () => {
    const detection = detectIntegrationStates(combinedHass());
    expect(
      pickIntegration(detection, { skip: new Set(["pp", "plu", "peu"]) }),
    ).toBe("dwd");
  });

  it("falls back to the normalized user integration when nothing is detected", () => {
    const detection = detectIntegrationStates(createHassWithRegistry([]));
    expect(pickIntegration(detection, { userIntegration: "PP" })).toBe("pp");
    expect(pickIntegration(detection)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. autoSelectLocation — per-integration branch outcomes
//
// id-pattern integrations use a real hass; discovery-backed integrations use a
// hand-built detection object (locations Map) so the "first discovery key" and
// lazy-getter branches are pinned without discovery internals.
// ---------------------------------------------------------------------------

describe("autoSelectLocation: id-pattern integrations", () => {
  it("dwd -> smallest region_id from the entity-id suffix", () => {
    const hass = createHassWithRegistry([
      { entityId: "sensor.pollenflug_erle_50" },
      { entityId: "sensor.pollenflug_birke_11" },
    ]);
    const detection = detectIntegrationStates(hass);
    expect(autoSelectLocation("dwd", {}, hass, detection)).toEqual({
      key: "region_id",
      value: "11",
    });
  });

  it("pp -> city slug from the first sensor that yields one", () => {
    const hass = createHassWithRegistry([
      { entityId: "sensor.pollen_stockholm_bjork" },
    ]);
    const detection = detectIntegrationStates(hass);
    expect(autoSelectLocation("pp", {}, hass, detection)).toEqual({
      key: "city",
      value: "stockholm",
    });
  });

  it("peu -> location_slug attribute of the first sensor", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.polleninformation_wien_birch",
        attributes: { location_slug: "wien" },
      },
    ]);
    const detection = detectIntegrationStates(hass);
    expect(autoSelectLocation("peu", {}, hass, detection)).toEqual({
      key: "location",
      value: "wien",
    });
  });

  it("kleenex -> location parsed from the sibling _date sensor", () => {
    const hass = createHassWithRegistry([
      { entityId: "sensor.kleenex_pollen_radar_amsterdam_trees" },
      { entityId: "sensor.kleenex_pollen_radar_amsterdam_date" },
    ]);
    const detection = detectIntegrationStates(hass);
    expect(autoSelectLocation("kleenex", {}, hass, detection)).toEqual({
      key: "location",
      value: "amsterdam",
    });
  });

  it("atmo -> slug from the niveau_<allergen>_<slug> pattern", () => {
    const hass = createHassWithRegistry([
      { entityId: "sensor.niveau_bouleau_montpellier" },
    ]);
    const detection = detectIntegrationStates(hass);
    expect(autoSelectLocation("atmo", {}, hass, detection)).toEqual({
      key: "location",
      value: "montpellier",
    });
  });

  it("returns null when the integration has no detected states", () => {
    const hass = createHassWithRegistry([]);
    const detection = detectIntegrationStates(hass);
    for (const id of INTEGRATION_PRIORITY) {
      expect(autoSelectLocation(id, {}, hass, detection)).toBeNull();
    }
  });
});

describe("autoSelectLocation: discovery-backed integrations", () => {
  // Minimal detection stub: states present + a discovery locations Map whose
  // first key is what the branch returns.
  const withDiscovery = (integration: string, discovery: any, lazy = false) => {
    const detection: any = {
      states: { [integration]: ["sensor.x"] },
      stateIds: ["sensor.x"],
      discovery: {},
    };
    if (lazy) {
      const getterName = {
        gpl: "getGplDiscovery",
        msw: "getMswDiscovery",
        irmkmi: "getIrmkmiDiscovery",
      }[integration]!;
      detection[getterName] = () => discovery;
    } else {
      detection.discovery[integration] = discovery;
    }
    return detection;
  };

  const disc = (firstKey: string) => ({
    locations: new Map([[firstKey, { entities: new Map() }]]),
  });

  it("silam -> first discovery location key (eager discovery)", () => {
    const detection = withDiscovery("silam", disc("entry_s"));
    expect(autoSelectLocation("silam", {}, {} as any, detection)).toEqual({
      key: "location",
      value: "entry_s",
    });
  });

  it("gp -> first discovery location key (eager discovery)", () => {
    const detection = withDiscovery("gp", disc("entry_gp"));
    expect(autoSelectLocation("gp", {}, {} as any, detection)).toEqual({
      key: "location",
      value: "entry_gp",
    });
  });

  it("gpl -> first discovery location key (lazy getter)", () => {
    const detection = withDiscovery("gpl", disc("entry_gpl"), true);
    expect(autoSelectLocation("gpl", {}, {} as any, detection)).toEqual({
      key: "location",
      value: "entry_gpl",
    });
  });

  it("msw -> first discovery location key (lazy getter)", () => {
    const detection = withDiscovery("msw", disc("entry_msw"), true);
    expect(autoSelectLocation("msw", {}, {} as any, detection)).toEqual({
      key: "location",
      value: "entry_msw",
    });
  });

  it("irmkmi -> first discovery location key (lazy getter)", () => {
    const detection = withDiscovery("irmkmi", disc("entry_irm"), true);
    expect(autoSelectLocation("irmkmi", {}, {} as any, detection)).toEqual({
      key: "location",
      value: "entry_irm",
    });
  });

  it("silam -> regex fallback when discovery has no locations", () => {
    const detection: any = {
      states: { silam: ["sensor.silam_pollen_helsinki_birch"] },
      discovery: { silam: { locations: new Map() } },
    };
    expect(autoSelectLocation("silam", {}, {} as any, detection)).toEqual({
      key: "location",
      value: "helsinki",
    });
  });
});

// ---------------------------------------------------------------------------
// 4. normalizeIntegration
// ---------------------------------------------------------------------------

describe("normalizeIntegration", () => {
  it("trims and lowercases strings", () => {
    expect(normalizeIntegration("  PP  ")).toBe("pp");
    expect(normalizeIntegration("Dwd")).toBe("dwd");
  });

  it("passes non-strings through unchanged", () => {
    expect(normalizeIntegration(undefined)).toBeUndefined();
    expect(normalizeIntegration(null)).toBeNull();
    const obj = {};
    expect(normalizeIntegration(obj)).toBe(obj);
  });
});
