import { describe, it, expect } from "vitest";
import { stubConfigPP } from "../../src/adapters/pp.js";
import { stubConfigDWD } from "../../src/adapters/dwd.js";
import { stubConfigPEU } from "../../src/adapters/peu.js";
import { stubConfigSILAM } from "../../src/adapters/silam.js";
import { stubConfigKleenex } from "../../src/adapters/kleenex/index.js";
import { stubConfigPLU } from "../../src/adapters/plu.js";
import { stubConfigATMO } from "../../src/adapters/atmo.js";
import { stubConfigGPL } from "../../src/adapters/gpl/index.js";
import { COSMETIC_FIELDS } from "../../src/constants.js";

// ── Constants matching setConfig() implementation ──────────────────────

const HARDCODED_EXTRAS = [
  "type",
  "card_mod",
  "allergens",
  "icon_size",
  "icon_color_mode",
  "icon_color",
  "city",
  "location",
  "region_id",
  "tap_action",
  "debug",
  "show_version",
  "title",
  "days_to_show",
  "date_locale",
];

const STUBS = {
  pp: stubConfigPP,
  dwd: stubConfigDWD,
  peu: stubConfigPEU,
  silam: stubConfigSILAM,
  kleenex: stubConfigKleenex,
  plu: stubConfigPLU,
  atmo: stubConfigATMO,
  gpl: stubConfigGPL,
};

// ── Replicate the core filtering logic from setConfig() ────────────────

function simulateSetConfig(config) {
  let integration = config.integration;
  if (integration && typeof integration === "string") {
    integration = integration.trim().toLowerCase();
  }

  const stub = STUBS[integration] || stubConfigPP;
  const allowedFields = Object.keys(stub).concat(HARDCODED_EXTRAS);

  const cleanedUserConfig = {};
  for (const k of allowedFields) {
    if (k in config) cleanedUserConfig[k] = config[k];
  }

  return { ...stub, ...cleanedUserConfig, integration };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("setConfig: unknown fields are dropped", () => {
  it("strips fields not in stub or hardcoded extras", () => {
    const result = simulateSetConfig({
      integration: "pp",
      unknown_field: "test",
      another_junk: 123,
    });

    expect(result).not.toHaveProperty("unknown_field");
    expect(result).not.toHaveProperty("another_junk");
  });

  it("strips multiple unknown fields across different value types", () => {
    const result = simulateSetConfig({
      integration: "pp",
      foo: "bar",
      baz: [1, 2, 3],
      qux: { nested: true },
      num: 42,
      flag: false,
    });

    expect(result).not.toHaveProperty("foo");
    expect(result).not.toHaveProperty("baz");
    expect(result).not.toHaveProperty("qux");
    expect(result).not.toHaveProperty("num");
    expect(result).not.toHaveProperty("flag");
  });
});

describe("setConfig: known stub fields pass through", () => {
  it("preserves PP-specific fields", () => {
    const result = simulateSetConfig({
      integration: "pp",
      pollen_threshold: 3,
      sort: "value_ascending",
      minimal: true,
      days_relative: false,
    });

    expect(result.pollen_threshold).toBe(3);
    expect(result.sort).toBe("value_ascending");
    expect(result.minimal).toBe(true);
    expect(result.days_relative).toBe(false);
  });

  it("preserves DWD-specific fields", () => {
    const result = simulateSetConfig({
      integration: "dwd",
      region_id: "11",
      pollen_threshold: 0.5,
      entity_prefix: "my_prefix",
    });

    expect(result.region_id).toBe("11");
    expect(result.pollen_threshold).toBe(0.5);
    expect(result.entity_prefix).toBe("my_prefix");
  });

  it("preserves PEU-specific fields", () => {
    const result = simulateSetConfig({
      integration: "peu",
      location: "amsterdam",
      mode: "hourly",
      numeric_state_raw_risk: true,
    });

    expect(result.location).toBe("amsterdam");
    expect(result.mode).toBe("hourly");
    expect(result.numeric_state_raw_risk).toBe(true);
  });

  it("preserves SILAM-specific fields", () => {
    const result = simulateSetConfig({
      integration: "silam",
      location: "helsinki",
      mode: "twice_daily",
      index_top: false,
    });

    expect(result.location).toBe("helsinki");
    expect(result.mode).toBe("twice_daily");
    expect(result.index_top).toBe(false);
  });

  it("preserves ATMO-specific fields", () => {
    const result = simulateSetConfig({
      integration: "atmo",
      sort_pollution_block: false,
      pollution_block_position: "top",
      show_block_separator: true,
    });

    expect(result.sort_pollution_block).toBe(false);
    expect(result.pollution_block_position).toBe("top");
    expect(result.show_block_separator).toBe(true);
  });

  it("preserves GPL-specific fields", () => {
    const result = simulateSetConfig({
      integration: "gpl",
      sort_category_allergens_first: false,
    });

    expect(result.sort_category_allergens_first).toBe(false);
  });

  it("preserves Kleenex-specific fields", () => {
    const result = simulateSetConfig({
      integration: "kleenex",
      sort_category_allergens_first: false,
      location: "utrecht",
    });

    expect(result.sort_category_allergens_first).toBe(false);
    expect(result.location).toBe("utrecht");
  });

  it("preserves PLU-specific fields", () => {
    const result = simulateSetConfig({
      integration: "plu",
      pollen_threshold: 0,
      allergy_risk_top: false,
    });

    expect(result.pollen_threshold).toBe(0);
    expect(result.allergy_risk_top).toBe(false);
  });

  it("user value overrides stub default", () => {
    // PP stub has days_to_show: 4 by default
    const result = simulateSetConfig({
      integration: "pp",
      days_to_show: 2,
    });

    expect(result.days_to_show).toBe(2);
  });

  it("stub defaults fill in when user does not provide a field", () => {
    const result = simulateSetConfig({ integration: "pp" });

    // PP stub defaults
    expect(result.pollen_threshold).toBe(1);
    expect(result.days_to_show).toBe(4);
    expect(result.sort).toBe("value_descending");
    expect(result.minimal).toBe(false);
  });

  it("phrases object passes through intact", () => {
    const phrases = {
      full: { Birch: "Custom Birch" },
      short: { Birch: "CB" },
      levels: ["None", "Low", "Med", "High"],
      days: { Mon: "Monday" },
      no_information: "N/A",
    };
    const result = simulateSetConfig({ integration: "pp", phrases });

    expect(result.phrases).toEqual(phrases);
  });
});

describe("setConfig: hardcoded extras pass through", () => {
  it("preserves type field", () => {
    const result = simulateSetConfig({
      integration: "pp",
      type: "custom:pollenprognos-card",
    });

    expect(result.type).toBe("custom:pollenprognos-card");
  });

  it("preserves card_mod field", () => {
    const cardMod = { style: "ha-card { background: red; }" };
    const result = simulateSetConfig({
      integration: "pp",
      card_mod: cardMod,
    });

    expect(result.card_mod).toEqual(cardMod);
  });

  it("preserves tap_action with nested config", () => {
    const tapAction = { action: "more-info" };
    const result = simulateSetConfig({
      integration: "pp",
      tap_action: tapAction,
    });

    expect(result.tap_action).toEqual(tapAction);
  });

  it("preserves debug flag", () => {
    const result = simulateSetConfig({ integration: "pp", debug: true });

    expect(result.debug).toBe(true);
  });

  it("preserves title string", () => {
    const result = simulateSetConfig({
      integration: "pp",
      title: "Pollen Forecast",
    });

    expect(result.title).toBe("Pollen Forecast");
  });

  it("preserves show_version flag", () => {
    const result = simulateSetConfig({
      integration: "pp",
      show_version: false,
    });

    expect(result.show_version).toBe(false);
  });

  it("preserves icon_color_mode and icon_color", () => {
    const result = simulateSetConfig({
      integration: "pp",
      icon_color_mode: "custom",
      icon_color: "#ff0000",
    });

    expect(result.icon_color_mode).toBe("custom");
    expect(result.icon_color).toBe("#ff0000");
  });

  it("preserves date_locale", () => {
    const result = simulateSetConfig({
      integration: "pp",
      date_locale: "sv-SE",
    });

    expect(result.date_locale).toBe("sv-SE");
  });

  it("all 15 hardcoded extras survive when provided", () => {
    const config = {
      integration: "pp",
      type: "custom:pollenprognos-card",
      card_mod: { style: "" },
      allergens: ["Björk"],
      icon_size: "64",
      icon_color_mode: "custom",
      icon_color: "#123456",
      city: "Stockholm",
      location: "test_location",
      region_id: "42",
      tap_action: { action: "navigate" },
      debug: true,
      show_version: false,
      title: "My Pollen Card",
      days_to_show: 3,
      date_locale: "en-US",
    };
    const result = simulateSetConfig(config);

    for (const key of HARDCODED_EXTRAS) {
      expect(result).toHaveProperty(key);
      expect(result[key]).toEqual(config[key]);
    }
  });
});

describe("setConfig: cross-integration location fields survive", () => {
  it("city survives on DWD (via hardcoded extras, not DWD stub)", () => {
    // DWD stub does not define city, but the hardcoded extras include it
    expect(stubConfigDWD).not.toHaveProperty("city");

    const result = simulateSetConfig({
      integration: "dwd",
      city: "Stockholm",
    });

    expect(result.city).toBe("Stockholm");
  });

  it("location survives on PP (via hardcoded extras, not PP stub)", () => {
    // PP stub does not define location, but hardcoded extras include it
    const ppKeys = Object.keys(stubConfigPP);
    expect(ppKeys).not.toContain("location");

    const result = simulateSetConfig({
      integration: "pp",
      location: "test_location",
    });

    expect(result.location).toBe("test_location");
  });

  it("region_id survives on PEU (via hardcoded extras)", () => {
    const result = simulateSetConfig({
      integration: "peu",
      region_id: "99",
    });

    expect(result.region_id).toBe("99");
  });

  it("all three location fields survive on every integration", () => {
    for (const key of Object.keys(STUBS)) {
      const result = simulateSetConfig({
        integration: key,
        city: "TestCity",
        location: "test_loc",
        region_id: "7",
      });

      expect(result.city).toBe("TestCity");
      expect(result.location).toBe("test_loc");
      expect(result.region_id).toBe("7");
    }
  });
});

describe("setConfig: integration normalization", () => {
  it("uppercased integration is normalized to lowercase", () => {
    const result = simulateSetConfig({ integration: "PP" });

    expect(result.integration).toBe("pp");
  });

  it("mixed-case integration is normalized", () => {
    const result = simulateSetConfig({ integration: "Dwd" });

    expect(result.integration).toBe("dwd");
  });

  it("whitespace-padded integration is trimmed", () => {
    const result = simulateSetConfig({ integration: " dwd " });

    expect(result.integration).toBe("dwd");
  });

  it("combined trim + lowercase", () => {
    const result = simulateSetConfig({ integration: "  PEU  " });

    expect(result.integration).toBe("peu");
  });

  it("already lowercase integration is unchanged", () => {
    const result = simulateSetConfig({ integration: "silam" });

    expect(result.integration).toBe("silam");
  });

  it("normalized integration selects the correct stub", () => {
    const result = simulateSetConfig({ integration: " SILAM " });

    // SILAM stub has index_top, PP does not
    expect(result).toHaveProperty("index_top");
    expect(result.days_to_show).toBe(stubConfigSILAM.days_to_show);
  });
});

describe("setConfig: unknown integration falls back to PP stub", () => {
  it("uses PP stub for unrecognized integration name", () => {
    const result = simulateSetConfig({ integration: "nonexistent" });

    // PP stub has city field, DWD has region_id
    expect(result).toHaveProperty("city");
    expect(result.days_to_show).toBe(stubConfigPP.days_to_show);
    expect(result.pollen_threshold).toBe(stubConfigPP.pollen_threshold);
  });

  it("uses PP stub when integration is empty string", () => {
    const result = simulateSetConfig({ integration: "" });

    expect(result.days_to_show).toBe(stubConfigPP.days_to_show);
  });

  it("uses PP stub when integration is undefined", () => {
    const result = simulateSetConfig({});

    expect(result.days_to_show).toBe(stubConfigPP.days_to_show);
    expect(result.pollen_threshold).toBe(stubConfigPP.pollen_threshold);
  });

  it("PP-specific fields are present for unknown integration", () => {
    const result = simulateSetConfig({ integration: "bogus" });

    // Verify a sample of PP-unique stub defaults
    expect(result.allergy_risk_top).toBe(true);
    expect(result.link_to_sensors).toBe(true);
    expect(result.sort).toBe("value_descending");
  });

  it("unknown fields still get dropped even with PP fallback", () => {
    const result = simulateSetConfig({
      integration: "nonexistent",
      garbage: true,
    });

    expect(result).not.toHaveProperty("garbage");
  });
});

describe("setConfig: cosmetic-only update detection", () => {
  // This tests the COSMETIC_FIELDS constant is plausible:
  // fields like icon_size, minimal, background_color are cosmetic.

  it("COSMETIC_FIELDS list is non-empty", () => {
    expect(COSMETIC_FIELDS.length).toBeGreaterThan(0);
  });

  it("most COSMETIC_FIELDS entries are in at least one stub or extras", () => {
    // Build the set of all allowed fields across all integrations
    const allFields = new Set();
    for (const stub of Object.values(STUBS)) {
      for (const key of Object.keys(stub)) {
        allFields.add(key);
      }
    }
    for (const key of HARDCODED_EXTRAS) {
      allFields.add(key);
    }

    const allowed = COSMETIC_FIELDS.filter((f) => allFields.has(f));
    const notAllowed = COSMETIC_FIELDS.filter((f) => !allFields.has(f));

    // The vast majority of cosmetic fields should be in allowed fields
    expect(allowed.length).toBeGreaterThan(0);

    // Document which cosmetic fields are NOT in any stub or extras.
    // These fields are used by the card/editor at render time but
    // are not part of the allowedFields set in setConfig, so they
    // would be stripped during config filtering. They still appear
    // in COSMETIC_FIELDS because the cosmetic-only detection runs
    // against the already-merged config object.
    const knownExceptions = [
      "allergen_color_mode",
      "allergen_outline_color",
      "levels_inherit_mode",
    ];
    for (const field of notAllowed) {
      expect(knownExceptions).toContain(field);
    }
  });

  it("cosmetic fields pass through for each integration's own stub", () => {
    // For each integration, verify that cosmetic fields present in that
    // integration's allowed set (stub keys + extras) are preserved.
    for (const [name, stub] of Object.entries(STUBS)) {
      const integrationAllowed = new Set([
        ...Object.keys(stub),
        ...HARDCODED_EXTRAS,
      ]);
      const cosmeticForIntegration = COSMETIC_FIELDS.filter((f) =>
        integrationAllowed.has(f),
      );

      const config = { integration: name };
      for (const field of cosmeticForIntegration) {
        config[field] = "test_value";
      }
      const result = simulateSetConfig(config);

      for (const field of cosmeticForIntegration) {
        expect(result).toHaveProperty(field);
      }
    }
  });

  it("cosmetic fields not in any stub or extras are stripped", () => {
    // allergen_color_mode, allergen_outline_color, and levels_inherit_mode
    // are in COSMETIC_FIELDS but not in any stub or hardcoded extras,
    // so setConfig's filtering drops them.
    const result = simulateSetConfig({
      integration: "pp",
      allergen_color_mode: "custom",
      allergen_outline_color: "#ff0000",
      levels_inherit_mode: "inherit_allergen",
    });

    expect(result).not.toHaveProperty("allergen_color_mode");
    expect(result).not.toHaveProperty("allergen_outline_color");
    expect(result).not.toHaveProperty("levels_inherit_mode");
  });

  it("changing only cosmetic fields produces only cosmetic changed keys", () => {
    // Simulate prev config (initial setConfig)
    const prevResult = simulateSetConfig({ integration: "pp" });

    // Simulate next config with one cosmetic change
    const nextConfig = { integration: "pp", icon_size: "64" };
    const nextResult = simulateSetConfig(nextConfig);

    // Determine which keys changed
    const changedKeys = Object.keys(nextResult).filter(
      (k) => JSON.stringify(nextResult[k]) !== JSON.stringify(prevResult[k]),
    );

    // icon_size should be the only changed key
    expect(changedKeys).toContain("icon_size");
    // All changed keys should be cosmetic
    for (const k of changedKeys) {
      expect(COSMETIC_FIELDS).toContain(k);
    }
  });

  it("changing a non-cosmetic field is detected", () => {
    const prevResult = simulateSetConfig({ integration: "pp" });

    // pollen_threshold is NOT cosmetic
    const nextResult = simulateSetConfig({
      integration: "pp",
      pollen_threshold: 5,
    });

    const changedKeys = Object.keys(nextResult).filter(
      (k) => JSON.stringify(nextResult[k]) !== JSON.stringify(prevResult[k]),
    );

    expect(changedKeys).toContain("pollen_threshold");
    const allCosmetic = changedKeys.every((k) =>
      COSMETIC_FIELDS.includes(k),
    );
    expect(allCosmetic).toBe(false);
  });
});

describe("setConfig: integration field is always set in output", () => {
  it("integration from config is preserved in result", () => {
    const result = simulateSetConfig({ integration: "dwd" });

    expect(result.integration).toBe("dwd");
  });

  it("integration overrides stub integration value", () => {
    // Even though PP stub has integration: "pp", passing "dwd" should
    // produce integration: "dwd" (though it selects the DWD stub)
    const result = simulateSetConfig({ integration: "dwd" });

    expect(result.integration).toBe("dwd");
  });

  it("undefined integration stays undefined in result", () => {
    const result = simulateSetConfig({});

    expect(result.integration).toBeUndefined();
  });
});

describe("setConfig: stub + user merge semantics", () => {
  it("user config overrides stub defaults (spread order)", () => {
    const result = simulateSetConfig({
      integration: "pp",
      allergens: ["Björk"],
      days_to_show: 1,
    });

    // User values should override the stub
    expect(result.allergens).toEqual(["Björk"]);
    expect(result.days_to_show).toBe(1);
  });

  it("stub fields not overridden by user remain at stub defaults", () => {
    const result = simulateSetConfig({
      integration: "dwd",
      region_id: "11",
    });

    // DWD stub defaults should remain for unset fields
    expect(result.days_to_show).toBe(stubConfigDWD.days_to_show);
    expect(result.pollen_threshold).toBe(stubConfigDWD.pollen_threshold);
    expect(result.sort).toBe(stubConfigDWD.sort);
  });

  it("levels defaults from LEVELS_DEFAULTS are present in output", () => {
    const result = simulateSetConfig({ integration: "pp" });

    // These come from the ...LEVELS_DEFAULTS spread in every stub
    expect(result).toHaveProperty("levels_colors");
    expect(result).toHaveProperty("levels_empty_color");
    expect(result).toHaveProperty("levels_gap_color");
    expect(result).toHaveProperty("levels_thickness");
    expect(result).toHaveProperty("levels_gap");
    expect(result).toHaveProperty("allergen_colors");
    expect(result).toHaveProperty("allergen_stroke_width");
  });

  it("every stub key is present in the final output", () => {
    for (const [name, stub] of Object.entries(STUBS)) {
      const result = simulateSetConfig({ integration: name });

      for (const key of Object.keys(stub)) {
        expect(result).toHaveProperty(key);
      }
    }
  });
});
