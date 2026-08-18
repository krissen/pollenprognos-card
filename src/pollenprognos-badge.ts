// src/pollenprognos-badge.ts
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
import type { TemplateResult } from "lit";
import type { PrimitiveType } from "intl-messageformat";
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
  hasValidPollenData,
} from "./utils/adapter-helpers.js";
import {
  LEVELS_DEFAULTS,
  NORMAL_DEFAULT_THICKNESS,
  ICON_IN_RING_DEFAULT_THICKNESS,
} from "./utils/levels-defaults.js";
import {
  LevelCircleMixin,
  resolveTapActionType,
  iconMoreInfoEnabled,
} from "./rendering/level-circle-mixin.js";
import { ringIconStyles } from "./rendering/ring-icon-styles.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { googleMapsPinSvg } from "./pollenprognos-svgs.js";
import { GOOGLE_MAPS_TEXT, GOOGLE_POLLEN_SOURCE_TEXT } from "./constants.js";
import {
  buildBadgeLabel,
  coerceBadgeLabelContent,
} from "./utils/badge-label.js";
import type { BadgeLabelContent } from "./utils/badge-label.js";
import { deepEqual } from "./utils/confcompare.js";
import {
  detectIntegrationStates,
  pickIntegration,
  autoSelectLocation,
  normalizeIntegration,
} from "./utils/autodetect.js";
import silamAllergenMap from "./adapters/silam_allergen_map.json";
import type { HomeAssistant } from "./types/home-assistant.js";
import type { CardConfig, RawCardConfig } from "./types/config.js";
import type { PollenSensor } from "./types/sensor.js";

class PollenPrognosBadge extends LevelCircleMixin(LitElement) {
  // ---------------------------------------------------------------------- //
  // Instance fields                                                          //
  // ---------------------------------------------------------------------- //

  // _hass is declared as HomeAssistant | undefined by the mixin; the badge
  // initializes it to null at runtime (the mixin only reads it via truthiness /
  // reference-equality, so null and undefined behave identically here). Cast via
  // unknown so the field keeps the mixin's declared type while preserving the
  // null runtime seed.
  override _hass = null as unknown as HomeAssistant | undefined;
  // Narrow the mixin's optional `config` to non-optional here: the badge always
  // has a config in its render / fetch paths, matching the original JS which
  // read `this.config.x` directly. `declare` keeps Lit's reactive accessor.
  declare config: CardConfig;
  _userConfig: RawCardConfig | null = null;
  // sensors/_noPollen/_noData are reactive AND field-initialised on purpose:
  // the class-field initializer shadows Lit's accessor (useDefineForClassFields
  // is off), so assigning them does not schedule an update by itself. The fetch
  // path calls requestUpdate() explicitly to repaint (see _fetchSensors). Kept
  // as initialised fields to preserve that documented behaviour.
  sensors: PollenSensor[] = [];
  _versionLogged = false;
  _noPollen = false;
  _noData = false;
  _integrationExplicit = false;
  // Reactive props that keep Lit's accessor (no field initializer): declare so
  // TS types them without emitting a runtime field that would clobber it.
  declare _isLoaded?: boolean;
  declare _error?: string | null;
  // Monotonic fetch token; starts undefined and is read via `|| 0`.
  declare _fetchSeq?: number;

  // ---------------------------------------------------------------------- //
  // Lit reactive properties                                                  //
  // ---------------------------------------------------------------------- //

  static override get properties() {
    return {
      hass: { state: true },
      config: {},
      sensors: { state: true },
      _error: { type: String, state: true },
      _isLoaded: { type: Boolean, state: true },
      _noPollen: { state: true },
      _noData: { state: true },
    };
  }

  // ---------------------------------------------------------------------- //
  // Helpers                                                                  //
  // ---------------------------------------------------------------------- //

  // The mixin declares `debug` as a (declare) property so it can read it; the
  // concrete badge implements it as a computed getter. TS flags the
  // property→accessor shape mismatch (TS2611), which is inherent to this split
  // and cannot be resolved without changing the mixin. Suppress the single
  // shape error; the runtime contract (mixin reads this.debug) is unchanged.
  // @ts-expect-error property-in-base vs accessor-in-derived (see above)
  override get debug(): boolean {
    return Boolean(this.config && this.config.debug);
  }

  get _lang(): string {
    return detectLang(
      this._hass,
      this.config?.date_locale as string | undefined,
    );
  }

  _t(key: string, vars: Record<string, PrimitiveType> = {}): string {
    return t(key, this._lang, vars);
  }

  // _noDataDotColor() is inherited from LevelCircleMixin; no override needed.

  // ---------------------------------------------------------------------- //
  // HA card protocol                                                         //
  // ---------------------------------------------------------------------- //

  static async getConfigElement(): Promise<HTMLElement> {
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
  static getStubConfig(
    hass?: HomeAssistant,
    _entities?: unknown,
    _entitiesFallback?: unknown,
  ): RawCardConfig {
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

  setConfig(config: RawCardConfig): void {
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
  _buildConfig(
    config: RawCardConfig,
    hass: HomeAssistant | null | undefined,
  ): CardConfig {
    const explicit = Object.prototype.hasOwnProperty.call(
      config,
      "integration",
    );
    let integration = normalizeIntegration(config.integration) as
      string | undefined;

    // Autodetect integration when the user didn't pin one.
    let detection = null;
    if (!explicit && hass) {
      detection = detectIntegrationStates(hass);
      integration =
        pickIntegration(detection, { explicit: false }) || integration;
    }

    const stub = (getStubConfig(integration) || getStubConfig("pp"))!;
    if (!integration) integration = stub.integration as string;

    // Defensive typeguards (repo policy): coerce YAML-sourced fields that the
    // badge adds so mis-typed values can't cause silent misbehaviour.
    const badgeContent =
      typeof config.badge_content === "string" ? config.badge_content : "worst";
    const badgeSingleAllergen =
      typeof config.badge_single_allergen === "string"
        ? config.badge_single_allergen
        : undefined;
    const badgeShowLabel = coerceBool(config.badge_show_label);
    // Visual mode: icon_in_ring (default) | ring_value | ring_empty | icon_only.
    const VISUALS = ["icon_in_ring", "ring_value", "ring_empty", "icon_only"];
    const badgeVisual = VISUALS.includes(config.badge_visual as string)
      ? (config.badge_visual as string)
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
    // Label content: allergen name (default, the original behaviour) | today's
    // translated level text | both. Allow-list coercion lives in the helper.
    const badgeLabelContent = coerceBadgeLabelContent(
      config.badge_label_content,
    );
    // tap_action: optional element-level action (more-info | navigate |
    // call-service), shared with the card. Keep only a plain object so a
    // mis-typed YAML scalar can't reach the runtime handler.
    const tapAction =
      config.tap_action &&
      typeof config.tap_action === "object" &&
      !Array.isArray(config.tap_action)
        ? config.tap_action
        : undefined;
    // link_to_sensors has no stub default: absent means "default on", explicit
    // true is a distinct opt-in that keeps per-icon more-info alongside a
    // tap_action (see iconMoreInfoEnabled / #279). Coerce only the "true"/"false"
    // YAML strings (mirroring the card's config boundary) so a hand-written
    // link_to_sensors: "false" is honoured; an absent key stays undefined and
    // reads default-on at runtime.
    const linkToSensors =
      config.link_to_sensors === "true"
        ? true
        : config.link_to_sensors === "false"
          ? false
          : config.link_to_sensors;

    // show_google_attribution is default-on and the render gate reads it as
    // `!== false`, so a raw YAML string would slip through the gate and show
    // the pin no matter what the user wrote (#338). Coerce it to a real boolean
    // whenever the key is present; an absent key leaves the stub default alone.
    // Only an explicit false / "false" turns it off: anything unrecognised
    // fails OPEN and keeps the attribution, which is the safe direction for a
    // toggle that exists to satisfy Google's attribution policy.
    const hasAttributionKey = Object.prototype.hasOwnProperty.call(
      config,
      "show_google_attribution",
    );
    const showGoogleAttribution = !(
      config.show_google_attribution === false ||
      config.show_google_attribution === "false"
    );

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
    const built: Record<string, unknown> = {
      ...stub,
      // badge_content / badge_show_label previously also appeared as literal
      // defaults before `...config`; those were dead (last-wins identical) since
      // the coerced badgeContent / badgeShowLabel below always override them, and
      // duplicate literal keys are a TS error. Dropped the pre-spread copies.
      ...config,
      integration,
      // Re-apply coerced fields after spread so they override raw values.
      badge_content: badgeContent,
      badge_show_label: badgeShowLabel,
      badge_visual: badgeVisual,
      badge_scale: badgeScale,
      badge_icon_scale: badgeIconScale,
      badge_label_position: badgeLabelPosition,
      badge_label_content: badgeLabelContent,
      icon_in_ring: iconInRing,
      show_value_numeric_in_circle: showValueInCircle,
      levels_thickness: effectiveThickness,
      levels_text_size: effectiveTextSize,
      // Type-guarded above; override the raw spread so a bad scalar becomes
      // undefined and the runtime click guard simply skips it.
      tap_action: tapAction,
      // Coerced above; overrides the raw spread so a "false" string is a real
      // boolean at the iconMoreInfoEnabled call site.
      link_to_sensors: linkToSensors,
      ...(badgeSingleAllergen !== undefined
        ? { badge_single_allergen: badgeSingleAllergen }
        : {}),
      // Coerced above; overrides the raw spread so the render gate compares a
      // real boolean. Written only when the user set the key, so the stub
      // default keeps speaking for everyone else.
      ...(hasAttributionKey
        ? { show_google_attribution: showGoogleAttribution }
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
      const sel = autoSelectLocation(
        integration as string,
        built,
        hass,
        detection,
      );
      if (sel && built[sel.key] !== "manual" && !built[sel.key]) {
        built[sel.key] = sel.value;
      }
    }

    return pinBadgeSingleAllergen(
      built as CardConfig,
      stub.allergens as string[],
    );
  }

  // ---------------------------------------------------------------------- //
  // hass setter                                                              //
  // ---------------------------------------------------------------------- //

  set hass(hass: HomeAssistant | undefined) {
    if (this._hass === hass) return;
    this._hass = hass;
    // When the integration is not explicit, re-resolve integration + location
    // from the new hass so a no-config badge (picker default) renders real
    // data. Only reassign when something changed to avoid render churn.
    if (this._userConfig && !this._integrationExplicit) {
      const next = this._buildConfig(this._userConfig, hass);
      if (!deepEqual(this.config, next)) this.config = next;
    }
    // HA always sets a defined hass on the element; the setter's param stays
    // optional to match the editor's contract. Cast for the fetch call, which
    // dereferences hass (unchanged from the original unguarded JS call).
    this._fetchSensors(hass as HomeAssistant);
  }

  get hass(): HomeAssistant | undefined {
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
  _fetchSensors(hass: HomeAssistant): void {
    const cfg = this.config;
    if (!cfg) return;

    const adapter = (getAdapter(cfg.integration) || getAdapter("pp"))!;

    // Monotonic token: the editor preview reuses one badge element and refetches
    // on every config + hass change, so several fetches can be in flight. Each
    // fetch is async (and emptyWithEntities triggers a second await), so an
    // OLDER fetch can resolve after a NEWER one. Without this guard the stale
    // result overwrites this.sensors with the previous allergen's data, and the
    // render then finds nothing for the new allergen and goes blank until a save
    // (the bug behind "changing the allergen blanks the preview"). Only the
    // latest fetch is allowed to apply its result.
    const fetchId = (this._fetchSeq = (this._fetchSeq || 0) + 1);

    adapter
      .fetchForecast(hass, cfg)
      .then(async (sensors) => {
        const availableSensors = findAvailableSensors(cfg, hass, this.debug);

        // For silam daily, pass the full state-key list + allergen map so
        // filterSensorsPostFetch can do the same discovery the card does.
        const isSilamDaily =
          cfg.integration === "silam" && (!cfg.mode || cfg.mode === "daily");

        const filtered = filterSensorsPostFetch(
          sensors,
          cfg,
          availableSensors,
          isSilamDaily ? Object.keys(hass.states) : [],
          isSilamDaily ? silamAllergenMap.mapping : {},
        );

        // Classify an empty result. With entities available, an empty fetch has
        // two causes: genuine no-pollen (data exists, all below threshold) or no
        // usable data (entities exist but no valid forecast). A threshold-0
        // confirmation tells them apart so render shows the breezy no_allergens
        // image only for the former and the no-info (noise) visual for the
        // latter, never a false no-pollen image for a data problem.
        const emptyWithEntities =
          filtered.length === 0 && availableSensors.length > 0;
        const hasData = emptyWithEntities
          ? await hasValidPollenData(adapter, hass, cfg)
          : false;

        // Drop a superseded (out-of-order) fetch: a newer config/hass change
        // already started a later fetch, so applying this one would clobber the
        // current allergen with stale data.
        if (fetchId !== this._fetchSeq) return;

        this.sensors = filtered;
        this._isLoaded = true;
        this._noPollen = emptyWithEntities && hasData;
        this._noData = emptyWithEntities && !hasData;
        this._error =
          filtered.length === 0 && availableSensors.length === 0
            ? "card.error_no_sensors"
            : null;
        // Force a re-render: sensors / _noPollen / _noData are reactive
        // properties that are also class-field-initialised, which shadows Lit's
        // accessor (useDefineForClassFields), so assigning them does not by
        // itself schedule an update. Without this, only the FIRST fetch repaints
        // (via _isLoaded flipping); later fetches change only sensors and the
        // view keeps showing the previous allergen -- the bug behind the editor
        // preview going blank when the allergen is changed.
        this.requestUpdate();
      })
      .catch((err) => {
        if (fetchId !== this._fetchSeq) return;
        console.error("[Badge] fetch error:", err);
        this._isLoaded = true;
        // Clear the previous fetch's data and no-pollen/no-data state so an
        // error renders the empty pill instead of stale rings: render() only
        // consults selectBadgeSensor(this.sensors), never _error, so leaving the
        // old sensors in place would keep showing outdated readings as current.
        this.sensors = [];
        this._noPollen = false;
        this._noData = false;
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
  _badgeBaseSize(): number {
    // Native HA badge height; kept local to avoid module-scope minification
    // quirks. badge_scale multiplies it.
    const HA_BADGE_SIZE = 36;
    const scale = Number(this.config?.badge_scale) || 1;
    return Math.round(HA_BADGE_SIZE * scale);
  }

  /**
   * Google attribution logo for the badge (issue #338). The Google Pollen API
   * attribution policy wants the wordmark AND the source line always visible;
   * a badge pill has room for neither at a legible size, so by owner decision
   * the badge shows the square Google Maps pin and carries the full string as
   * a hover title. Both the pin and the tooltip are deliberate deviations from
   * the policy and apply to the badge format only — the card footer and the
   * editor still render the wordmark and the source line verbatim.
   *
   * Returns an empty string for every non-Google integration so their badge
   * markup is byte-identical to before.
   */
  _renderGoogleAttribution(): TemplateResult | "" {
    const integration = this.config?.integration;
    if (
      (integration !== "gpl" && integration !== "gp") ||
      this.config?.show_google_attribution === false
    ) {
      return "";
    }
    const title = `${GOOGLE_MAPS_TEXT} — ${GOOGLE_POLLEN_SOURCE_TEXT}`;
    return html`<div class="ppb-attribution" title="${title}">
      ${unsafeSVG(googleMapsPinSvg)}
    </div>`;
  }

  override render(): TemplateResult {
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
    const bg = (this.config?.background_color as string | undefined)?.trim?.();
    const hostStyle =
      `--ppb-size: ${height}px; --pollen-icon-size: ${visualSize}px;` +
      (bg ? ` --ppb-bg: ${bg};` : "");

    // Pill layout class, shared by every render path (placeholder, no-data,
    // no-pollen, empty, and the normal data render) so the pill keeps the same
    // height/padding across states instead of jumping between ppb--right and
    // ppb--below when data appears or disappears.
    const wrapClass =
      this.config?.badge_label_position === "below"
        ? "ppb--below"
        : "ppb--right";

    // Google-backed integrations only: the pin overlay plus the class that
    // makes the pill its positioning context. Both stay empty otherwise, so the
    // rendered markup for every other integration is unchanged.
    const attribution = this._renderGoogleAttribution();
    const attributionClass = attribution === "" ? "" : " ppb--attribution";

    // Not yet loaded: render an empty pill placeholder so the badge slot
    // doesn't jump when data arrives. It carries the same size base.
    if (!this._isLoaded) {
      return html`<div class="ppb ${wrapClass}" style="${hostStyle}">
        <div class="ppb-empty"></div>
      </div>`;
    }

    // Error or no sensors: render a tiny empty pill; do NOT render a big
    // error card — the badge slot is not the right place for verbose errors.
    const picks = selectBadgeSensor(this.sensors, this.config);
    if (!picks.length) {
      // Entities exist but none have usable forecast data: show the no-info
      // visual (the no_allergens silhouette filled with the no-data noise
      // pattern via level -1), not a blank pill or a false no-pollen image. The
      // badge stays text-free; the card adds the "(No information)" label.
      if (this._noData) {
        return html`<div class="ppb ${wrapClass}" style="${hostStyle}">
          <div class="ppb-item">
            ${this._renderAllergenSvg("no_allergens", -1, {})}
          </div>
        </div>`;
      }
      // No pollen (entities exist, nothing above threshold): mirror the card's
      // breezy no_allergens image instead of a blank pill. Reuse
      // _renderAllergenSvg("no_allergens", 0) so the level-0 colour matches the
      // card. This applies to every mode, keyed only on _noPollen: a single
      // badge WITH a named allergen never reaches here with _noPollen set,
      // because the pin forces pollen_threshold 0 so its sensor is kept (it
      // renders its own ring / no-data visual). A single badge with NO named
      // allergen is effectively "worst" and must show breezy here too, not a
      // blank pill. aggregate with a surviving summary is non-empty and rendered
      // below; with no summary it falls back to worst, so breezy is right.
      // "No pollen" is a conclusion drawn from Google's readings, so the pin
      // stays with it (mirrors the card, which keeps its attribution footer on
      // the no-allergens result).
      if (this._noPollen) {
        return html`<div
          class="ppb ${wrapClass}${attributionClass}"
          style="${hostStyle}"
        >
          <div class="ppb-item">
            ${this._renderAllergenSvg("no_allergens", 0, {})}
          </div>
          ${attribution}
        </div>`;
      }
      return html`<div class="ppb ${wrapClass}" style="${hostStyle}">
        <div class="ppb-empty"></div>
      </div>`;
    }

    const ringConfig = this._buildLevelRingConfig();
    const ringIconRatio =
      Number(this.config?.icon_in_ring_size_ratio) ||
      LEVELS_DEFAULTS.icon_in_ring_size_ratio;

    const visualMode = (this.config?.badge_visual as string) || "icon_in_ring";
    const showLabel = this.config.badge_show_label === true;
    // setConfig allow-listed this already, and buildBadgeLabel treats anything
    // unrecognised as "allergen", so the raw value is safe to pass through.
    const labelContent = this.config.badge_label_content as BadgeLabelContent;

    // Badge-level tap_action (shared with the card). Bind only when the action
    // resolves to a supported type (so an inert/unknown action doesn't make the
    // badge clickable-but-dead). A configured tap_action takes precedence over
    // per-icon more-info: iconMoreInfoEnabled suppresses the ring/icon click
    // (which would otherwise stopPropagation and shadow the tap_action) unless
    // link_to_sensors is explicitly true (#279). Handler and predicate live in
    // LevelCircleMixin.
    const hasTap = resolveTapActionType(this.config?.tap_action) !== null;

    return html`
      <div
        class="ppb ${wrapClass}${attributionClass}"
        style="${hostStyle}${hasTap ? " cursor: pointer;" : ""}"
        @click=${hasTap ? this._handleTapAction : null}
      >
        ${picks.map((sensor) => {
          // Preserve a no-data sensor (missing / NaN / negative days[0]) as a
          // negative level so the ring + icon render the no-data noise pattern
          // instead of collapsing to a green level-0 ring. This matters for a
          // single pinned allergen whose entity is unavailable (e.g. DWD/PEU
          // emit no days[0] for no data), which would otherwise look like level 0.
          const normalizedLevel = badgeRingLevel(sensor.days?.[0]);
          const ringLevel = scaleRingLevel(
            this.config.integration,
            normalizedLevel,
          );
          const svgKey = this._getSvgKey(sensor.allergenReplaced);
          const rawNum =
            resolveNumericValue(sensor.days?.[0], this.config) ?? ringLevel;
          // rawNum may be a numeric string (display_state); the `>= 0` guard
          // relies on JS string→number coercion, so cast for the comparison
          // without changing the runtime value carried into displayLevel.
          const displayLevel =
            rawNum != null && (rawNum as number) >= 0 ? rawNum : ringLevel;
          const clickable =
            iconMoreInfoEnabled(this.config.link_to_sensors, hasTap) &&
            !!sensor.entity_id;

          const visual = this._renderBadgeVisual(visualMode, sensor, {
            ringConfig,
            base: visualSize,
            ringIconRatio,
            ringLevel,
            svgKey,
            displayLevel,
            clickable,
          });

          // Hoisted out of the template: the helper's call formatted
          // non-idempotently under Prettier inline. Referencing a short local
          // keeps the span's inner whitespace byte-identical to the original.
          const labelText = buildBadgeLabel(sensor, labelContent);

          return html`
            <div class="ppb-item">
              ${visual}
              ${
                showLabel && labelText
                  ? html`<span class="ppb-label"> ${labelText} </span>`
                  : ""
              }
            </div>
          `;
        })}
        ${attribution}
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
  _renderBadgeVisual(
    mode: string,
    sensor: PollenSensor,
    ctx: {
      ringConfig: ReturnType<PollenPrognosBadge["_buildLevelRingConfig"]>;
      base: number;
      ringIconRatio: number;
      ringLevel: number;
      svgKey: string | null;
      displayLevel: number | string;
      clickable: boolean;
    },
  ): TemplateResult {
    const {
      ringConfig,
      base,
      ringIconRatio,
      ringLevel,
      svgKey,
      displayLevel,
      clickable,
    } = ctx;

    if (mode === "icon_only") {
      const onClick = (e: Event) => {
        if (clickable) {
          e.stopPropagation();
          this._openEntity(sensor.entity_id);
        }
      };
      return this._renderAllergenSvg(
        this._getEffectiveSvgKey(svgKey as string, ringLevel),
        ringLevel,
        { clickable, onClick, stale: sensor.stale },
      );
    }

    const iconKey =
      mode === "icon_in_ring"
        ? this._getEffectiveSvgKey(svgKey as string, ringLevel)
        : "";

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
      displayLevel as number,
      sensor.entity_id,
      clickable,
    );
  }

  // ---------------------------------------------------------------------- //
  // Styles                                                                   //
  // ---------------------------------------------------------------------- //

  static override get styles() {
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

      /* Google attribution pin (#338), Google-backed integrations only.
         The pill is a rounded capsule, so its bottom-right corner of the border
         box is transparent: anchoring the pin there left half of it outside the
         pill and on top of the label. The inset pulls the pin inside the corner
         radius, and the reserved padding on that side keeps the content (label
         included) out of its footprint in both label positions. This does widen
         the pill, deliberately and only for the two Google integrations; every
         other badge keeps its native geometry down to the pixel. */
      .ppb--attribution {
        position: relative;
        /* Height of the visible pin: the policy's 16dp minimum at badge_scale 1,
           held there for bigger badges so the pin never dominates the pill, and
           shrinking proportionally below. */
        --ppb-attr-glyph: min(16px, calc(var(--ppb-size) * 0.45));
        /* The asset's square 192x192 viewBox carries a symmetric transparent
           margin around a 176-tall glyph, so the box has to be scaled up for the
           glyph itself to reach --ppb-attr-glyph. Scaling the box here keeps the
           asset file byte-identical to Google's. */
        --ppb-attr-box: calc(var(--ppb-attr-glyph) * 192 / 176);
        /* The pin is centred on the pill's axis, where the capsule is at its
           widest, so this inset only has to clear the curve beside the pin's
           own corners -- 2.3px at scale 1 -- plus a visual margin. */
        --ppb-attr-inset: calc(var(--ppb-size) * 0.1);
        padding-right: calc(
          var(--ppb-attr-inset) + var(--ppb-attr-box) + var(--ppb-size) * 0.06
        );
      }

      /* Centred on the pill's vertical axis: the glyph sits symmetrically in the
         viewBox, so centring the box centres what the eye sees. */
      .ppb-attribution {
        position: absolute;
        right: var(--ppb-attr-inset);
        top: 50%;
        transform: translateY(-50%);
        line-height: 0;
      }

      /* The pin is square and full colour: never restyle the fills (it reads on
         light and dark alike) and never set width and height independently. */
      .ppb-attribution svg {
        display: block;
        height: var(--ppb-attr-box);
        width: auto;
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
       * they stay byte-identical to the card; the ring markup rendered by
       * the mixin's declarative template is covered by the fragment. The rules below are badge-specific and
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
