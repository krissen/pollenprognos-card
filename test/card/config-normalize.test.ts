import { describe, it, expect } from "vitest";
import {
  normalizeCardConfig,
  mergeCardConfig,
  coerceConfigTypes,
  finalizeCardConfig,
  cardAllowedFields,
  CARD_EXTRA_FIELDS,
  resolveIconSize,
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

  it("coerces a legacy string icon_size to a number", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", icon_size: "64" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.icon_size).toBe(64);
  });

  it("keeps zero and negative numeric strings as-is", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", icon_size: "0", days_to_show: "-1" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    // The boundary coerces the type and stops there: 0 and -1 are legitimate
    // values for some number fields, so range-checking is not its job. For
    // icon_size the read-side guard rejects them, so both layers have to be
    // read together — hence the guard assertion alongside the config one.
    expect(cfg.icon_size).toBe(0);
    expect(cfg.days_to_show).toBe(-1);
    expect(resolveIconSize(cfg.icon_size)).toBe(48);
  });

  it("falls back to the stub default for an unusable numeric value", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", icon_size: "abc", days_to_show: "abc" },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    // A string reaching the donut geometry would abort the render (toFixed).
    expect(cfg.icon_size).toBe(stubConfigPP.icon_size);
    expect(cfg.icon_size).toBe(48);
    expect(cfg.days_to_show).toBe(stubConfigPP.days_to_show);
  });

  it("falls back for an empty scalar and for NaN", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", icon_size: "  ", days_to_show: NaN },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.icon_size).toBe(48);
    expect(cfg.days_to_show).toBe(4);
  });

  it("falls back for values that are neither string nor number", () => {
    // icon_size: true used to render as a 1px icon (Number(true)); an object
    // slips in through a malformed nesting. Both must not reach the geometry.
    const cfg = normalizeCardConfig(
      { integration: "pp", icon_size: true, days_to_show: {} } as Record<
        string,
        unknown
      >,
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.icon_size).toBe(48);
    expect(cfg.days_to_show).toBe(4);
  });

  it("falls back for null and undefined", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", icon_size: null, days_to_show: undefined } as Record<
        string,
        unknown
      >,
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.icon_size).toBe(48);
    expect(cfg.days_to_show).toBe(4);
  });

  it("drops an unusable number field the resolved stub does not declare", () => {
    // set hass spreads the full config, so a field only another stub declares
    // can arrive; with no stub default to restore, the key is removed and the
    // read-site default applies.
    const cfg = coerceConfigTypes(
      { integration: "pp", pollen_threshold: "abc" },
      { ...stubConfigPP, pollen_threshold: undefined } as never,
    );
    expect(cfg).not.toHaveProperty("pollen_threshold");
  });
});

// Two layers keep the icon geometry safe, and both are exercised here.
//   1. The boundary (the block above) repairs hand-written YAML for every
//      number field: a non-coercible string, NaN, a boolean or a nested
//      structure becomes the stub default before the card sees it.
//   2. resolveIconSize is the read-side guard shared by the card's three
//      icon_size sites (minimal rows, daily rows, --pollen-icon-size) and the
//      editor's slider/number field. It covers what the boundary deliberately
//      leaves alone — 0 and negative numbers are legitimate values there — and
//      stands on its own for configs that never passed the boundary (the editor
//      spreads config without coercing it).
describe("resolveIconSize", () => {
  it("passes a usable size through", () => {
    expect(resolveIconSize(64)).toBe(64);
    expect(resolveIconSize(16)).toBe(16);
  });

  it("converts a numeric string, for configs that skipped the boundary", () => {
    // The editor spreads config uncoerced, so legacy icon_size: "64" arrives
    // here as a string; returning the default would make the slider and number
    // field start from a different value than the card renders.
    expect(resolveIconSize("64")).toBe(64);
    expect(resolveIconSize(" 64 ")).toBe(64);
  });

  it("falls back to 48 for every unusable value", () => {
    // "48px" is plausible by hand: the editor label reads "Icon size (px)".
    for (const raw of [
      "abc",
      "48px",
      "",
      "  ",
      true,
      {},
      [],
      null,
      undefined,
      NaN,
      Infinity,
    ]) {
      expect(resolveIconSize(raw)).toBe(48);
    }
  });

  it("falls back to 48 for non-positive sizes the boundary keeps", () => {
    // Behaviour change: the minimal/daily sites previously let a negative
    // through (Number(-10) || 48 === -10), which is invalid CSS anyway.
    expect(resolveIconSize(0)).toBe(48);
    expect(resolveIconSize(-10)).toBe(48);
    expect(resolveIconSize("0")).toBe(48);
    expect(resolveIconSize("-10")).toBe(48);
  });

  it("layers with the boundary for real YAML values", () => {
    const rendered = (raw: unknown) =>
      resolveIconSize(
        normalizeCardConfig(
          { integration: "pp", icon_size: raw } as Record<string, unknown>,
          stubConfigPP,
          { integration: "pp", filter: true },
        ).icon_size,
      );
    // Repaired by the boundary, passed through by the guard.
    expect(rendered("64")).toBe(64);
    expect(rendered(64)).toBe(64);
    // Repaired by the boundary before the guard is reached.
    for (const raw of ["abc", "48px", "", true, {}, null]) {
      expect(rendered(raw)).toBe(48);
    }
    // Survives the boundary as a valid number; only the guard rejects it.
    expect(rendered("0")).toBe(48);
    expect(rendered(-10)).toBe(48);
  });

  it("renders the same size whether or not the boundary ran", () => {
    // Both layers parse numeric scalars through one shared rule, so passing a
    // value through the boundary must never change what the guard renders.
    // Drift between the two is what produced the round 1 and round 3 findings:
    // a boundary that accepted [64] as 64 while the guard said 48 would fail
    // here, as would a guard that started accepting "48px".
    for (const raw of [
      64,
      "64",
      " 64 ",
      "48px",
      "abc",
      "",
      "  ",
      "0x10",
      0,
      "0",
      -10,
      "-10",
      true,
      false,
      {},
      [],
      [64],
      null,
      undefined,
      NaN,
      Infinity,
    ]) {
      const throughBoundary = normalizeCardConfig(
        { integration: "pp", icon_size: raw } as Record<string, unknown>,
        stubConfigPP,
        { integration: "pp", filter: true },
      ).icon_size;
      expect(resolveIconSize(throughBoundary)).toBe(resolveIconSize(raw));
    }
  });

  it("uses the stub default when icon_size is absent", () => {
    const cfg = normalizeCardConfig({ integration: "pp" }, stubConfigPP, {
      integration: "pp",
      filter: true,
    });
    expect(resolveIconSize(cfg.icon_size)).toBe(stubConfigPP.icon_size);
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
      {
        integration: "pp",
        city: "Stockholm",
        tap_action: { action: "more-info" },
      },
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
    const cfg = finalizeCardConfig(
      { integration: "pp", minimal: true },
      stubConfigPP,
    );
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
