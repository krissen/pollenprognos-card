// src/utils/no-data-pattern.ts
//
// Noise-pattern generator for the "no data" visual treatment (level === -1).
// Two output forms are provided so distinct textures can be applied to the
// allergen icon (CSS mask + background) and the level circle ring
// (Chart.js doughnut via CanvasPattern):
//
//   - Icon background: tile of small round dots. The CSS rule layers this on
//     top of a solid translucent fill so the icon silhouette stays readable
//     even when the doughnut ring behind it is heavily textured.
//   - Ring (doughnut): mixed 1-2px pixels with a sparse short-stroke
//     "scratches" pass. Per-circle seed lets adjacent circles look different,
//     avoiding visible identical clumps.

const ICON_DOT_DENSITY = 0.5;
const ICON_DOT_TILE = 12;

const RING_TILE = 32;
const RING_PIX_DENSITY = 0.1;
const RING_SCRATCH_DENSITY_FACTOR = 0.25;
const RING_MAX_PIX_SIZE = 2;

const DEFAULT_SEED = 13;

/**
 * Escape a string for safe use inside an SVG/XML attribute value.
 * The dot color is read from a CSS custom property and could in principle
 * contain `"`, `<`, `>`, `&`, or `'` (custom properties accept arbitrary
 * strings until they're used). Without escaping, a crafted property value
 * could break out of the `fill="..."` attribute and inject SVG markup into
 * the data URI -- including `<script>`, since SVG is script-capable.
 * The order matters: `&` first, so we don't double-encode entity refs we
 * introduce in later replacements.
 */
export function escapeXmlAttr(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Seedable PRNG. Stable output for a given seed so headless screenshots and
 * unit tests don't flake across runs.
 */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a tiling SVG `data:` URI of small round dots. Used as
 * `background-image` for the no-data icon (under a CSS mask of the allergen
 * SVG). Density defaults to 50% so the silhouette reads even against a
 * heavily-textured ring.
 */
export function buildNoiseSvgUri(
  color = "#888888",
  opts: { density?: number; tile?: number; seed?: number } = {},
): string {
  const density = opts.density ?? ICON_DOT_DENSITY;
  const tile = opts.tile ?? ICON_DOT_TILE;
  const seed = opts.seed ?? DEFAULT_SEED;
  const rng = mulberry32(seed);
  const dotR = 1.4;
  const area = tile * tile;
  const count = Math.round((area * density) / (Math.PI * dotR * dotR));
  // Escape once so we don't re-do it on every dot.
  const safeColor = escapeXmlAttr(color);
  let body = "";
  for (let i = 0; i < count; i++) {
    body +=
      `<circle cx="${(rng() * tile).toFixed(1)}" cy="${(rng() * tile).toFixed(1)}" ` +
      `r="${dotR}" fill="${safeColor}" fill-opacity="${(0.55 + rng() * 0.45).toFixed(2)}"/>`;
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" ` +
    `viewBox="0 0 ${tile} ${tile}">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Draw the ring noise tile (pixel-static + sparse scratches) into an
 * offscreen canvas. Returns null when there's no `document` (Node test env);
 * production callers must fall back to an emptyColor fill in that case.
 */
export function buildNoiseTileCanvas(
  color = "#888888",
  opts: {
    tile?: number;
    seed?: number;
    pixDensity?: number;
    scratchDensity?: number;
    maxPx?: number;
  } = {},
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const tile = opts.tile ?? RING_TILE;
  const seed = opts.seed ?? DEFAULT_SEED;
  const pixDensity = opts.pixDensity ?? RING_PIX_DENSITY;
  const scratchFactor = opts.scratchDensity ?? RING_SCRATCH_DENSITY_FACTOR;
  const maxPx = opts.maxPx ?? RING_MAX_PIX_SIZE;

  const canvas = document.createElement("canvas");
  canvas.width = tile;
  canvas.height = tile;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const rng = mulberry32(seed);

  // Layer 1: pixel static. Mostly 1px squares, ~15% 2px. The bigger squares
  // get dimmer so they don't visually clump.
  ctx.fillStyle = color;
  const pixArea = tile * tile;
  const pixCount = Math.round(pixArea * pixDensity);
  for (let i = 0; i < pixCount; i++) {
    const x = Math.floor(rng() * tile);
    const y = Math.floor(rng() * tile);
    const r = rng();
    let dotSz;
    if (maxPx === 2) dotSz = r < 0.85 ? 1 : 2;
    else dotSz = r < 0.7 ? 1 : r < 0.96 ? 2 : 3;
    const opBase = 0.35 + rng() * 0.55;
    ctx.globalAlpha = dotSz === 1 ? opBase : opBase * 0.6;
    ctx.fillRect(x, y, dotSz, dotSz);
  }

  // Layer 2: sparse short scratches. Thin, dim, short — directional accent
  // without competing with the pixel field.
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.6;
  ctx.lineCap = "round";
  const scratchCount = Math.round(pixArea * 0.06 * scratchFactor);
  for (let i = 0; i < scratchCount; i++) {
    const x = rng() * tile;
    const y = rng() * tile;
    const angle = rng() * Math.PI;
    const len = 1.5 + rng() * 2.5;
    ctx.globalAlpha = 0.25 + rng() * 0.35;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * Build the inner markup of an SVG `<pattern>` reproducing the ring noise tile
 * (pixel static + sparse scratches) as vector shapes instead of a canvas tile.
 * Mirrors buildNoiseTileCanvas element-for-element and consumes the seeded RNG
 * in the same order, so a given seed yields the same visual density. Returns a
 * full `<pattern id="...">...</pattern>` string ready to drop into an SVG
 * `<defs>`; pure string building, so it works in headless/Node contexts where
 * the canvas variant returns null.
 *
 * @param id      DOM id for the pattern (referenced via url(#id))
 * @param color   dot/scratch color
 */
export function buildRingNoiseSvgPattern(
  id: string,
  color = "#888888",
  opts: {
    tile?: number;
    seed?: number;
    pixDensity?: number;
    scratchDensity?: number;
    maxPx?: number;
  } = {},
): string {
  const tile = opts.tile ?? RING_TILE;
  const seed = opts.seed ?? DEFAULT_SEED;
  const pixDensity = opts.pixDensity ?? RING_PIX_DENSITY;
  const scratchFactor = opts.scratchDensity ?? RING_SCRATCH_DENSITY_FACTOR;
  const maxPx = opts.maxPx ?? RING_MAX_PIX_SIZE;
  const rng = mulberry32(seed);
  const safeColor = escapeXmlAttr(color);
  const pixArea = tile * tile;

  let body = "";

  // Layer 1: pixel static. Mostly 1px squares, ~15% 2px; the bigger squares
  // get dimmer so they don't visually clump. (Mirror of buildNoiseTileCanvas.)
  const pixCount = Math.round(pixArea * pixDensity);
  for (let i = 0; i < pixCount; i++) {
    const x = Math.floor(rng() * tile);
    const y = Math.floor(rng() * tile);
    const r = rng();
    let dotSz;
    if (maxPx === 2) dotSz = r < 0.85 ? 1 : 2;
    else dotSz = r < 0.7 ? 1 : r < 0.96 ? 2 : 3;
    const opBase = 0.35 + rng() * 0.55;
    const alpha = dotSz === 1 ? opBase : opBase * 0.6;
    body +=
      `<rect x="${x}" y="${y}" width="${dotSz}" height="${dotSz}" ` +
      `fill="${safeColor}" fill-opacity="${alpha.toFixed(2)}"/>`;
  }

  // Layer 2: sparse short scratches — thin, dim, short directional accents.
  const scratchCount = Math.round(pixArea * 0.06 * scratchFactor);
  for (let i = 0; i < scratchCount; i++) {
    const x = rng() * tile;
    const y = rng() * tile;
    const angle = rng() * Math.PI;
    const len = 1.5 + rng() * 2.5;
    const alpha = 0.25 + rng() * 0.35;
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;
    body +=
      `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" ` +
      `x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
      `stroke="${safeColor}" stroke-width="0.6" stroke-linecap="round" ` +
      `stroke-opacity="${alpha.toFixed(2)}"/>`;
  }

  return (
    `<pattern id="${escapeXmlAttr(id)}" patternUnits="userSpaceOnUse" ` +
    `width="${tile}" height="${tile}">${body}</pattern>`
  );
}

/**
 * Build a Chart.js-compatible CanvasPattern for the ring. Pass the
 * destination chart's 2D context so the pattern is allocated in the right
 * rendering context.
 */
export function buildNoiseCanvasPattern(
  ctx: CanvasRenderingContext2D | null,
  color = "#888888",
  opts: {
    tile?: number;
    seed?: number;
    pixDensity?: number;
    scratchDensity?: number;
    maxPx?: number;
  } = {},
): CanvasPattern | null {
  if (!ctx || typeof ctx.createPattern !== "function") return null;
  const tile = buildNoiseTileCanvas(color, opts);
  if (!tile) return null;
  return ctx.createPattern(tile, "repeat");
}

/**
 * Hash an arbitrary string (e.g. allergen + day-index) to a positive 32-bit
 * integer suitable as a noise seed. Lets the card give each rendered circle
 * its own seed so identical no-data layouts don't repeat across adjacent
 * allergen rows.
 */
export function hashStringSeed(s: string): number {
  let h = 5381;
  if (typeof s !== "string") s = String(s);
  // Math.imul keeps the multiplication in 32-bit integer space; plain
  // `h * 33` would drift into IEEE-754 float at ~14 chars (33^14 > 2^53)
  // and lose low-bit precision, increasing collisions on longer chart ids.
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h, 33) ^ s.charCodeAt(i);
  }
  return h >>> 0 || 1;
}
