import { describe, it, expect } from "vitest";

// Tests run in the project's default node env (no jsdom). The canvas helpers
// are guarded with `typeof document === "undefined" -> null` for exactly this
// reason; we assert the SSR/test fallback here, and rely on the headless
// browser smoke test for the real-canvas path.
import {
  buildNoiseSvgUri,
  buildNoiseTileCanvas,
  buildNoiseCanvasPattern,
  hashStringSeed,
} from "../../src/utils/no-data-pattern.js";

describe("no-data-pattern", () => {
  describe("buildNoiseSvgUri", () => {
    it("returns a data:image/svg+xml URI", () => {
      const uri = buildNoiseSvgUri();
      expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    });

    it("URL-encodes the SVG body so the URI is safe inside CSS url() and HTML attributes", () => {
      const uri = buildNoiseSvgUri();
      // No raw '<' or '>' should leak through (they break HTML attributes).
      expect(uri).not.toMatch(/[<>]/);
      // Must contain the encoded <svg ...> opening tag.
      expect(uri).toMatch(/%3Csvg/);
    });

    it("embeds the requested dot color", () => {
      const uri = buildNoiseSvgUri("#aabbcc");
      // encodeURIComponent("#") -> "%23"
      expect(uri).toContain("%23aabbcc");
    });

    it("escapes XML-significant characters in the color (defense vs SVG attribute injection)", () => {
      // Custom CSS properties accept arbitrary strings. A crafted theme
      // value containing `"` or `<` must not be able to break out of
      // fill="..." and inject SVG markup into the data URI. Decode the
      // URI back and assert the dangerous chars survived as entities.
      const uri = buildNoiseSvgUri('red"><script>alert(1)</script>');
      const decoded = decodeURIComponent(uri.replace(/^data:image\/svg\+xml;utf8,/, ""));
      // Original payload's `"` and `<script>` must NOT appear verbatim.
      expect(decoded).not.toContain('"><script>');
      // Their entity-encoded forms must be present.
      expect(decoded).toContain("&quot;");
      expect(decoded).toContain("&lt;script&gt;");
    });

    it("is deterministic for the same seed", () => {
      const a = buildNoiseSvgUri("#888", { seed: 7 });
      const b = buildNoiseSvgUri("#888", { seed: 7 });
      expect(a).toBe(b);
    });

    it("changes when the seed changes", () => {
      const a = buildNoiseSvgUri("#888", { seed: 1 });
      const b = buildNoiseSvgUri("#888", { seed: 2 });
      expect(a).not.toBe(b);
    });

    it("produces more dots at higher density", () => {
      const sparse = buildNoiseSvgUri("#888", { density: 0.1, seed: 5 });
      const dense = buildNoiseSvgUri("#888", { density: 0.6, seed: 5 });
      const countSparse = (sparse.match(/circle/g) || []).length;
      const countDense = (dense.match(/circle/g) || []).length;
      expect(countDense).toBeGreaterThan(countSparse);
    });
  });

  describe("buildNoiseTileCanvas", () => {
    it("returns null when document is unavailable (server-side / node test env)", () => {
      // Asserts the SSR guard (typeof document === "undefined" -> null) so the
      // chart renderer's fall-through to emptyColor is exercised in tests too.
      expect(buildNoiseTileCanvas("#888")).toBeNull();
    });
  });

  describe("buildNoiseCanvasPattern", () => {
    it("returns null when given a null context", () => {
      expect(buildNoiseCanvasPattern(null)).toBeNull();
    });

    it("returns null when given a context-shaped object missing createPattern", () => {
      expect(buildNoiseCanvasPattern({})).toBeNull();
    });

    it("returns null when document is unavailable, even with a valid-shaped context", () => {
      // The guard order is: createPattern check -> tile build (which needs
      // document). Pass a stub ctx with createPattern so we reach the tile
      // step and exercise its SSR-null branch.
      const stubCtx = { createPattern: () => "should not get here" };
      expect(buildNoiseCanvasPattern(stubCtx, "#888")).toBeNull();
    });
  });

  describe("hashStringSeed", () => {
    it("returns a positive integer", () => {
      const seed = hashStringSeed("chart-birch-0--1");
      expect(seed).toBeGreaterThan(0);
      expect(Number.isInteger(seed)).toBe(true);
    });

    it("is deterministic for the same input", () => {
      expect(hashStringSeed("chart-grass-2--1")).toBe(
        hashStringSeed("chart-grass-2--1"),
      );
    });

    it("produces different seeds for adjacent chart ids", () => {
      // Practical concern: adjacent no-data circles (same allergen, different
      // day) must not share the same noise layout, otherwise clumps repeat.
      const seeds = [
        hashStringSeed("chart-birch-0--1"),
        hashStringSeed("chart-birch-1--1"),
        hashStringSeed("chart-birch-2--1"),
      ];
      expect(new Set(seeds).size).toBe(3);
    });

    it("coerces non-string input rather than throwing", () => {
      expect(() => hashStringSeed(42)).not.toThrow();
      expect(hashStringSeed(42)).toBeGreaterThan(0);
    });

    it("never returns 0 (would degenerate the PRNG)", () => {
      // Empty string is the dangerous edge case; the function falls back to
      // the djb2 initial value (positive non-zero).
      expect(hashStringSeed("")).toBeGreaterThan(0);
    });
  });
});
