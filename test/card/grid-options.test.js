import { describe, it, expect } from "vitest";
import { computeGridOptions } from "../../src/utils/grid-options.js";

describe("computeGridOptions", () => {
  describe("normal (table) mode", () => {
    it("returns content-driven height and a half-section minimum width", () => {
      expect(computeGridOptions({}, 5)).toEqual({
        rows: "auto",
        columns: 12,
        min_rows: 1,
        min_columns: 6,
      });
    });

    it("ignores sensor count for the normal layout", () => {
      expect(computeGridOptions({ minimal: false }, 1)).toEqual(
        computeGridOptions({ minimal: false }, 50),
      );
    });
  });

  describe("minimal (icon strip) mode", () => {
    it("is always one row tall", () => {
      for (const count of [1, 3, 6, 20]) {
        expect(computeGridOptions({ minimal: true }, count).rows).toBe(1);
      }
    });

    it("scales columns with the allergen count (floor 3, ~2 cols each, cap 12)", () => {
      expect(computeGridOptions({ minimal: true }, 1).columns).toBe(3); // floored
      expect(computeGridOptions({ minimal: true }, 2).columns).toBe(4);
      expect(computeGridOptions({ minimal: true }, 3).columns).toBe(6);
      expect(computeGridOptions({ minimal: true }, 6).columns).toBe(12); // capped
      expect(computeGridOptions({ minimal: true }, 20).columns).toBe(12); // capped
    });

    it("keeps a small minimum width so a single icon still fits", () => {
      expect(computeGridOptions({ minimal: true }, 1)).toMatchObject({
        rows: 1,
        min_rows: 1,
        min_columns: 2,
      });
    });
  });

  describe("defensive inputs", () => {
    it("floors a zero / negative / non-finite sensor count to 1", () => {
      for (const bad of [0, -5, NaN, Infinity, undefined]) {
        expect(computeGridOptions({ minimal: true }, bad).columns).toBe(3);
      }
    });

    it("tolerates a missing config object (treated as normal mode)", () => {
      expect(() => computeGridOptions(undefined, 3)).not.toThrow();
      expect(computeGridOptions(undefined, 3)).toEqual({
        rows: "auto",
        columns: 12,
        min_rows: 1,
        min_columns: 6,
      });
    });

    it("works with no arguments at all", () => {
      expect(() => computeGridOptions()).not.toThrow();
      expect(computeGridOptions().rows).toBe("auto");
    });
  });
});
