// src/pollenprognos-badge.js
//
// Compact HA badge element that renders one or more pollen level rings.
// Visually identical to the minimal-mode icon-in-ring cells of the main card,
// sized for a badge pill (host is inline-flex, no <ha-card> wrapper).
//
// Supported badge_content modes:
//   "worst"     — single sensor with the highest current level (default)
//   "aggregate" — overall-risk sensor (isSummary); falls back to "worst"
//   "single"    — allergen named in badge_single_allergen; falls back to "worst"
//   "row"       — all sensors side by side
//
// The badge editor element (pollenprognos-badge-editor) is a separate task;
// getConfigElement points at that tag so HA can lazy-load it when ready.

import { LitElement, html, css } from "lit";
import { t, detectLang } from "./i18n.js";
import { getAdapter, getStubConfig } from "./adapter-registry.js";
import { findAvailableSensors } from "./utils/sensors.js";
import {
  filterSensorsPostFetch,
  selectBadgeSensor,
  coerceBool,
} from "./utils/adapter-helpers.js";
import {
  LEVELS_DEFAULTS,
  NORMAL_DEFAULT_THICKNESS,
  ICON_IN_RING_DEFAULT_THICKNESS,
} from "./utils/levels-defaults.js";
import { LevelCircleMixin } from "./rendering/level-circle-mixin.js";
import silamAllergenMap from "./adapters/silam_allergen_map.json" assert { type: "json" };

class PollenPrognosBadge extends LevelCircleMixin(LitElement) {
  // ---------------------------------------------------------------------- //
  // Instance fields                                                          //
  // ---------------------------------------------------------------------- //

  _hass = null;
  _userConfig = null;
  sensors = [];

  // ---------------------------------------------------------------------- //
  // Lit reactive properties                                                  //
  // ---------------------------------------------------------------------- //

  static get properties() {
    return {
      hass: { state: true },
      config: {},
      sensors: { state: true },
      _error: { type: String, state: true },
      _isLoaded: { type: Boolean, state: true },
    };
  }

  // ---------------------------------------------------------------------- //
  // Helpers                                                                  //
  // ---------------------------------------------------------------------- //

  get debug() {
    return Boolean(this.config && this.config.debug);
  }

  get _lang() {
    return detectLang(this._hass, this.config?.date_locale);
  }

  _t(key, vars = {}) {
    return t(key, this._lang, vars);
  }

  // _noDataDotColor() is inherited from LevelCircleMixin; no override needed.

  // ---------------------------------------------------------------------- //
  // HA card protocol                                                         //
  // ---------------------------------------------------------------------- //

  static async getConfigElement() {
    await customElements.whenDefined("pollenprognos-badge-editor");
    return document.createElement("pollenprognos-badge-editor");
  }

  /**
   * Default stub config surfaced in the HA badge picker.
   * No `type` key — HA badge convention differs from card convention.
   */
  static getStubConfig(_hass, _entities, _entitiesFallback) {
    return {
      integration: "pp",
      badge_content: "worst",
      icon_in_ring: true,
    };
  }

  // ---------------------------------------------------------------------- //
  // setConfig                                                                //
  // ---------------------------------------------------------------------- //

  setConfig(config) {
    // Normalize integration: trim + lowercase if string.
    let integration = config.integration;
    if (integration && typeof integration === "string") {
      integration = integration.trim().toLowerCase();
    }

    const stub = getStubConfig(integration) || getStubConfig("pp");
    if (!integration) integration = stub.integration;

    // Defensive typeguards (repo policy): coerce YAML-sourced fields that the
    // badge adds so mis-typed values can't cause silent misbehaviour.
    const badgeContent =
      typeof config.badge_content === "string"
        ? config.badge_content
        : "worst";
    const badgeSingleAllergen =
      typeof config.badge_single_allergen === "string"
        ? config.badge_single_allergen
        : undefined;
    const badgeShowLabel = coerceBool(config.badge_show_label);
    // Visual mode: icon_in_ring (default) | ring_value | ring_empty | icon_only.
    const VISUALS = ["icon_in_ring", "ring_value", "ring_empty", "icon_only"];
    const badgeVisual = VISUALS.includes(config.badge_visual)
      ? config.badge_visual
      : "icon_in_ring";
    // Scale: whole-badge multiplier; default 1 = standard HA badge size.
    const badgeScaleRaw = Number(config.badge_scale);
    const badgeScale =
      Number.isFinite(badgeScaleRaw) && badgeScaleRaw > 0 ? badgeScaleRaw : 1;
    // Label position: right (community convention, default) | below.
    const badgeLabelPosition =
      config.badge_label_position === "below" ? "below" : "right";

    // badge_visual drives two engine flags so the shared LevelCircleMixin
    // renders the right centre content: icon_in_ring shows the allergen icon;
    // ring_value shows the numeric overlay; ring_empty/icon_only show neither
    // (icon_only renders a bare icon outside the ring path entirely).
    const iconInRing = badgeVisual === "icon_in_ring";
    const showValueInCircle = badgeVisual === "ring_value";

    // Badges are tiny, so whenever the ring holds something in its centre — an
    // icon (icon_in_ring) OR a number (ring_value) — thin the ring so the
    // centre content stays legible, matching the card's icon-in-ring treatment.
    //
    // We can't treat any present levels_thickness as "user set": the editor
    // bakes the stub default (60) into the saved config, so a 60 on an
    // icon-in-ring badge is almost always that baked default, not a deliberate
    // choice. Apply the card's auto-shift safety rule symmetrically — use the
    // mode's preferred default when the saved thickness is missing OR equals the
    // OTHER mode's default; any other value is a genuine override and is kept.
    // Tradeoff: thickness exactly 60 is unreachable in a ring-centre mode (it
    // coerces to 35); 35 is unreachable in the no-centre modes (coerces to 60).
    const ringHasCentre = iconInRing || showValueInCircle;
    const preferredThickness = ringHasCentre
      ? ICON_IN_RING_DEFAULT_THICKNESS
      : NORMAL_DEFAULT_THICKNESS;
    const otherThicknessDefault = ringHasCentre
      ? NORMAL_DEFAULT_THICKNESS
      : ICON_IN_RING_DEFAULT_THICKNESS;
    const savedThickness = config.levels_thickness;
    const effectiveThickness =
      savedThickness == null || savedThickness === otherThicknessDefault
        ? preferredThickness
        : savedThickness;

    // ring_value: bump the numeric size a touch (mirrors the larger icon in
    // icon_in_ring) so it fills the thinner ring's wider hole. Same baked-
    // default caveat as thickness above: the editor persists the stub default
    // (0.2), so treat a saved 0.2 in ring_value mode as "use the bumped 0.3"
    // rather than a deliberate choice; any other saved value is kept.
    const BADGE_VALUE_TEXT_SIZE = 0.3;
    const baseTextSize = LEVELS_DEFAULTS.levels_text_size;
    const savedTextSize = config.levels_text_size;
    let effectiveTextSize;
    if (showValueInCircle) {
      effectiveTextSize =
        savedTextSize == null || savedTextSize === baseTextSize
          ? BADGE_VALUE_TEXT_SIZE
          : savedTextSize;
    } else {
      effectiveTextSize = savedTextSize == null ? baseTextSize : savedTextSize;
    }

    // Merge order: stub → badge-oriented defaults → user config, so user
    // always wins for plain keys. The badge-derived engine flags are applied
    // AFTER the spread so badge_visual stays the single source of truth.
    this.config = {
      ...stub,
      badge_content: "worst",
      badge_show_label: false,
      ...config,
      integration,
      // Re-apply coerced fields after spread so they override raw values.
      badge_content: badgeContent,
      badge_show_label: badgeShowLabel,
      badge_visual: badgeVisual,
      badge_scale: badgeScale,
      badge_label_position: badgeLabelPosition,
      icon_in_ring: iconInRing,
      show_value_numeric_in_circle: showValueInCircle,
      levels_thickness: effectiveThickness,
      levels_text_size: effectiveTextSize,
      ...(badgeSingleAllergen !== undefined
        ? { badge_single_allergen: badgeSingleAllergen }
        : {}),
      // A badge shows today's value only and has no forecast-event
      // subscription, so non-daily SILAM/PEU modes would fetch an empty
      // forecast and render an empty pill. Force daily regardless of any
      // mode the user may have hand-written in YAML.
      mode: "daily",
    };

    this._userConfig = { ...config };

    // Trigger a data fetch if hass is already available.
    if (this._hass) {
      this._fetchSensors(this._hass);
    }
  }

  // ---------------------------------------------------------------------- //
  // hass setter                                                              //
  // ---------------------------------------------------------------------- //

  set hass(hass) {
    if (this._hass === hass) return;
    this._hass = hass;
    this._fetchSensors(hass);
  }

  get hass() {
    return this._hass;
  }

  /**
   * Fetch sensors from the adapter and populate this.sensors. Mirrors the
   * non-silam fetch path of PollenPrognosCard. Silam forecast-event
   * subscriptions are not implemented in the badge MVP; fetchForecast is
   * called without a forecastEvent which makes the adapter fall back to
   * entity.attributes.forecast (daily-mode silam still works).
   *
   * @param {object} hass
   */
  _fetchSensors(hass) {
    const cfg = this.config;
    if (!cfg) return;

    const adapter = getAdapter(cfg.integration) || getAdapter("pp");

    adapter
      .fetchForecast(hass, cfg)
      .then((sensors) => {
        const availableSensors = findAvailableSensors(cfg, hass, this.debug);

        // For silam daily, pass the full state-key list + allergen map so
        // filterSensorsPostFetch can do the same discovery the card does.
        const isSilamDaily =
          cfg.integration === "silam" &&
          (!cfg.mode || cfg.mode === "daily");

        const filtered = filterSensorsPostFetch(
          sensors,
          cfg,
          availableSensors,
          isSilamDaily ? Object.keys(hass.states) : [],
          isSilamDaily ? silamAllergenMap.mapping : {},
        );

        this.sensors = filtered;
        this._isLoaded = true;
        this._error = filtered.length ? null : "card.error_no_sensors";
      })
      .catch((err) => {
        console.error("[Badge] fetch error:", err);
        this._isLoaded = true;
        this._error = "card.error_entity_unavailable";
        this.requestUpdate();
      });
  }

  // ---------------------------------------------------------------------- //
  // Render                                                                   //
  // ---------------------------------------------------------------------- //

  /**
   * Resolve the badge's pill HEIGHT in px, following the native HA badge size
   * convention (--ha-badge-size, 36px) multiplied by badge_scale. The ring and
   * bare icon are derived from this height (see ring math in render), so the
   * whole pill scales as a unit and a default badge matches a stock HA badge.
   * setConfig always normalises badge_scale to a positive number, so this is a
   * single deterministic path.
   *
   * @returns {number}
   */
  _badgeBaseSize() {
    // Native HA badge height; kept local to avoid module-scope minification
    // quirks. badge_scale multiplies it.
    const HA_BADGE_SIZE = 36;
    const scale = Number(this.config?.badge_scale) || 1;
    return Math.round(HA_BADGE_SIZE * scale);
  }

  render() {
    // Pill height follows the HA badge convention; the ring sits inside it.
    const height = this._badgeBaseSize();
    const ring = Math.round(height * 0.78);
    // --ppb-size drives the proportional pill CSS (padding/gap/radius/label);
    // --pollen-icon-size sizes the bare icon used by the icon_only mode.
    const hostStyle = `--ppb-size: ${height}px; --pollen-icon-size: ${ring}px;`;

    // Not yet loaded: render an empty pill placeholder so the badge slot
    // doesn't jump when data arrives. It carries the same size base.
    if (!this._isLoaded) {
      return html`<div class="ppb ppb--right" style="${hostStyle}"><div class="ppb-empty"></div></div>`;
    }

    // Error or no sensors: render a tiny empty pill; do NOT render a big
    // error card — the badge slot is not the right place for verbose errors.
    const picks = selectBadgeSensor(this.sensors, this.config);
    if (!picks.length) {
      return html`<div class="ppb ppb--right" style="${hostStyle}"><div class="ppb-empty"></div></div>`;
    }

    const ringConfig = this._buildLevelRingConfig();
    const ringIconRatio =
      Number(this.config?.icon_in_ring_size_ratio) ||
      LEVELS_DEFAULTS.icon_in_ring_size_ratio;

    const visualMode = this.config?.badge_visual || "icon_in_ring";
    const labelBelow = this.config?.badge_label_position === "below";
    const showLabel = this.config.badge_show_label === true;

    return html`
      <div class="ppb ${labelBelow ? "ppb--below" : "ppb--right"}" style="${hostStyle}">
        ${picks.map((sensor) => {
          const normalizedLevel = Number(sensor.day0?.state) || 0;
          const ringLevel =
            this.config.integration === "dwd"
              ? normalizedLevel * 2
              : normalizedLevel;
          const svgKey = this._getSvgKey(sensor.allergenReplaced);
          const rawNum =
            sensor.day0?.display_state ?? sensor.day0?.state ?? ringLevel;
          const displayLevel = rawNum != null && rawNum >= 0 ? rawNum : ringLevel;
          const clickable =
            this.config.link_to_sensors !== false && !!sensor.entity_id;

          const visual = this._renderBadgeVisual(
            visualMode,
            sensor,
            { ringConfig, base: ring, ringIconRatio, ringLevel, svgKey, displayLevel, clickable },
          );

          return html`
            <div class="ppb-item">
              ${visual}
              ${showLabel
                ? html`<span class="ppb-label">
                    ${sensor.allergenShort ??
                    sensor.allergenCapitalized ??
                    ""}
                  </span>`
                : ""}
            </div>
          `;
        })}
      </div>
    `;
  }

  /**
   * Build the centre visual for one sensor according to badge_visual:
   *   icon_in_ring — level ring with the allergen icon centred (default)
   *   ring_value   — level ring with the numeric value centred
   *   ring_empty   — level ring with nothing centred
   *   icon_only    — bare allergen symbol, no ring
   *
   * All four reuse the shared LevelCircleMixin (no duplicated rendering). The
   * mixin renders the numeric overlay only when show_value_numeric_in_circle is
   * on AND no icon occupies the hole — setConfig already set those engine flags
   * from badge_visual, so here we only choose iconKey and which call to make.
   *
   * @param {string} mode
   * @param {object} sensor
   * @param {object} ctx
   * @returns {import("lit").TemplateResult}
   */
  _renderBadgeVisual(mode, sensor, ctx) {
    const { ringConfig, base, ringIconRatio, ringLevel, svgKey, displayLevel, clickable } = ctx;

    if (mode === "icon_only") {
      const onClick = (e) => {
        if (clickable) {
          e.stopPropagation();
          this._openEntity(sensor.entity_id);
        }
      };
      return this._renderAllergenSvg(
        this._getEffectiveSvgKey(svgKey, ringLevel),
        ringLevel,
        { clickable, onClick, stale: sensor.stale },
      );
    }

    const iconKey =
      mode === "icon_in_ring" ? this._getEffectiveSvgKey(svgKey, ringLevel) : "";

    return this._renderLevelCircle(
      ringLevel,
      {
        ...ringConfig,
        size: base,
        iconKey,
        iconColor: iconKey
          ? this._iconInRingColor(ringLevel, sensor.allergenReplaced, {
              stale: sensor.stale,
            })
          : "",
        iconSizeRatio: ringIconRatio,
      },
      sensor.allergenReplaced,
      0,
      displayLevel,
      sensor.entity_id,
      clickable,
    );
  }

  // ---------------------------------------------------------------------- //
  // Styles                                                                   //
  // ---------------------------------------------------------------------- //

  static get styles() {
    return css`
      :host {
        display: inline-flex;
        align-items: center;
      }

      /* The pill follows the native Home Assistant badge box so badges drop in
         alongside stock ones: fixed height + min-width = --ppb-size (the HA
         badge height, 36px at scale 1), horizontal padding 12px and inner gap
         8px at that size, radius = half the height (pill). Everything is
         proportional to --ppb-size so badge_scale grows the whole box, padding
         and gap included, exactly like resizing a native badge. */
      .ppb {
        --ppb-size: var(--ha-badge-size, 36px);
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: var(--ppb-size);
        min-width: var(--ppb-size);
        /* 12/36 ≈ 0.333 horizontal padding, matching native "0 12px". */
        padding: 0 calc(var(--ppb-size) * 0.333);
        /* 8/36 ≈ 0.222 inner gap, matching native --ha-space-2 (8px). */
        gap: calc(var(--ppb-size) * 0.222);
        border-radius: var(--ha-badge-border-radius, calc(var(--ppb-size) / 2));
        /* --ppb-bg is set inline only when the user configures
           background_color; otherwise fall back to the themed badge/card
           background so a default badge matches native ones. */
        background: var(
          --ppb-bg,
          var(--ha-card-background, var(--card-background-color, #fff))
        );
        border: var(--ha-card-border-width, 1px) solid
          var(--ha-card-border-color, var(--divider-color));
        box-shadow: var(--ha-card-box-shadow, none);
      }

      /* "below" stacks the label under the visual, so the pill can't keep the
         native fixed height — let it grow and add a little vertical padding. */
      .ppb--below {
        height: auto;
        padding: calc(var(--ppb-size) * 0.12) calc(var(--ppb-size) * 0.222);
      }

      /* Each item lays its visual and label out per badge_label_position:
         "right" (community convention, default) = icon left, label right;
         "below" = label stacked under the visual. */
      .ppb-item {
        display: flex;
        align-items: center;
        gap: calc(var(--ppb-size) * 0.18);
      }
      .ppb--right .ppb-item {
        flex-direction: row;
      }
      .ppb--below .ppb-item {
        flex-direction: column;
        gap: calc(var(--ppb-size) * 0.06);
      }
      /* Several items (row content mode) sit side by side with a clear gap. */
      .ppb--right .ppb-item + .ppb-item,
      .ppb--below .ppb-item + .ppb-item {
        margin-left: calc(var(--ppb-size) * 0.18);
      }

      .ppb-label {
        font-size: calc(var(--ppb-size) * 0.34);
        line-height: 1.1;
        color: var(--primary-text-color);
        white-space: nowrap;
      }

      .ppb-empty {
        width: calc(var(--ppb-size) * 0.78);
        height: calc(var(--ppb-size) * 0.78);
        border-radius: 50%;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
        opacity: 0.4;
      }

      /*
       * The following rules mirror the card's shadow-DOM CSS verbatim.
       * They must live here because _rebuildCharts() injects .ring-icon
       * and .level-value-text directly into this element's renderRoot.
       */

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

      .level-circle {
        line-height: 0;
      }

      .level-value-text {
        max-width: 100%;
        max-height: 100%;
        overflow: hidden;
        text-align: center;
        white-space: nowrap;
      }

      /*
       * Rules below are required by _renderAllergenSvg (inherited from
       * LevelCircleMixin) for the icon_only badge_visual mode.
       * Copied verbatim from the card's shadow-DOM CSS with one intentional
       * deviation: margin is 0 (not "0 auto 6px auto") because the badge
       * controls spacing via its .ppb-item flex gap, not bottom-margin.
       * Same deviation applies to .pp-icon-error.
       */

      .pp-icon {
        display: block;
        width: var(--pollen-icon-size, 48px);
        height: var(--pollen-icon-size, 48px);
        max-width: var(--pollen-icon-size, 48px);
        max-height: var(--pollen-icon-size, 48px);
        min-width: 0;
        min-height: 0;
        margin: 0;
        color: var(--pp-icon-color, var(--primary-text-color));
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
        background-color: rgba(136, 136, 136, 0.15);
        background-color: color-mix(
          in srgb,
          var(--primary-text-color, #888888) 15%,
          transparent
        );
      }

      .pp-icon-error {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--pollen-icon-size, 48px);
        height: var(--pollen-icon-size, 48px);
        max-width: var(--pollen-icon-size, 48px);
        max-height: var(--pollen-icon-size, 48px);
        min-width: 0;
        min-height: 0;
        margin: 0;
      }
    `;
  }
}

if (!customElements.get("pollenprognos-badge")) {
  customElements.define("pollenprognos-badge", PollenPrognosBadge);
}

export default PollenPrognosBadge;
