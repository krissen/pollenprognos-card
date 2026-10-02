/**
 * hide_no_allergens_display (issue #369).
 *
 * Covers the config boundary and the card's hide logic:
 *   - the option defaults off for every integration and coerces "true"/"false";
 *   - the card hides itself (renders nothing, flags the host `hidden` and tells
 *     hui-card via `card-visibility-changed`) ONLY in the genuine "no allergens"
 *     state;
 *   - the no-information, stale and error states stay visible, as does a card
 *     shown in an editor / dashboard-edit preview.
 *
 * The card is a LitElement, so this file installs the same minimal DOM shim the
 * other card tests use and calls render() / the sync method directly.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { getAllAdapterIds, getStubConfig } from "../../src/adapter-registry.js";
import { stubConfigPP } from "../../src/adapters/pp.js";
import { COSMETIC_FIELDS } from "../../src/constants.js";
import { normalizeCardConfig } from "../../src/utils/config-normalize.js";
import { ALLERGENS_RESET_KEYS } from "../../src/editor/reset-registry.js";

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

/** Recursively flatten a lit TemplateResult tree into one searchable string. */
function deepTemplateText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(deepTemplateText).join("");
  const tpl = node as { strings?: readonly string[]; values?: unknown[] };
  if (tpl.strings) {
    return (
      tpl.strings.join("") + (tpl.values ?? []).map(deepTemplateText).join("")
    );
  }
  return "";
}

// ---------------------------------------------------------------------------
// Config boundary
// ---------------------------------------------------------------------------

describe("hide_no_allergens_display at the config boundary (#369)", () => {
  it.each(getAllAdapterIds())("defaults to false for %s", (id) => {
    expect(getStubConfig(id)?.hide_no_allergens_display).toBe(false);
  });

  it("survives setConfig's allowed-field filter", () => {
    const cfg = normalizeCardConfig(
      { integration: "pp", hide_no_allergens_display: true },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.hide_no_allergens_display).toBe(true);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("coerces the YAML string %j to %j", (raw, expected) => {
    const cfg = normalizeCardConfig(
      { integration: "pp", hide_no_allergens_display: raw },
      stubConfigPP,
      { integration: "pp", filter: true },
    );
    expect(cfg.hide_no_allergens_display).toBe(expected);
  });

  it("is a cosmetic field: toggling it does not refetch data", () => {
    expect(COSMETIC_FIELDS).toContain("hide_no_allergens_display");
  });

  it("is cleared by the Allergens section reset", () => {
    expect(ALLERGENS_RESET_KEYS).toContain("hide_no_allergens_display");
  });
});

// ---------------------------------------------------------------------------
// Card behaviour
// ---------------------------------------------------------------------------

type CardLike = {
  setConfig: (config: Record<string, unknown>) => void;
  render: () => unknown;
  dispatchEvent: (ev: Event) => boolean;
  _isNoAllergensHidden: () => boolean;
  _syncNoAllergensVisibility: () => void;
  connectedWhileHidden: boolean;
  hidden: boolean;
  preview?: boolean;
  sensors: unknown[];
  _isLoaded: boolean;
  _error: string | null;
  _availableSensorCount: number;
  _noPollenData: boolean;
};

let CardCtor: new () => CardLike;

beforeAll(async () => {
  installDomShim();
  await import("../../src/pollenprognos-card.js");
  const ce = (
    globalThis as unknown as {
      customElements: { get: (n: string) => new () => CardLike };
    }
  ).customElements;
  CardCtor = ce.get("pollenprognos-card");
});

/** Card in the "entities exist, every reading below threshold" state. */
function noPollenCard(config: Record<string, unknown> = {}): CardLike {
  const card = new CardCtor();
  card.setConfig({
    type: "custom:pollenprognos-card",
    integration: "pp",
    ...config,
  });
  card.sensors = [];
  card._isLoaded = true;
  card._error = null;
  card._availableSensorCount = 2;
  card._noPollenData = true;
  return card;
}

describe("card hides the genuine no-allergens state only (#369)", () => {
  it("keeps the placeholder by default", () => {
    const card = noPollenCard();
    expect(card._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(card.render())).toContain("no-allergens-container");
  });

  it("renders nothing when the option is on", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    expect(card._isNoAllergensHidden()).toBe(true);
    expect(deepTemplateText(card.render())).toBe("");
  });

  it("honours the string form from hand-written YAML", () => {
    const card = noPollenCard({ hide_no_allergens_display: "true" });
    expect(card._isNoAllergensHidden()).toBe(true);
  });

  it("keeps the placeholder when the option is explicitly off", () => {
    const card = noPollenCard({ hide_no_allergens_display: false });
    expect(card._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(card.render())).toContain("no-allergens-container");
  });

  it("stays visible in an editor / dashboard-edit preview", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    card.preview = true;
    expect(card._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(card.render())).toContain("no-allergens-container");
  });

  it("keeps the no-information state visible", () => {
    // Entities exist but carry no usable forecast: a data problem.
    const card = noPollenCard({ hide_no_allergens_display: true });
    card._noPollenData = false;
    expect(card._isNoAllergensHidden()).toBe(false);
    const text = deepTemplateText(card.render());
    expect(text).toContain("no-allergens-container");
    expect(text).toContain("(No information)");
  });

  it("keeps the no-sensors error visible", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    card._availableSensorCount = 0;
    expect(card._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(card.render())).toContain("card-error");
  });

  it("keeps a reported error visible", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    card._error = "card.error_entity_unavailable";
    expect(card._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(card.render())).toContain("card-error");
  });

  it("keeps the loading state visible", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    card._isLoaded = false;
    expect(card._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(card.render())).not.toBe("");
  });

  it("does not hide while there are sensors to show", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    card.sensors = [{ allergenReplaced: "birch", days: [] }];
    expect(card._isNoAllergensHidden()).toBe(false);
  });
});

describe("card collapses its host through hui-card (#369)", () => {
  function track(card: CardLike) {
    const events: CustomEvent[] = [];
    card.dispatchEvent = (ev: Event) => {
      events.push(ev as CustomEvent);
      return true;
    };
    return events;
  }

  it("flags the host hidden and fires card-visibility-changed once", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    const events = track(card);

    card._syncNoAllergensVisibility();
    card._syncNoAllergensVisibility();

    expect(card.hidden).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("card-visibility-changed");
    expect(events[0]!.detail).toEqual({ value: false });
    expect(events[0]!.bubbles).toBe(true);
    expect(events[0]!.composed).toBe(true);
  });

  it("reveals the host again when pollen returns", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    const events = track(card);
    card._syncNoAllergensVisibility();

    card._noPollenData = false;
    card.sensors = [{ allergenReplaced: "birch", days: [] }];
    card._syncNoAllergensVisibility();

    expect(card.hidden).toBe(false);
    expect(events.map((e) => e.detail)).toEqual([
      { value: false },
      { value: true },
    ]);
  });

  it("stays quiet when the option is off", () => {
    const card = noPollenCard();
    const events = track(card);
    card._syncNoAllergensVisibility();
    expect(card.hidden).toBeFalsy();
    expect(events).toHaveLength(0);
  });

  it("does not hide in a preview and reveals a hidden card entering one", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    const events = track(card);
    card._syncNoAllergensVisibility();
    expect(card.hidden).toBe(true);

    card.preview = true;
    card._syncNoAllergensVisibility();

    expect(card.hidden).toBe(false);
    expect(events.at(-1)!.detail).toEqual({ value: true });
  });

  it("asks hui-card to keep it connected while hidden", () => {
    expect(new CardCtor().connectedWhileHidden).toBe(true);
  });
});
