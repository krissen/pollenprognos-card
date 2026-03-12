import { describe, it, expect } from "vitest";
import { clampLevel } from "../../src/utils/adapter-helpers.js";

describe("clampLevel", () => {
  describe("normal values", () => {
    it("passes through value within range", () => {
      expect(clampLevel(3)).toBe(3);
    });

    it("clamps value above maxLevel", () => {
      expect(clampLevel(10, 6)).toBe(6);
    });

    it("passes through zero", () => {
      expect(clampLevel(0)).toBe(0);
    });

    it("passes through maxLevel exactly", () => {
      expect(clampLevel(6, 6)).toBe(6);
    });
  });

  describe("string coercion", () => {
    it("coerces numeric string", () => {
      expect(clampLevel("4")).toBe(4);
    });

    it("coerces '0' to 0", () => {
      expect(clampLevel("0")).toBe(0);
    });
  });

  describe("null and undefined", () => {
    it("returns nanResult for null", () => {
      expect(clampLevel(null)).toBe(-1);
    });

    it("returns nanResult for undefined", () => {
      expect(clampLevel(undefined)).toBe(-1);
    });

    it("returns custom nanResult for null", () => {
      expect(clampLevel(null, 6, null)).toBeNull();
    });

    it("returns custom nanResult for undefined", () => {
      expect(clampLevel(undefined, 6, 0)).toBe(0);
    });
  });

  describe("NaN and invalid", () => {
    it("returns nanResult for NaN", () => {
      expect(clampLevel(NaN)).toBe(-1);
    });

    it("returns nanResult for non-numeric string", () => {
      expect(clampLevel("unavailable")).toBe(-1);
    });

    it("treats empty string as 0 (Number('') === 0)", () => {
      expect(clampLevel("")).toBe(0);
    });

    it("returns nanResult for negative value", () => {
      expect(clampLevel(-1)).toBe(-1);
    });

    it("returns nanResult for -0.5", () => {
      expect(clampLevel(-0.5)).toBe(-1);
    });
  });

  describe("custom maxLevel", () => {
    it("clamps to custom maxLevel", () => {
      expect(clampLevel(5, 4)).toBe(4);
    });

    it("no upper clamp when maxLevel is null", () => {
      expect(clampLevel(100, null)).toBe(100);
    });

    it("clamps to 0 maxLevel", () => {
      expect(clampLevel(1, 0)).toBe(0);
    });
  });

  describe("fractional values", () => {
    it("preserves fractional value within range", () => {
      expect(clampLevel(3.7, 6)).toBe(3.7);
    });

    it("clamps fractional value above max", () => {
      expect(clampLevel(6.1, 6)).toBe(6);
    });
  });
});
