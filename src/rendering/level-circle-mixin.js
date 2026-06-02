// src/rendering/level-circle-mixin.js
//
// Mixin that provides the level-circle / icon-in-ring rendering engine.
// Applied to both PollenPrognosCard and the forthcoming PollenPrognosBadge
// so the Chart.js doughnut logic is never duplicated.
//
// Usage:
//   class MyElement extends LevelCircleMixin(LitElement) { ... }

import { html } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { getSvgContent } from "../pollenprognos-svgs.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { ringSegmentsForIntegration } from "../utils/level-counts.js";
import { buildNoiseCanvasPattern, buildNoiseSvgUri, hashStringSeed } from "../utils/no-data-pattern.js";
import { ALLERGEN_ICON_FALLBACK, toCanonicalAllergenKey } from "../constants.js";
import {
  Chart,
  ArcElement,
  DoughnutController,
  Tooltip,
  Legend,
} from "chart.js/auto";

// Register Chart.js components once at module load time.
Chart.register(ArcElement, DoughnutController, Tooltip, Legend);

// The tap_action types the shared handler knows how to perform.
const TAP_ACTION_TYPES = ["more-info", "navigate", "call-service"];

/**
 * Read the raw action keyword from a tap_action object, honouring both shapes:
 * the Lovelace-standard `action` key (e.g. `{ action: "navigate" }`) and this
 * card's historical `type` key (e.g. `{ type: "navigate" }`). `action` wins so
 * a standard HA config is never misread. HA renamed "call-service" to
 * "perform-action" (2024.8); map it back to our internal "call-service".
 *
 * @param {object} tapAction
 * @returns {string} keyword (possibly "" when neither key is set)
 */
function rawTapActionType(tapAction) {
  const raw = tapAction.action || tapAction.type || "";
  return raw === "perform-action" ? "call-service" : raw;
}

/**
 * Resolve a tap_action config to the effective action type, or null when the
 * action is absent/unactionable. A plain object with no action keyword defaults
 * to "more-info" (the handler's documented default); "none", non-objects,
 * arrays, and unknown keywords resolve to null. Callers use this both to decide
 * whether to bind a click listener (so the element isn't clickable-but-inert)
 * and to dispatch, keeping the binding and the handler in lockstep.
 *
 * @param {*} tapAction
 * @returns {"more-info"|"navigate"|"call-service"|null}
 */
export function resolveTapActionType(tapAction) {
  if (!tapAction || typeof tapAction !== "object" || Array.isArray(tapAction))
    return null;
  const type = rawTapActionType(tapAction) || "more-info";
  return TAP_ACTION_TYPES.includes(type) ? type : null;
}

/**
 * LevelCircleMixin — adds the level-circle / icon-in-ring rendering engine
 * to any LitElement subclass.
 *
 * Contributes:
 *   - _chartCache field
 *   - _noDataDotColor(), _getSvgKey(), _colorForLevel(), _levelColorForLevel(),
 *     _getGapColor(), _getEffectiveSvgKey(), _iconInRingColor()
 *   - _renderLevelCircle(), _buildLevelRingConfig()
 *   - _openEntity()
 *   - _rebuildCharts()
 *   - Lifecycle hooks: updated(), connectedCallback(), disconnectedCallback()
 *     (all call super so the chain reaches LitElement).
 *
 * @param {typeof LitElement} Base
 * @returns {typeof LitElement}
 */
export const LevelCircleMixin = (Base) =>
  class extends Base {
    _chartCache = new Map();

    // ---------------------------------------------------------------------------
    // Color helpers
    // ---------------------------------------------------------------------------

    /**
     * Gets color for a specific level for allergen icons.
     * @param {number} level - The pollen level (0-6 or 0-4 depending on integration)
     * @param {string} allergenKey - Optional allergen key for special handling
     * @returns {string} Color hex string
     */
    _colorForLevel(level, allergenKey = null) {
      // Special handling for no_allergens icon
      if (allergenKey === "no_allergens") {
        return this.config?.no_allergens_color || LEVELS_DEFAULTS.no_allergens_color;
      }

      // Use custom allergen colors if set
      if (this.config?.allergen_color_mode === "custom" && this.config?.allergen_colors) {
        const allergenColors = this.config.allergen_colors;
        const clampedLevel = Math.max(0, Math.min(level, allergenColors.length - 1));
        return allergenColors[clampedLevel] || allergenColors[0];
      }

      // Default: use default allergen colors (which includes empty color at index 0)
      const defaultColors = LEVELS_DEFAULTS.allergen_colors;
      const clampedLevel = Math.max(0, Math.min(level, defaultColors.length - 1));
      return defaultColors[clampedLevel] || defaultColors[0];
    }

    /**
     * Gets color for level circles (charts) - may inherit from allergen colors.
     * Note: Level circles don't use specific allergen keys, so we pass null.
     * @param {number} level - The pollen level (0-6 or 0-4 depending on integration)
     * @returns {string} Color hex string
     */
    _levelColorForLevel(level) {
      // If level circles inherit from allergen colors (default)
      if (this.config?.levels_inherit_mode !== "custom") {
        // Use allergen color directly - same level mapping (but no special allergen key)
        return this._colorForLevel(level, null);
      }

      // Use custom level colors with traditional mapping
      // Level 0 uses empty color, Level 1+ uses pollen colors
      if (level === 0) {
        return this.config?.levels_empty_color || LEVELS_DEFAULTS.levels_empty_color;
      }

      const colors = this.config?.levels_colors || LEVELS_DEFAULTS.levels_colors;
      const colorIndex = level - 1; // Map level 1->0, 2->1, etc.
      const clampedIndex = Math.max(0, Math.min(colorIndex, colors.length - 1));
      return colors[clampedIndex] || colors[0];
    }

    /**
     * Determines the appropriate gap color based on inheritance mode.
     * @returns {string} The gap color to use
     */
    _getGapColor() {
      // Use allergen outline color as gap color when inheriting, otherwise use custom gap color
      return this.config?.levels_inherit_mode !== "custom"
        ? (this.config.allergen_outline_color ?? LEVELS_DEFAULTS.levels_gap_color)
        : (this.config.levels_gap_color ?? "var(--card-background-color)");
    }

    // ---------------------------------------------------------------------------
    // SVG key helpers
    // ---------------------------------------------------------------------------

    /**
     * Gets the SVG key for an allergen.
     * @param {string} allergenReplaced - The allergen identifier
     * @returns {string|null} The key to use for SVG loading, or null if invalid
     */
    _getSvgKey(allergenReplaced) {
      // Guard against undefined/null allergenReplaced
      if (!allergenReplaced || typeof allergenReplaced !== "string") {
        if (this.debug) {
          console.warn("[SVG] Invalid allergenReplaced:", allergenReplaced);
        }
        return null;
      }

      const key = toCanonicalAllergenKey(allergenReplaced);

      // Check if we have the primary key SVG available
      if (getSvgContent(key)) {
        return key;
      }

      // Try icon fallback for category allergens
      if (ALLERGEN_ICON_FALLBACK[allergenReplaced]) {
        const fallbackKey = ALLERGEN_ICON_FALLBACK[allergenReplaced];
        if (getSvgContent(fallbackKey)) {
          return fallbackKey;
        }
      }

      return key; // Return original key even if SVG not found
    }

    /**
     * Resolve the level-reactive SVG key for an allergen. `allergy_risk`
     * has six level-specific variants (`allergy_risk_1`..`allergy_risk_6`,
     * the smiley); other allergens use the base key as-is. Shared between
     * the side icon (_renderAllergenSvg) and the ring-centered icon
     * (_renderMinimalHtml / _renderNormalHtml) so both render paths
     * respect the variant when icon_in_ring is on.
     */
    _getEffectiveSvgKey(allergenKey, level) {
      if (allergenKey === "allergy_risk" && level > 0) {
        return `allergy_risk_${Math.min(level, 6)}`;
      }
      return allergenKey;
    }

    // ---------------------------------------------------------------------------
    // No-data dot color
    // ---------------------------------------------------------------------------

    /**
     * Dot color for the "no data" noise pattern. Reads the card's resolved
     * `--primary-text-color` so the texture follows the active HA theme, with
     * a neutral grey fallback when the variable is not available (offscreen
     * canvases, headless test runs, etc.).
     */
    _noDataDotColor() {
      if (typeof window !== "undefined" && window.getComputedStyle) {
        try {
          const v = window
            .getComputedStyle(this)
            .getPropertyValue("--primary-text-color")
            .trim();
          if (v) return v;
        } catch (_) {
          // ignore and fall through
        }
      }
      return "#888888";
    }

    // ---------------------------------------------------------------------------
    // Ring config / rendering
    // ---------------------------------------------------------------------------

    _renderLevelCircle(
      level,
      {
        colors = LEVELS_DEFAULTS.levels_colors,
        emptyColor = LEVELS_DEFAULTS.levels_empty_color,
        gapColor = LEVELS_DEFAULTS.levels_gap_color,
        thickness = LEVELS_DEFAULTS.levels_thickness,
        gap = LEVELS_DEFAULTS.levels_gap,
        size = 100,
        iconKey = "",
        iconColor = "",
        iconSizeRatio = LEVELS_DEFAULTS.icon_in_ring_size_ratio,
      },
      allergen = "default",
      dayIndex = 0,
      displayLevel = level,
      entityId = null,
      clickable = true,
    ) {
      // Create a unique key for this chart configuration. `size` is part of the
      // key so a size change (e.g. the badge's badge_scale live-preview) forces
      // a fresh canvas at the new dimensions instead of reusing a cached Chart
      // whose canvas width/height was fixed at the old size.
      const chartId = `chart-${allergen}-${dayIndex}-${level}-${size}`;

      // Use attributes instead of properties so values persist if DOM is cloned
      const noDataDistinct = this.config?.show_no_data_distinct !== false;
      // `level < 0` rather than `=== -1` so per-integration scaling doesn't
      // hide the no-data sentinel. E.g. DWD scales raw state by 2 in the
      // daily-row path, so an adapter-emitted -1 reaches here as -2.
      const stateAttr = noDataDistinct && level < 0 ? "no_data" : "ok";
      return html`
        <div
          id="${chartId}"
          class="level-circle"
          style="display: inline-block; width: ${size}px; height: ${size}px; position: relative;${clickable &&
          entityId
            ? " cursor: pointer;"
            : ""}"
          data-level="${level}"
          data-display-level="${displayLevel}"
          data-state="${stateAttr}"
          data-colors="${JSON.stringify(colors)}"
          data-empty-color="${emptyColor}"
          data-gap-color="${gapColor}"
          data-thickness="${thickness}"
          data-gap="${gap}"
          data-size="${size}"
          data-show-value="${this.config &&
          this.config.show_value_numeric_in_circle}"
          data-font-weight="${this.config?.levels_text_weight || "normal"}"
          data-font-size-ratio="${this.config?.levels_text_size || 0.2}"
          data-text-color="${this.config?.levels_text_color ||
          "var(--primary-text-color)"}"
          data-icon-key="${iconKey}"
          data-icon-color="${iconColor}"
          data-icon-size-ratio="${iconSizeRatio}"
          @click=${(e) => {
            if (clickable && entityId) {
              e.stopPropagation();
              this._openEntity(entityId);
            }
          }}
        ></div>
      `;
    }

    // ---------------------------------------------------------------------------
    // Allergen icon rendering
    // ---------------------------------------------------------------------------

    /**
     * Renders an allergen SVG icon with proper color styling
     * @param {string} allergenKey - The allergen key
     * @param {number} level - The pollen level for color
     * @param {Object} options - Optional configuration
     * @param {Function} options.onClick - Click handler
     * @param {boolean} options.clickable - Whether icon should be clickable
     * @returns {TemplateResult} HTML template with SVG or placeholder
     */
    _renderAllergenSvg(allergenKey, level, options = {}) {
      // Guard against null/undefined keys - show error placeholder
      if (!allergenKey || typeof allergenKey !== 'string') {
        if (this.debug) {
          console.warn('[SVG] Cannot render SVG with invalid key:', allergenKey);
        }
        return html`
          <div class="pp-icon pp-icon-error" aria-hidden="true">
            <div style="background: #ff0000; color: white; border-radius: 50%; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12px;">?</div>
          </div>
        `;
      }

      const { onClick, clickable = false, stale = false } = options;
      const color = stale ? "#e6a800" : this._colorForLevel(level, allergenKey);
      const outlineColor = this.config?.allergen_outline_color || LEVELS_DEFAULTS.levels_gap_color;
      const strokeWidth = this.config?.allergen_stroke_width ?? LEVELS_DEFAULTS.allergen_stroke_width;
      // Select level-reactive icon variant for allergy_risk smiley
      const effectiveKey = this._getEffectiveSvgKey(allergenKey, level);
      const svgContent = getSvgContent(effectiveKey);

      // No-data branch: render the icon as a CSS mask filled with the noise
      // pattern instead of inline SVG. The shape is preserved (you still see
      // the allergen silhouette) but the fill is fuzzy, signalling "we have
      // no data for this entry" without screaming red.
      // `level < 0` rather than `=== -1`: DWD scales the level by 2 in the
      // chart path, so adapter-emitted -1 can arrive here as -2.
      const noDataDistinct = this.config?.show_no_data_distinct !== false;
      if (!stale && noDataDistinct && level < 0 && svgContent) {
        const clickHandler = clickable && onClick ? onClick : null;
        const iconUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
        const noiseUri = buildNoiseSvgUri(this._noDataDotColor());
        // No --pp-icon-stroke-width here: the no-data branch renders a masked
        // div with no inline SVG, so the stroke-width var (read by
        // `.pp-icon svg g`) has no effect in this branch.
        const style =
          `--pp-icon-no-data-mask: url("${iconUri}"); ` +
          `--pp-icon-no-data-noise: url("${noiseUri}");` +
          (clickable ? " cursor: pointer;" : "");
        return html`
          <div
            class="pp-icon pp-icon-no-data"
            data-state="no_data"
            style="${style}"
            aria-hidden="true"
            @click=${clickHandler}
          ></div>
        `;
      }

      // Determine stroke color based on sync setting
      let actualStrokeColor;
      if (allergenKey === "no_allergens") {
        // Special handling for no_allergens: always use its color as stroke color since it's stroke-based
        actualStrokeColor = color;
      } else if (this.config?.allergen_stroke_color_synced) {
        // When synced, use the level color for stroke
        actualStrokeColor = color;
      } else {
        // Default: use outline color
        actualStrokeColor = outlineColor;
      }

      const clickHandler = clickable && onClick ? onClick : null;
      const style = `--pp-icon-color: ${color}; --pp-icon-stroke: ${actualStrokeColor}; --pp-icon-stroke-width: ${strokeWidth}; ${clickable ? 'cursor: pointer;' : ''}`;

      if (svgContent) {
        // Render inline SVG with color styling.
        // data-state="ok" mirrors the attribute the no-data icon branch sets,
        // and matches the same attribute on .level-circle, so theme / card-mod
        // overrides can target both states symmetrically.
        return html`
          <div
            class="pp-icon"
            data-state="ok"
            style="${style}"
            aria-hidden="true"
            @click=${clickHandler}
          >
            ${unsafeSVG(svgContent)}
          </div>
        `;
      } else {
        // SVG not found - show error placeholder
        if (this.debug) {
          console.warn(`[SVG] No SVG found for key: ${allergenKey}`);
        }
        return html`
          <div
            class="pp-icon pp-icon-error"
            style="${style}"
            aria-hidden="true"
            @click=${clickHandler}
          >
            <div style="background: #ccc; color: #666; border-radius: 50%; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12px;">?</div>
          </div>
        `;
      }
    }

    /**
     * Ring geometry/colors for the level-circle render path. Returns the opts
     * blob passed to _renderLevelCircle (minus per-cell values like
     * size/iconKey/iconColor which the caller fills in). Shared by the card
     * (normal and minimal modes) and the badge, so the segment count, color
     * array, thickness and gap are derived in one place.
     */
    _buildLevelRingConfig() {
      const segments = ringSegmentsForIntegration(this.config?.integration);
      const colors = [];
      for (let i = 0; i < segments; i++) {
        colors.push(this._levelColorForLevel(i + 1));
      }
      return {
        colors,
        emptyColor: this.config?.levels_empty_color ?? "var(--divider-color)",
        gapColor: this._getGapColor(),
        thickness: this.config?.levels_thickness ?? LEVELS_DEFAULTS.levels_thickness,
        gap: this.config?.levels_gap ?? LEVELS_DEFAULTS.levels_gap,
      };
    }

    /**
     * Resolve the color for the icon centered inside the level ring (#227).
     * Mode "static": user-configured static color (default
     * `var(--primary-text-color)` so the icon follows the theme).
     * Mode "follow_level": same level-mapped color as the side-icon would have.
     * Stale entities always render orange (#e6a800), mirroring the
     * _renderAllergenSvg convention.
     */
    _iconInRingColor(level, allergenKey, { stale = false } = {}) {
      if (stale) return "#e6a800";
      const mode =
        this.config?.icon_in_ring_color_mode ||
        LEVELS_DEFAULTS.icon_in_ring_color_mode;
      if (mode === "follow_level") {
        return this._colorForLevel(level, allergenKey);
      }
      return (
        this.config?.icon_in_ring_static_color ||
        LEVELS_DEFAULTS.icon_in_ring_static_color
      );
    }

    // ---------------------------------------------------------------------------
    // HA entity navigation
    // ---------------------------------------------------------------------------

    _openEntity(entityId) {
      const ev = new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      });
      this.dispatchEvent(ev);
    }

    /**
     * Element-level tap_action handler, shared by the card and the badge.
     *
     * The configured action lives on `this.tapAction` for the card (set in its
     * setConfig) and on `this.config.tap_action` for the badge; resolve from
     * either so one implementation serves both. Dispatches directly via
     * dispatchEvent (like _openEntity) so the mixin does not depend on the
     * card's _fire helper. No-ops unless an action is configured and hass is
     * present, so the caller can bind it unconditionally.
     */
    _handleTapAction(e) {
      const tapAction = this.tapAction || this.config?.tap_action;
      const action = resolveTapActionType(tapAction);
      // Bail before consuming the event for absent/none/unknown actions, so an
      // inert tap_action doesn't swallow the click. hass is needed for
      // more-info and call-service; navigate only needs the History API.
      if (!action) return;
      if (action !== "navigate" && !this._hass) return;
      e?.preventDefault?.();
      e?.stopPropagation?.();
      switch (action) {
        case "more-info": {
          // Fall back to sun.sun, which always exists in Home Assistant.
          const entityId = tapAction.entity || "sun.sun";
          this.dispatchEvent(
            new CustomEvent("hass-more-info", {
              bubbles: true,
              composed: true,
              detail: { entityId },
            }),
          );
          break;
        }
        case "navigate":
          if (
            tapAction.navigation_path &&
            typeof window !== "undefined" &&
            window.history?.pushState
          )
            window.history.pushState(null, "", tapAction.navigation_path);
          break;
        case "call-service": {
          // Accept the card's service/service_data and HA's modern
          // perform_action/data spelling. The target must be a
          // "domain.service" string with both halves present.
          const target = tapAction.service || tapAction.perform_action;
          const [domain, service] =
            typeof target === "string" ? target.split(".") : [];
          if (domain && service)
            this._hass.callService(
              domain,
              service,
              tapAction.service_data || tapAction.data || {},
            );
          break;
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Chart lifecycle
    // ---------------------------------------------------------------------------

    /**
     * Build or refresh all level-circle charts in the current DOM.
     * Chart options are stored as data attributes so charts can be
     * reconstructed after the DOM is cloned or replaced.
     */
    _rebuildCharts() {
      const containers = this.renderRoot?.querySelectorAll(".level-circle") || [];
      const activeIds = new Set();

      // Resolve the no-data dot color once per rebuild. _noDataDotColor() reads
      // getComputedStyle which is non-trivial; caching here both saves work
      // when many circles are no-data AND lets the update branch detect a
      // theme-color change (chart._noDataColor !== noDataColor) so stale
      // patterns get rebuilt instead of reused indefinitely.
      const noDataColor = this._noDataDotColor();

      containers.forEach((container) => {
        activeIds.add(container.id);

        // Extract values from data attributes
        const level = Number(container.dataset.level || 0);
        const displayLevel = Number(container.dataset.displayLevel ?? level);
        const colors = JSON.parse(container.dataset.colors || "[]");
        const numSegments = colors.length;
        const safeLevel = Math.min(level, numSegments);
        const emptyColor = container.dataset.emptyColor;
        const gapColor = container.dataset.gapColor;
        const thickness = Number(container.dataset.thickness);
        const gap = Number(container.dataset.gap);
        const size = Number(container.dataset.size);
        const showValue = container.dataset.showValue === "true";
        const isNoData = container.dataset.state === "no_data";

        // Get custom styling from data attributes
        const fontWeight = container.dataset.fontWeight || "normal";
        const fontSizeRatio = parseFloat(container.dataset.fontSizeRatio) || 0.2;
        const textColor =
          container.dataset.textColor || "var(--primary-text-color)";

        // Retrieve existing chart if it exists
        let chart = this._chartCache.get(container.id);

        // Recreate chart if missing or detached
        if (!chart || !container.contains(chart.canvas)) {
          if (chart) chart.destroy();
          container.innerHTML = "";
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          container.appendChild(canvas);

          const canvasCtx = canvas.getContext("2d");
          // No-data: fill every segment with the noise tile pattern so the
          // ring looks visibly distinct from a real "level 0" (which is just
          // the empty color repeated). Each chart gets its own seed derived
          // from the container id (allergen+dayIndex+level) so adjacent
          // no-data circles don't display identical clumps. Falls back to
          // emptyColor if pattern creation fails (e.g. headless ctx with no
          // createPattern).
          const noisePattern = isNoData
            ? buildNoiseCanvasPattern(canvasCtx, noDataColor, {
                seed: hashStringSeed(container.id),
              })
            : null;
          const fill = noisePattern ?? emptyColor;
          const data = Array(numSegments).fill(1);
          const bg = isNoData
            ? Array(numSegments).fill(fill)
            : Array(numSegments)
                .fill(emptyColor)
                .map((c, i) => (i < safeLevel ? colors[i] : emptyColor));
          const bc = Array(numSegments).fill(gapColor);

          chart = new Chart(canvasCtx, {
            type: "doughnut",
            data: {
              labels: Array(numSegments).fill(""),
              datasets: [
                {
                  data,
                  backgroundColor: bg,
                  borderColor: bc,
                  borderWidth: gap,
                },
              ],
            },
            options: {
              rotation: -Math.PI / 2,
              cutout: `${100 - thickness}%`,
              responsive: false,
              maintainAspectRatio: false,
              animation: {
                duration: 0,
                animateRotate: false,
                animateScale: false,
                easing: "linear",
              },
              transitions: {
                active: {
                  animation: {
                    duration: 0,
                    animateRotate: false,
                    animateScale: false,
                    easing: "linear",
                  },
                },
                show: {
                  animations: {
                    numbers: { duration: 0, easing: "linear" },
                    colors: { duration: 0, easing: "linear" },
                  },
                },
                hide: {
                  animations: {
                    numbers: { duration: 0, easing: "linear" },
                    colors: { duration: 0, easing: "linear" },
                  },
                },
              },
              plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
              },
            },
          });

          // Tag the chart with the dot color used to build this pattern so
          // a later theme-color change can invalidate the cached pattern.
          if (isNoData) chart._noDataColor = noDataColor;
          // Cache the geometry that the chart was actually built with so
          // the update branch can detect when thickness/gap change (e.g.
          // the icon_in_ring auto-toggle swaps thickness 60 ↔ 35).
          chart._thicknessApplied = thickness;
          chart._gapApplied = gap;

          this._chartCache.set(container.id, chart);
        } else {
          // Update existing chart only if colors actually changed
          const datasets = chart.data.datasets;
          if (datasets && datasets[0]) {
            // Geometry change (thickness/gap) doesn't show up under the
            // colors-only update path. The chartId is keyed by allergen +
            // dayIndex + level, so a thickness flip on toggle keeps the
            // same id and the cached Chart instance survives. Detect and
            // propagate before computing colors so cutout matches.
            const geometryChanged =
              chart._thicknessApplied !== thickness ||
              chart._gapApplied !== gap;
            if (geometryChanged) {
              chart.options.cutout = `${100 - thickness}%`;
              datasets[0].borderWidth = gap;
              chart._thicknessApplied = thickness;
              chart._gapApplied = gap;
            }
            const oldBg = datasets[0].backgroundColor;
            let bg;
            if (isNoData) {
              // Reuse the cached pattern if the chart already has one in oldBg
              // AND the theme dot color hasn't changed since it was built.
              // Otherwise rebuild so a theme switch propagates through.
              const existingPattern = oldBg.find(
                (c) => typeof c === "object" && c !== null,
              );
              const colorChanged = chart._noDataColor !== noDataColor;
              let pattern;
              if (existingPattern && !colorChanged) {
                pattern = existingPattern;
              } else {
                pattern =
                  buildNoiseCanvasPattern(
                    chart.canvas.getContext("2d"),
                    noDataColor,
                    { seed: hashStringSeed(container.id) },
                  ) ?? emptyColor;
                chart._noDataColor = noDataColor;
              }
              bg = Array(oldBg.length).fill(pattern);
            } else {
              bg = Array(oldBg.length)
                .fill(emptyColor)
                .map((c, i) => (i < safeLevel ? colors[i] : emptyColor));
            }

            const colorsChanged =
              bg.length !== oldBg.length || bg.some((c, i) => c !== oldBg[i]);
            if (colorsChanged || geometryChanged) {
              datasets[0].backgroundColor = bg;
              chart.update("none");
            }
          }
        }

        // Add or update the centered allergen icon (#227 icon-in-ring).
        // Data attributes drive everything; the chart canvas was just
        // (re)created above so we always re-append at the end if needed.
        const iconKey = container.dataset.iconKey || "";
        const iconColor = container.dataset.iconColor || "";
        const iconSizeRatio =
          parseFloat(container.dataset.iconSizeRatio) ||
          LEVELS_DEFAULTS.icon_in_ring_size_ratio;
        let ringIcon = container.querySelector(".ring-icon");
        // Resolve the SVG once; if missing, fall back to the no-icon
        // path so the numeric overlay below can render instead of an
        // empty .ring-icon shell.
        const svgForIcon =
          iconKey && ringIcon?.dataset.iconKey === iconKey
            ? null // already mounted with this key; skip refetch
            : iconKey
              ? getSvgContent(iconKey)
              : null;
        const hasRenderableIcon =
          iconKey &&
          (ringIcon?.dataset.iconKey === iconKey || svgForIcon !== null);
        if (hasRenderableIcon) {
          const innerHole = size * (1 - thickness / 100);
          const iconDiameter = Math.max(1, Math.round(innerHole * iconSizeRatio));
          if (!ringIcon) {
            ringIcon = document.createElement("div");
            ringIcon.className = "ring-icon";
            // Mark as decorative — the level value (data-display-level on
            // the parent .level-circle) is the screen-reader signal; the
            // centered SVG is duplicate visual information.
            ringIcon.setAttribute("aria-hidden", "true");
            container.appendChild(ringIcon);
          }
          ringIcon.style.width = `${iconDiameter}px`;
          ringIcon.style.height = `${iconDiameter}px`;
          ringIcon.style.color = iconColor;
          if (svgForIcon !== null && ringIcon.dataset.iconKey !== iconKey) {
            ringIcon.innerHTML = svgForIcon;
            ringIcon.dataset.iconKey = iconKey;
          }
        } else if (ringIcon) {
          ringIcon.remove();
          ringIcon = null;
        }

        // Add or update numeric text overlay (suppress negative values).
        // Only mutate DOM when the displayed value actually changed.
        // Suppressed when a renderable ring-icon occupies the donut hole,
        // to avoid the icon and the number colliding. When iconKey is
        // set but the SVG is missing, hasRenderableIcon is false above
        // and we fall back to the numeric overlay.
        const existingText = container.querySelector(".level-value-text");
        if (showValue && displayLevel >= 0 && !hasRenderableIcon) {
          if (existingText && existingText.textContent === String(displayLevel)) {
            // Value unchanged — skip DOM mutation.
          } else {
            if (existingText) existingText.remove();
            const valueText = document.createElement("div");
            valueText.className = "level-value-text";
            valueText.textContent = displayLevel;
            // Fill the ring box and flex-centre the digit, so it is centred
            // optically rather than anchored to the text baseline (which made
            // the number read slightly high). line-height:1 keeps the line box
            // tight; explicit edges (not the `inset` shorthand) for the legacy
            // browser build.
            valueText.style.position = "absolute";
            valueText.style.top = "0";
            valueText.style.left = "0";
            valueText.style.right = "0";
            valueText.style.bottom = "0";
            valueText.style.display = "flex";
            valueText.style.alignItems = "center";
            valueText.style.justifyContent = "center";
            valueText.style.lineHeight = "1";
            valueText.style.fontSize = `${size * fontSizeRatio}px`;
            valueText.style.fontWeight = fontWeight;
            valueText.style.color = textColor;
            container.appendChild(valueText);
          }
        } else if (existingText) {
          existingText.remove();
        }
      });

      // Remove charts whose containers disappeared
      this._chartCache.forEach((cachedChart, id) => {
        if (!activeIds.has(id)) {
          cachedChart.destroy();
          this._chartCache.delete(id);
        }
      });
    }

    // ---------------------------------------------------------------------------
    // Lifecycle hooks (chart subset only — card-specific logic stays on card)
    // ---------------------------------------------------------------------------

    updated(changedProps) {
      if (super.updated) super.updated(changedProps);
      // After rendering, ensure all charts exist.
      this.updateComplete.then(() => this._rebuildCharts());
    }

    // Recreate charts when element is connected, useful after DOM cloning.
    connectedCallback() {
      super.connectedCallback();
      Promise.resolve().then(() => this._rebuildCharts());
    }

    // Clean up charts when component is disconnected.
    disconnectedCallback() {
      this._chartCache.forEach((chart) => {
        chart.destroy();
      });
      this._chartCache.clear();
      super.disconnectedCallback();
    }
  };
