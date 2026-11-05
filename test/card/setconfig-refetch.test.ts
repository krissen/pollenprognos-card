import { describe, it, expect, beforeAll, vi } from "vitest";
import { createHass } from "../helpers.js";

/**
 * A data-driven setConfig must refetch with the hass the card already has.
 * It used to go through the hass setter, whose identity guard turned it into
 * a no-op, so a changed location or allergen list waited for the next state
 * update anywhere in Home Assistant. The old code passed every other test, so
 * this one counts the adapter's fetchForecast calls directly.
 */
// The card is a LitElement, so this file installs the same minimal DOM shim as
// the editor tests. Nothing is rendered; only the hass/config lifecycle is
// exercised.
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

let CardCtor: any;
let registry: any;

beforeAll(async () => {
  installDomShim();
  registry = await import("../../src/adapter-registry.js");
  await import("../../src/pollenprognos-card.js");
  CardCtor = (globalThis as any).customElements.get("pollenprognos-card");
});

const BASE = {
  type: "custom:pollenprognos-card",
  integration: "dwd",
  region_id: "11",
};

describe("setConfig refetch (#383 follow-up)", () => {
  it("refetches on a data-driven change, not on the same hass or a cosmetic change", () => {
    const spy = vi.spyOn(registry.getAdapter("dwd"), "fetchForecast");
    const hass = createHass({
      "sensor.pollenflug_birke_11": { state: "1", attributes: {} },
      "sensor.pollenflug_graeser_11": { state: "2", attributes: {} },
    });
    const card = new CardCtor();
    const calls = () => spy.mock.calls.length;

    card.setConfig({ ...BASE, allergens: ["birke"] });
    card.hass = hass;
    const afterHass = calls();
    card.hass = hass; // same object: no-op
    const afterSameHass = calls();
    card.setConfig({ ...BASE, allergens: ["birke", "graeser"] }); // data-driven
    const afterDataChange = calls();
    card.setConfig({ ...BASE, allergens: ["birke", "graeser"], icon_size: 60 }); // cosmetic
    const afterCosmetic = calls();

    expect([afterHass, afterSameHass, afterDataChange, afterCosmetic]).toEqual([
      1, 1, 2, 2,
    ]);
    // the refetch used the hass the card already had
    expect(spy.mock.calls[1]![0]).toBe(hass);
    expect(
      (spy.mock.calls[1]![1] as { allergens: string[] }).allergens,
    ).toEqual(["birke", "graeser"]);
    spy.mockRestore();
  });
});
