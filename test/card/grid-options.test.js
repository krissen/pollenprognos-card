import { describe, it, expect } from "vitest";
import { computeGridOptions } from "../../src/utils/grid-options.js";

// Helper: a config carrying N configured allergens (the stable, sync source the
// width is derived from — not the async-fetched sensor list).
const withAllergens = (n, extra = {}) => ({
  allergens: Array.from({ length: n }, (_, i) => `a${i}`),
  ...extra,
});

describe("computeGridOptions", () => {
  describe("normal (table) mode", () => {
    it("returns content-driven height and a half-section minimum width", () => {
      expect(computeGridOptions(withAllergens(5))).toEqual({
        rows: "auto",
        columns: 12,
        min_rows: 1,
        min_columns: 6,
      });
    });

    it("ignores the allergen count for the normal layout", () => {
      expect(computeGridOptions(withAllergens(1))).toEqual(
        computeGridOptions(withAllergens(50)),
      );
    });
  });

  describe("minimal (icon strip) mode", () => {
    it("leaves height content-driven so a header or text labels can't be clipped", () => {
      for (const count of [1, 3, 6, 20]) {
        expect(
          computeGridOptions(withAllergens(count, { minimal: true })).rows,
        ).toBe("auto");
      }
    });

    it("scales columns with the allergen count (floor 3, ~2 cols each, cap 12)", () => {
      const cols = (n) =>
        computeGridOptions(withAllergens(n, { minimal: true })).columns;
      expect(cols(1)).toBe(3); // floored
      expect(cols(2)).toBe(4);
      expect(cols(3)).toBe(6);
      expect(cols(6)).toBe(12); // capped
      expect(cols(20)).toBe(12); // capped
    });

    it("derives width from config (stable) so first-load isn't stuck too narrow", () => {
      // No sensor list is consulted; the configured allergens alone size it.
      expect(
        computeGridOptions(withAllergens(4, { minimal: true })).columns,
      ).toBe(8);
    });

    it("keeps a small minimum width so a single icon still fits", () => {
      expect(
        computeGridOptions(withAllergens(1, { minimal: true })),
      ).toMatchObject({
        rows: "auto",
        min_rows: 1,
        min_columns: 2,
      });
    });
  });

  describe("defensive inputs", () => {
    it("floors a missing / empty / non-array allergens list to one icon width", () => {
      for (const allergens of [undefined, [], "birch", 3, null]) {
        expect(
          computeGridOptions({ minimal: true, allergens }).columns,
        ).toBe(3);
      }
    });

    it("tolerates a missing config object (treated as normal mode)", () => {
      expect(() => computeGridOptions(undefined)).not.toThrow();
      expect(computeGridOptions(undefined)).toEqual({
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
