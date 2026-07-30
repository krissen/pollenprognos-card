import { describe, it, expect, beforeAll } from "vitest";
import { createHassWithRegistry } from "../helpers.js";

// The editor is a LitElement and cannot be imported in the bare node test
// environment, so this file installs the same minimal DOM shim as
// editor-silam-autoselect.test.ts. We never render the element; only the
// location-list logic in `set hass` is exercised.
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
 * A Kleenex install whose device was renamed: the entity IDs carry neither the
 * `radar_` prefix nor a location slug, so only the registry knows the location
 * (issue #309).
 */
function renamedKleenexHass(): any {
  return createHassWithRegistry([
    {
      entityId: "sensor.kleenex_pollen_trees",
      state: "200",
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: "dev_home",
      deviceMeta: {
        name: "Kleenex Pollen Radar (Home)",
        identifiers: [["kleenex_pollenradar", "Home"]],
        configEntries: ["entry_home"],
      },
    },
    {
      entityId: "sensor.kleenex_pollen_grass",
      state: "100",
      platform: "kleenex_pollenradar",
      translationKey: "grass",
      deviceId: "dev_home",
    },
  ]);
}

/** Legacy-shaped entity IDs on a device that is nonetheless in the registry. */
function legacyKleenexHass(): any {
  return createHassWithRegistry([
    {
      entityId: "sensor.kleenex_pollen_radar_utrecht_trees",
      state: "200",
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: "dev_utrecht",
      deviceMeta: {
        name: "Kleenex Pollen Radar (Utrecht)",
        identifiers: [["kleenex_pollenradar", "Utrecht"]],
        configEntries: ["entry_utrecht"],
      },
    },
    {
      entityId: "sensor.kleenex_pollen_radar_utrecht_grass",
      state: "100",
      platform: "kleenex_pollenradar",
      translationKey: "grass",
      deviceId: "dev_utrecht",
    },
  ]);
}

let EditorCtor: new () => {
  hass: unknown;
  setConfig: (config: Record<string, unknown>) => void;
  _config: Record<string, unknown>;
  installedKleenexLocations: Array<[string, string]>;
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

describe("editor Kleenex locations via registry discovery (issue #309)", () => {
  it("lists the discovered location with its device label", () => {
    const editor = new EditorCtor();
    editor.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
    });
    editor.hass = renamedKleenexHass();

    expect(editor.installedKleenexLocations).toContainEqual([
      "entry_home",
      "Home",
    ]);
  });

  // The auto-select branch is guarded by `!this._initDone`, i.e. it only runs
  // when hass arrives before setConfig has completed an editing session.
  it("auto-selects the discovered location when none is configured", () => {
    const editor = new EditorCtor();
    editor.hass = renamedKleenexHass();

    expect(editor._config.integration).toBe("kleenex");
    expect(editor._config.location).toBe("entry_home");
  });

  it("keeps a legacy slug config visible as its own dropdown entry", () => {
    const editor = new EditorCtor();
    editor.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "utrecht",
    });
    editor.hass = legacyKleenexHass();

    // The discovered entry (keyed by config entry) plus the legacy slug the
    // config still points at, so the dropdown shows the selected value.
    expect(editor.installedKleenexLocations).toContainEqual([
      "entry_utrecht",
      "Utrecht",
    ]);
    expect(editor.installedKleenexLocations).toContainEqual([
      "utrecht",
      "Utrecht",
    ]);
    expect(editor._config.location).toBe("utrecht");
  });
});
