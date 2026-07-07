import { describe, it, expect } from "vitest";
import { buildDonutSvg } from "../../src/rendering/donut.js";

const base = {
  level: 3,
  segments: 6,
  colors: ["#a", "#b", "#c", "#d", "#e", "#f"],
  emptyColor: "#eee",
  gapColor: "#fff",
  thickness: 60,
  gap: 1,
  size: 48,
};

// Fill layer only: stroke paths carry `fill:none;stroke:...` in the same
// style attribute, so require the style to be a single fill declaration.
const fillPaths = (svg: any) =>
  [...svg.matchAll(/<path d="[^"]*" style="fill:([^";]*)"\/>/g)].map(
    (m) => m[1],
  );

describe("buildDonutSvg", () => {
  it("renders one fill path per segment and a square viewBox", () => {
    const svg = buildDonutSvg(base);
    expect(fillPaths(svg)).toHaveLength(6);
    expect(svg).toContain('viewBox="0 0 48 48"');
  });

  it("fills the first `level` segments with their colors, the rest empty", () => {
    const fills = fillPaths(buildDonutSvg(base));
    expect(fills.slice(0, 3)).toEqual(["#a", "#b", "#c"]);
    expect(fills.slice(3)).toEqual(["#eee", "#eee", "#eee"]);
  });

  it("clamps level below 0 to all-empty and above segments to all-filled", () => {
    const none = fillPaths(buildDonutSvg({ ...base, level: -1, noData: false }));
    expect(none).toEqual(Array(6).fill("#eee"));
    const all = fillPaths(buildDonutSvg({ ...base, level: 99 }));
    expect(all).toEqual(base.colors);
  });

  it("degenerates to pie wedges at thickness 100 (sectors start at the center)", () => {
    const svg = buildDonutSvg({ ...base, thickness: 100 });
    // Pie wedges start with a move-to at the center point (cx == cy == size/2).
    expect(svg).toContain('d="M24 24 L');
  });

  it("skips the stroke layer entirely when gap is 0", () => {
    const svg = buildDonutSvg({ ...base, gap: 0 });
    expect(svg).not.toContain("stroke");
  });

  it("uses the noise pattern for every segment in no-data mode", () => {
    const svg = buildDonutSvg({
      ...base,
      noData: true,
      noiseColor: "#888",
      noiseSeed: 42,
    });
    expect(svg).toContain("<pattern");
    expect(fillPaths(svg)).toEqual(Array(6).fill("url(#ppd-noise-42)"));
  });

  it("attribute-escapes color strings so YAML config cannot inject markup", () => {
    const hostile = 'red" onmouseover="alert(1)';
    const svg = buildDonutSvg({
      ...base,
      colors: [hostile, "#b", "#c", "#d", "#e", "#f"],
      gapColor: '</svg><script>alert(2)</script>',
    });
    expect(svg).not.toContain('" onmouseover="');
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&quot; onmouseover=&quot;");
    expect(svg).toContain("&lt;script&gt;");
  });
});
