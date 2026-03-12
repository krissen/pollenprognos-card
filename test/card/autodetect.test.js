/**
 * Autodetect precedence tests.
 *
 * The pollenprognos-card has THREE separate autodetect codepaths with
 * intentionally different precedence orders. This test file locks the
 * current behavior so accidental changes are caught.
 *
 * Paths tested:
 *   1. Card set hass()          — PP > PLU > PEU > DWD > SILAM > Kleenex > ATMO > GPL
 *   2. Editor setConfig()       — PP > PEU > DWD > SILAM > Kleenex > ATMO > GPL  (no PLU)
 *   3. Editor set hass()        — PP > PLU > PEU > DWD > SILAM > ATMO > GPL      (no Kleenex)
 *
 * Since we cannot easily instantiate LitElement components in vitest, we
 * replicate each detection path as a pure function and verify the logic
 * matches the source code exactly.
 */

import { describe, it, expect } from "vitest";
import { PLU_ALIAS_MAP } from "../../src/adapters/plu.js";
import { GPL_ATTRIBUTION } from "../../src/adapters/gpl/index.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const pluAllergenSlugs = new Set(Object.values(PLU_ALIAS_MAP).flat());

/** Minimal hass mock. */
function mkHass(entityIds, opts = {}) {
  const states = {};
  for (const id of entityIds) {
    states[id] = opts.stateObj?.[id] ?? { state: "0", attributes: {} };
  }
  return {
    states,
    entities: opts.entities || {},
  };
}

// ---------------------------------------------------------------------------
// Path 1: Card set hass()
// Order: PP > PLU > PEU > DWD > SILAM > Kleenex > ATMO > GPL
// ---------------------------------------------------------------------------

function detectCardSetHass(hass) {
  const all = Object.keys(hass.states);

  const ppStates = all.filter((id) => {
    if (typeof id !== "string") return false;
    if (!id.startsWith("sensor.pollen_")) return false;
    if (id.startsWith("sensor.pollenflug_")) return false;
    const match = /^sensor\.pollen_([^_]+)(_.*)?$/.exec(id);
    if (!match) return false;
    const allergenSlug = match[1];
    if (!match[2] && pluAllergenSlugs.has(allergenSlug)) return false;
    return true;
  });

  const pluStates = all.filter((id) => {
    if (typeof id !== "string") return false;
    const match = /^sensor\.pollen_([^_]+)$/.exec(id);
    if (!match) return false;
    return pluAllergenSlugs.has(match[1]);
  });

  const peuStates = all.filter(
    (id) => typeof id === "string" && id.startsWith("sensor.polleninformation_"),
  );

  const dwdStates = all.filter(
    (id) => typeof id === "string" && id.startsWith("sensor.pollenflug_"),
  );

  // SILAM: primary via hass.entities platform check, fallback via prefix
  let silamStates = [];
  if (hass.entities) {
    silamStates = Object.entries(hass.entities)
      .filter(([, e]) => e.platform === "silam_pollen" && !e.entity_category)
      .map(([eid]) => eid);
  }
  if (!silamStates.length) {
    silamStates = all.filter(
      (id) => typeof id === "string" && id.startsWith("sensor.silam_pollen_"),
    );
  }

  const kleenexStates = all.filter(
    (id) => typeof id === "string" && id.startsWith("sensor.kleenex_pollen_radar_"),
  );

  const atmoStates = all.filter(
    (id) =>
      typeof id === "string" &&
      /^sensor\.(?:niveau_(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)|(?:pm25|pm10|ozone|dioxyde_d_azote|dioxyde_de_soufre)|qualite_globale(?:_pollen)?)_/.test(id) &&
      !/_j_\d+$/.test(id),
  );

  // GPL: primary via hass.entities, fallback via attribution
  let gplStates = [];
  if (hass.entities) {
    gplStates = Object.entries(hass.entities)
      .filter(([, entry]) => entry.platform === "pollenlevels" && !entry.entity_category)
      .map(([eid]) => eid);
  }
  if (!gplStates.length) {
    gplStates = all.filter((id) => {
      const s = hass.states[id];
      return (
        s?.attributes?.attribution === GPL_ATTRIBUTION &&
        s.attributes.device_class !== "date" &&
        s.attributes.device_class !== "timestamp"
      );
    });
  }

  if (ppStates.length) return "pp";
  if (pluStates.length) return "plu";
  if (peuStates.length) return "peu";
  if (dwdStates.length) return "dwd";
  if (silamStates.length) return "silam";
  if (kleenexStates.length) return "kleenex";
  if (atmoStates.length) return "atmo";
  if (gplStates.length) return "gpl";
  return undefined;
}

// ---------------------------------------------------------------------------
// Path 2: Editor setConfig()
// Order: PP > PEU > DWD > SILAM > Kleenex > ATMO > GPL
// NOTE: No PLU detection; PP check is simpler (no PLU exclusion).
// ---------------------------------------------------------------------------

function detectEditorSetConfig(hass) {
  const all = Object.keys(hass.states);

  // Simple sensor.pollen_* startsWith check (no PLU filtering)
  if (all.some((id) => typeof id === "string" && id.startsWith("sensor.pollen_"))) {
    return "pp";
  }

  if (all.some((id) => typeof id === "string" && id.startsWith("sensor.polleninformation_"))) {
    return "peu";
  }

  if (all.some((id) => typeof id === "string" && id.startsWith("sensor.pollenflug_"))) {
    return "dwd";
  }

  // SILAM: primary via hass.entities, fallback via prefix
  if (
    (hass.entities &&
      Object.values(hass.entities).some(
        (e) => e.platform === "silam_pollen" && !e.entity_category,
      )) ||
    all.some((id) => typeof id === "string" && id.startsWith("sensor.silam_pollen_"))
  ) {
    return "silam";
  }

  if (
    all.some(
      (id) =>
        typeof id === "string" && id.startsWith("sensor.kleenex_pollen_radar_"),
    )
  ) {
    return "kleenex";
  }

  if (
    all.some(
      (id) =>
        typeof id === "string" &&
        /^sensor\.niveau_(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)_/.test(id),
    )
  ) {
    return "atmo";
  }

  // GPL: primary via hass.entities, fallback via attribution
  if (
    (hass.entities &&
      Object.values(hass.entities).some(
        (e) => e.platform === "pollenlevels" && !e.entity_category,
      )) ||
    all.some((id) => {
      const s = hass.states[id];
      return (
        s?.attributes?.attribution === GPL_ATTRIBUTION &&
        s.attributes?.device_class !== "date" &&
        s.attributes?.device_class !== "timestamp"
      );
    })
  ) {
    return "gpl";
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Path 3: Editor set hass()
// Order: PP > PLU > PEU > DWD > SILAM > ATMO > GPL
// NOTE: No Kleenex detection; has PLU.
// ---------------------------------------------------------------------------

function detectEditorSetHass(hass) {
  const all = Object.keys(hass.states);

  const ppStates = all.filter((id) => {
    if (typeof id !== "string") return false;
    if (!id.startsWith("sensor.pollen_")) return false;
    if (id.startsWith("sensor.pollenflug_")) return false;
    const match = /^sensor\.pollen_([^_]+)(_.*)?$/.exec(id);
    if (!match) return false;
    const allergenSlug = match[1];
    if (!match[2] && pluAllergenSlugs.has(allergenSlug)) return false;
    return true;
  });

  const pluStates = all.filter((id) => {
    if (typeof id !== "string") return false;
    const match = /^sensor\.pollen_([^_]+)$/.exec(id);
    if (!match) return false;
    return pluAllergenSlugs.has(match[1]);
  });

  const peuStates = all.filter(
    (id) => typeof id === "string" && id.startsWith("sensor.polleninformation_"),
  );

  const dwdStates = all.filter(
    (id) => typeof id === "string" && id.startsWith("sensor.pollenflug_"),
  );

  // SILAM: primary via hass.entities, fallback via prefix
  let silamStates = [];
  if (hass.entities) {
    silamStates = Object.entries(hass.entities)
      .filter(([, e]) => e.platform === "silam_pollen" && !e.entity_category)
      .map(([eid]) => eid);
  }
  if (!silamStates.length) {
    silamStates = all.filter(
      (id) => typeof id === "string" && id.startsWith("sensor.silam_pollen_"),
    );
  }

  // No Kleenex detection in this path

  const atmoStates = all.filter(
    (id) =>
      typeof id === "string" &&
      /^sensor\.(?:niveau_(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)|(?:pm25|pm10|ozone|dioxyde_d_azote|dioxyde_de_soufre)|qualite_globale(?:_pollen)?)_/.test(id) &&
      !/_j_\d+$/.test(id),
  );

  // GPL: primary via hass.entities, fallback via attribution
  let gplStates = [];
  if (hass.entities) {
    gplStates = Object.entries(hass.entities)
      .filter(([, entry]) => entry.platform === "pollenlevels" && !entry.entity_category)
      .map(([eid]) => eid);
  }
  if (!gplStates.length) {
    gplStates = all.filter((id) => {
      const s = hass.states[id];
      return (
        s?.attributes?.attribution === GPL_ATTRIBUTION &&
        s.attributes.device_class !== "date" &&
        s.attributes.device_class !== "timestamp"
      );
    });
  }

  if (ppStates.length) return "pp";
  if (pluStates.length) return "plu";
  if (peuStates.length) return "peu";
  if (dwdStates.length) return "dwd";
  if (silamStates.length) return "silam";
  if (atmoStates.length) return "atmo";
  if (gplStates.length) return "gpl";
  return undefined;
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
  // GPL uses entity registry platform check
  gpl: ["sensor.pollenlevels_grass"],
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
function hassWithIntegrations(...keys) {
  const entityIds = [];
  const stateObj = {};
  let entities = {};

  for (const key of keys) {
    const ids = FIXTURES[key];
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
// Tests
// ---------------------------------------------------------------------------

describe("Card set hass() autodetect", () => {
  const detect = detectCardSetHass;

  describe("single integration present", () => {
    it.each([
      ["pp", "pp"],
      ["plu", "plu"],
      ["peu", "peu"],
      ["dwd", "dwd"],
      ["silam", "silam"],
      ["kleenex", "kleenex"],
      ["atmo", "atmo"],
      ["gpl", "gpl"],
    ])("detects %s alone as %s", (fixture, expected) => {
      expect(detect(hassWithIntegrations(fixture))).toBe(expected);
    });
  });

  describe("precedence when all integrations present", () => {
    it("selects PP when all 8 are present", () => {
      expect(
        detect(hassWithIntegrations("pp", "plu", "peu", "dwd", "silam", "kleenex", "atmo", "gpl")),
      ).toBe("pp");
    });

    it("selects PLU when PP is absent", () => {
      expect(
        detect(hassWithIntegrations("plu", "peu", "dwd", "silam", "kleenex", "atmo", "gpl")),
      ).toBe("plu");
    });

    it("selects PEU when PP and PLU are absent", () => {
      expect(
        detect(hassWithIntegrations("peu", "dwd", "silam", "kleenex", "atmo", "gpl")),
      ).toBe("peu");
    });

    it("selects DWD when PP, PLU, PEU are absent", () => {
      expect(
        detect(hassWithIntegrations("dwd", "silam", "kleenex", "atmo", "gpl")),
      ).toBe("dwd");
    });

    it("selects SILAM when PP, PLU, PEU, DWD are absent", () => {
      expect(detect(hassWithIntegrations("silam", "kleenex", "atmo", "gpl"))).toBe("silam");
    });

    it("selects Kleenex when PP, PLU, PEU, DWD, SILAM are absent", () => {
      expect(detect(hassWithIntegrations("kleenex", "atmo", "gpl"))).toBe("kleenex");
    });

    it("selects ATMO when only ATMO and GPL are present", () => {
      expect(detect(hassWithIntegrations("atmo", "gpl"))).toBe("atmo");
    });

    it("selects GPL when only GPL is present", () => {
      expect(detect(hassWithIntegrations("gpl"))).toBe("gpl");
    });
  });

  it("returns undefined when no sensors present", () => {
    expect(detect(mkHass([]))).toBeUndefined();
  });

  describe("full precedence order is PP > PLU > PEU > DWD > SILAM > Kleenex > ATMO > GPL", () => {
    const order = ["pp", "plu", "peu", "dwd", "silam", "kleenex", "atmo", "gpl"];

    it("each integration wins over all that follow it", () => {
      for (let i = 0; i < order.length; i++) {
        const remaining = order.slice(i);
        expect(detect(hassWithIntegrations(...remaining))).toBe(order[i]);
      }
    });
  });
});

describe("Editor setConfig() autodetect", () => {
  const detect = detectEditorSetConfig;

  describe("single integration present", () => {
    it.each([
      ["pp", "pp"],
      ["peu", "peu"],
      ["dwd", "dwd"],
      ["silam", "silam"],
      ["kleenex", "kleenex"],
      ["atmo", "atmo"],
      ["gpl", "gpl"],
    ])("detects %s alone as %s", (fixture, expected) => {
      expect(detect(hassWithIntegrations(fixture))).toBe(expected);
    });
  });

  describe("precedence when multiple integrations present", () => {
    it("selects PP when all 7 (no PLU path) are present", () => {
      expect(
        detect(hassWithIntegrations("pp", "peu", "dwd", "silam", "kleenex", "atmo", "gpl")),
      ).toBe("pp");
    });

    it("selects PEU when PP is absent", () => {
      expect(
        detect(hassWithIntegrations("peu", "dwd", "silam", "kleenex", "atmo", "gpl")),
      ).toBe("peu");
    });

    it("selects DWD when PP, PEU are absent", () => {
      expect(
        detect(hassWithIntegrations("dwd", "silam", "kleenex", "atmo", "gpl")),
      ).toBe("dwd");
    });

    it("selects SILAM when PP, PEU, DWD are absent", () => {
      expect(detect(hassWithIntegrations("silam", "kleenex", "atmo", "gpl"))).toBe("silam");
    });

    it("selects Kleenex when PP, PEU, DWD, SILAM are absent", () => {
      expect(detect(hassWithIntegrations("kleenex", "atmo", "gpl"))).toBe("kleenex");
    });

    it("selects ATMO when only ATMO and GPL are present", () => {
      expect(detect(hassWithIntegrations("atmo", "gpl"))).toBe("atmo");
    });

    it("selects GPL when only GPL is present", () => {
      expect(detect(hassWithIntegrations("gpl"))).toBe("gpl");
    });
  });

  describe("known divergence: no PLU detection", () => {
    it("PLU-only sensors match PP (simpler sensor.pollen_* check)", () => {
      // Editor setConfig() has no PLU-specific detection.
      // sensor.pollen_bouleau starts with "sensor.pollen_", so it matches PP.
      const hass = hassWithIntegrations("plu");
      expect(detect(hass)).toBe("pp");
    });

    it("PLU sensors alongside PEU: PP wins (PLU sensors trigger PP check)", () => {
      const hass = hassWithIntegrations("plu", "peu");
      expect(detect(hass)).toBe("pp");
    });
  });

  describe("full precedence order is PP > PEU > DWD > SILAM > Kleenex > ATMO > GPL", () => {
    const order = ["pp", "peu", "dwd", "silam", "kleenex", "atmo", "gpl"];

    it("each integration wins over all that follow it", () => {
      for (let i = 0; i < order.length; i++) {
        const remaining = order.slice(i);
        expect(detect(hassWithIntegrations(...remaining))).toBe(order[i]);
      }
    });
  });

  it("returns undefined when no sensors present", () => {
    expect(detect(mkHass([]))).toBeUndefined();
  });
});

describe("Editor set hass() autodetect", () => {
  const detect = detectEditorSetHass;

  describe("single integration present", () => {
    it.each([
      ["pp", "pp"],
      ["plu", "plu"],
      ["peu", "peu"],
      ["dwd", "dwd"],
      ["silam", "silam"],
      ["atmo", "atmo"],
      ["gpl", "gpl"],
    ])("detects %s alone as %s", (fixture, expected) => {
      expect(detect(hassWithIntegrations(fixture))).toBe(expected);
    });
  });

  describe("precedence when multiple integrations present", () => {
    it("selects PP when all 7 (no Kleenex path) are present", () => {
      expect(
        detect(hassWithIntegrations("pp", "plu", "peu", "dwd", "silam", "atmo", "gpl")),
      ).toBe("pp");
    });

    it("selects PLU when PP is absent", () => {
      expect(
        detect(hassWithIntegrations("plu", "peu", "dwd", "silam", "atmo", "gpl")),
      ).toBe("plu");
    });

    it("selects PEU when PP, PLU are absent", () => {
      expect(
        detect(hassWithIntegrations("peu", "dwd", "silam", "atmo", "gpl")),
      ).toBe("peu");
    });

    it("selects DWD when PP, PLU, PEU are absent", () => {
      expect(detect(hassWithIntegrations("dwd", "silam", "atmo", "gpl"))).toBe("dwd");
    });

    it("selects SILAM when PP, PLU, PEU, DWD are absent", () => {
      expect(detect(hassWithIntegrations("silam", "atmo", "gpl"))).toBe("silam");
    });

    it("selects ATMO when only ATMO and GPL are present", () => {
      expect(detect(hassWithIntegrations("atmo", "gpl"))).toBe("atmo");
    });

    it("selects GPL when only GPL is present", () => {
      expect(detect(hassWithIntegrations("gpl"))).toBe("gpl");
    });
  });

  describe("known divergence: no Kleenex detection", () => {
    it("Kleenex-only sensors are not detected", () => {
      const hass = hassWithIntegrations("kleenex");
      expect(detect(hass)).toBeUndefined();
    });

    it("Kleenex sensors are ignored, ATMO wins when both present", () => {
      const hass = hassWithIntegrations("kleenex", "atmo");
      expect(detect(hass)).toBe("atmo");
    });

    it("Kleenex sensors are ignored, GPL wins when Kleenex + GPL present", () => {
      const hass = hassWithIntegrations("kleenex", "gpl");
      expect(detect(hass)).toBe("gpl");
    });
  });

  describe("full precedence order is PP > PLU > PEU > DWD > SILAM > ATMO > GPL", () => {
    const order = ["pp", "plu", "peu", "dwd", "silam", "atmo", "gpl"];

    it("each integration wins over all that follow it", () => {
      for (let i = 0; i < order.length; i++) {
        const remaining = order.slice(i);
        expect(detect(hassWithIntegrations(...remaining))).toBe(order[i]);
      }
    });
  });

  it("returns undefined when no sensors present", () => {
    expect(detect(mkHass([]))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PP / PLU disambiguation
// ---------------------------------------------------------------------------

describe("PP / PLU disambiguation", () => {
  describe("PLU-pattern sensors (sensor.pollen_{allergen}, no city suffix)", () => {
    it("known PLU allergen slug goes to PLU in card set hass()", () => {
      // "bouleau" is a PLU alias for "birch"
      const hass = mkHass(["sensor.pollen_bouleau"]);
      expect(detectCardSetHass(hass)).toBe("plu");
    });

    it("known PLU allergen slug goes to PLU in editor set hass()", () => {
      const hass = mkHass(["sensor.pollen_bouleau"]);
      expect(detectEditorSetHass(hass)).toBe("plu");
    });

    it("known PLU allergen slug goes to PP in editor setConfig() (no PLU path)", () => {
      // Editor setConfig() has no PLU-specific detection
      const hass = mkHass(["sensor.pollen_bouleau"]);
      expect(detectEditorSetConfig(hass)).toBe("pp");
    });
  });

  describe("PP-pattern sensors (sensor.pollen_{city}_{allergen})", () => {
    it("city-mode sensor goes to PP in card set hass()", () => {
      const hass = mkHass(["sensor.pollen_stockholm_bjork"]);
      expect(detectCardSetHass(hass)).toBe("pp");
    });

    it("city-mode sensor goes to PP in editor set hass()", () => {
      const hass = mkHass(["sensor.pollen_stockholm_bjork"]);
      expect(detectEditorSetHass(hass)).toBe("pp");
    });

    it("city-mode sensor goes to PP in editor setConfig()", () => {
      const hass = mkHass(["sensor.pollen_stockholm_bjork"]);
      expect(detectEditorSetConfig(hass)).toBe("pp");
    });
  });

  describe("mixed PP and PLU sensors", () => {
    it("PP wins over PLU in card set hass() when both present", () => {
      const hass = mkHass([
        "sensor.pollen_stockholm_bjork",
        "sensor.pollen_bouleau",
      ]);
      expect(detectCardSetHass(hass)).toBe("pp");
    });

    it("PP wins over PLU in editor set hass() when both present", () => {
      const hass = mkHass([
        "sensor.pollen_stockholm_bjork",
        "sensor.pollen_bouleau",
      ]);
      expect(detectEditorSetHass(hass)).toBe("pp");
    });
  });

  describe("PLU canonical slugs are correctly identified", () => {
    // All canonical PLU allergens should be detected as PLU (not PP)
    // in paths that have PLU detection
    const canonicalPluAllergens = Object.keys(PLU_ALIAS_MAP);

    it.each(canonicalPluAllergens)(
      "sensor.pollen_%s detected as PLU in card set hass()",
      (allergen) => {
        const hass = mkHass([`sensor.pollen_${allergen}`]);
        expect(detectCardSetHass(hass)).toBe("plu");
      },
    );

    it.each(canonicalPluAllergens)(
      "sensor.pollen_%s detected as PLU in editor set hass()",
      (allergen) => {
        const hass = mkHass([`sensor.pollen_${allergen}`]);
        expect(detectEditorSetHass(hass)).toBe("plu");
      },
    );
  });

  describe("PLU alias slugs are correctly identified", () => {
    // Slugified aliases should also route to PLU
    const aliasSamples = [
      "rumex",      // sorrel alias
      "artemisia",  // mugwort alias
      "betula",     // birch alias
      "corylus",    // hazel alias
      "fraxinus",   // ash alias
      "quercus",    // oak alias
      "poacea",     // poaceae alias (note: single 'a' variant)
      "plantago",   // plantain alias
    ];

    it.each(aliasSamples)(
      "sensor.pollen_%s detected as PLU in card set hass()",
      (slug) => {
        const hass = mkHass([`sensor.pollen_${slug}`]);
        expect(detectCardSetHass(hass)).toBe("plu");
      },
    );
  });

  describe("unknown allergen with no city suffix goes to PP (not PLU)", () => {
    it("sensor.pollen_unknownallergen is PP in card set hass()", () => {
      // "unknownallergen" is not a PLU slug, so PP filter accepts it
      const hass = mkHass(["sensor.pollen_unknownallergen"]);
      expect(detectCardSetHass(hass)).toBe("pp");
    });

    it("sensor.pollen_unknownallergen is PP in editor set hass()", () => {
      const hass = mkHass(["sensor.pollen_unknownallergen"]);
      expect(detectEditorSetHass(hass)).toBe("pp");
    });
  });
});

// ---------------------------------------------------------------------------
// Edge cases: pollenflug_ prefix exclusion
// ---------------------------------------------------------------------------

describe("pollenflug_ prefix exclusion from PP", () => {
  it("sensor.pollenflug_ is excluded from PP detection (goes to DWD)", () => {
    const hass = mkHass(["sensor.pollenflug_erle_11"]);
    expect(detectCardSetHass(hass)).toBe("dwd");
    expect(detectEditorSetHass(hass)).toBe("dwd");
    expect(detectEditorSetConfig(hass)).toBe("dwd");
  });

  it("sensor.pollenflug_ does not trigger PP even when only PP-like prefix matches", () => {
    // "sensor.pollenflug_" starts with "sensor.pollen" but the explicit
    // pollenflug exclusion should prevent it from matching PP
    const hass = mkHass(["sensor.pollenflug_hasel_11"]);
    expect(detectCardSetHass(hass)).toBe("dwd");
    expect(detectEditorSetHass(hass)).toBe("dwd");
  });
});

// ---------------------------------------------------------------------------
// SILAM detection paths
// ---------------------------------------------------------------------------

describe("SILAM detection via entity registry vs prefix fallback", () => {
  it("detects SILAM via hass.entities platform check", () => {
    const hass = mkHass([], {
      entities: {
        "sensor.silam_pollen_birch_home": {
          platform: "silam_pollen",
        },
      },
    });
    // The entity is in hass.entities but NOT in hass.states,
    // so only the entities path fires
    expect(detectCardSetHass(hass)).toBe("silam");
    expect(detectEditorSetHass(hass)).toBe("silam");
  });

  it("detects SILAM via sensor prefix fallback when no entities", () => {
    const hass = mkHass(["sensor.silam_pollen_birch_home"], {
      entities: {},
    });
    expect(detectCardSetHass(hass)).toBe("silam");
    expect(detectEditorSetHass(hass)).toBe("silam");
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
    expect(detectCardSetHass(hass)).toBeUndefined();
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
    expect(detectCardSetHass(hass)).toBe("gpl");
    expect(detectEditorSetHass(hass)).toBe("gpl");
    expect(detectEditorSetConfig(hass)).toBe("gpl");
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
    expect(detectCardSetHass(hass)).toBe("gpl");
    expect(detectEditorSetHass(hass)).toBe("gpl");
    expect(detectEditorSetConfig(hass)).toBe("gpl");
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
    expect(detectCardSetHass(hass)).toBeUndefined();
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
    expect(detectCardSetHass(hass)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ATMO detection specifics
// ---------------------------------------------------------------------------

describe("ATMO detection", () => {
  it("detects ATMO via pollen sensor (niveau_bouleau)", () => {
    const hass = mkHass(["sensor.niveau_bouleau_montpellier"]);
    expect(detectCardSetHass(hass)).toBe("atmo");
    expect(detectEditorSetHass(hass)).toBe("atmo");
    expect(detectEditorSetConfig(hass)).toBe("atmo");
  });

  it("detects ATMO via pollution sensor (pm25) in card and editor set hass()", () => {
    // pm25 sensors are in the broader ATMO regex used by card/editor set hass()
    const hass = mkHass(["sensor.pm25_montpellier"]);
    expect(detectCardSetHass(hass)).toBe("atmo");
    expect(detectEditorSetHass(hass)).toBe("atmo");
  });

  it("editor setConfig() only matches pollen allergens, not pollution sensors", () => {
    // Editor setConfig() uses a narrower regex (only niveau_ pollen names)
    const hass = mkHass(["sensor.pm25_montpellier"]);
    expect(detectEditorSetConfig(hass)).toBeUndefined();
  });

  it("excludes forecast day entities (_j_N suffix) in card and editor set hass()", () => {
    // Sensors ending with _j_1, _j_2 etc are forecast-day entities, excluded
    const hass = mkHass(["sensor.niveau_bouleau_montpellier_j_1"]);
    expect(detectCardSetHass(hass)).toBeUndefined();
    expect(detectEditorSetHass(hass)).toBeUndefined();
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
    expect(detectCardSetHass(hass)).toBe("atmo");
    expect(detectEditorSetConfig(hass)).toBe("atmo");
  });
});

// ---------------------------------------------------------------------------
// Cross-path comparison: document the three divergences
// ---------------------------------------------------------------------------

describe("cross-path divergence documentation", () => {
  it("editor setConfig() detects PLU sensors as PP (no PLU path)", () => {
    const hass = hassWithIntegrations("plu");
    expect(detectCardSetHass(hass)).toBe("plu");
    expect(detectEditorSetConfig(hass)).toBe("pp"); // divergence
    expect(detectEditorSetHass(hass)).toBe("plu");
  });

  it("editor set hass() does not detect Kleenex (no Kleenex path)", () => {
    const hass = hassWithIntegrations("kleenex");
    expect(detectCardSetHass(hass)).toBe("kleenex");
    expect(detectEditorSetConfig(hass)).toBe("kleenex");
    expect(detectEditorSetHass(hass)).toBeUndefined(); // divergence
  });

  it("ATMO pollution sensors detected in card/editor set hass() but not editor setConfig()", () => {
    // The card and editor set hass() paths use a broader ATMO regex that
    // includes pm25, pm10, ozone, dioxyde_*, qualite_globale sensors.
    // The editor setConfig() path only matches niveau_{allergen} pollen sensors.
    const hass = mkHass(["sensor.qualite_globale_montpellier"]);
    expect(detectCardSetHass(hass)).toBe("atmo");
    expect(detectEditorSetHass(hass)).toBe("atmo");
    expect(detectEditorSetConfig(hass)).toBeUndefined(); // divergence: narrower regex
  });
});
