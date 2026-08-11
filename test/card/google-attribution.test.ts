/**
 * Google attribution gates (issue #338).
 *
 * Two layers are exercised:
 *   1. the config boundary -- show_google_attribution only exists for the
 *      Google-backed adapters, defaults on there and survives an explicit
 *      false;
 *   2. the render gate -- card footer and badge corner pin appear for gpl/gp
 *      unless the user opted out, and never for any other integration.
 *
 * The card and badge are LitElements, so this file installs the same minimal
 * DOM shim the other card tests use. Nothing is rendered into a document; the
 * gate methods are called directly and their return value is inspected (a
 * TemplateResult when the attribution is shown, the `nothing` sentinel / empty
 * string when it is not).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { nothing } from "lit";
import { normalizeCardConfig } from "../../src/utils/config-normalize.js";
import { stubConfigPP } from "../../src/adapters/pp.js";
import { stubConfigGPL } from "../../src/adapters/gpl/index.js";
import { stubConfigGP } from "../../src/adapters/gp/index.js";
import {
  GOOGLE_MAPS_TEXT,
  GOOGLE_POLLEN_SOURCE_TEXT,
} from "../../src/constants.js";

class FakeNode {
  childNodes: unknown[] = [];
  appendChild() {}
}
class FakeElement extends FakeNode {
  content: unknown = { firstChild: null, cloneNode: () => new FakeElement() };
  attachShadow() {
    return new FakeElement();
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
  setAttribute() {}
  getAttribute() {
    return null;
  }
  remove() {}
}

function installDomShim() {
  const g = globalThis as unknown as Record<string, unknown>;
  g.Document = class {};
  g.HTMLElement = FakeElement;
  g.ShadowRoot = class {};
  g.CSSStyleSheet = class {
    replaceSync() {}
    replace() {}
  };
  const registry = new Map<string, unknown>();
  g.customElements = {
    define(name: string, ctor: unknown) {
      registry.set(name, ctor);
    },
    get(name: string) {
      return registry.get(name);
    },
  };
  g.window = globalThis;
  g.document = {
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
    createComment: () => new FakeNode(),
    createTextNode: () => new FakeNode(),
    createTreeWalker: () => ({ nextNode: () => null, currentNode: null }),
    head: new FakeElement(),
    adoptedStyleSheets: [],
  };
}

/** Flatten a lit TemplateResult's static strings for substring assertions. */
function templateText(result: unknown): string {
  const strings = (result as { strings?: readonly string[] })?.strings;
  return strings ? strings.join("") : "";
}

// ---------------------------------------------------------------------------
// Config boundary
// ---------------------------------------------------------------------------

describe("show_google_attribution at the config boundary (#338)", () => {
  it("defaults to true for gpl and gp", () => {
    for (const [stub, id] of [
      [stubConfigGPL, "gpl"],
      [stubConfigGP, "gp"],
    ] as const) {
      const cfg = normalizeCardConfig({ integration: id }, stub, {
        integration: id,
        filter: true,
      });
      expect(cfg.show_google_attribution).toBe(true);
    }
  });

  it("keeps an explicit false for gpl and gp", () => {
    for (const [stub, id] of [
      [stubConfigGPL, "gpl"],
      [stubConfigGP, "gp"],
    ] as const) {
      const cfg = normalizeCardConfig(
        { integration: id, show_google_attribution: false },
        stub,
        { integration: id, filter: true },
      );
      expect(cfg.show_google_attribution).toBe(false);
    }
  });

  it("coerces the YAML string form for gpl", () => {
    const cfg = normalizeCardConfig(
      { integration: "gpl", show_google_attribution: "false" },
      stubConfigGPL,
      { integration: "gpl", filter: true },
    );
    expect(cfg.show_google_attribution).toBe(false);
  });

  it("is dropped for a non-Google integration even when the YAML sets it", () => {
    // The key is not in the PP stub, so the setConfig filter must strip it --
    // otherwise a copied config would carry a flag PP never honours.
    const cfg = normalizeCardConfig(
      { integration: "pp", show_google_attribution: true },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg).not.toHaveProperty("show_google_attribution");
  });
});

// ---------------------------------------------------------------------------
// Render gates
// ---------------------------------------------------------------------------

type GateElement = {
  setConfig: (config: Record<string, unknown>) => void;
  _renderGoogleAttribution: () => unknown;
};

let CardCtor: new () => GateElement;
let BadgeCtor: new () => GateElement;

beforeAll(async () => {
  installDomShim();
  await import("../../src/pollenprognos-card.js");
  await import("../../src/pollenprognos-badge.js");
  const ce = (
    globalThis as unknown as {
      customElements: { get: (n: string) => new () => GateElement };
    }
  ).customElements;
  CardCtor = ce.get("pollenprognos-card");
  BadgeCtor = ce.get("pollenprognos-badge");
});

function cardGate(config: Record<string, unknown>): unknown {
  const card = new CardCtor();
  card.setConfig({ type: "custom:pollenprognos-card", ...config });
  return card._renderGoogleAttribution();
}

function badgeGate(config: Record<string, unknown>): unknown {
  const badge = new BadgeCtor();
  badge.setConfig({ type: "custom:pollenprognos-badge", ...config });
  return badge._renderGoogleAttribution();
}

describe("card attribution footer gate (#338)", () => {
  it.each(["gpl", "gp"])("renders the footer for %s by default", (id) => {
    const text = templateText(cardGate({ integration: id }));
    expect(text).toContain("google-attribution");
  });

  it("renders both mandated strings verbatim", () => {
    const result = cardGate({ integration: "gpl" }) as {
      values?: unknown[];
      strings?: readonly string[];
    };
    // The policy strings are interpolated values, not static template text.
    const rendered = templateText(result) + JSON.stringify(result.values ?? []);
    expect(rendered).toContain(GOOGLE_MAPS_TEXT);
    expect(rendered).toContain(GOOGLE_POLLEN_SOURCE_TEXT);
  });

  it.each(["gpl", "gp"])(
    "renders nothing for %s when the user opts out",
    (id) => {
      expect(
        cardGate({ integration: id, show_google_attribution: false }),
      ).toBe(nothing);
    },
  );

  it("honours the YAML string form of the opt-out", () => {
    expect(
      cardGate({ integration: "gpl", show_google_attribution: "false" }),
    ).toBe(nothing);
  });

  it.each(["pp", "dwd", "silam"])("renders nothing for %s", (id) => {
    expect(cardGate({ integration: id })).toBe(nothing);
  });
});

describe("badge attribution pin gate (#338)", () => {
  it.each(["gpl", "gp"])("renders the pin for %s by default", (id) => {
    const text = templateText(badgeGate({ integration: id }));
    expect(text).toContain("ppb-attribution");
  });

  it("carries the full attribution string as the pin's title", () => {
    const result = badgeGate({ integration: "gpl" }) as { values?: unknown[] };
    const values = JSON.stringify(result.values ?? []);
    expect(values).toContain(GOOGLE_MAPS_TEXT);
    expect(values).toContain(GOOGLE_POLLEN_SOURCE_TEXT);
  });

  it.each(["gpl", "gp"])(
    "renders an empty string for %s when the user opts out",
    (id) => {
      expect(
        badgeGate({ integration: id, show_google_attribution: false }),
      ).toBe("");
    },
  );

  it.each(["pp", "dwd", "silam"])("renders an empty string for %s", (id) => {
    expect(badgeGate({ integration: id })).toBe("");
  });
});

describe("badge attribution toggle coercion (#338)", () => {
  // The badge builds its own config instead of going through
  // normalizeCardConfig, so the YAML string forms have to be coerced in
  // _buildConfig. Without that, `show_google_attribution: "false"` is not
  // `=== false` and the pin stays on for a user who asked for it off.
  it.each(["gpl", "gp"])(
    'hides the pin for %s on the YAML string "false"',
    (id) => {
      expect(
        badgeGate({ integration: id, show_google_attribution: "false" }),
      ).toBe("");
    },
  );

  it.each(["gpl", "gp"])(
    'shows the pin for %s on the YAML string "true"',
    (id) => {
      const text = templateText(
        badgeGate({ integration: id, show_google_attribution: "true" }),
      );
      expect(text).toContain("ppb-attribution");
    },
  );

  it.each(["gpl", "gp"])(
    "shows the pin for %s when the key is absent (stub default)",
    (id) => {
      const text = templateText(badgeGate({ integration: id }));
      expect(text).toContain("ppb-attribution");
    },
  );

  it.each(["gpl", "gp"])(
    "shows the pin for %s when the key is present but undefined",
    (id) => {
      const text = templateText(
        badgeGate({ integration: id, show_google_attribution: undefined }),
      );
      expect(text).toContain("ppb-attribution");
    },
  );

  // Only an explicit false / "false" turns the attribution off: an
  // unrecognised value must fail OPEN, since the toggle exists to satisfy
  // Google's attribution policy.
  it.each([0, "0", "no", "off", null, []])(
    "keeps the pin for the unrecognised value %p",
    (value) => {
      const text = templateText(
        badgeGate({ integration: "gpl", show_google_attribution: value }),
      );
      expect(text).toContain("ppb-attribution");
    },
  );
});
