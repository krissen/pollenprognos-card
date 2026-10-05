/**
 * hide_no_allergens_display (issue #369) -- for the badge and the card.
 *
 * Covers the config boundary and hide logic of both elements:
 *   - the option defaults off and coerces the "true"/"false" YAML strings;
 *   - the badge hides itself (renders nothing, flags the host `hidden` and tells
 *     hui-badge via `badge-visibility-changed`) ONLY in the genuine "no
 *     allergens" state (the card likewise, via `card-visibility-changed`);
 *   - the no-information visual, the empty error / loading pills and a badge
 *     shown in an editor / dashboard-edit preview stay visible;
 *   - the same for the card: no information, errors, missing sensors, loading
 *     and previews stay visible.
 *
 * The elements are LitElements, so this file installs the same minimal DOM shim
 * the other card tests use and calls render() / the sync method directly.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  ALLERGENS_RESET_KEYS,
  APPEARANCE_RESET_KEYS,
} from "../../src/editor/reset-registry.js";
import { COSMETIC_FIELDS } from "../../src/constants.js";
import type { HomeAssistant } from "../../src/types/home-assistant.js";
import { createHass, createPPSensor } from "../helpers.js";

/**
 * Per-test fetch override. The registry hands out frozen adapter module
 * namespaces, so tests cannot reassign `fetchForecast` on the adapter itself.
 * Instead the registry mock below wraps the real adapter in a plain object
 * with a delegating `fetchForecast` whenever an override is installed.
 */
const fetchOverrides = vi.hoisted(() => ({
  pp: null as ((...args: any[]) => Promise<any>) | null,
  silam: null as ((...args: any[]) => Promise<any>) | null,
}));

vi.mock("../../src/adapter-registry.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/adapter-registry.js")>();
  return {
    ...actual,
    getAdapter: (id: string | undefined) => {
      const real = actual.getAdapter(id);
      const override =
        id === "pp"
          ? fetchOverrides.pp
          : id === "silam"
            ? fetchOverrides.silam
            : null;
      if (!real || !override) return real;
      return { ...real, fetchForecast: override };
    },
  };
});

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
  updated: (changed: Map<string, unknown>) => void;
  dispatchEvent: (ev: Event) => boolean;
  _isNoAllergensHidden: () => boolean;
  _updateSensorsAfterForecastEvent: () => void;
  connectedWhileHidden: boolean;
  hidden: boolean;
  preview?: boolean;
  hass: HomeAssistant;
  _hass: unknown;
  _forecastEvent: unknown;
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
  it("resets with the Allergens section, shared by card and badge", () => {
    expect(ALLERGENS_RESET_KEYS).toContain("hide_no_allergens_display");
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

describe("card editor wiring (#369)", () => {
  type CardEditorLike = {
    _config: Record<string, unknown>;
    hass: unknown;
    setConfig: (config: Record<string, unknown>) => void;
  };

  it("keeps the YAML string coerced when hass rebuilds the config", async () => {
    await import("../../src/pollenprognos-editor.js");
    const EditorCtor = (
      globalThis as unknown as {
        customElements: { get: (n: string) => new () => CardEditorLike };
      }
    ).customElements.get("pollenprognos-card-editor");
    const editor = new EditorCtor();
    editor.setConfig({
      type: "custom:pollenprognos-card",
      integration: "pp",
      city: "Stockholm",
      hide_no_allergens_display: "true",
    });
    expect(editor._config.hide_no_allergens_display).toBe(true);
    // set hass rebuilds _config from the stored user config; the raw string
    // must not come back and uncheck the box.
    editor.hass = createHass({
      "sensor.pollen_stockholm_bjork": createPPSensor([1]),
    });
    expect(editor._config.hide_no_allergens_display).toBe(true);
  });

  it("counts the option as cosmetic, so toggling it does not refetch", () => {
    expect(COSMETIC_FIELDS).toContain("hide_no_allergens_display");
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

describe("the card hides the genuine no-allergens state only (#369)", () => {
  it("keeps the No allergens icon and text by default", () => {
    const card = noPollenCard();
    expect(card._isNoAllergensHidden()).toBe(false);
    const text = deepTemplateText(card.render());
    expect(text).toContain("no-allergens-container");
    expect(text).toContain("no-allergens-text");
  });

  it("renders nothing when the option is on", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    expect(card._isNoAllergensHidden()).toBe(true);
    expect(deepTemplateText(card.render())).toBe("");
  });

  it("keeps the option and coerces the YAML string at setConfig", () => {
    const card = noPollenCard({ hide_no_allergens_display: "true" });
    expect(card.config.hide_no_allergens_display).toBe(true);
    expect(card._isNoAllergensHidden()).toBe(true);
    expect(
      noPollenCard({ hide_no_allergens_display: "false" }).config
        .hide_no_allergens_display,
    ).toBe(false);
  });

  it("keeps No information visible", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    card._noPollenData = false;
    expect(card._isNoAllergensHidden()).toBe(false);
    expect(deepTemplateText(card.render())).toContain("no-allergens-container");
  });

  it("keeps errors and missing sensors visible", () => {
    const errored = noPollenCard({ hide_no_allergens_display: true });
    errored._error = "card.error_entity_unavailable";
    expect(errored._isNoAllergensHidden()).toBe(false);

    const noSensors = noPollenCard({ hide_no_allergens_display: true });
    noSensors._availableSensorCount = 0;
    expect(noSensors._isNoAllergensHidden()).toBe(false);
  });

  it("keeps the loading state visible", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    card._isLoaded = false;
    expect(card._isNoAllergensHidden()).toBe(false);
  });

  it("does not hide while there are allergens to show", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    card.sensors = [{ allergenReplaced: "birch", days: [{ state: 3 }] }];
    expect(card._isNoAllergensHidden()).toBe(false);
  });

  it("stays visible in an editor / dashboard-edit preview", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    card.preview = true;
    expect(card._isNoAllergensHidden()).toBe(false);

    const wrapped = noPollenCard({ hide_no_allergens_display: true });
    Object.defineProperty(wrapped, "parentElement", {
      value: { preview: true },
      configurable: true,
    });
    expect(wrapped._isNoAllergensHidden()).toBe(false);
  });
});

describe("the card collapses its host through hui-card (#369)", () => {
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
    card.updated(new Map());
    card.updated(new Map());
    expect(card.hidden).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("card-visibility-changed");
    expect(events[0]!.detail).toEqual({ value: false });
  });

  it("reveals the host again when pollen returns", () => {
    const card = noPollenCard({ hide_no_allergens_display: true });
    const events = track(card);
    card.updated(new Map());
    card.sensors = [{ allergenReplaced: "birch", days: [{ state: 3 }] }];
    card.updated(new Map());
    expect(card.hidden).toBe(false);
    expect(events.at(-1)!.detail).toEqual({ value: true });
  });

  it("asks hui-card to keep it connected while hidden", () => {
    expect(new CardCtor().connectedWhileHidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A fetch failure clears the hidden no-pollen state (PR #372 review follow-up)
// ---------------------------------------------------------------------------

/** Let queued promise continuations (the card's fetch chains) run. */
async function flushFetches(times = 25): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

/** Card with explicit silam integration in the genuine no-pollen state. */
function noPollenSilamCard(config: Record<string, unknown> = {}): CardLike {
  const card = new CardCtor();
  card.setConfig({
    type: "custom:pollenprognos-card",
    integration: "silam",
    hide_no_allergens_display: true,
    ...config,
  });
  card.sensors = [];
  card._isLoaded = true;
  card._error = null;
  card._availableSensorCount = 2;
  card._noPollenData = true;
  return card;
}

describe("a fetch failure clears the hidden no-pollen state (#372)", () => {
  it("set hass: a rejected refresh unhides the card and shows the error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchOverrides.pp = () => Promise.reject(new Error("fetch failed"));
    try {
      const card = noPollenCard({ hide_no_allergens_display: true });
      expect(card._isNoAllergensHidden()).toBe(true);

      card.hass = createHass({
        "sensor.pollen_stockholm_bjork": createPPSensor([0, 0, 0]),
      });
      await flushFetches();

      expect(card._noPollenData).toBe(false);
      expect(card._error).toBe("card.error_entity_unavailable");
      expect(card._isNoAllergensHidden()).toBe(false);
      expect(deepTemplateText(card.render())).toContain("card-error");
    } finally {
      fetchOverrides.pp = null;
      errorSpy.mockRestore();
    }
  });

  it("SILAM forecast-event fetch: a rejection unhides the card and shows the error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchOverrides.silam = () => Promise.reject(new Error("fetch failed"));
    try {
      const card = noPollenSilamCard();
      expect(card._isNoAllergensHidden()).toBe(true);

      card._hass = createHass({
        "sensor.pollen_stockholm_bjork": createPPSensor([0, 0, 0]),
      });
      card._forecastEvent = {};
      card._updateSensorsAfterForecastEvent();
      await flushFetches();

      expect(card._noPollenData).toBe(false);
      expect(card._error).toBe("card.error_entity_unavailable");
      expect(card._isNoAllergensHidden()).toBe(false);
      expect(deepTemplateText(card.render())).toContain("card-error");
    } finally {
      fetchOverrides.silam = null;
      errorSpy.mockRestore();
    }
  });

  it("a superseded fetch failure does not clobber newer state", async () => {
    let rejectFirst!: (reason?: unknown) => void;
    let calls = 0;
    fetchOverrides.pp = () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<never>((_, reject) => {
          rejectFirst = reject;
        });
      }
      return Promise.resolve([]);
    };
    try {
      const card = noPollenCard({ hide_no_allergens_display: true });
      card.hass = createHass({
        "sensor.pollen_stockholm_bjork": createPPSensor([0, 0, 0]),
      });
      // A newer fetch starts before the first one settles.
      card.hass = createHass({});
      await flushFetches();
      expect(calls).toBe(2);

      // The stale fetch now fails: the guard must drop it before it can
      // record an error over the newer successful state.
      rejectFirst(new Error("stale failure"));
      await flushFetches();

      expect(card._error).toBe(null);
      expect(card._noPollenData).toBe(false);
    } finally {
      fetchOverrides.pp = null;
    }
  });

  it("set hass: recovery with unchanged data clears the error and hides again", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Main fetch resolves empty; the threshold-0 classification re-fetch
    // reports one valid reading, i.e. genuine no pollen.
    const emptyThenValid = () => {
      let n = 0;
      return () => {
        n += 1;
        if (n % 2 === 1) return Promise.resolve([]);
        return Promise.resolve([{ days: [{ state: 0 }] }]);
      };
    };
    const twoSensorHass = () =>
      createHass({
        "sensor.pollen_stockholm_bjork": createPPSensor([0, 0, 0]),
        "sensor.pollen_stockholm_gras": createPPSensor([0, 0, 0]),
      });
    try {
      const card = noPollenCard({ hide_no_allergens_display: true });
      // Settle into the classified no-pollen state (hidden).
      fetchOverrides.pp = emptyThenValid();
      card.hass = twoSensorHass();
      await flushFetches();
      expect(card._error).toBe(null);
      expect(card._noPollenData).toBe(true);
      expect(card._isNoAllergensHidden()).toBe(true);

      // A transient failure surfaces the error (visible again).
      fetchOverrides.pp = () => Promise.reject(new Error("fetch failed"));
      card.hass = twoSensorHass();
      await flushFetches();
      expect(card._error).toBe("card.error_entity_unavailable");
      expect(card._isNoAllergensHidden()).toBe(false);

      // An identical successful refresh early-returns in
      // _updateSensorsAndColumns, so the error must already be cleared by the
      // success path itself for the card to recover (and hide) here.
      fetchOverrides.pp = emptyThenValid();
      card.hass = twoSensorHass();
      await flushFetches();
      expect(card._noPollenData).toBe(true);
      expect(card._error).toBe(null);
      expect(card._isNoAllergensHidden()).toBe(true);
      expect(deepTemplateText(card.render())).toBe("");
    } finally {
      fetchOverrides.pp = null;
      errorSpy.mockRestore();
    }
  });

  it("SILAM forecast-event fetch: recovery with unchanged data clears the error", async () => {
    fetchOverrides.silam = () => Promise.resolve([]);
    try {
      const card = noPollenSilamCard();
      card._hass = createHass({});
      card._forecastEvent = {};
      // Settle the displayed state so the next identical success early-returns
      // in _updateSensorsAndColumns ...
      card._updateSensorsAfterForecastEvent();
      await flushFetches();
      expect(card._error).toBe(null);
      // ... then simulate the post-failure state the SILAM catch produces
      // (covered by the rejection test above) ...
      card._error = "card.error_entity_unavailable";
      // ... and recover with the same unchanged data.
      card._updateSensorsAfterForecastEvent();
      await flushFetches();
      expect(card._error).toBe(null);
    } finally {
      fetchOverrides.silam = null;
    }
  });
});
