import { describe, it, expect } from "vitest";
import {
  normalizeCardConfig,
  mergeCardConfig,
  coerceConfigTypes,
  finalizeCardConfig,
  cardAllowedFields,
  CARD_EXTRA_FIELDS,
} from "../../src/utils/config-normalize.js";
import { stubConfigPP } from "../../src/adapters/pp.js";
import { stubConfigSILAM } from "../../src/adapters/silam.js";

// The boundary is the single place YAML values are coerced. These tests pin the
// legacy-YAML forms (string booleans, numeric strings, missing/malformed
// allergens) and the structural guarantees (freeze, no input mutation, the
// filter asymmetry between setConfig and set hass).

describe("normalizeCardConfig: string boolean coercion", () => {
  it('coerces "true"/"false" for stub-declared boolean fields', () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", minimal: "true", days_relative: "false" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.minimal).toBe(true);
    expect(cfg.days_relative).toBe(false);
  });

  it("coerces the debug / show_version extras (boolean in the stub)", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", debug: "true", show_version: "false" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.debug).toBe(true);
    expect(cfg.show_version).toBe(false);
  });

  it("leaves real booleans untouched", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", minimal: true, days_relative: false },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.minimal).toBe(true);
    expect(cfg.days_relative).toBe(false);
  });

  it("does not coerce non-boolean-typed fields (title stays the string)", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", title: "false" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.title).toBe("false");
  });
});

describe("normalizeCardConfig: numeric string coercion", () => {
  it("coerces numeric strings for stub-declared number fields", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", days_to_show: "4", pollen_threshold: "3" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.days_to_show).toBe(4);
    expect(cfg.pollen_threshold).toBe(3);
  });

  it("leaves a non-numeric string for a numeric field untouched", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", days_to_show: "abc" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.days_to_show).toBe("abc");
  });

  it("does not coerce icon_size (a string in the stub) to a number", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", icon_size: "64" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.icon_size).toBe("64");
  });
});

describe("normalizeCardConfig: allergens guard", () => {
  it("falls back to the stub allergens when allergens is missing", () => {
    const cfg = normalizeCardConfig({ integration: "pp" }, stubConfigPP, {
      integration: "pp",
      filter: true,
    });
    expect(cfg.allergens).toEqual(stubConfigPP.allergens);
  });

  it("replaces a malformed non-array allergens with the stub default", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", allergens: "birch" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.allergens).toEqual(stubConfigPP.allergens);
  });

  it("keeps a user-provided allergens array", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", allergens: ["Björk"] },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.allergens).toEqual(["Björk"]);
  });
});

describe("normalizeCardConfig: passthrough + location keys", () => {
  it("preserves the city key and tap_action (both action and type forms)", () => {
    const withAction = normalizeCardConfig(
      { integration: "pp", city: "Stockholm", tap_action: { action: "more-info" } },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(withAction.city).toBe("Stockholm");
    expect(withAction.tap_action).toEqual({ action: "more-info" });

    const withType = normalizeCardConfig(
      { integration: "pp", tap_action: { type: "navigate" } },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(withType.tap_action).toEqual({ type: "navigate" });
  });

  it("forces the resolved integration over any stub/raw value", () => {
    const cfg = normalizeCardConfig({ integration: "PP" }, stubConfigPP, {
      integration: "pp",
      filter: true,
    });
    expect(cfg.integration).toBe("pp");
  });
});

describe("mergeCardConfig: filter asymmetry", () => {
  it("filter:true drops unknown fields", () => {
    const merged = mergeCardConfig(
      { integration: "pp", unknown_field: "x" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(merged).not.toHaveProperty("unknown_field");
  });

  it("filter:false keeps unknown fields (the set hass path)", () => {
    const merged = mergeCardConfig(
      { integration: "pp", unknown_field: "x" },
      stubConfigPP,
      { integration: "pp", filter: false },
    );
    expect(merged.unknown_field).toBe("x");
  });

  it("allowed fields = stub keys + card extras", () => {
    const allowed = cardAllowedFields(stubConfigPP);
    for (const k of CARD_EXTRA_FIELDS) expect(allowed).toContain(k);
    expect(allowed).toContain("pollen_threshold"); // a stub key
  });
});

describe("link_to_sensors: no stub default, explicit opt-in (#279)", () => {
  it("stays absent when the user does not set it (default-on state)", () => {
    // No stub declares link_to_sensors, so a config that omits it must not gain
    // it from the merge -- an absent key is the "default on" signal that lets a
    // configured tap_action take precedence over per-icon more-info.
    const cfg = normalizeCardConfig({ integration: "pp" }, stubConfigPP, {
      integration: "pp",
      filter: true,
    });
    expect(cfg).not.toHaveProperty("link_to_sensors");
  });

  it("keeps an explicit boolean and coerces the YAML string form", () => {
    const asTrue = normalizeCardConfig(
      { integration: "pp", link_to_sensors: true },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(asTrue.link_to_sensors).toBe(true);

    const asString = normalizeCardConfig(
      { integration: "pp", link_to_sensors: "false" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(asString.link_to_sensors).toBe(false);
  });

  it("is an accepted extra field (survives the allowed-field filter)", () => {
    expect(CARD_EXTRA_FIELDS).toContain("link_to_sensors");
    expect(cardAllowedFields(stubConfigPP)).toContain("link_to_sensors");
  });
});

describe("cross-stub coercion union", () => {
  it("coerces a field the active stub omits but another stub declares boolean", () => {
    // show_summary_top_types is defined only in the GPL stub, not SILAM's, yet
    // set hass spreads it (filter:false). The union coercion must still fire.
    expect(stubConfigSILAM).not.toHaveProperty("show_summary_top_types");
    const cfg = coerceConfigTypes(
      { integration: "silam", show_summary_top_types: "false" },
      stubConfigSILAM,
    );
    expect(cfg.show_summary_top_types).toBe(false);
  });
});

describe("structural guarantees", () => {
  it("finalizeCardConfig freezes the result", () => {
    const cfg = finalizeCardConfig({ integration: "pp", minimal: true }, stubConfigPP);
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(() => {
      cfg.minimal = false;
    }).toThrow();
  });

  it("coerceConfigTypes does not mutate its input", () => {
    const input = { integration: "pp", minimal: "true" };
    coerceConfigTypes(input, stubConfigPP);
    expect(input.minimal).toBe("true");
  });

  it("does not mutate the raw config object (may be HA-frozen)", () => {
    const raw = Object.freeze({ integration: "pp", minimal: "true" });
    expect(() =>
      normalizeCardConfig(raw, stubConfigPP, {
        integration: "pp",
        filter: true,
      }),
    ).not.toThrow();
  });
});
