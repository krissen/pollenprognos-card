import { describe, it, expect } from "vitest";
import {
  selectDisplaySensors,
  coerceBool,
} from "../../src/utils/adapter-helpers.js";

// selectDisplaySensors is the single, shared selector used by BOTH the normal
// table path and the minimal icon path (issue #222). Testing it here covers
// the summary/standalone/detail ordering for both render modes — in minimal
// the same list simply becomes the icon row, the aggregate being the first
// icon.

const summary: any = { allergenReplaced: "allergy_risk", isSummary: true };
const birch: any = { allergenReplaced: "birch" };
const grass: any = { allergenReplaced: "grass" };

describe("coerceBool", () => {
  it("treats true and the string 'true' as true", () => {
    expect(coerceBool(true)).toBe(true);
    expect(coerceBool("true")).toBe(true);
  });
  it("treats everything else as false", () => {
    expect(coerceBool(false)).toBe(false);
    expect(coerceBool("false")).toBe(false);
    expect(coerceBool(undefined)).toBe(false);
    expect(coerceBool(1)).toBe(false);
  });
});

describe("selectDisplaySensors", () => {
  it("returns the sensors unchanged when the block is off (default)", () => {
    const sensors = [birch, summary, grass];
    expect(selectDisplaySensors(sensors, {} as any)).toBe(sensors);
    expect(
      selectDisplaySensors(sensors, { show_summary_block: false } as any),
    ).toBe(sensors);
  });

  it("returns only the aggregate when block on and detail rows off (standalone)", () => {
    const sensors = [birch, summary, grass];
    const out = selectDisplaySensors(sensors, {
      show_summary_block: true,
    } as any);
    expect(out).toEqual([summary]);
  });

  it("pins the aggregate first, then the detail rows, when both are on", () => {
    const sensors = [birch, summary, grass];
    const out = selectDisplaySensors(sensors, {
      show_summary_block: true,
      show_summary_row: true,
    } as any);
    expect(out).toEqual([summary, birch, grass]);
  });

  it("leaves the list unchanged when block on but no aggregate is present", () => {
    const sensors = [birch, grass];
    expect(
      selectDisplaySensors(sensors, { show_summary_block: true } as any),
    ).toBe(sensors);
  });

  it("honors string flags from YAML ('true')", () => {
    const sensors = [birch, summary, grass];
    expect(
      selectDisplaySensors(sensors, { show_summary_block: "true" } as any),
    ).toEqual([summary]);
    expect(
      selectDisplaySensors(sensors, {
        show_summary_block: "true",
        show_summary_row: "true",
      } as any),
    ).toEqual([summary, birch, grass]);
  });

  it("is null-safe on non-array input", () => {
    expect(
      selectDisplaySensors(null as any, { show_summary_block: true } as any),
    ).toEqual([]);
    expect(selectDisplaySensors(undefined as any, {} as any)).toEqual([]);
  });
});
