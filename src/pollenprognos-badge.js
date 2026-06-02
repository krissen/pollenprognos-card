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
  pinBadgeSingleAllergen,
  selectBadgeSensor,
  coerceBool,
  scaleRingLevel,
  resolveNumericValue,
  badgeRingLevel,
} from "./utils/adapter-helpers.js";
import {
  LEVELS_DEFAULTS,
  NORMAL_DEFAULT_THICKNESS,
  ICON_IN_RING_DEFAULT_THICKNESS,
} from "./utils/levels-defaults.js";
import { LevelCircleMixin, resolveTapActionType } from "./rendering/level-circle-mixin.js";
import { ringIconStyles } from "./rendering/ring-icon-styles.js";
import { deepEqual } from "./utils/confcompare.js";
import {
  detectIntegrationStates,
  pickIntegration,
  autoSelectLocation,
  normalizeIntegration,
} from "./utils/autodetect.js";
import silamAllergenMap from "./adapters/silam_allergen_map.json" assert { type: "json" };

class PollenPrognosBadge extends LevelCircleMixin(LitElement) {
  // ---------------------------------------------------------------------- //
  // Instance fields                                                          //
  // ---------------------------------------------------------------------- //

  _hass = null;
  _userConfig = null;
  sensors = [];
  _versionLogged = false;
  _noPollen = false;

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
      _noPollen: { state: true },
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
   *
   * When HA provides hass and an integration is detected, pin it so a freshly
   * added badge shows real data. When hass is absent (the documented no-arg
   * badge stub call) OR nothing is detected, OMIT `integration`: both the badge
   * element and editor treat a present `integration` as a user pin via
   * hasOwnProperty, so emitting a "pp" fallback here would wrongly suppress
   * autodetect on a DWD/PEU-only install. Without it, autodetect runs once hass
   * is available.
   */
  static getStubConfig(hass, _entities, _entitiesFallback) {
    const base = { badge_content: "worst", icon_in_ring: true };
    if (hass) {
      const integration = pickIntegration(detectIntegrationStates(hass), {
        explicit: false,
      });
      if (integration) return { integration, ...base };
    }
    return base;
  }

  // ---------------------------------------------------------------------- //
  // setConfig                                                                //
  // ---------------------------------------------------------------------- //

  setConfig(config) {
    this._userConfig = { ...config };
    // Whether the user pinned an integration. When they didn't, set hass()
    // re-resolves integration + location from hass so a no-config badge shows
    // real data (mirrors the card element).
    this._integrationExplicit = Object.prototype.hasOwnProperty.call(
      config,
      "integration",
    );
    this.config = this._buildConfig(config, this._hass);

    if (!this._versionLogged && this.config.show_version !== false) {
      console.info(
        `%c🤧 Pollenprognos Badge: version ${__VERSION__}`,
        "background:#f0e68c;color:#000;padding:2px 4px;border-radius:2px;",
      );
      this._versionLogged = true;
    }

    // Trigger a data fetch if hass is already available.
    if (this._hass) {
      this._fetchSensors(this._hass);
    }
  }

  /**
   * Build the badge's effective config from a raw user config and (optionally)
   * hass. When the integration is not explicit and hass is available, the
   * integration and its first location are autodetected (shared with the card
   * via src/utils/autodetect.js). Stub defaults fill in the rest; badge_visual
   * drives the engine flags. Pure aside from reading hass.
   *
   * @param {object} config  raw user config
   * @param {object|null} hass
   * @returns {object}
   */
  _buildConfig(config, hass) {
    const explicit = Object.prototype.hasOwnProperty.call(config, "integration");
    let integration = normalizeIntegration(config.integration);

    // Autodetect integration when the user didn't pin one.
    let detection = null;
    if (!explicit && hass) {
      detection = detectIntegrationStates(hass);
      integration = pickIntegration(detection, { explicit: false }) || integration;
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
    // Clamp to a sane ceiling so a typo (e.g. 100 typed into the editor field)
    // can't render an editor-breaking giant pill (#235).
    const BADGE_SCALE_MAX = 10;
    const badgeScaleRaw = Number(config.badge_scale);
    const badgeScale =
      Number.isFinite(badgeScaleRaw) && badgeScaleRaw > 0
        ? Math.min(badgeScaleRaw, BADGE_SCALE_MAX)
        : 1;
    // Icon scale: scales the allergen visual as a whole (the ring in the ring
    // modes, the bare icon in icon_only) while the pill keeps badge_scale.
    // Default 1 = no change. Lets users shrink the image without shrinking the
    // badge (#235). Same clamp guards a typo.
    const badgeIconScaleRaw = Number(config.badge_icon_scale);
    const badgeIconScale =
      Number.isFinite(badgeIconScaleRaw) && badgeIconScaleRaw > 0
        ? Math.min(badgeIconScaleRaw, BADGE_SCALE_MAX)
        : 1;
    // Label position: right (community convention, default) | below.
    const badgeLabelPosition =
      config.badge_label_position === "below" ? "below" : "right";
    // tap_action: optional element-level action (more-info | navigate |
    // call-service), shared with the card. Keep only a plain object so a
    // mis-typed YAML scalar can't reach the runtime handler. link_to_sensors
    // passes through ...config unchanged (boolean, read default-on at runtime).
    const tapAction =
      config.tap_action &&
      typeof config.tap_action === "object" &&
      !Array.isArray(config.tap_action)
        ? config.tap_action
        : undefined;

    // badge_visual drives two engine flags so the shared LevelCircleMixin
    // renders the right centre content: icon_in_ring shows the allergen icon;
    // ring_value shows the numeric overlay; ring_empty/icon_only show neither
    // (icon_only renders a bare icon outside the ring path entirely).
    const iconInRing = badgeVisual === "icon_in_ring";
    const showValueInCircle = badgeVisual === "ring_value";

    // Badges are tiny, so whenever the ring holds something in its centre — an
    // icon (icon_in_ring) OR a number (ring_value) — thin the ring so the
    // centre content stays legible, matching the card's icon-in-ring treatment.
    // The badge editor persists ONLY user-set keys, so a present levels_thickness
    // is a deliberate choice and is honoured; the auto-thin default applies only
    // when the key is absent. Same rule for the numeric text size in ring_value.
    const ringHasCentre = iconInRing || showValueInCircle;
    const effectiveThickness =
      config.levels_thickness != null
        ? config.levels_thickness
        : ringHasCentre
          ? ICON_IN_RING_DEFAULT_THICKNESS
          : NORMAL_DEFAULT_THICKNESS;

    const effectiveTextSize =
      config.levels_text_size != null
        ? config.levels_text_size
        : showValueInCircle
          ? 0.3
          : LEVELS_DEFAULTS.levels_text_size;

    // Merge order: stub → badge-oriented defaults → user config, so user
    // always wins for plain keys. The badge-derived engine flags are applied
    // AFTER the spread so badge_visual stays the single source of truth.
    const built = {
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
      badge_icon_scale: badgeIconScale,
      badge_label_position: badgeLabelPosition,
      icon_in_ring: iconInRing,
      show_value_numeric_in_circle: showValueInCircle,
      levels_thickness: effectiveThickness,
      levels_text_size: effectiveTextSize,
      // Type-guarded above; override the raw spread so a bad scalar becomes
      // undefined and the runtime click guard simply skips it.
      tap_action: tapAction,
      ...(badgeSingleAllergen !== undefined
        ? { badge_single_allergen: badgeSingleAllergen }
        : {}),
      // A badge shows today's value only and has no forecast-event
      // subscription, so non-daily SILAM/PEU modes would fetch an empty
      // forecast and render an empty pill. Force daily regardless of any
      // mode the user may have hand-written in YAML.
      mode: "daily",
    };

    // Auto-select the first location for the detected integration when the
    // user didn't set one (and isn't in manual mode). Reuses the detection
    // computed above; the guard keeps an explicit "manual" / user value.
    if (!explicit && hass && detection) {
      const sel = autoSelectLocation(integration, built, hass, detection);
      if (sel && built[sel.key] !== "manual" && !built[sel.key]) {
        built[sel.key] = sel.value;
      }
    }

    return pinBadgeSingleAllergen(built);
  }

  // ---------------------------------------------------------------------- //
  // hass setter                                                              //
  // ---------------------------------------------------------------------- //

  set hass(hass) {
    if (this._hass === hass) return;
    this._hass = hass;
    // When the integration is not explicit, re-resolve integration + location
    // from the new hass so a no-config badge (picker default) renders real
    // data. Only reassign when something changed to avoid render churn.
    if (this._userConfig && !this._integrationExplicit) {
      const next = this._buildConfig(this._userConfig, hass);
      if (!deepEqual(this.config, next)) this.config = next;
    }
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
        // Distinguish "no pollen" (entities exist but everything is below the
        // threshold, so the filtered set is empty) from "no sensors at all".
        // The former mirrors the card's no_allergens breezy state; only the
        // latter is a real error. availableSensors comes from findAvailableSensors
        // above (already in scope in this block).
        this._noPollen = filtered.length === 0 && availableSensors.length > 0;
        this._error =
          filtered.length === 0 && availableSensors.length === 0
            ? "card.error_no_sensors"
            : null;
      })
      .catch((err) => {
        console.error("[Badge] fetch error:", err);
        this._isLoaded = true;
        // Clear any "no pollen" state from a previous successful fetch so a
        // later error does not keep rendering the breezy no_allergens image.
        this._noPollen = false;
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
    // --ppb-size drives the proportional pill CSS (padding/gap/radius/label).
    // badge_icon_scale scales the allergen VISUAL as a whole — the ring (with
    // whatever it centres: icon or value) in the ring modes, and the bare icon
    // in icon_only — but NOT the label text or the pill box (#235). So it sizes
    // both the ring `base` passed to _renderBadgeVisual below and the bare
    // icon's --pollen-icon-size. badge_scale still governs the overall badge.
    const iconScale = Number(this.config?.badge_icon_scale) || 1;
    // Cap the scaled visual at the pill height so scaling UP can grow the image
    // to fill the badge but never overflow it (the ring base is already
    // 0.78*height, so scales above ~1.28 would otherwise spill out of the pill).
    // Scaling DOWN is unbounded within the slider range.
    const visualSize = Math.min(Math.round(ring * iconScale), height);
    // A configured background_color sets --ppb-bg (consumed by the .ppb rule,
    // which otherwise falls back to the themed background). Same ?.trim?.()
    // guard the card uses, so non-string YAML values can't throw.
    const bg = this.config?.background_color?.trim?.();
    const hostStyle =
      `--ppb-size: ${height}px; --pollen-icon-size: ${visualSize}px;` +
      (bg ? ` --ppb-bg: ${bg};` : "");

    // Not yet loaded: render an empty pill placeholder so the badge slot
    // doesn't jump when data arrives. It carries the same size base.
    if (!this._isLoaded) {
      return html`<div class="ppb ppb--right" style="${hostStyle}"><div class="ppb-empty"></div></div>`;
    }

    // Error or no sensors: render a tiny empty pill; do NOT render a big
    // error card — the badge slot is not the right place for verbose errors.
    const picks = selectBadgeSensor(this.sensors, this.config);
    if (!picks.length) {
      // No pollen (entities exist, nothing above threshold): mirror the card's
      // breezy no_allergens image instead of a blank pill, for the aggregate/
      // selection modes. Reuse _renderAllergenSvg("no_allergens", 0) so the
      // level-0 colour is applied identically to the card. single mode pins one
      // named allergen and must not collapse to breezy (a missing named entity
      // stays a blank pill); aggregate keeps its own summary ring elsewhere.
      const contentMode = this.config?.badge_content || "worst";
      if (
        this._noPollen &&
        (contentMode === "worst" || contentMode === "row")
      ) {
        return html`<div class="ppb ppb--right" style="${hostStyle}">
          <div class="ppb-item">
            ${this._renderAllergenSvg("no_allergens", 0, {})}
          </div>
        </div>`;
      }
      return html`<div class="ppb ppb--right" style="${hostStyle}"><div class="ppb-empty"></div></div>`;
    }

    const ringConfig = this._buildLevelRingConfig();
    const ringIconRatio =
      Number(this.config?.icon_in_ring_size_ratio) ||
      LEVELS_DEFAULTS.icon_in_ring_size_ratio;

    const visualMode = this.config?.badge_visual || "icon_in_ring";
    const labelBelow = this.config?.badge_label_position === "below";
    const showLabel = this.config.badge_show_label === true;

    // Badge-level tap_action (shared with the card). Bind only when the action
    // resolves to a supported type (so an inert/unknown action doesn't make the
    // badge clickable-but-dead); per-icon link_to_sensors clicks stopPropagation,
    // so the two coexist without double-firing, exactly like the card. Handler
    // and predicate live in LevelCircleMixin.
    const hasTap = resolveTapActionType(this.config?.tap_action) !== null;

    return html`
      <div
        class="ppb ${labelBelow ? "ppb--below" : "ppb--right"}"
        style="${hostStyle}${hasTap ? " cursor: pointer;" : ""}"
        @click=${hasTap ? this._handleTapAction : null}
      >
        ${picks.map((sensor) => {
          // Preserve a no-data sensor (missing / NaN / negative day0) as a
          // negative level so the ring + icon render the no-data noise pattern
          // instead of collapsing to a green level-0 ring. This matters for a
          // single pinned allergen whose entity is unavailable (e.g. DWD/PEU
          // emit no day0 for no data), which would otherwise look like level 0.
          const normalizedLevel = badgeRingLevel(sensor.day0);
          const ringLevel = scaleRingLevel(
            this.config.integration,
            normalizedLevel,
          );
          const svgKey = this._getSvgKey(sensor.allergenReplaced);
          const rawNum = resolveNumericValue(sensor.day0, this.config) ?? ringLevel;
          const displayLevel = rawNum != null && rawNum >= 0 ? rawNum : ringLevel;
          const clickable =
            this.config.link_to_sensors !== false && !!sensor.entity_id;

          const visual = this._renderBadgeVisual(
            visualMode,
            sensor,
            { ringConfig, base: visualSize, ringIconRatio, ringLevel, svgKey, displayLevel, clickable },
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
      ${ringIconStyles}
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
       * .ring-icon, .ring-icon svg, .level-value-text and the no-data icon
       * rules live in the shared ringIconStyles fragment (spliced above), so
       * they stay byte-identical to the card. _rebuildCharts injects
       * .ring-icon / .level-value-text into this element's renderRoot, which
       * the fragment covers. The rules below are badge-specific and
       * intentionally differ from the card.
       */

      /* Badge ring wrapper: no card-style sizing/margin (the badge sizes the
         ring inline via badge_scale and spaces items with .ppb-item flex gap). */
      .level-circle {
        line-height: 0;
      }

      /*
       * .pp-icon / .pp-icon-error are required by _renderAllergenSvg (inherited
       * from LevelCircleMixin) for the icon_only badge_visual mode. They differ
       * from the card by one intentional deviation: margin is 0 (not
       * "0 auto 6px auto") because the badge controls spacing via its .ppb-item
       * flex gap. The shared .pp-icon svg / svg g / no-data rules come from the
       * ringIconStyles fragment.
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
