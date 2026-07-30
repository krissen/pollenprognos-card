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

/**
 * The device was renamed AND its entities re-minted from the new name, so
 * neither the entity IDs nor the visible device name carry the original "Home"
 * instance any more. Only the device identifier still does.
 */
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

/**
 * Two config entries whose instance names normalize to the same slug AND whose
 * labels are identical, so neither the identifier nor the label can tell them
 * apart.
 */
function ambiguousKleenexHass(): any {
  const device = (instance: string, prefix: string, id: string, cfg: string) => ({
    entityId: `sensor.${prefix}_trees`,
    state: "200",
    platform: "kleenex_pollenradar",
    translationKey: "trees",
    deviceId: id,
    deviceMeta: {
      name: `Kleenex Pollen Radar (${instance})`,
      nameByUser: "St John",
      identifiers: [["kleenex_pollenradar", instance] as [string, string]],
      configEntries: [cfg],
    },
  });
  return createHassWithRegistry([
    device("St. John", "kleenex_a", "dev_a", "cfg_a"),
    device("St John", "kleenex_b", "dev_b", "cfg_b"),
  ]);
}

/**
 * Codex round 7: no usable identifier (so discovery keys by config entry) AND
 * re-minted entity IDs (so no entity-ID slug matches either). The device label
 * is the only thing a saved `location: home` can still resolve through.
 */
function labelOnlyKleenexHass(): any {
  return createHassWithRegistry([
    {
      entityId: "sensor.my_pollen_trees",
      state: "200",
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: "dev_home",
      deviceMeta: {
        name: "Home",
        identifiers: [],
        configEntries: ["entry_home"],
      },
    },
    {
      entityId: "sensor.my_pollen_grass",
      state: "100",
      platform: "kleenex_pollenradar",
      translationKey: "grass",
      deviceId: "dev_home",
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
  it("lists the discovered location keyed by the device identifier slug", () => {
    const editor = new EditorCtor();
    editor.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
    });
    editor.hass = renamedKleenexHass();

    expect(editor.installedKleenexLocations).toContainEqual([
      "home",
      "Home",
    ]);
  });

  // The auto-select branch is guarded by `!this._initDone`, i.e. it only runs
  // when hass arrives before setConfig has completed an editing session.
  it("auto-selects the discovered location when none is configured", () => {
    const editor = new EditorCtor();
    editor.hass = renamedKleenexHass();

    expect(editor._config.integration).toBe("kleenex");
    expect(editor._config.location).toBe("home");
  });

  // Codex P1 on PR #311: with the device and its entities both renamed, the
  // legacy slug matches no entity ID and no visible device name, so the
  // dropdown lost the configured value entirely. The device identifier is the
  // only rename-stable candidate left.
  it("keeps a legacy slug config visible when the entity IDs were re-minted", () => {
    const editor = new EditorCtor();
    editor.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "home",
    });
    editor.hass = reMintedKleenexHass();

    expect(editor.installedKleenexLocations).toContainEqual([
      "home",
      "My Pollen",
    ]);
    expect(editor._config.location).toBe("home");
  });

  // Nagelfar issue-001: appending the configured value produced two options
  // with the same label, and picking the wrong one silently rewrote the key.
  it("re-keys the matched entry instead of listing the label twice", () => {
    const editor = new EditorCtor();
    editor.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "utrecht",
    });
    editor.hass = identifierlessKleenexHass();

    const list = editor.installedKleenexLocations;
    expect(list).toEqual([["utrecht", "Utrecht"]]);
    expect(list.filter(([, label]) => label === "Utrecht").length).toBe(1);
  });

  // Codex P2 (round 7): the compat path only searched entity IDs, so a config
  // that the adapter resolves through the device label was dropped from the
  // list and the selector showed nothing selected.
  it("keeps a config that only the device label can resolve", () => {
    const editor = new EditorCtor();
    editor.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "home",
    });
    editor.hass = labelOnlyKleenexHass();

    const list = editor.installedKleenexLocations;
    expect(list).toEqual([["home", "Home"]]);
    expect(editor._config.location).toBe("home");
  });

  // Codex P2 (round 6). Contract guard rather than a regression test: the
  // editor's own fallback (findLocationBySlug) matches on entity-ID slugs,
  // which two devices cannot share, so only the card's label-based chain could
  // actually mis-resolve here. This pins the editor to the same "ambiguous ->
  // offer nothing" semantics so a future fallback change cannot reintroduce
  // the guess.
  it("adds no compat entry when the configured value is ambiguous", () => {
    const editor = new EditorCtor();
    editor.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "St John",
    });
    editor.hass = ambiguousKleenexHass();

    const list = editor.installedKleenexLocations;
    expect(list.some(([key]) => key === "St John")).toBe(false);
    expect(list.map(([key]) => key).sort()).toEqual(["cfg_a", "cfg_b"]);
  });

  it("lists a legacy slug config once, as the discovered entry itself", () => {
    const editor = new EditorCtor();
    editor.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "utrecht",
    });
    editor.hass = legacyKleenexHass();

    // The legacy slug is the discovery key now, so the configured value IS the
    // discovered entry rather than a second one beside it.
    expect(editor.installedKleenexLocations).toEqual([["utrecht", "Utrecht"]]);
    expect(editor._config.location).toBe("utrecht");
  });
});
