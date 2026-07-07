import { css } from "lit";

/**
 * Shadow-DOM CSS shared verbatim by the card and the badge.
 *
 * These rules style elements that LevelCircleMixin injects (or renders) into
 * each component's own renderRoot: the ring-centre icon (`_rebuildCharts`),
 * the numeric ring value, and the bare allergen SVG (`_renderAllergenSvg`).
 * Because the mixin writes into each element's shadow tree, the rules must be
 * present in BOTH shadow roots; importing one `css` fragment keeps the two
 * copies in sync instead of duplicating the source.
 *
 * Only byte-identical rules live here. Rules that legitimately differ between
 * the card and the badge (e.g. `.pp-icon` margin, `.level-circle` sizing) stay
 * local to each component with their own explanatory comments.
 */
export const ringIconStyles = css`
  /* Icon centered inside the level ring (#227). Sized inline by
     _rebuildCharts based on ring thickness and icon_in_ring_size_ratio.
     color is inherited so SVG fill="currentColor" follows. */
  .ring-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ring-icon svg {
    width: 100%;
    height: 100%;
    display: block;
    fill: currentColor;
  }
  /* No <g fill=...> override here: SVGs that intentionally set
     fill="none" (e.g. no_allergens uses fill="none" with
     stroke="currentColor") must keep that. The svg-level
     fill: currentColor handles every allergen icon whose <g> has
     fill="currentColor" or no fill attr. */

  .level-value-text {
    max-width: 100%;
    max-height: 100%;
    overflow: hidden;
    text-align: center;
    white-space: nowrap;
  }

  .pp-icon svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .pp-icon svg g {
    stroke: var(--pp-icon-stroke, none);
    stroke-width: var(--pp-icon-stroke-width, 1);
  }

  /* No-data icon: silhouette filled with a faint solid color (anchors
     the shape so it stays readable against a heavily textured ring)
     plus a noise pattern on top (carries the "no data" cue). The icon
     SVG acts as the mask; mask-mode: alpha is set explicitly so SVG
     paths filled with black act as the opaque part of the mask in
     Chrome (its default for SVG-via-url is luminance, which would
     invert the result). */
  .pp-icon-no-data {
    -webkit-mask-image: var(--pp-icon-no-data-mask);
    mask-image: var(--pp-icon-no-data-mask);
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-mode: alpha;
    mask-mode: alpha;
    background-image: var(--pp-icon-no-data-noise);
    background-repeat: repeat;
    /* Plain rgba fallback first so the icon still gets a translucent
       anchor on browsers without color-mix() support (older WebKit /
       legacy Chromium builds shipped via plugin-legacy). The
       color-mix() declaration overrides it on modern browsers and
       tracks --primary-text-color through theme switches. */
    background-color: rgba(136, 136, 136, 0.15);
    background-color: color-mix(
      in srgb,
      var(--primary-text-color, #888888) 15%,
      transparent
    );
  }
`;
