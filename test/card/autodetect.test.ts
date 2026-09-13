/**
 * Autodetect precedence tests.
 *
 * Integration autodetection now lives in ONE shared module
 * (src/utils/autodetect.js) consumed by the card element, card editor, badge
 * element and badge editor. This file exercises the REAL shared functions
 * (no parallel reimplementation), so it catches drift in the actual code.
 *
 * Canonical precedence (single source of truth, INTEGRATION_PRIORITY):
 *   PP > PLU > PEU > DWD > SILAM > Kleenex > ATMO > GP > GPL > MSW > IRMKMI
 *
 * Previously the card and the two editor codepaths had documented divergences
 * (editor setConfig missed PLU; editor set hass missed Kleenex). The extraction
 * unified them, so every path now agrees — the old divergence cases are flipped
 * below to assert the unified behaviour.
 */

import { describe, it, expect } from "vitest";
import { PLU_ALIAS_MAP } from "../../src/adapters/plu.js";

import {
  detectIntegrationStates,
  pickIntegration,
  detectedIntegrationIds,
  autoSelectLocation,
  deriveLocationForEntity,
} from "../../src/utils/autodetect.js";
import {
  createHassWithRegistry,
  GPL_ATTRIBUTION,
  GPL_ATTRIBUTION_LEGACY,
} from "../helpers.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Run the real shared autodetect and return the picked integration id. */
function detect(hass: any) {
  return pickIntegration(detectIntegrationStates(hass));
}

/** Minimal hass mock. */
function mkHass(entityIds: any, opts: any = {}): any {
  const states: Record<string, any> = {};
  for (const id of entityIds) {
    states[id] = opts.stateObj?.[id] ?? { state: "0", attributes: {} };
  }
  return {
    states,
    entities: opts.entities || {},
  };
}

// ---------------------------------------------------------------------------
// Fixture factories — one representative entity per integration
// ---------------------------------------------------------------------------

const FIXTURES = {
  // PP city-mode sensor (has city suffix after allergen)
  pp: ["sensor.pollen_stockholm_bjork"],
  // PLU sensor (single underscore, known PLU allergen slug)
  plu: ["sensor.pollen_bouleau"],
  peu: ["sensor.polleninformation_birch_0"],
  dwd: ["sensor.pollenflug_erle_11"],
  silam: ["sensor.silam_pollen_birch_home"],
  kleenex: ["sensor.kleenex_pollen_radar_trees"],
  // ATMO needs to match the regex (pollen allergen, not a forecast day)
  atmo: ["sensor.niveau_bouleau_montpellier"],
  // GP (svenove/google_pollen): prefix fallback when no registry entry
  gp: ["sensor.google_pollen_grass"],
  // GPL uses entity registry platform check
  gpl: ["sensor.pollenlevels_grass"],
  // MSW: HA prefixes entity_id with the device name slug (e.g.
  // "meteoswiss_at_8000_klo"). Use a realistic prefixed shape so the
  // detection regex is exercised for the real-world case.
  msw: ["sensor.meteoswiss_at_8000_klo_pollen_birch_level_at_8000_pzh"],
  // IRM KMI: entity ids sensor.<location>_<allergen>_level; detection falls
  // back to the state regex when no irm_kmi platform entry is present.
  irmkmi: ["sensor.antwerp_birch_level"],
};

/** Entities entries for integrations that use hass.entities for detection. */
const ENTITY_FIXTURES = {
  silam_entities: {
    "sensor.silam_pollen_birch_home": {
      platform: "silam_pollen",
    },
  },
  gpl_entities: {
    "sensor.pollenlevels_grass": {
      platform: "pollenlevels",
    },
  },
};

/** Build a hass mock with sensors from the given integration keys. */
function hassWithIntegrations(...keys: any[]): any {
  const entityIds = [];
  const stateObj: Record<string, any> = {};
  let entities: Record<string, any> = {};

  for (const key of keys) {
    const ids = (FIXTURES as any)[key];
    if (!ids) throw new Error(`Unknown fixture key: ${key}`);
    entityIds.push(...ids);
    for (const id of ids) {
      stateObj[id] = { state: "1", attributes: {} };
    }

    // GPL uses attribution fallback when entities are not set
    if (key === "gpl") {
      for (const id of ids) {
        stateObj[id] = {
          state: "1",
          attributes: { attribution: GPL_ATTRIBUTION },
        };
      }
      entities = { ...entities, ...ENTITY_FIXTURES.gpl_entities };
    }

    // SILAM uses entities platform check
    if (key === "silam") {
      entities = { ...entities, ...ENTITY_FIXTURES.silam_entities };
    }
  }

  return mkHass(entityIds, { stateObj, entities });
}

// ---------------------------------------------------------------------------
// Unified autodetect (shared module)
// ---------------------------------------------------------------------------

describe("shared autodetect", () => {
  describe("single integration present", () => {
    it.each([
      ["pp", "pp"],
      ["plu", "plu"],
      ["peu", "peu"],
      ["dwd", "dwd"],
      ["silam", "silam"],
      ["kleenex", "kleenex"],
      ["atmo", "atmo"],
      ["gp", "gp"],
      ["gpl", "gpl"],
      ["msw", "msw"],
      ["irmkmi", "irmkmi"],
    ])("detects %s alone as %s", (fixture, expected) => {
      expect(detect(hassWithIntegrations(fixture))).toBe(expected);
    });
  });

  describe("precedence when multiple integrations present", () => {
    it("selects PP when all are present", () => {
      expect(
        detect(
          hassWithIntegrations(
            "pp",
            "plu",
            "peu",
            "dwd",
            "silam",
            "kleenex",
            "atmo",
            "gpl",
          ),
        ),
      ).toBe("pp");
    });

    it("selects PLU when PP is absent", () => {
      expect(
        detect(
          hassWithIntegrations(
            "plu",
            "peu",
            "dwd",
            "silam",
            "kleenex",
            "atmo",
            "gpl",
          ),
        ),
      ).toBe("plu");
    });

    it("selects PEU when PP and PLU are absent", () => {
      expect(
        detect(
          hassWithIntegrations("peu", "dwd", "silam", "kleenex", "atmo", "gpl"),
        ),
      ).toBe("peu");
    });

    it("selects DWD when PP, PLU, PEU are absent", () => {
      expect(
        detect(hassWithIntegrations("dwd", "silam", "kleenex", "atmo", "gpl")),
      ).toBe("dwd");
    });

    it("selects SILAM when PP, PLU, PEU, DWD are absent", () => {
      expect(
        detect(hassWithIntegrations("silam", "kleenex", "atmo", "gpl")),
      ).toBe("silam");
    });

    it("selects Kleenex when PP, PLU, PEU, DWD, SILAM are absent", () => {
      expect(detect(hassWithIntegrations("kleenex", "atmo", "gpl"))).toBe(
        "kleenex",
      );
    });

    it("selects ATMO when ATMO, GP, GPL, MSW are present", () => {
      expect(detect(hassWithIntegrations("atmo", "gp", "gpl", "msw"))).toBe(
        "atmo",
      );
    });

    it("selects GP over GPL and MSW", () => {
      expect(detect(hassWithIntegrations("gp", "gpl", "msw"))).toBe("gp");
    });

    it("selects GPL over MSW", () => {
      expect(detect(hassWithIntegrations("gpl", "msw"))).toBe("gpl");
    });

    it("detects ATMO via discovery for prefixed entity IDs", () => {
      // Multi-instance prefix: entity IDs don't match the legacy regex,
      // but tier 1 device-based discovery finds them.
      const eid = "sensor.toulouse_niveau_bouleau_toulouse";
      const hass = {
        states: { [eid]: { state: "2", attributes: {} } },
        entities: {
          [eid]: { platform: "atmofrance", device_id: "dev_toulouse" },
        },
        devices: {
          dev_toulouse: {
            name: "Atmo France",
            config_entries: ["entry_toulouse"],
            identifiers: [["atmofrance", "Test-Toulouse"]],
          },
        },
      };
      expect(detect(hass)).toBe("atmo");
    });

    it("selects GPL when only GPL is present", () => {
      expect(detect(hassWithIntegrations("gpl"))).toBe("gpl");
    });
  });

  it("returns undefined when no sensors present", () => {
    expect(detect(mkHass([]))).toBeUndefined();
  });

  describe("full precedence order PP > PLU > PEU > DWD > SILAM > Kleenex > ATMO > GP > GPL > MSW", () => {
    const order = [
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
    ];

    it("each integration wins over all that follow it", () => {
      for (let i = 0; i < order.length; i++) {
        const remaining = order.slice(i);
        expect(detect(hassWithIntegrations(...remaining))).toBe(order[i]);
      }
    });
  });

  describe("unified behaviour (former divergences)", () => {
    it("PLU is detected on every path (formerly missed by editor setConfig)", () => {
      expect(detect(hassWithIntegrations("plu"))).toBe("plu");
      // PLU alongside PEU still resolves to PLU (PLU outranks PEU).
      expect(detect(hassWithIntegrations("plu", "peu"))).toBe("plu");
    });

    it("Kleenex is detected on every path (formerly missed by editor set hass)", () => {
      expect(detect(hassWithIntegrations("kleenex"))).toBe("kleenex");
      // Kleenex outranks ATMO and GPL.
      expect(detect(hassWithIntegrations("kleenex", "atmo"))).toBe("kleenex");
      expect(detect(hassWithIntegrations("kleenex", "gpl"))).toBe("kleenex");
    });
  });
});

// ---------------------------------------------------------------------------
// PP / PLU disambiguation
// ---------------------------------------------------------------------------

describe("PP / PLU disambiguation", () => {
  it("known PLU allergen slug (no city suffix) goes to PLU", () => {
    // "bouleau" is a PLU alias for "birch"
    const hass = mkHass(["sensor.pollen_bouleau"]);
    expect(detect(hass)).toBe("plu");
  });

  it("city-mode sensor goes to PP", () => {
    const hass = mkHass(["sensor.pollen_stockholm_bjork"]);
    expect(detect(hass)).toBe("pp");
  });

  it("PP wins over PLU when both present", () => {
    const hass = mkHass([
      "sensor.pollen_stockholm_bjork",
      "sensor.pollen_bouleau",
    ]);
    expect(detect(hass)).toBe("pp");
  });

  describe("PLU canonical slugs are correctly identified", () => {
    const canonicalPluAllergens = Object.keys(PLU_ALIAS_MAP);

    it.each(canonicalPluAllergens)(
      "sensor.pollen_%s detected as PLU",
      (allergen) => {
        const hass = mkHass([`sensor.pollen_${allergen}`]);
        expect(detect(hass)).toBe("plu");
      },
    );
  });

  describe("PLU alias slugs are correctly identified", () => {
    const aliasSamples = [
      "rumex", // sorrel alias
      "artemisia", // mugwort alias
      "betula", // birch alias
      "corylus", // hazel alias
      "fraxinus", // ash alias
      "quercus", // oak alias
      "poacea", // poaceae alias (note: single 'a' variant)
      "plantago", // plantain alias
    ];

    it.each(aliasSamples)("sensor.pollen_%s detected as PLU", (slug) => {
      const hass = mkHass([`sensor.pollen_${slug}`]);
      expect(detect(hass)).toBe("plu");
    });
  });

  describe("unknown allergen with no city suffix goes to PP (not PLU)", () => {
    it("sensor.pollen_unknownallergen is PP", () => {
      const hass = mkHass(["sensor.pollen_unknownallergen"]);
      expect(detect(hass)).toBe("pp");
    });
  });
});

// ---------------------------------------------------------------------------
// MSW (hass-swissweather) detection
// ---------------------------------------------------------------------------

describe("MSW detection", () => {
  it("device-prefixed entity is detected as MSW", () => {
    const hass = mkHass([
      "sensor.meteoswiss_at_8000_klo_pollen_birch_level_at_8000_pzh",
      "sensor.meteoswiss_at_8000_klo_pollen_grasses_level_at_8000_pzh",
    ]);
    expect(detect(hass)).toBe("msw");
  });

  it("renamed device prefix is also detected as MSW", () => {
    const hass = mkHass(["sensor.bern_pollen_birch_level_at_3000_pbe"]);
    expect(detect(hass)).toBe("msw");
  });

  it("non-prefixed shape is also detected (legacy/no device-name path)", () => {
    const hass = mkHass(["sensor.pollen_birch_level_at_8000"]);
    expect(detect(hass)).toBe("msw");
  });

  it("MSW pattern is excluded from PP detection (no false PP hit)", () => {
    const hass = mkHass(["sensor.pollen_birch_level_at_8000"]);
    expect(detect(hass)).not.toBe("pp");
  });

  it("entity-registry platform check detects MSW even without state", () => {
    const hass = mkHass(["sensor.bern_pollen_birch_level_at_3000_pbe"], {
      entities: {
        "sensor.bern_pollen_birch_level_at_3000_pbe": {
          platform: "swissweather",
        },
      },
    });
    expect(detect(hass)).toBe("msw");
  });

  it("PP wins when both PP and MSW sensors are present", () => {
    const hass = mkHass([
      "sensor.pollen_stockholm_bjork",
      "sensor.bern_pollen_birch_level_at_3000_pbe",
    ]);
    expect(detect(hass)).toBe("pp");
  });
});

// ---------------------------------------------------------------------------
// pollenflug_ prefix exclusion from PP
// ---------------------------------------------------------------------------

describe("pollenflug_ prefix exclusion from PP", () => {
  it("sensor.pollenflug_ is excluded from PP detection (goes to DWD)", () => {
    const hass = mkHass(["sensor.pollenflug_erle_11"]);
    expect(detect(hass)).toBe("dwd");
  });

  it("sensor.pollenflug_ does not trigger PP even when only PP-like prefix matches", () => {
    const hass = mkHass(["sensor.pollenflug_hasel_11"]);
    expect(detect(hass)).toBe("dwd");
  });
});

// ---------------------------------------------------------------------------
// Kleenex detection / location resolution (issue #309)
//
// Since integration v1.6.1 the entity IDs follow the (renameable) device name,
// so a renamed device yields sensor.kleenex_pollen_* with neither the `radar_`
// prefix nor a location slug. Detection and location resolution must therefore
// go through registry discovery, with the legacy entity-ID paths as fallback.
// ---------------------------------------------------------------------------

describe("Kleenex detection with renamed devices (issue #309)", () => {
  /** One config entry / device whose entity IDs carry no location slug. */
  function renamedKleenexHass() {
    const deviceMeta = {
      name: "Kleenex Pollen Radar (Home)",
      identifiers: [["kleenex_pollenradar", "Home"] as [string, string]],
      configEntries: ["entry_home"],
    };
    return createHassWithRegistry([
      {
        entityId: "sensor.kleenex_pollen_trees",
        state: "200",
        platform: "kleenex_pollenradar",
        translationKey: "trees",
        deviceId: "dev_home",
        deviceMeta,
      },
      {
        entityId: "sensor.kleenex_pollen_grass",
        state: "100",
        platform: "kleenex_pollenradar",
        translationKey: "grass",
        deviceId: "dev_home",
      },
      {
        entityId: "sensor.kleenex_pollen_last_updated",
        state: "2026-04-25T10:00:00+00:00",
        platform: "kleenex_pollenradar",
        translationKey: "last_updated",
        deviceId: "dev_home",
      },
    ]);
  }

  it("detects Kleenex from the registry when no entity ID carries the prefix", () => {
    expect(detect(renamedKleenexHass())).toBe("kleenex");
  });

  it("auto-selects the discovered location (config entry key)", () => {
    const hass = renamedKleenexHass();
    const detection = detectIntegrationStates(hass);
    expect(autoSelectLocation("kleenex", {}, hass, detection)).toEqual({
      key: "location",
      value: "home",
    });
  });

  it("derives the location of a specific renamed entity", () => {
    const hass = renamedKleenexHass();
    const detection = detectIntegrationStates(hass);
    expect(
      deriveLocationForEntity(
        "kleenex",
        "sensor.kleenex_pollen_grass",
        hass,
        detection,
      ),
    ).toEqual({ key: "location", value: "home" });
  });

  it("offers no derivation for a diagnostic sensor", () => {
    const hass = renamedKleenexHass();
    const detection = detectIntegrationStates(hass);
    expect(
      deriveLocationForEntity(
        "kleenex",
        "sensor.kleenex_pollen_last_updated",
        hass,
        detection,
      ),
    ).toBeNull();
  });

  // Codex round 14: without a registry, the fallback rejected only
  // date/last_updated/region, so HA's "suggest a card" flow advertised a pollen
  // card for latitude/longitude/city/error and the *_level enums.
  it("offers no derivation for legacy diagnostic helpers", () => {
    const hass = mkHass([
      "sensor.kleenex_pollen_radar_home_trees",
      "sensor.kleenex_pollen_radar_home_trees_level",
      "sensor.kleenex_pollen_radar_home_latitude",
      "sensor.kleenex_pollen_radar_home_longitude",
      "sensor.kleenex_pollen_radar_home_city",
      "sensor.kleenex_pollen_radar_home_error",
      "sensor.kleenex_pollen_radar_home_date",
    ]);
    const detection = detectIntegrationStates(hass);

    for (const id of [
      "sensor.kleenex_pollen_radar_home_trees_level",
      "sensor.kleenex_pollen_radar_home_latitude",
      "sensor.kleenex_pollen_radar_home_longitude",
      "sensor.kleenex_pollen_radar_home_city",
      "sensor.kleenex_pollen_radar_home_error",
      "sensor.kleenex_pollen_radar_home_date",
    ]) {
      expect(
        deriveLocationForEntity("kleenex", id, hass, detection),
      ).toBeNull();
    }

    // The category sensor still derives its location.
    expect(
      deriveLocationForEntity(
        "kleenex",
        "sensor.kleenex_pollen_radar_home_trees",
        hass,
        detection,
      ),
    ).toEqual({ key: "location", value: "home" });
  });

  it("keeps the legacy slug for registry-less installs", () => {
    const hass = mkHass([
      "sensor.kleenex_pollen_radar_utrecht_trees",
      "sensor.kleenex_pollen_radar_utrecht_date",
    ]);
    const detection = detectIntegrationStates(hass);
    expect(pickIntegration(detection)).toBe("kleenex");
    expect(autoSelectLocation("kleenex", {}, hass, detection)).toEqual({
      key: "location",
      value: "utrecht",
    });
  });
});

// ---------------------------------------------------------------------------
// SILAM detection paths
// ---------------------------------------------------------------------------

describe("SILAM detection via entity registry vs prefix fallback", () => {
  it("detects SILAM via registry discovery (device + platform)", () => {
    // Realistic registry setup: discoverSilamSensors() walks hass.entities by
    // platform and resolves the device. A bare registry entry with no device
    // and no state is not a real SILAM install and is intentionally not
    // detected (it only ever matched the old test shim).
    const sensorId = "sensor.silam_pollen_birch_home";
    const hass = mkHass([sensorId], {
      stateObj: { [sensorId]: { state: "1", attributes: {} } },
      entities: {
        [sensorId]: {
          entity_id: sensorId,
          platform: "silam_pollen",
          device_id: "dev_home",
          entity_category: null,
          translation_key: "birch",
        },
      },
    });
    hass.devices = {
      dev_home: { name: "Home", config_entries: ["entry_home"] },
    };
    expect(detect(hass)).toBe("silam");
  });

  it("detects SILAM via sensor prefix fallback when no entities", () => {
    const hass = mkHass(["sensor.silam_pollen_birch_home"], {
      entities: {},
    });
    expect(detect(hass)).toBe("silam");
  });

  it("detects a weather-only SILAM install (no allergen sensors)", () => {
    // SILAM can be configured with only the weather entity (allergy_risk
    // index); the weather entity counts as evidence so it still autodetects.
    const weatherId = "weather.silam_pollen_home_forecast";
    const hass = mkHass([weatherId], {
      stateObj: { [weatherId]: { state: "sunny", attributes: {} } },
      entities: {
        [weatherId]: {
          entity_id: weatherId,
          platform: "silam_pollen",
          device_id: "dev_home",
          translation_key: "forecast",
        },
      },
    });
    hass.devices = {
      dev_home: { name: "Home", config_entries: ["entry_home"] },
    };
    expect(detect(hass)).toBe("silam");
  });

  it("entity_category entries are excluded from SILAM entity detection", () => {
    const hass = mkHass([], {
      entities: {
        "sensor.silam_diagnostic": {
          platform: "silam_pollen",
          entity_category: "diagnostic",
        },
      },
    });
    expect(detect(hass)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GPL detection paths
// ---------------------------------------------------------------------------

describe("GPL detection via entity registry vs attribution fallback", () => {
  it("detects GPL via hass.entities platform check", () => {
    const hass = mkHass([], {
      entities: {
        "sensor.pollenlevels_grass": {
          platform: "pollenlevels",
        },
      },
    });
    expect(detect(hass)).toBe("gpl");
  });

  it("detects GPL via attribution fallback when no entities", () => {
    const hass = mkHass(["sensor.pollenlevels_grass"], {
      entities: {},
      stateObj: {
        "sensor.pollenlevels_grass": {
          state: "1",
          attributes: { attribution: GPL_ATTRIBUTION },
        },
      },
    });
    expect(detect(hass)).toBe("gpl");
  });

  it("GPL date/timestamp sensors are excluded from attribution fallback", () => {
    const hass = mkHass(["sensor.pollenlevels_update_time"], {
      entities: {},
      stateObj: {
        "sensor.pollenlevels_update_time": {
          state: "2024-01-01",
          attributes: {
            attribution: GPL_ATTRIBUTION,
            device_class: "timestamp",
          },
        },
      },
    });
    expect(detect(hass)).toBeUndefined();
  });

  it("detects GPL via the legacy attribution string (pollenlevels <= 3.0.0rc2)", () => {
    const hass = mkHass(["sensor.pollenlevels_grass"], {
      entities: {},
      stateObj: {
        "sensor.pollenlevels_grass": {
          state: "1",
          attributes: { attribution: GPL_ATTRIBUTION_LEGACY },
        },
      },
    });
    expect(detect(hass)).toBe("gpl");
  });

  // GP publishes no attribution today; the id exclusion keeps a future
  // upstream addition from making GP sensors look like GPL ones (#338).
  it("sensor.google_pollen_* is never detected as GPL via attribution", () => {
    const hass = mkHass(["sensor.google_pollen_grass"], {
      entities: {},
      stateObj: {
        "sensor.google_pollen_grass": {
          state: "1",
          attributes: { attribution: GPL_ATTRIBUTION },
        },
      },
    });
    // GP's own detector still claims the entity; what must not happen is the
    // GPL detector adopting it.
    expect(detectedIntegrationIds(detectIntegrationStates(hass))).not.toContain(
      "gpl",
    );
    expect(detect(hass)).toBe("gp");
  });

  it("entity_category entries are excluded from GPL entity detection", () => {
    const hass = mkHass([], {
      entities: {
        "sensor.pollenlevels_diagnostic": {
          platform: "pollenlevels",
          entity_category: "diagnostic",
        },
      },
    });
    expect(detect(hass)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ATMO detection specifics
// ---------------------------------------------------------------------------

describe("ATMO detection", () => {
  it("detects ATMO via pollen sensor (niveau_bouleau)", () => {
    const hass = mkHass(["sensor.niveau_bouleau_montpellier"]);
    expect(detect(hass)).toBe("atmo");
  });

  it("detects ATMO via pollution sensor (pm25)", () => {
    const hass = mkHass(["sensor.pm25_montpellier"]);
    expect(detect(hass)).toBe("atmo");
  });

  it("excludes forecast day entities (_j_N suffix)", () => {
    const hass = mkHass(["sensor.niveau_bouleau_montpellier_j_1"]);
    expect(detect(hass)).toBeUndefined();
  });

  it.each([
    "sensor.niveau_ambroisie_lyon",
    "sensor.niveau_armoise_paris",
    "sensor.niveau_aulne_marseille",
    "sensor.niveau_bouleau_lille",
    "sensor.niveau_gramine_bordeaux",
    "sensor.niveau_olivier_nice",
  ])("all six ATMO pollen allergens are detected: %s", (id) => {
    const hass = mkHass([id]);
    expect(detect(hass)).toBe("atmo");
  });

  it("detects ATMO via discovery for prefixed entity IDs", () => {
    const eid = "sensor.toulouse_niveau_bouleau_toulouse";
    const hass = {
      states: { [eid]: { state: "2", attributes: {} } },
      entities: {
        [eid]: { platform: "atmofrance", device_id: "dev_toulouse" },
      },
      devices: {
        dev_toulouse: {
          name: "Atmo France",
          config_entries: ["entry_toulouse"],
          identifiers: [["atmofrance", "Test-Toulouse"]],
        },
      },
    };
    expect(detect(hass)).toBe("atmo");
  });

  it("qualite_globale pollution sensor is detected as ATMO", () => {
    const hass = mkHass(["sensor.qualite_globale_montpellier"]);
    expect(detect(hass)).toBe("atmo");
  });
});

// ---------------------------------------------------------------------------
// Badge picker (getStubConfig) integration choice
//
// PollenPrognosBadge.getStubConfig(hass) is a LitElement static method we
// cannot import in the node test environment (no customElements), so we assert
// the pick it relies on. The stub pins `integration` ONLY when one is detected;
// when nothing is detected or hass is absent it omits the key (so the present-
// integration => user-pin heuristic doesn't suppress autodetect later).
// ---------------------------------------------------------------------------

describe("badge picker integration choice (getStubConfig logic)", () => {
  const pickStub = (hass: any) =>
    pickIntegration(detectIntegrationStates(hass), { explicit: false });

  it("pins the detected integration (e.g. DWD), not always pp", () => {
    expect(pickStub(hassWithIntegrations("dwd"))).toBe("dwd");
  });

  it("omits integration when nothing is installed (autodetect later)", () => {
    expect(pickStub(mkHass([]))).toBeUndefined();
  });

  it("detectIntegrationStates tolerates an empty hass", () => {
    const detection = detectIntegrationStates({
      states: {},
      entities: {},
    } as any);
    expect(detectedIntegrationIds(detection).size).toBe(0);
  });
});
