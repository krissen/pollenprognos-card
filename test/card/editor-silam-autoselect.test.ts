import { describe, it, expect, beforeAll } from "vitest";
import { createHass } from "../helpers.js";

// The editor is a LitElement and cannot be imported in the bare node test
// environment (see test/card/autodetect.test.ts). Install a minimal DOM shim
// so lit-html/reactive-element load and the element can be constructed. We
// never render the element here; we only exercise setConfig's data logic.
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
    createElement: (t: string) =>
      t === "template" ? new FakeElement() : new FakeElement(),
    createElementNS: () => new FakeElement(),
    createComment: () => new FakeNode(),
    createTextNode: () => new FakeNode(),
    createTreeWalker: () => ({ nextNode: () => null, currentNode: null }),
    head: new FakeElement(),
    adoptedStyleSheets: [],
  };
}

// Build a hass fixture exposing one discoverable SILAM location (Stockholm),
// mirroring the device-registry shape used in test/adapters/silam.test.ts.
function createSilamHass() {
  const weatherEntityId = "weather.silam_pollen_stockholm_forecast";
  const sensorId = "sensor.silam_pollen_stockholm_birch";
  const deviceId = "dev_sthlm";
  const states = {
    [weatherEntityId]: { state: "sunny", attributes: {} },
    [sensorId]: { state: "30", attributes: {} },
  };
  const entities = {
    [weatherEntityId]: {
      entity_id: weatherEntityId,
      platform: "silam_pollen",
      device_id: deviceId,
      entity_category: null,
      translation_key: "forecast",
    },
    [sensorId]: {
      entity_id: sensorId,
      platform: "silam_pollen",
      device_id: deviceId,
      entity_category: null,
      translation_key: "birch",
    },
  };
  const devices = {
    [deviceId]: { name: "Stockholm", config_entries: ["entry_sthlm"] },
  };
  return createHass(states, { entities, devices, language: "en" });
}

let EditorCtor: new () => {
  _hass: unknown;
  setConfig: (config: Record<string, unknown>) => void;
  _config: Record<string, unknown>;
};

beforeAll(async () => {
  installDomShim();
  await import("../../src/pollenprognos-editor.js");
  EditorCtor = (
    globalThis as unknown as {
      customElements: { get: (n: string) => new () => never };
    }
  ).customElements.get("pollenprognos-card-editor");
});

describe("editor SILAM auto-select (issue #302)", () => {
  // The buggy branch only runs when the integration is auto-detected (not set
  // explicitly by the user), so these configs omit `integration` and let the
  // SILAM sensors in hass drive the detection.

  // Regression: setConfig's SILAM branch previously read `installedLocations`,
  // a property that is never assigned, throwing a TypeError at runtime whenever
  // SILAM was auto-detected without an explicit location.
  it("auto-selects the first discovered SILAM location when none is set", () => {
    const editor = new EditorCtor();
    editor._hass = createSilamHass();

    expect(() =>
      editor.setConfig({
        type: "custom:pollenprognos-card",
      }),
    ).not.toThrow();

    expect(editor._config.integration).toBe("silam");
    // Discovery keys the location by config_entry_id ("entry_sthlm").
    expect(editor._config.location).toBe("entry_sthlm");
  });

  it("keeps an explicitly configured SILAM location instead of auto-selecting", () => {
    const editor = new EditorCtor();
    editor._hass = createSilamHass();

    editor.setConfig({
      type: "custom:pollenprognos-card",
      location: "entry_sthlm",
    });

    expect(editor._config.integration).toBe("silam");
    expect(editor._config.location).toBe("entry_sthlm");
  });
});
