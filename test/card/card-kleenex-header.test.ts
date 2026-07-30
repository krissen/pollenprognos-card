import { describe, it, expect, beforeAll } from "vitest";
import { createHass } from "../helpers.js";

// The card is a LitElement, so this file installs the same minimal DOM shim as
// the editor tests. Nothing is rendered; only the header label resolution in
// `set hass` is exercised.
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

/**
 * Manual-mode install whose entity IDs use a non-legacy prefix: the device was
 * renamed to "Kleenex pollen", so nothing carries `kleenex_pollen_radar_`.
 */
function manualPrefixHass(): any {
  return createHass({
    "sensor.kleenex_pollen_trees": {
      entity_id: "sensor.kleenex_pollen_trees",
      state: "200",
      attributes: {
        friendly_name: "Kleenex pollen Trees",
        details: [],
        forecast: [],
      },
    },
    "sensor.kleenex_pollen_grass": {
      entity_id: "sensor.kleenex_pollen_grass",
      state: "100",
      attributes: {
        friendly_name: "Kleenex pollen Grass",
        details: [],
        forecast: [],
      },
    },
  });
}

let CardCtor: new () => {
  hass: unknown;
  setConfig: (config: Record<string, unknown>) => void;
  header: string;
};

beforeAll(async () => {
  installDomShim();
  await import("../../src/pollenprognos-card.js");
  CardCtor = (
    globalThis as unknown as {
      customElements: { get: (n: string) => new () => never };
    }
  ).customElements.get("pollenprognos-card");
});

describe("card header for Kleenex manual mode (issue #309)", () => {
  // Codex P2 on PR #311: the header prefiltered on the legacy
  // `kleenex_pollen_radar_` prefix before applying the configured
  // entity_prefix, so a manual config on re-minted entity IDs found no sensor
  // and the header fell back to the literal config value "manual".
  it("labels the header from the configured entity_prefix", () => {
    const card = new CardCtor();
    card.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "manual",
      entity_prefix: "kleenex_pollen_",
      allergens: ["trees", "grass"],
    });
    card.hass = manualPrefixHass();

    expect(card.header).toBe("Pollen forecast for Kleenex pollen");
  });
});
