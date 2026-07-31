import { describe, it, expect, beforeAll } from "vitest";
import { createHass, createHassWithRegistry } from "../helpers.js";

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

/**
 * Same install, but the diagnostic siblings come first in hass.states -- the
 * order HA happens to hand them over is not something the card can rely on.
 */
function diagnosticsFirstHass(): any {
  return createHass({
    "sensor.kleenex_pollen_date": {
      entity_id: "sensor.kleenex_pollen_date",
      state: "2026-04-25",
      attributes: { friendly_name: "Kleenex pollen Date" },
    },
    "sensor.kleenex_pollen_last_updated": {
      entity_id: "sensor.kleenex_pollen_last_updated",
      state: "2026-04-25T10:00:00+00:00",
      attributes: { friendly_name: "Kleenex pollen Last updated" },
    },
    "sensor.kleenex_pollen_trees": {
      entity_id: "sensor.kleenex_pollen_trees",
      state: "200",
      attributes: {
        friendly_name: "Kleenex pollen Trees",
        details: [],
        forecast: [],
      },
    },
  });
}

/**
 * Diagnostics first again, but every entity carries a configured
 * entity_suffix, so the classifier only recognises the category sensor once
 * the suffix is stripped.
 */
function suffixedDiagnosticsFirstHass(): any {
  return createHass({
    "sensor.kleenex_pollen_date_v2": {
      entity_id: "sensor.kleenex_pollen_date_v2",
      state: "2026-04-25",
      attributes: { friendly_name: "Kleenex pollen Date v2" },
    },
    "sensor.kleenex_pollen_trees_v2": {
      entity_id: "sensor.kleenex_pollen_trees_v2",
      state: "200",
      attributes: {
        friendly_name: "Kleenex pollen Trees v2",
        details: [],
        forecast: [],
      },
    },
  });
}

/**
 * Both an unsuffixed and a suffixed sensor match the prefix, the unsuffixed one
 * first. Only the `_v2` pair belongs to this card (Codex round 15).
 */
function mixedSuffixHass(): any {
  return createHass({
    "sensor.kleenex_pollen_trees": {
      entity_id: "sensor.kleenex_pollen_trees",
      state: "10",
      attributes: {
        friendly_name: "Old kleenex Trees",
        details: [],
        forecast: [],
      },
    },
    "sensor.kleenex_pollen_trees_v2": {
      entity_id: "sensor.kleenex_pollen_trees_v2",
      state: "200",
      attributes: {
        friendly_name: "Kleenex pollen Trees",
        details: [],
        forecast: [],
      },
    },
  });
}

/**
 * Two config entries whose entity IDs collide under the prefix
 * `kleenex_pollen_`: Paris on a renamed device, Utrecht on the legacy naming.
 */
function collidingLocationsHass(): any {
  const attrs = { details: [], forecast: [] };
  // Utrecht first: the pre-fix header picked whichever colliding entity
  // hass.states listed first, so the order is what reproduced the bug.
  return createHassWithRegistry([
    {
      entityId: "sensor.kleenex_pollen_radar_utrecht_trees",
      state: "20",
      attributes: {
        friendly_name: "Kleenex Pollen Radar (Utrecht) Trees",
        ...attrs,
      },
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: "dev_utrecht",
      deviceMeta: {
        name: "Kleenex Pollen Radar (Utrecht)",
        identifiers: [["kleenex_pollenradar", "Utrecht"]],
        configEntries: ["cfg_utrecht"],
      },
    },
    {
      entityId: "sensor.kleenex_pollen_radar_utrecht_grass",
      state: "10",
      attributes: {
        friendly_name: "Kleenex Pollen Radar (Utrecht) Grass",
        ...attrs,
      },
      platform: "kleenex_pollenradar",
      translationKey: "grass",
      deviceId: "dev_utrecht",
    },
    {
      entityId: "sensor.kleenex_pollen_trees",
      state: "200",
      attributes: { friendly_name: "Kleenex pollen Trees", ...attrs },
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: "dev_paris",
      deviceMeta: {
        name: "Kleenex Pollen Radar (Paris)",
        nameByUser: "Kleenex pollen",
        identifiers: [["kleenex_pollenradar", "Paris"]],
        configEntries: ["cfg_paris"],
      },
    },
  ] as any);
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

  // Codex P2 (round 4): the prefix also matches `_date` / `_last_updated`, so
  // an unrestricted find picked whichever came first in hass.states and could
  // derive a header of "Kleenex pollen Date".
  it("ignores diagnostic sensors that share the prefix", () => {
    const card = new CardCtor();
    card.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "manual",
      entity_prefix: "kleenex_pollen_",
      allergens: ["trees"],
    });
    card.hass = diagnosticsFirstHass();

    expect(card.header).toBe("Pollen forecast for Kleenex pollen");
  });

  it("names the header from a suffixed sensor, not its unsuffixed sibling", () => {
    const card = new CardCtor();
    card.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "manual",
      entity_prefix: "kleenex_pollen_",
      entity_suffix: "_v2",
      allergens: ["trees"],
    });
    card.hass = mixedSuffixHass();

    expect(card.header).toBe("Pollen forecast for Kleenex pollen");
  });

  // Codex P2 (round 5): the classifier reads the trailing token, so with an
  // entity_suffix configured every entity looked unrenderable and the fallback
  // picked the diagnostic sensor again.
  it("ignores diagnostic sensors when an entity_suffix is configured", () => {
    const card = new CardCtor();
    card.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "manual",
      entity_prefix: "kleenex_pollen_",
      entity_suffix: "_v2",
      allergens: ["trees"],
    });
    card.hass = suffixedDiagnosticsFirstHass();

    expect(card.header).toBe("Pollen forecast for Kleenex pollen");
  });

  // The prefix `kleenex_pollen_` also matches another config entry's legacy
  // `kleenex_pollen_radar_utrecht_*` IDs, and Utrecht came first in
  // hass.states, so the header named a location the card wasn't rendering.
  it("names the location the prefix was minted from, not a colliding one", () => {
    const card = new CardCtor();
    card.setConfig({
      type: "custom:pollenprognos-card",
      integration: "kleenex",
      location: "manual",
      entity_prefix: "kleenex_pollen_",
      allergens: ["trees"],
    });
    card.hass = collidingLocationsHass();

    expect(card.header).toBe("Pollen forecast for Kleenex pollen");
  });
});
