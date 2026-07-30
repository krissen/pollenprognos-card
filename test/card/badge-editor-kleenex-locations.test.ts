import { describe, it, expect, beforeAll } from "vitest";
import { createHassWithRegistry } from "../helpers.js";
import { detectIntegrationStates } from "../../src/utils/autodetect.js";

// The badge editor is a LitElement, so this file installs the same minimal DOM
// shim as editor-silam-autoselect.test.ts / editor-kleenex-registry.test.ts.
// We never render the element; only _populateInstalledLocations is exercised.
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

/** Legacy-shaped entity IDs on a device that is present in the registry. */
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

/**
 * A device with no usable identifier, so discovery keys it by config entry
 * while the config still holds the legacy entity-ID slug.
 */
function identifierlessKleenexHass(): any {
  return createHassWithRegistry([
    {
      entityId: "sensor.kleenex_pollen_radar_utrecht_trees",
      state: "200",
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: "dev_utrecht",
      deviceMeta: {
        name: "Kleenex Pollen Radar (Utrecht)",
        identifiers: [],
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

/** Device and entities both renamed: only the identifier still says "Home". */
function reMintedKleenexHass(): any {
  return createHassWithRegistry([
    {
      entityId: "sensor.my_pollen_trees",
      state: "200",
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: "dev_renamed",
      deviceMeta: {
        name: "Kleenex Pollen Radar (Home)",
        nameByUser: "My Pollen",
        identifiers: [["kleenex_pollenradar", "Home"]],
        configEntries: ["entry_renamed"],
      },
    },
    {
      entityId: "sensor.my_pollen_grass",
      state: "100",
      platform: "kleenex_pollenradar",
      translationKey: "grass",
      deviceId: "dev_renamed",
    },
  ]);
}

let BadgeEditorCtor: new () => {
  _config: Record<string, unknown>;
  installedKleenexLocations: Array<[string, string]>;
  _populateInstalledLocations: (detection: any, hass: any) => void;
};

beforeAll(async () => {
  installDomShim();
  const mod = await import("../../src/pollenprognos-badge-editor.js");
  BadgeEditorCtor = mod.default as unknown as typeof BadgeEditorCtor;
});

/** Populate the lists for a badge config against the given hass. */
function locationsFor(config: Record<string, unknown>, hass: any) {
  const editor = new BadgeEditorCtor();
  editor._config = config;
  editor._populateInstalledLocations(detectIntegrationStates(hass), hass);
  return editor.installedKleenexLocations;
}

describe("badge editor Kleenex legacy-slug compatibility (issue #309)", () => {
  it("lists the discovered location keyed by the device identifier slug", () => {
    expect(
      locationsFor({ integration: "kleenex" }, legacyKleenexHass()),
    ).toContainEqual(["utrecht", "Utrecht"]);
  });

  // A legacy slug now hits the discovery key directly, so the selector binds
  // without any compatibility entry at all.
  it("keeps a saved legacy slug selectable", () => {
    expect(
      locationsFor(
        { integration: "kleenex", location: "utrecht" },
        legacyKleenexHass(),
      ),
    ).toContainEqual(["utrecht", "Utrecht"]);
  });

  it("resolves a legacy slug via the device identifier when IDs were re-minted", () => {
    expect(
      locationsFor(
        { integration: "kleenex", location: "home" },
        reMintedKleenexHass(),
      ),
    ).toContainEqual(["home", "My Pollen"]);
  });

  it("re-keys the matched entry instead of listing the label twice", () => {
    const list = locationsFor(
      { integration: "kleenex", location: "utrecht" },
      identifierlessKleenexHass(),
    );

    expect(list).toEqual([["utrecht", "Utrecht"]]);
    expect(list.filter(([, label]) => label === "Utrecht").length).toBe(1);
  });

  it("adds no compat entry in manual mode", () => {
    const list = locationsFor(
      { integration: "kleenex", location: "manual" },
      legacyKleenexHass(),
    );
    expect(list).toEqual([["utrecht", "Utrecht"]]);
  });
});
