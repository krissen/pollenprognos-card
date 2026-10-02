/**
 * hide_no_allergens_display (issue #369) -- a badge-only option.
 *
 * Covers the badge's config boundary and hide logic:
 *   - the option defaults off and coerces the "true"/"false" YAML strings;
 *   - the badge hides itself (renders nothing, flags the host `hidden` and tells
 *     hui-badge via `badge-visibility-changed`) ONLY in the genuine "no
 *     allergens" state;
 *   - the no-information visual, the empty error / loading pills and a badge
 *     shown in an editor / dashboard-edit preview stay visible;
 *   - the card is untouched and keeps its "No allergens" icon and text.
 *
 * The elements are LitElements, so this file installs the same minimal DOM shim
 * the other card tests use and calls render() / the sync method directly.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  ALLERGENS_RESET_KEYS,
  APPEARANCE_RESET_KEYS,
} from "../../src/editor/reset-registry.js";

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

type BadgeLike = {
  setConfig: (config: Record<string, unknown>) => void;
  config: Record<string, unknown>;
  render: () => unknown;
  dispatchEvent: (ev: Event) => boolean;
  _isNoAllergensHidden: () => boolean;
  _syncNoAllergensVisibility: () => void;
  connectedWhileHidden: boolean;
  hidden: boolean;
  preview?: boolean;
  sensors: unknown[];
  _isLoaded: boolean;
  _noPollen: boolean;
  _noData: boolean;
};

type CardLike = {
  setConfig: (config: Record<string, unknown>) => void;
  config: Record<string, unknown>;
  render: () => unknown;
  _isNoAllergensHidden?: () => boolean;
  sensors: unknown[];
  _isLoaded: boolean;
  _error: string | null;
  _availableSensorCount: number;
  _noPollenData: boolean;
};

let BadgeCtor: new () => BadgeLike;
let CardCtor: new () => CardLike;

beforeAll(async () => {
  installDomShim();
  await import("../../src/pollenprognos-badge.js");
  await import("../../src/pollenprognos-card.js");
  const ce = (
    globalThis as unknown as {
      customElements: { get: (n: string) => new () => unknown };
    }
  ).customElements;
  BadgeCtor = ce.get("pollenprognos-badge") as new () => BadgeLike;
  CardCtor = ce.get("pollenprognos-card") as new () => CardLike;
});

/** Badge in the "entities exist, every reading below threshold" state. */
function noPollenBadge(config: Record<string, unknown> = {}): BadgeLike {
  const badge = new BadgeCtor();
  badge.setConfig({
    type: "custom:pollenprognos-badge",
    integration: "pp",
    ...config,
  });
  badge.sensors = [];
  badge._isLoaded = true;
  badge._noPollen = true;
  badge._noData = false;
  return badge;
}

// ---------------------------------------------------------------------------
// Config boundary
// ---------------------------------------------------------------------------

describe("hide_no_allergens_display at the badge config boundary (#369)", () => {
  it("defaults to false", () => {
    const badge = new BadgeCtor();
    badge.setConfig({ type: "custom:pollenprognos-badge", integration: "pp" });
    expect(badge.config.hide_no_allergens_display).toBe(false);
  });

  it.each([
    [true, true],
    ["true", true],
    [false, false],
    ["false", false],
    ["yes", false],
    [1, false],
  ])("coerces %j to %j", (raw, expected) => {
    const badge = new BadgeCtor();
    badge.setConfig({
      type: "custom:pollenprognos-badge",
      integration: "pp",
      hide_no_allergens_display: raw,
    });
    expect(badge.config.hide_no_allergens_display).toBe(expected);
  });
});

describe("badge editor wiring (#369)", () => {
  it("keeps the option out of the shared (card) reset registries", () => {
    expect(ALLERGENS_RESET_KEYS).not.toContain("hide_no_allergens_display");
    expect(APPEARANCE_RESET_KEYS).not.toContain("hide_no_allergens_display");
  });

  it("coerces the YAML string form so the checkbox reflects it", async () => {
    const mod = await import("../../src/pollenprognos-badge-editor.js");
    const EditorCtor = mod.default as unknown as new () => {
      _config: Record<string, unknown>;
      setConfig: (config: Record<string, unknown>) => void;
    };
    const cases: Array<[unknown, boolean]> = [
      ["true", true],
      [true, true],
      ["false", false],
      [undefined, false],
    ];
    for (const [raw, expected] of cases) {
      const editor = new EditorCtor();
      editor.setConfig({
        type: "custom:pollenprognos-badge",
        integration: "pp",
        hide_no_allergens_display: raw,
      });
      expect(editor._config.hide_no_allergens_display).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Badge behaviour
// ---------------------------------------------------------------------------

describe("badge hides the genuine no-allergens state only (#369)", () => {
  it("keeps the breezy image by default", () => {
    const badge = noPollenBadge();
    expect(badge._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(badge.render())).toContain("ppb-item");
  });

  it("renders nothing when the option is on", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    expect(badge._isNoAllergensHidden()).toBe(true);
    expect(deepTemplateText(badge.render())).toBe("");
  });

  it("honours the string form from hand-written YAML", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: "true" });
    expect(badge._isNoAllergensHidden()).toBe(true);
  });

  it("keeps the image when the option is explicitly off", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: false });
    expect(badge._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(badge.render())).toContain("ppb-item");
  });

  it.each(["worst", "aggregate", "single", "row"])(
    "hides in badge_content %s too",
    (badge_content) => {
      const badge = noPollenBadge({
        hide_no_allergens_display: true,
        badge_content,
      });
      expect(badge._isNoAllergensHidden()).toBe(true);
    },
  );

  it("stays visible in a badge-editor / dashboard-edit preview", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    badge.preview = true;
    expect(badge._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(badge.render())).toContain("ppb-item");
  });

  it("stays visible when only the wrapping hui-badge is in preview", () => {
    // HA before 2026.10 sets preview on hui-badge but does not forward it to
    // the badge element, so the badge must read it from its parent.
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    Object.defineProperty(badge, "parentElement", {
      value: { preview: true },
      configurable: true,
    });
    expect(badge._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(badge.render())).toContain("ppb-item");
  });

  it("still hides when the wrapping hui-badge is not in preview", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    Object.defineProperty(badge, "parentElement", {
      value: { preview: false },
      configurable: true,
    });
    expect(badge._isNoAllergensHidden()).toBe(true);
  });

  it("keeps the no-information visual", () => {
    // Entities exist but carry no usable forecast: a data problem.
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    badge._noPollen = false;
    badge._noData = true;
    expect(badge._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(badge.render())).toContain("ppb-item");
  });

  it("keeps the empty error pill", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    badge._noPollen = false;
    expect(badge._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(badge.render())).toContain("ppb-empty");
  });

  it("keeps the loading placeholder", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    badge._isLoaded = false;
    expect(badge._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(badge.render())).toContain("ppb-empty");
  });

  it("does not hide while there is a sensor to show", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    badge.sensors = [
      {
        allergenReplaced: "birch",
        entity_id: "sensor.pollen_birch",
        days: [{ state: 2, display_state: 2 }],
      },
    ];
    expect(badge._isNoAllergensHidden()).toBe(false);
  });

  // The adapters keep a sensor when ANY forecast day meets the threshold, but
  // the badge shows only today: judge the picked sensors by days[0].
  function pickedBadge(
    today: number,
    config: Record<string, unknown> = {},
  ): BadgeLike {
    const badge = noPollenBadge({
      hide_no_allergens_display: true,
      pollen_threshold: 2,
      ...config,
    });
    badge._noPollen = false;
    badge.sensors = [
      {
        allergenReplaced: "birch",
        entity_id: "sensor.pollen_birch",
        days: [
          { state: today, display_state: today },
          { state: 4, display_state: 4 },
        ],
      },
    ];
    return badge;
  }

  it("hides when today is below the threshold but a later day is not", () => {
    expect(pickedBadge(1)._isNoAllergensHidden()).toBe(true);
    expect(pickedBadge(0)._isNoAllergensHidden()).toBe(true);
  });

  it("stays visible when today reaches the threshold", () => {
    expect(pickedBadge(2)._isNoAllergensHidden()).toBe(false);
  });

  it("stays visible when today's pick has no data", () => {
    expect(pickedBadge(-1)._isNoAllergensHidden()).toBe(false);
    expect(pickedBadge(Number.NaN)._isNoAllergensHidden()).toBe(false);
  });

  it("never hides a picked sensor at threshold 0", () => {
    expect(pickedBadge(0, { pollen_threshold: 0 })._isNoAllergensHidden()).toBe(
      false,
    );
  });

  it("judges every retained allergen in aggregate mode, not only the summary", () => {
    const badge = pickedBadge(1, { badge_content: "aggregate" });
    badge.sensors = [
      {
        allergenReplaced: "allergy_risk",
        entity_id: "sensor.pollen_risk",
        isSummary: true,
        days: [{ state: 1, display_state: 1 }],
      },
      {
        allergenReplaced: "birch",
        entity_id: "sensor.pollen_birch",
        days: [{ state: 4, display_state: 4 }],
      },
    ];
    expect(badge._isNoAllergensHidden()).toBe(false);

    badge.sensors = [
      badge.sensors[0],
      {
        allergenReplaced: "birch",
        entity_id: "sensor.pollen_birch",
        days: [{ state: 1, display_state: 1 }],
      },
    ];
    expect(badge._isNoAllergensHidden()).toBe(true);
  });

  it("keeps a below-threshold pick visible when the option is off", () => {
    expect(
      pickedBadge(0, {
        hide_no_allergens_display: false,
      })._isNoAllergensHidden(),
    ).toBe(false);
  });
});

describe("badge collapses its host through hui-badge (#369)", () => {
  function track(badge: BadgeLike) {
    const events: CustomEvent[] = [];
    badge.dispatchEvent = (ev: Event) => {
      events.push(ev as CustomEvent);
      return true;
    };
    return events;
  }

  it("flags the host hidden and fires badge-visibility-changed once", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    const events = track(badge);

    badge._syncNoAllergensVisibility();
    badge._syncNoAllergensVisibility();

    expect(badge.hidden).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("badge-visibility-changed");
    expect(events[0]!.detail).toEqual({ value: false });
    expect(events[0]!.bubbles).toBe(true);
    expect(events[0]!.composed).toBe(true);
  });

  it("reveals the host again when pollen returns", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    const events = track(badge);
    badge._syncNoAllergensVisibility();

    badge._noPollen = false;
    badge.sensors = [
      {
        allergenReplaced: "birch",
        entity_id: "sensor.pollen_birch",
        days: [{ state: 2, display_state: 2 }],
      },
    ];
    badge._syncNoAllergensVisibility();

    expect(badge.hidden).toBe(false);
    expect(events.map((e) => e.detail)).toEqual([
      { value: false },
      { value: true },
    ]);
  });

  it("stays quiet when the option is off", () => {
    const badge = noPollenBadge();
    const events = track(badge);
    badge._syncNoAllergensVisibility();
    expect(badge.hidden).toBeFalsy();
    expect(events).toHaveLength(0);
  });

  it("reveals a hidden badge that enters a preview", () => {
    const badge = noPollenBadge({ hide_no_allergens_display: true });
    const events = track(badge);
    badge._syncNoAllergensVisibility();
    expect(badge.hidden).toBe(true);

    badge.preview = true;
    badge._syncNoAllergensVisibility();

    expect(badge.hidden).toBe(false);
    expect(events.at(-1)!.detail).toEqual({ value: true });
  });

  it("asks hui-badge to keep it connected while hidden", () => {
    expect(new BadgeCtor().connectedWhileHidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The card is unchanged
// ---------------------------------------------------------------------------

describe("the card keeps its no-allergens icon and text (#369)", () => {
  it("ignores the badge-only option", () => {
    const card = new CardCtor();
    card.setConfig({
      type: "custom:pollenprognos-card",
      integration: "pp",
      hide_no_allergens_display: true,
    });
    card.sensors = [];
    card._isLoaded = true;
    card._error = null;
    card._availableSensorCount = 2;
    card._noPollenData = true;

    expect(card._isNoAllergensHidden).toBeUndefined();
    const text = deepTemplateText(card.render());
    expect(text).toContain("no-allergens-container");
    expect(text).toContain("no-allergens-text");
  });
});
