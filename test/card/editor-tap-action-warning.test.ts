import { describe, it, expect } from "vitest";
import { renderInteractionSection } from "../../src/editor/sections/interactions.js";
import {
  parseEntityId,
  resolveTapActionType,
} from "../../src/rendering/level-circle-mixin.js";

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

function fakeEditor(tapEntity: string) {
  return {
    _editorConfig: () => ({}),
    _config: { tap_action: { type: "more-info", entity: tapEntity } },
    _hass: {},
    _tapType: "more-info",
    _tapEntity: tapEntity,
    _tapNavigation: "",
    _tapService: "",
    _tapServiceData: "",
    // Only the warning key needs to be distinguishable.
    _t: (key: string) =>
      key === "tap_action_more_info_needs_entity" ? WARNING : `t:${key}`,
    _renderTextField: () => "",
    _renderSectionReset: () => "",
    _interactivitySectionTitle: () => "",
    _interactivitySectionHelper: () => "",
    _updateConfig: () => {},
    requestUpdate: () => {},
  } as any;
}

const warns = (entity: string) =>
  collectStrings(renderInteractionSection(fakeEditor(entity))).includes(WARNING);

describe("editor warning for a more-info tap_action", () => {
  it("warns for an entity that is only whitespace", () => {
    expect(warns("   ")).toBe(true);
  });

  it("warns for an empty entity", () => {
    expect(warns("")).toBe(true);
  });

  it("stays quiet for a real entity, padded or not", () => {
    expect(warns("sensor.pollen")).toBe(false);
    expect(warns(" sensor.pollen ")).toBe(false);
  });

  it("fires on exactly the values the runtime calls inert", () => {
    for (const entity of ["", "   ", "\t", "sensor.pollen", " sensor.pollen "]) {
      const inert =
        resolveTapActionType({ type: "more-info", entity }) === null;
      expect(warns(entity), `disagreement for ${JSON.stringify(entity)}`).toBe(
        inert,
      );
      expect(inert).toBe(parseEntityId(entity) === null);
    }
  });
});
