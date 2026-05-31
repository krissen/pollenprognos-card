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
import { LEVELS_DEFAULTS } from "./utils/levels-defaults.js";
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

    // Merge order: stub → badge-oriented defaults → user config, so user
    // always wins. icon_in_ring and badge_content are overridden to sensible
    // badge defaults, but the user can still override them.
    this.config = {
      ...stub,
      icon_in_ring: true,
      badge_content: "worst",
      badge_show_label: false,
      ...config,
      integration,
      // Re-apply coerced fields after spread so they override raw values.
      badge_content: badgeContent,
      badge_show_label: badgeShowLabel,
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

  render() {
    // Not yet loaded: render an empty pill placeholder so the badge slot
    // doesn't jump when data arrives.
    if (!this._isLoaded) {
      return html`<div class="ppb"><div class="ppb-empty"></div></div>`;
    }

    // Error or no sensors: render a tiny empty pill; do NOT render a big
    // error card — the badge slot is not the right place for verbose errors.
    const picks = selectBadgeSensor(this.sensors, this.config);
    if (!picks.length) {
      return html`<div class="ppb"><div class="ppb-empty"></div></div>`;
    }

    const ringConfig = this._buildLevelRingConfig();
    const iconSize = Number(this.config?.icon_size) || 36;
    const ringIconRatio =
      Number(this.config?.icon_in_ring_size_ratio) ||
      LEVELS_DEFAULTS.icon_in_ring_size_ratio;

    return html`
      <div class="ppb">
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

          const visual = this._renderLevelCircle(
            ringLevel,
            {
              ...ringConfig,
              size: iconSize,
              iconKey: this._getEffectiveSvgKey(svgKey, ringLevel),
              iconColor: this._iconInRingColor(
                ringLevel,
                sensor.allergenReplaced,
                { stale: sensor.stale },
              ),
              iconSizeRatio: ringIconRatio,
            },
            sensor.allergenReplaced,
            0,
            displayLevel,
            sensor.entity_id,
            this.config.link_to_sensors !== false && !!sensor.entity_id,
          );

          const showLabel = this.config.badge_show_label === true;

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

  // ---------------------------------------------------------------------- //
  // Styles                                                                   //
  // ---------------------------------------------------------------------- //

  static get styles() {
    return css`
      :host {
        display: inline-flex;
        align-items: center;
      }

      .ppb {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: var(--ha-badge-border-radius, 18px);
        background: var(
          --ha-card-background,
          var(--card-background-color, #fff)
        );
        border: var(--ha-card-border-width, 1px) solid
          var(--ha-card-border-color, var(--divider-color));
        box-shadow: var(--ha-card-box-shadow, none);
      }

      .ppb-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }

      .ppb-label {
        font-size: var(--ha-badge-font-size, var(--ha-font-size-s, 12px));
        color: var(--primary-text-color);
        white-space: nowrap;
      }

      .ppb-empty {
        width: 24px;
        height: 24px;
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
    `;
  }
}

if (!customElements.get("pollenprognos-badge")) {
  customElements.define("pollenprognos-badge", PollenPrognosBadge);
}

export default PollenPrognosBadge;
