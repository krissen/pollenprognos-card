// src/rendering/donut.ts
//
// Self-contained SVG level-ring renderer. Replaces the Chart.js doughnut that
// LevelCircleMixin used to draw imperatively into a <canvas>. Given already-
// resolved colors (the mixin owns all color/inherit-mode logic), this produces
// the ring markup deterministically, so the ring can be rendered declaratively
// inside a lit template with no cache / destroy / recreate lifecycle.
//
// Geometry parity with the old Chart.js doughnut:
//   - N equal segments (data: Array(N).fill(1)), one per non-empty level step.
//   - Start at 12 o'clock and run clockwise (Chart.js rotation: -Math.PI/2).
//   - Ring band from innerRadius to outerRadius where
//     innerRadius = outerRadius * (100 - thickness) / 100  (Chart.js
//     cutout: `${100 - thickness}%`, outerRadius = size / 2).
//   - Per-segment stroke of `gap` px in gapColor reproduces Chart.js's
//     per-arc borderWidth/borderColor (borderAlign "center" == SVG's
//     centered stroke), giving the thin gap between and around segments.
//   - Filled segments (index < level) use their level color; the rest use
//     emptyColor. No-data fills every segment with a noise <pattern>.
//
// Known sub-pixel deviations from the canvas output are documented in the PR
// report; the dominant visual (band width, segment count, colors, gap) is
// reproduced exactly.

import { buildRingNoiseSvgPattern } from "../utils/no-data-pattern.js";

export interface DonutParams {
  /** Number of filled segments (clamped to [0, segments]). */
  level: number;
  /** Total segment count N (per-integration max level). */
  segments: number;
  /** Per-segment fill colors; colors[i] fills segment i when i < level. */
  colors: string[];
  /** Fill for unfilled segments. */
  emptyColor: string;
  /** Stroke color drawn around every segment (the gap). */
  gapColor: string;
  /** Ring band width as a percentage of the radius (0-100). */
  thickness: number;
  /** Gap / border width in px. */
  gap: number;
  /** Rendered size in px; sets the viewBox so 1 user unit == 1 px. */
  size: number;
  /** No-data state: fill every segment with the noise pattern. */
  noData?: boolean;
  /** Dot/scratch color for the no-data noise pattern. */
  noiseColor?: string;
  /** Per-circle seed so adjacent no-data rings don't repeat identically. */
  noiseSeed?: number;
}

/** Point on a circle, angle measured clockwise from 12 o'clock (screen y-down). */
function polar(
  cx: number,
  cy: number,
  r: number,
  deg: number,
): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function n(v: number): string {
  // Trim to 3 decimals; drop trailing ".000" noise for smaller markup.
  return Number(v.toFixed(3)).toString();
}

/** Path for one ring sector (donut wedge) between radii ri..ro, angles d0..d1. */
function sectorPath(
  cx: number,
  cy: number,
  ri: number,
  ro: number,
  d0: number,
  d1: number,
): string {
  const [ox0, oy0] = polar(cx, cy, ro, d0);
  const [ox1, oy1] = polar(cx, cy, ro, d1);
  const large = d1 - d0 > 180 ? 1 : 0;
  if (ri <= 0.0001) {
    // Full-thickness ring (cutout 0) degenerates into a pie wedge.
    return (
      `M${n(cx)} ${n(cy)} L${n(ox0)} ${n(oy0)} ` +
      `A${n(ro)} ${n(ro)} 0 ${large} 1 ${n(ox1)} ${n(oy1)} Z`
    );
  }
  const [ix1, iy1] = polar(cx, cy, ri, d1);
  const [ix0, iy0] = polar(cx, cy, ri, d0);
  return (
    `M${n(ox0)} ${n(oy0)} A${n(ro)} ${n(ro)} 0 ${large} 1 ${n(ox1)} ${n(oy1)} ` +
    `L${n(ix1)} ${n(iy1)} A${n(ri)} ${n(ri)} 0 ${large} 0 ${n(ix0)} ${n(iy0)} Z`
  );
}

/**
 * Build the SVG markup for a level ring. Returns a complete `<svg>` string
 * (inject with lit's unsafeSVG). Deterministic: identical params yield an
 * identical string, so lit skips re-parsing when nothing changed.
 */
export function buildDonutSvg(params: DonutParams): string {
  const {
    level,
    segments,
    colors,
    emptyColor,
    gapColor,
    thickness,
    gap,
    size,
    noData = false,
    noiseColor = "#888888",
    noiseSeed = 13,
  } = params;

  const cx = size / 2;
  const cy = size / 2;
  // Inset the outer radius by half the stroke so the gap outline stays inside
  // the box (Chart.js clipped the outer half of the border at the canvas edge;
  // insetting keeps neighbours from overlapping and is visually equivalent).
  const ro = size / 2 - gap / 2;
  const ri = (size / 2) * ((100 - thickness) / 100);
  const seg = 360 / segments;
  const safeLevel = Math.max(0, Math.min(level, segments));

  const patternId = `ppd-noise-${noiseSeed}`;
  let paths = "";
  for (let i = 0; i < segments; i++) {
    const fill = noData
      ? `url(#${patternId})`
      : i < safeLevel
        ? (colors[i] ?? emptyColor)
        : emptyColor;
    const d = sectorPath(cx, cy, ri, ro, i * seg, (i + 1) * seg);
    paths += `<path d="${d}" fill="${fill}"/>`;
  }

  // Gap: one stroked outline layer over the fills (drawn once per segment path
  // so inner/outer arcs and radial edges all get the gapColor line, matching
  // the per-arc border Chart.js drew). Skipped when gap is 0.
  let strokes = "";
  if (gap > 0) {
    for (let i = 0; i < segments; i++) {
      const d = sectorPath(cx, cy, ri, ro, i * seg, (i + 1) * seg);
      strokes +=
        `<path d="${d}" fill="none" stroke="${gapColor}" ` +
        `stroke-width="${n(gap)}"/>`;
    }
  }

  const defs = noData
    ? `<defs>${buildRingNoiseSvgPattern(patternId, noiseColor, { seed: noiseSeed })}</defs>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" ` +
    `viewBox="0 0 ${n(size)} ${n(size)}" style="display:block" aria-hidden="true">` +
    `${defs}${paths}${strokes}</svg>`
  );
}
