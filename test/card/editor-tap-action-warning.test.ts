import { describe, it, expect } from "vitest";
import { renderInteractionSection } from "../../src/editor/sections/interactions.js";
import { resolveTapActionType } from "../../src/rendering/level-circle-mixin.js";

/**
 * The editor's caveat under the more-info entity field has to fire on exactly
 * the values the runtime treats as inert. Grinding it on truthiness meant an
 * entity of `"   "` produced a card that silently did nothing and an editor
 * that said everything was fine.
 *
 * The section is a lit template, so this renders it without a DOM: `html`
 * builds a value tree, and the marker string is somewhere in it or it is not.
 */
const WARNING = "WARNING-STRING";

function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const n of node) collectStrings(n, out);
  else if (node && typeof node === "object") {
    const values = (node as { values?: unknown[] }).values;
    if (Array.isArray(values)) for (const v of values) collectStrings(v, out);
  }
  return out;
}

/** The field each action type warns about, and the config key it lives under. */
const TYPES = {
  "more-info": { prop: "_tapEntity", key: "entity" },
  navigate: { prop: "_tapNavigation", key: "navigation_path" },
  "call-service": { prop: "_tapService", key: "service" },
} as const;
type TapType = keyof typeof TYPES;

const WARNING_KEYS = [
  "tap_action_more_info_needs_entity",
  "tap_action_navigate_needs_path",
  "tap_action_call_service_needs_service",
];

function fakeEditor(type: TapType, value: string) {
  const { prop, key } = TYPES[type];
  return {
    _editorConfig: () => ({}),
    _config: { tap_action: { type, [key]: value } },
    _hass: {},
    _tapType: type,
    _tapEntity: "",
    _tapNavigation: "",
    _tapService: "",
    [prop]: value,
    _tapServiceData: "",
    // Any of the three warning strings collapses to one marker: the test cares
    // that the field is flagged, not which sentence says so.
    _t: (key: string) => (WARNING_KEYS.includes(key) ? WARNING : `t:${key}`),
    _renderTextField: () => "",
    _renderSectionReset: () => "",
    _interactivitySectionTitle: () => "",
    _interactivitySectionHelper: () => "",
    _updateConfig: () => {},
    requestUpdate: () => {},
  } as any;
}

const warns = (type: TapType, value: string) =>
  collectStrings(renderInteractionSection(fakeEditor(type, value))).includes(
    WARNING,
  );

/** Values worth trying for every type: blank shapes, then a usable one. */
const SAMPLES: Record<TapType, string[]> = {
  "more-info": ["", "   ", "\t", "sensor.pollen", " sensor.pollen "],
  navigate: ["", "   ", "\t", "/lovelace/2", " /lovelace/2 "],
  "call-service": [
    "",
    "   ",
    "notadomain",
    "foo.bar.baz",
    " . ",
    "light.turn_on",
    " light.turn_on ",
  ],
};

describe("editor warning for a more-info tap_action", () => {
  it("warns for an entity that is only whitespace", () => {
    expect(warns("more-info", "   ")).toBe(true);
  });

  it("warns for an empty entity", () => {
    expect(warns("more-info", "")).toBe(true);
  });

  it("stays quiet for a real entity, padded or not", () => {
    expect(warns("more-info", "sensor.pollen")).toBe(false);
    expect(warns("more-info", " sensor.pollen ")).toBe(false);
  });
});

describe("editor warnings cover every action type", () => {
  it("warns for navigate without a usable path", () => {
    expect(warns("navigate", "")).toBe(true);
    expect(warns("navigate", "   ")).toBe(true);
    expect(warns("navigate", "/lovelace/2")).toBe(false);
  });

  it("warns for call-service without a usable service id", () => {
    expect(warns("call-service", "")).toBe(true);
    expect(warns("call-service", "notadomain")).toBe(true);
    expect(warns("call-service", "foo.bar.baz")).toBe(true);
    expect(warns("call-service", "light.turn_on")).toBe(false);
  });

  it("fires on exactly the configs the runtime calls inert", () => {
    // The invariant, per type: the editor flags a field if and only if
    // resolveTapActionType refuses to bind the click. Asserting it against the
    // resolver rather than against a list of strings means the two cannot
    // drift apart as either side gains cases.
    for (const type of Object.keys(SAMPLES) as TapType[]) {
      const { key } = TYPES[type];
      for (const value of SAMPLES[type]) {
        const inert = resolveTapActionType({ type, [key]: value }) === null;
        expect(
          warns(type, value),
          `disagreement for ${type} ${JSON.stringify(value)}`,
        ).toBe(inert);
      }
    }
  });
});
