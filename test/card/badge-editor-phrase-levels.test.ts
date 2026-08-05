import { describe, it, expect, beforeAll } from "vitest";

// The badge editor is a LitElement, so this file installs the same minimal DOM
// shim as badge-editor-kleenex-locations.test.ts. The element is never
// rendered; only _showPhraseLevels() is exercised against a config.
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

let BadgeEditorCtor: new () => {
  _config: Record<string, unknown>;
  _showPhraseLevels: () => boolean;
};

beforeAll(async () => {
  installDomShim();
  const mod = await import("../../src/pollenprognos-badge-editor.js");
  BadgeEditorCtor = mod.default as unknown as typeof BadgeEditorCtor;
});

function showsLevels(config: Record<string, unknown>): boolean {
  const editor = new BadgeEditorCtor();
  editor._config = { integration: "pp", ...config };
  return editor._showPhraseLevels();
}

// The level-name phrase fields are hidden on a badge that shows only the
// allergen name, but badge_label_content level/allergen_level render
// days[0].state_text, so those strings must stay editable (Codex round 1 on
// the #63 label work).
describe("badge editor level-name phrases follow badge_label_content", () => {
  it("stays hidden for a badge with no label", () => {
    expect(showsLevels({})).toBe(false);
    expect(showsLevels({ badge_label_content: "level" })).toBe(false);
    expect(
      showsLevels({ badge_show_label: false, badge_label_content: "level" }),
    ).toBe(false);
  });

  it("stays hidden when the label shows the allergen name only", () => {
    expect(showsLevels({ badge_show_label: true })).toBe(false);
    expect(
      showsLevels({ badge_show_label: true, badge_label_content: "allergen" }),
    ).toBe(false);
  });

  it("appears when the label shows the level text", () => {
    expect(
      showsLevels({ badge_show_label: true, badge_label_content: "level" }),
    ).toBe(true);
    expect(
      showsLevels({
        badge_show_label: true,
        badge_label_content: "allergen_level",
      }),
    ).toBe(true);
  });

  it("treats an invalid content value as the allergen default", () => {
    // Same coercion the runtime applies, so the editor never offers fields for
    // a mode the badge will not render.
    expect(
      showsLevels({ badge_show_label: true, badge_label_content: "levels" }),
    ).toBe(false);
  });
});
