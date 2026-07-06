// src/rendering/level-circle-mixin.js
//
// Mixin that provides the level-circle / icon-in-ring rendering engine.
// Applied to both PollenPrognosCard and the forthcoming PollenPrognosBadge
// so the Chart.js doughnut logic is never duplicated.
//
// Usage:
//   class MyElement extends LevelCircleMixin(LitElement) { ... }

import { LitElement, html } from "lit";
import type { TemplateResult } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { getSvgContent } from "../pollenprognos-svgs.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { ringSegmentsForIntegration } from "../utils/level-counts.js";
import { buildNoiseSvgUri, hashStringSeed } from "../utils/no-data-pattern.js";
import { buildDonutSvg } from "./donut.js";
import { ALLERGEN_ICON_FALLBACK, toCanonicalAllergenKey } from "../constants.js";
import type { CardConfig } from "../types/config.js";
import type { HomeAssistant } from "../types/home-assistant.js";

/** Generic mixin base constraint. `any[]` args is the standard mixin pattern. */
type Constructor<T = object> = new (...args: any[]) => T;

/** The effective action a resolved tap_action maps to. */
type TapActionType = "more-info" | "navigate" | "call-service";

/**
 * A tap_action config. The dual-shape union mirrors the legacy YAML: this card
 * historically used `type`, Lovelace standard uses `action`; likewise
 * `service`/`service_data` vs HA's modern `perform_action`/`data`. Typed as it
 * IS, no semantic change.
 */
interface TapActionConfig {
  action?: string;
  type?: string;
  entity?: string;
  navigation_path?: string;
  service?: string;
  perform_action?: string;
  service_data?: Record<string, unknown>;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
}

/** Ring geometry/colors passed to {@link _renderLevelCircle}. */
interface LevelCircleOpts {
  colors?: string[];
  emptyColor?: string;
  gapColor?: string;
  thickness?: number;
  gap?: number;
  size?: number;
  iconKey?: string;
  iconColor?: string;
  iconSizeRatio?: number;
}

/** Options for {@link _renderAllergenSvg}. */
interface AllergenSvgOptions {
  onClick?: (e: Event) => void;
  clickable?: boolean;
  stale?: boolean;
}

// The tap_action types the shared handler knows how to perform.
const TAP_ACTION_TYPES: TapActionType[] = ["more-info", "navigate", "call-service"];

/**
 * Read the raw action keyword from a tap_action object, honouring both shapes:
 * the Lovelace-standard `action` key (e.g. `{ action: "navigate" }`) and this
 * card's historical `type` key (e.g. `{ type: "navigate" }`). `action` wins so
 * a standard HA config is never misread. HA renamed "call-service" to
 * "perform-action" (2024.8); map it back to our internal "call-service".
 *
 * @returns keyword (possibly "" when neither key is set)
 */
function rawTapActionType(tapAction: TapActionConfig): string {
  const raw = tapAction.action || tapAction.type || "";
  return raw === "perform-action" ? "call-service" : raw;
}

/**
 * Parse a HA service id into [domain, service]. A valid id is exactly
 * "domain.service": one dot, both halves non-empty. Multi-dot strings
 * (e.g. "foo.bar.baz") and dotless strings are rejected so a misconfigured
 * value can't silently call an unintended service.
 */
function parseServiceId(svc: unknown): [string, string] | null {
  if (typeof svc !== "string") return null;
  const parts = svc.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
}

/**
 * Resolve a tap_action config to the effective action type, or null when the
 * action is absent/unactionable. A plain object with no action keyword defaults
 * to "more-info" (the handler's documented default); "none", non-objects,
 * arrays, and unknown keywords resolve to null. Callers use this both to decide
 * whether to bind a click listener (so the element isn't clickable-but-inert)
 * and to dispatch, keeping the binding and the handler in lockstep.
 *
 */
export function resolveTapActionType(tapAction: unknown): TapActionType | null {
  if (!tapAction || typeof tapAction !== "object" || Array.isArray(tapAction))
    return null;
  const ta = tapAction as TapActionConfig;
  const type = rawTapActionType(ta) || "more-info";
  if (!TAP_ACTION_TYPES.includes(type as TapActionType)) return null;
  // Mirror the handler's own field requirements so callers never bind a click
  // (or show a pointer cursor) for a config the handler would no-op on.
  if (type === "navigate" && !ta.navigation_path) return null;
  if (type === "call-service" && !parseServiceId(ta.service || ta.perform_action))
    return null;
  return type as TapActionType;
}

/**
 * Decide whether a per-icon click should open more-info, given the badge/card
 * `link_to_sensors` setting and whether the element has an active tap_action.
 *
 * Without a tap_action, per-icon more-info is the default (on unless the user
 * set `link_to_sensors: false`). With a tap_action configured, the whole
 * element runs that action and per-icon more-info is suppressed UNLESS the user
 * explicitly opted in with `link_to_sensors: true` -- otherwise the ring/icon
 * click handler (stopPropagation + more-info) would shadow the configured
 * tap_action, since the ring covers almost the whole element (#279).
 *
 * `linkToSensors` is boolean|undefined after the config boundary coerces string
 * scalars, but typed `unknown` here to stay tolerant of a raw call.
 */
export function iconMoreInfoEnabled(
  linkToSensors: unknown,
  hasTapAction: boolean,
): boolean {
  return hasTapAction ? linkToSensors === true : linkToSensors !== false;
}

/**
 * LevelCircleMixin — adds the level-circle / icon-in-ring rendering engine
 * to any LitElement subclass.
 *
 * The level ring is rendered declaratively as an inline SVG (see donut.js), so
 * there is no chart cache, no destroy/recreate lifecycle, and no post-render
 * DOM patching: the whole circle (ring + centered icon + numeric value) comes
 * out of _renderLevelCircle in one lit template.
 *
 * Contributes:
 *   - _noDataDotColor(), _getSvgKey(), _colorForLevel(), _levelColorForLevel(),
 *     _getGapColor(), _getEffectiveSvgKey(), _iconInRingColor()
 *   - _renderLevelCircle(), _buildLevelRingConfig()
 *   - _openEntity()
 */
export const LevelCircleMixin = <T extends Constructor<LitElement>>(Base: T) =>
  class extends Base {
    // These reactive properties are owned by the concrete card/badge that the
    // mixin is applied to; the mixin only reads them. `declare` types them
    // without emitting a field (no runtime footprint, no clobbering the host).
    declare config?: CardConfig;
    declare _hass?: HomeAssistant;
    declare debug?: boolean;
    declare tapAction?: TapActionConfig;

    // ---------------------------------------------------------------------------
    // Color helpers
    // ---------------------------------------------------------------------------

    /**
     * Gets color for a specific level for allergen icons.
     * @param level - The pollen level (0-6 or 0-4 depending on integration)
     * @param allergenKey - Optional allergen key for special handling
     * @returns Color hex string
     */
    _colorForLevel(level: number, allergenKey: string | null = null): string {
      // Special handling for no_allergens icon
      if (allergenKey === "no_allergens") {
        return (
          (this.config?.no_allergens_color as string) ||
          LEVELS_DEFAULTS.no_allergens_color
        );
      }

      // Use custom allergen colors if set
      if (this.config?.allergen_color_mode === "custom" && this.config?.allergen_colors) {
        const allergenColors = this.config.allergen_colors as string[];
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
     * @param level - The pollen level (0-6 or 0-4 depending on integration)
     * @returns Color hex string
     */
    _levelColorForLevel(level: number): string {
      // If level circles inherit from allergen colors (default)
      if (this.config?.levels_inherit_mode !== "custom") {
        // Use allergen color directly - same level mapping (but no special allergen key)
        return this._colorForLevel(level, null);
      }

      // Use custom level colors with traditional mapping
      // Level 0 uses empty color, Level 1+ uses pollen colors
      if (level === 0) {
        return (
          (this.config?.levels_empty_color as string) ||
          LEVELS_DEFAULTS.levels_empty_color
        );
      }

      const colors =
        (this.config?.levels_colors as string[]) || LEVELS_DEFAULTS.levels_colors;
      const colorIndex = level - 1; // Map level 1->0, 2->1, etc.
      const clampedIndex = Math.max(0, Math.min(colorIndex, colors.length - 1));
      return colors[clampedIndex] || colors[0];
    }

    /**
     * Determines the appropriate gap color based on inheritance mode.
     * @returns The gap color to use
     */
    _getGapColor(): string {
      // Use allergen outline color as gap color when inheriting, otherwise use custom gap color
      return this.config?.levels_inherit_mode !== "custom"
        ? ((this.config?.allergen_outline_color as string) ??
            LEVELS_DEFAULTS.levels_gap_color)
        : ((this.config?.levels_gap_color as string) ??
            "var(--card-background-color)");
    }

    // ---------------------------------------------------------------------------
    // SVG key helpers
    // ---------------------------------------------------------------------------

    /**
     * Gets the SVG key for an allergen.
     * @param allergenReplaced - The allergen identifier
     * @returns The key to use for SVG loading, or null if invalid
     */
    _getSvgKey(allergenReplaced: unknown): string | null {
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
    _getEffectiveSvgKey(allergenKey: string, level: number): string {
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
    _noDataDotColor(): string {
      if (typeof window !== "undefined" && window.getComputedStyle) {
        try {
          const v = window
            .getComputedStyle(this)
            .getPropertyValue("--primary-text-color")
            .trim();
          if (v) return v;
        } catch {
          // ignore and fall through
        }
      }
      return "#888888";
    }

    // ---------------------------------------------------------------------------
    // Ring config / rendering
    // ---------------------------------------------------------------------------

    _renderLevelCircle(
      level: number,
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
      }: LevelCircleOpts,
      allergen = "default",
      dayIndex = 0,
      displayLevel = level,
      entityId: string | null = null,
      clickable = true,
    ): TemplateResult {
      // Stable id per cell (allergen + day + level + size). Kept for theme /
      // card-mod targeting and as the no-data noise seed source, so adjacent
      // no-data rings get distinct textures.
      const circleId = `chart-${allergen}-${dayIndex}-${level}-${size}`;

      const noDataDistinct = this.config?.show_no_data_distinct !== false;
      // `level < 0` rather than `=== -1` so per-integration scaling doesn't
      // hide the no-data sentinel. E.g. DWD scales raw state by 2 in the
      // daily-row path, so an adapter-emitted -1 reaches here as -2.
      const isNoData = noDataDistinct && level < 0;
      const stateAttr = isNoData ? "no_data" : "ok";

      const numSegments = colors.length;
      const donutSvg = buildDonutSvg({
        level,
        segments: numSegments,
        colors,
        emptyColor,
        gapColor,
        thickness,
        gap,
        size,
        noData: isNoData,
        noiseColor: isNoData ? this._noDataDotColor() : undefined,
        noiseSeed: hashStringSeed(circleId),
      });

      // Centered ring icon (#227): only when a key is set and its SVG exists.
      const svgForIcon = iconKey ? getSvgContent(iconKey) : null;
      const hasRingIcon = !!svgForIcon;
      let ringIcon: string | TemplateResult = "";
      if (hasRingIcon) {
        const innerHole = size * (1 - thickness / 100);
        const iconDiameter = Math.max(1, Math.round(innerHole * iconSizeRatio));
        // aria-hidden: the numeric level (data-display-level) is the SR signal.
        ringIcon = html`
          <div
            class="ring-icon"
            aria-hidden="true"
            style="width: ${iconDiameter}px; height: ${iconDiameter}px; color: ${iconColor};"
          >
            ${unsafeSVG(svgForIcon)}
          </div>
        `;
      }

      // Numeric value overlay: suppressed when a ring icon occupies the hole
      // (they'd collide) and for negative/no-data values.
      const showValue = !!this.config?.show_value_numeric_in_circle;
      const fontWeight =
        (this.config?.levels_text_weight as string) || "normal";
      const fontSizeRatio = (this.config?.levels_text_size as number) || 0.2;
      const textColor =
        (this.config?.levels_text_color as string) || "var(--primary-text-color)";
      let valueText: string | TemplateResult = "";
      if (showValue && displayLevel >= 0 && !hasRingIcon) {
        valueText = html`
          <div
            class="level-value-text"
            style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; line-height: 1; font-size: ${size *
            fontSizeRatio}px; font-weight: ${fontWeight}; color: ${textColor};"
          >
            ${displayLevel}
          </div>
        `;
      }

      return html`
        <div
          id="${circleId}"
          class="level-circle"
          style="display: inline-block; width: ${size}px; height: ${size}px; position: relative;${clickable &&
          entityId
            ? " cursor: pointer;"
            : ""}"
          data-level="${level}"
          data-display-level="${displayLevel}"
          data-state="${stateAttr}"
          @click=${(e: Event) => {
            if (clickable && entityId) {
              e.stopPropagation();
              this._openEntity(entityId);
            }
          }}
        >
          ${unsafeSVG(donutSvg)}${ringIcon}${valueText}
        </div>
      `;
    }

    // ---------------------------------------------------------------------------
    // Allergen icon rendering
    // ---------------------------------------------------------------------------

    /**
     * Renders an allergen SVG icon with proper color styling
     * @param allergenKey - The allergen key
     * @param level - The pollen level for color
     * @param options - Optional configuration
     * @returns HTML template with SVG or placeholder
     */
    _renderAllergenSvg(
      allergenKey: unknown,
      level: number,
      options: AllergenSvgOptions = {},
    ): TemplateResult {
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
      const outlineColor =
        (this.config?.allergen_outline_color as string) ||
        LEVELS_DEFAULTS.levels_gap_color;
      const strokeWidth =
        (this.config?.allergen_stroke_width as number) ??
        LEVELS_DEFAULTS.allergen_stroke_width;
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
      let actualStrokeColor: string;
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
    _buildLevelRingConfig(): Required<
      Pick<LevelCircleOpts, "colors" | "emptyColor" | "gapColor" | "thickness" | "gap">
    > {
      const segments = ringSegmentsForIntegration(this.config?.integration ?? "");
      const colors: string[] = [];
      for (let i = 0; i < segments; i++) {
        colors.push(this._levelColorForLevel(i + 1));
      }
      return {
        colors,
        emptyColor:
          (this.config?.levels_empty_color as string) ?? "var(--divider-color)",
        gapColor: this._getGapColor(),
        thickness:
          (this.config?.levels_thickness as number) ??
          LEVELS_DEFAULTS.levels_thickness,
        gap: (this.config?.levels_gap as number) ?? LEVELS_DEFAULTS.levels_gap,
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
    _iconInRingColor(
      level: number,
      allergenKey: string,
      { stale = false }: { stale?: boolean } = {},
    ): string {
      if (stale) return "#e6a800";
      const mode =
        (this.config?.icon_in_ring_color_mode as string) ||
        LEVELS_DEFAULTS.icon_in_ring_color_mode;
      if (mode === "follow_level") {
        return this._colorForLevel(level, allergenKey);
      }
      return (
        (this.config?.icon_in_ring_static_color as string) ||
        LEVELS_DEFAULTS.icon_in_ring_static_color
      );
    }

    // ---------------------------------------------------------------------------
    // HA entity navigation
    // ---------------------------------------------------------------------------

    _openEntity(entityId: string): void {
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
    _handleTapAction(e?: Event): void {
      const tapAction = (this.tapAction || this.config?.tap_action) as
        | TapActionConfig
        | undefined;
      const action = resolveTapActionType(tapAction);
      // Bail before consuming the event for absent/none/unknown actions, so an
      // inert tap_action doesn't swallow the click. hass is needed for
      // more-info and call-service; navigate only needs the History API.
      if (!action) return;
      // `action` is non-null only for a valid tap_action object, so `ta` is
      // safe to treat as a populated config from here on.
      const ta = tapAction as TapActionConfig;
      if (action !== "navigate" && !this._hass) return;
      e?.preventDefault?.();
      e?.stopPropagation?.();
      switch (action) {
        case "more-info": {
          // Fall back to sun.sun, which always exists in Home Assistant.
          const entityId = ta.entity || "sun.sun";
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
            ta.navigation_path &&
            typeof window !== "undefined" &&
            window.history?.pushState
          ) {
            window.history.pushState(null, "", ta.navigation_path);
            // HA's router listens on window for "location-changed"; a bare
            // pushState updates the URL but never re-resolves the panel. Mirror
            // the frontend navigate() helper's fireEvent form: a plain Event
            // (bubbles+composed) with a { replace } detail bag attached.
            const ev = new Event("location-changed", {
              bubbles: true,
              composed: true,
            });
            (ev as unknown as { detail: { replace: boolean } }).detail = {
              replace: false,
            };
            window.dispatchEvent(ev);
          }
          break;
        case "call-service": {
          // Accept the card's service/service_data and HA's modern
          // perform_action/data spelling. parseServiceId enforces a strict
          // "domain.service" id. Forward the HA-standard `target`
          // (entity_id/device_id/area_id) as the fourth callService argument
          // so perform-action targets aren't dropped.
          const parsed = parseServiceId(ta.service || ta.perform_action);
          if (parsed)
            this._hass?.callService?.(
              parsed[0],
              parsed[1],
              ta.service_data || ta.data || {},
              ta.target,
            );
          break;
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Chart lifecycle (removed)
    // ---------------------------------------------------------------------------
    //
    // The level ring is now inline SVG rendered declaratively in
    // _renderLevelCircle, so the former _rebuildCharts() / _chartCache /
    // destroy-recreate lifecycle and the updated()/connectedCallback()/
    // disconnectedCallback() overrides are gone: lit re-renders the ring, the
    // centered icon and the numeric value together on every update, and there
    // is nothing imperative left to tear down. The card and badge keep their
    // own lifecycle hooks (subscriptions etc.) untouched.
  };

