// src/pollenprognos-badge-editor.js
//
// Visual editor for the pollenprognos-badge element.
// Extends PollenEditorBase to share integration/location and allergen sections.

import { html, css } from "lit";
import { getStubConfig } from "./adapter-registry.js";
import { PollenEditorBase, deepMerge } from "./editor/base.js";
import { LEVELS_DEFAULTS } from "./utils/levels-defaults.js";
import { coerceBool } from "./utils/adapter-helpers.js";
import { deepEqual } from "./utils/confcompare.js";
import {
  detectIntegrationStates,
  pickIntegration,
  detectedIntegrationIds,
  autoSelectLocation,
} from "./utils/autodetect.js";
import { extractCitySlugFromEntityId as extractPpCitySlugFromEntityId } from "./adapters/pp.js";

class PollenPrognosBadgeEditor extends PollenEditorBase {
  // ------------------------------------------------------------------ //
  // Reactive properties                                                  //
  // ------------------------------------------------------------------ //

  static get properties() {
    return {
      _config: { type: Object },
      hass: { type: Object },
      _selectedPhraseLang: { state: true },
    };
  }

  // ------------------------------------------------------------------ //
  // HA editor protocol                                                   //
  // ------------------------------------------------------------------ //

  /**
   * Called by HA when the badge is first opened in the editor and whenever
   * the user's config changes externally. Mirrors the badge element's own
   * setConfig so the editor always starts from a well-formed config.
   *
   * @param {object} config
   */
  setConfig(config) {
    // Normalize integration (trim + lowercase) to match badge element behaviour.
    let integration = config.integration;
    if (integration && typeof integration === "string") {
      integration = integration.trim().toLowerCase();
    }

    const stub = getStubConfig(integration) || getStubConfig("pp");
    if (!integration) integration = stub.integration;

    // Defensive type-guards (repo policy) on badge-specific fields.
    const badgeContent =
      typeof config.badge_content === "string" ? config.badge_content : "worst";
    const badgeSingleAllergen =
      typeof config.badge_single_allergen === "string"
        ? config.badge_single_allergen
        : undefined;
    const badgeShowLabel = coerceBool(config.badge_show_label);
    const badgeVisual =
      typeof config.badge_visual === "string" ? config.badge_visual : undefined;
    const badgeScale =
      typeof config.badge_scale === "number" ? config.badge_scale : undefined;
    const badgeLabelPosition =
      typeof config.badge_label_position === "string"
        ? config.badge_label_position
        : undefined;

    this._config = {
      ...stub,
      icon_in_ring: true,
      badge_content: "worst",
      badge_show_label: false,
      ...config,
      integration,
      badge_content: badgeContent,
      badge_show_label: badgeShowLabel,
      ...(badgeSingleAllergen !== undefined
        ? { badge_single_allergen: badgeSingleAllergen }
        : {}),
      ...(badgeVisual !== undefined ? { badge_visual: badgeVisual } : {}),
      ...(badgeScale !== undefined ? { badge_scale: badgeScale } : {}),
      ...(badgeLabelPosition !== undefined
        ? { badge_label_position: badgeLabelPosition }
        : {}),
    };

    // Persist only what the user actually set. _config above is the stub-merged
    // view used for rendering the editor; _userConfig is the raw incoming
    // config (user-origin keys) that we dispatch back, so stub defaults are
    // never baked into the saved YAML. Mirrors the card editor.
    this._userConfig = { ...config };

    // HA sets `hass` before `setConfig` for the badge editor, so the set hass()
    // autodetect was skipped while _config was still unset. Now that _config is
    // initialized, run it here so a freshly added badge prefills the installed
    // integration + first location and the dropdowns are populated.
    if (this._hass) this._runAutodetect();

    // Prefill the locale field from the current HA locale (display-only),
    // matching the card. The helper no-ops without hass, so whichever of
    // hass/setConfig arrives last triggers the prefill. _selectedPhraseLang is
    // intentionally NOT seeded; the shared phrases section derives the shown
    // language at render time.
    this._autofillDateLocale();
  }

  // ------------------------------------------------------------------ //
  // hass setter                                                          //
  // ------------------------------------------------------------------ //

  /**
   * Store hass and run the same autodetection the card editor does, so the
   * integration dropdown marks installed integrations, the location dropdown
   * is populated, and a freshly added badge prefills the integration + first
   * location of whatever is actually installed (issue #235). Detection is
   * shared with the card via src/utils/autodetect.js.
   *
   * @param {object} hass
   */
  set hass(hass) {
    const changed = this._hass !== hass;
    this._hass = hass;

    // Only when _config is already initialized; if hass arrives first (the
    // ordering HA uses for the badge editor), setConfig runs detection once it
    // sets _config — see the _runAutodetect() call there.
    if (this._config && changed) this._runAutodetect();

    // Prefill the locale field from the current HA locale (display-only),
    // matching the card editor, so it isn't left blank. _selectedPhraseLang
    // holds only the user's explicit dropdown pick; the shared phrases section
    // derives the shown language at render time, so it is not seeded here.
    this._autofillDateLocale();
    this.requestUpdate();
  }

  get hass() {
    return this._hass;
  }

  /**
   * Run the shared autodetection: mark installed integrations for the dropdown
   * sort, populate the location dropdown lists, and prefill integration + first
   * location. Called from both set hass() and setConfig() because HA can set
   * either first; needs both _hass and _config.
   */
  _runAutodetect() {
    if (!this._hass || !this._config) return;
    const detection = detectIntegrationStates(this._hass);
    this._detectedIntegrations = detectedIntegrationIds(detection);
    this._populateInstalledLocations(detection, this._hass);
    this._maybeAutofill(detection, this._hass);
  }

  // Integration -> the config key its location is stored under.
  static get _LOCATION_KEYS() {
    return { pp: "city", dwd: "region_id" };
  }

  _locationKeyFor(integration) {
    return PollenPrognosBadgeEditor._LOCATION_KEYS[integration] || "location";
  }

  /**
   * Build the installed-location lists the shared integration section reads
   * (installedPpLocations, installedDwdLocations, ...). The badge is new, so
   * there are no legacy slug configs to preserve: this is the discovery-first
   * path only (the card editor keeps the richer legacy-compat variant). Lists
   * are [key, label] pairs; the dropdown shows label, stores key.
   *
   * @param {ReturnType<typeof detectIntegrationStates>} detection
   * @param {object} hass
   */
  _populateInstalledLocations(detection, hass) {
    const toList = (discovery) =>
      Array.from(discovery.locations.entries()).map(([key, loc]) => [
        key,
        loc.label,
      ]);

    // PP / DWD / PEU via memoized discovery getters.
    const ppDiscovery = detection.getPpDiscovery();
    this.installedPpLocations = ppDiscovery.locations.size
      ? toList(ppDiscovery)
      : Array.from(
          new Set(
            detection.states.pp
              .map((id) => extractPpCitySlugFromEntityId(id))
              .filter(Boolean),
          ),
        ).map((slug) => [slug, slug]);

    const dwdDiscovery = detection.getDwdDiscovery();
    this.installedDwdLocations = dwdDiscovery.locations.size
      ? toList(dwdDiscovery)
      : Array.from(
          new Set(detection.states.dwd.map((id) => id.split("_").pop())),
        )
          .sort((a, b) => Number(a) - Number(b))
          .map((id) => [id, id]);

    const peuDiscovery = detection.getPeuDiscovery();
    this.installedPeuLocations = peuDiscovery.locations.size
      ? toList(peuDiscovery)
      : Array.from(
          new Set(
            detection.states.peu
              .map((eid) => hass.states[eid]?.attributes?.location_slug || null)
              .filter(Boolean),
          ),
        ).map((slug) => [slug, slug]);

    // SILAM / Atmo / GP via eager discovery; GPL / MSW via memoized getters.
    this.installedSilamLocations = toList(detection.discovery.silam);
    this.installedAtmoLocations = toList(detection.discovery.atmo);
    this.installedGpLocations = toList(detection.discovery.gp);
    this.installedGplLocations = toList(detection.getGplDiscovery());
    this.installedMswLocations = toList(detection.getMswDiscovery());

    // Kleenex has no discovery helper; derive slugs from the *_date sensors.
    this.installedKleenexLocations = Array.from(
      new Set(
        detection.stateIds
          .map((id) => {
            const m =
              typeof id === "string" &&
              id.match(/^sensor\.kleenex_pollen_radar_(.+)_date$/);
            return m ? m[1] : null;
          })
          .filter(Boolean),
      ),
    ).map((slug) => [slug, slug]);
  }

  /**
   * Prefill the integration (when the user hasn't pinned one) and the first
   * available location for the active integration (when none is set and not in
   * manual mode), then dispatch config-changed once if anything changed. The
   * diff-before-dispatch guard prevents an HA update loop on every hass tick.
   *
   * @param {ReturnType<typeof detectIntegrationStates>} detection
   * @param {object} hass
   */
  _maybeAutofill(detection, hass) {
    const userSetIntegration = Object.prototype.hasOwnProperty.call(
      this._userConfig || {},
      "integration",
    );

    const next = { ...this._config };

    if (!userSetIntegration) {
      const picked = pickIntegration(detection, { explicit: false });
      if (picked && picked !== next.integration) {
        next.integration = picked;
      }
    }

    const integration = next.integration;
    const locKey = this._locationKeyFor(integration);
    const userSetLocation = Object.prototype.hasOwnProperty.call(
      this._userConfig || {},
      locKey,
    );
    if (!userSetLocation && next[locKey] !== "manual" && !next[locKey]) {
      const sel = autoSelectLocation(integration, next, hass, detection);
      if (sel) next[sel.key] = sel.value;
    }

    if (!deepEqual(this._config, next)) {
      this._config = next;
      this._userConfig = { ...this._userConfig };
      if (!userSetIntegration) this._userConfig.integration = next.integration;
      if (next[locKey] != null) this._userConfig[locKey] = next[locKey];
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._userConfig },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  // ------------------------------------------------------------------ //
  // Config update                                                        //
  // ------------------------------------------------------------------ //

  /**
   * Config update: applies shared visual side-effects (via the base helper)
   * then deep-merges the new prop/value into _config and fires config-changed.
   * For visual properties (icon_in_ring, levels_inherit_mode, allergen_colors,
   * allergen_stroke_width, levels_*, allergen_color_mode) the shared helper
   * may produce a fully-mutated config; handled=true means dispatch and return.
   *
   * @param {string} prop
   * @param {*} value
   */
  _updateConfig(prop, value) {
    if (!this._config) return;

    // Integration change: drop the previous integration's location and
    // allergen keys so the new adapter's stub defaults take over. Without this
    // the stale user keys (e.g. PP allergen names) would override the new
    // integration and the badge would render empty. Mirrors the card editor.
    if (prop === "integration" && value !== this._config.integration) {
      const INTEGRATION_SCOPED = [
        "city", "region_id", "location",
        "entity_prefix", "entity_suffix", "entity_weather",
        "mode", "allergens", "badge_single_allergen",
        // Threshold ranges are integration-specific (DWD 0-3, PP 0-6, ...), so
        // a stale high threshold can suppress every allergen on the new
        // integration and render an empty badge. Pin-to-top flags are likewise
        // integration-specific. Clear them too, matching the card editor.
        "pollen_threshold", "allergy_risk_top", "index_top",
      ];
      this._userConfig = this._userConfig || {};
      for (const k of INTEGRATION_SCOPED) delete this._userConfig[k];
      this._userConfig.integration = value;
      const stub = getStubConfig(value) || getStubConfig("pp");
      this._config = deepMerge(stub, this._userConfig);
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._userConfig },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    const before = this._config;

    // Apply shared visual side-effects (may set several related keys at once,
    // e.g. levels_inherit_mode resetting the level colours/gap).
    const result = this._applyVisualConfigSideEffects(prop, value, {
      ...before,
    });
    if (result.thicknessAutoShifted !== null) {
      this._thicknessAutoShifted = result.thicknessAutoShifted;
    }
    const after = result.handled
      ? result.config
      : deepMerge(before, { [prop]: value });

    // Persist only user-origin keys: the edited prop plus any key the
    // side-effects actually changed (diffed against the pre-edit config). This
    // keeps stub defaults out of the saved YAML so the badge element can treat
    // a present value as a deliberate choice. Mirrors the card editor.
    this._userConfig = this._userConfig || {};
    for (const k of Object.keys(after)) {
      if (!deepEqual(after[k], before[k])) {
        this._userConfig[k] = after[k];
      }
    }
    this._userConfig[prop] = value;

    this._config = after;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._userConfig },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // A badge has no ha-card chrome and shows today's value only, so the shared
  // Integration/Location section must not offer the card-only Title controls or
  // the forecast-mode selector (the badge element forces mode to "daily").
  _showTitleSection() {
    return false;
  }

  _showModeSelector() {
    return false;
  }

  // The numeric-value-in-circle switch is driven by badge_visual (ring_value)
  // on the badge, so the §7 toggle would be a false affordance — hide it.
  _showNumericInCircleToggle() {
    return false;
  }

  // badge_visual (in the Badge content section) is the single source of truth
  // for whether the icon sits in the ring, so the §8 on/off checkbox would be
  // a false affordance here — hide it. The ring sub-fields (size ratio, colour)
  // remain available for tuning the icon_in_ring visual mode.
  _showIconInRingToggle() {
    return false;
  }

  // The badge shows the allergen name only (no level text, no day columns), so
  // hide the level-name and day-label customization. The badge label uses
  // allergenShort, which equals the full name UNLESS allergens_abbreviated is
  // set; the badge editor has no abbreviated toggle, but a YAML config can set
  // it, in which case the short names DO show -- so expose the short-name fields
  // only when allergens_abbreviated is enabled.
  _showPhraseShort() {
    return this._editorConfig()?.allergens_abbreviated === true;
  }

  _showPhraseLevels() {
    return false;
  }

  _showPhraseDays() {
    return false;
  }

  // ------------------------------------------------------------------ //
  // Allergen toggle helpers (required by _renderAllergensSection)        //
  // ------------------------------------------------------------------ //

  _onAllergenToggle(allergen, checked) {
    const set = new Set(this._config.allergens || []);
    checked ? set.add(allergen) : set.delete(allergen);
    this._updateConfig("allergens", [...set]);
  }

  _toggleSelectAllAllergens(allergens) {
    const current = new Set(this._config.allergens || []);
    const allSelected = allergens.every((a) => current.has(a));
    this._updateConfig("allergens", allSelected ? [] : [...allergens]);
  }

  _toggleAllergenSubset(subset) {
    const current = new Set(this._config.allergens || []);
    const allSelected = subset.every((a) => current.has(a));
    if (allSelected) {
      subset.forEach((a) => current.delete(a));
    } else {
      subset.forEach((a) => current.add(a));
    }
    this._updateConfig("allergens", [...current]);
  }

  // ------------------------------------------------------------------ //
  // Badge content section (badge-editor only — not shared)              //
  // ------------------------------------------------------------------ //

  _renderBadgeContentSection() {
    const c = this._editorConfig();
    const allergens = this._currentAllergens();

    return html`
      <details open>
        <summary>
          ${this._t("summary_badge_content")}
          ${this._renderSectionReset([
            "badge_visual",
            "badge_content",
            "badge_single_allergen",
          ])}
        </summary>
        <div class="section-helper">${this._t("helper_badge_content")}</div>

        <!-- badge_visual: what kind of badge (the section header + helper say
             "Badge content / What the badge shows", so no extra field label). -->
        <ha-formfield>
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: [
                  { value: "icon_in_ring", label: this._t("badge_visual_icon_in_ring") },
                  { value: "ring_value", label: this._t("badge_visual_ring_value") },
                  { value: "ring_empty", label: this._t("badge_visual_ring_empty") },
                  { value: "icon_only", label: this._t("badge_visual_icon_only") },
                ],
              },
            }}
            .value=${typeof c.badge_visual === "string" ? c.badge_visual : "icon_in_ring"}
            @value-changed=${(e) => {
              const v = e.detail?.value;
              if (v !== undefined) this._updateConfig("badge_visual", v);
            }}
          ></ha-selector>
        </ha-formfield>

        <!-- badge_content: which allergen(s) the badge concerns -->
        <ha-formfield>
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: [
                  { value: "worst", label: this._t("badge_content_worst") },
                  { value: "aggregate", label: this._t("badge_content_aggregate") },
                  { value: "single", label: this._t("badge_content_single") },
                  { value: "row", label: this._t("badge_content_row") },
                ],
              },
            }}
            .value=${c.badge_content || "worst"}
            @value-changed=${(e) => {
              const v = e.detail?.value;
              if (v !== undefined) this._updateConfig("badge_content", v);
            }}
          ></ha-selector>
        </ha-formfield>

        ${c.badge_content === "single"
          ? html`
              <ha-formfield label="${this._t("badge_single_allergen")}">
                <ha-selector
                  .hass=${this._hass}
                  .selector=${{
                    select: {
                      mode: "dropdown",
                      options: allergens.map((key) => ({
                        value: key,
                        label: this._getAllergenDisplayName(key),
                      })),
                    },
                  }}
                  .value=${c.badge_single_allergen || allergens[0] || ""}
                  @value-changed=${(e) => {
                    const v = e.detail?.value;
                    if (v !== undefined)
                      this._updateConfig("badge_single_allergen", v);
                  }}
                ></ha-selector>
              </ha-formfield>
            `
          : ""}
      </details>
    `;
  }

  // Hide the card-only size controls (icon_size / text_size_ratio) in the
  // shared Card appearance section; the badge uses badge_scale instead.
  _showCardSizeControls() {
    return false;
  }

  // The Card appearance (§5) reset also clears the badge size/label keys, which
  // live in this section via _renderAppearanceExtras (icon_size/text_size_ratio
  // are hidden on the badge but harmless to include).
  _appearanceResetKeys() {
    return [
      ...super._appearanceResetKeys(),
      "badge_scale",
      "badge_show_label",
      "badge_label_position",
    ];
  }

  // Badge size + label controls, rendered inside the shared Card appearance
  // section so badge size lives where card size lives (recognisable to users
  // of the card editor).
  _renderAppearanceExtras() {
    const c = this._editorConfig();
    return html`
      <!-- badge_scale: overall badge size multiplier -->
      <ha-formfield label="${this._t("badge_scale")}">
        <ha-slider
          min="0.5"
          max="3"
          step="0.1"
          .value=${typeof c.badge_scale === "number" ? c.badge_scale : 1}
          @input=${(e) =>
            this._updateConfig("badge_scale", Number(e.target.value))}
          style="width: 120px;"
        ></ha-slider>
        <ha-textfield
          type="number"
          min="0.5"
          max="3"
          step="0.1"
          .value=${typeof c.badge_scale === "number" ? c.badge_scale : 1}
          @input=${(e) =>
            this._updateConfig("badge_scale", Number(e.target.value))}
          style="width: 80px;"
        ></ha-textfield>
      </ha-formfield>

      <!-- badge_icon_scale: scale the allergen visual as a whole — the ring
           (and whatever it centres) in the ring modes, the bare icon in
           icon_only — without touching the label text or the pill box. Shown
           in every visual mode. -->
      <ha-formfield label="${this._t("badge_icon_scale")}">
        <ha-slider
          min="0.3"
          max="3"
          step="0.05"
          .value=${typeof c.badge_icon_scale === "number"
            ? c.badge_icon_scale
            : 1}
          @input=${(e) =>
            this._updateConfig("badge_icon_scale", Number(e.target.value))}
          style="width: 120px;"
        ></ha-slider>
        <ha-textfield
          type="number"
          min="0.3"
          max="3"
          step="0.05"
          .value=${typeof c.badge_icon_scale === "number"
            ? c.badge_icon_scale
            : 1}
          @input=${(e) =>
            this._updateConfig("badge_icon_scale", Number(e.target.value))}
          style="width: 80px;"
        ></ha-textfield>
      </ha-formfield>

      <!-- badge_show_label / badge_label_position -->
      <ha-formfield label="${this._t("badge_show_label")}">
        <ha-switch
          .checked=${c.badge_show_label === true}
          @change=${(e) =>
            this._updateConfig("badge_show_label", e.target.checked)}
        ></ha-switch>
      </ha-formfield>

      ${c.badge_show_label
        ? html`
            <ha-formfield label="${this._t("badge_label_position")}">
              <ha-selector
                .hass=${this._hass}
                .selector=${{
                  select: {
                    mode: "dropdown",
                    options: [
                      { value: "right", label: this._t("badge_label_position_right") },
                      { value: "below", label: this._t("badge_label_position_below") },
                    ],
                  },
                }}
                .value=${typeof c.badge_label_position === "string" ? c.badge_label_position : "right"}
                @value-changed=${(e) => {
                  const v = e.detail?.value;
                  if (v !== undefined) this._updateConfig("badge_label_position", v);
                }}
              ></ha-selector>
            </ha-formfield>
          `
        : ""}
    `;
  }

  // ------------------------------------------------------------------ //
  // Render                                                               //
  // ------------------------------------------------------------------ //

  render() {
    if (!this._config) return html``;

    return html`
      <div class="card-config">
        <!-- Reset button (inherited from PollenEditorBase) -->
        <ha-button outlined @click=${() => this._resetAll()}>
          ${this._t("preset_reset_all")}
        </ha-button>

        ${this._renderIntegrationSection()}
        ${this._renderBadgeContentSection()}
        ${this._renderAllergensSection()}
        ${this._renderAppearanceSection()}
        ${this._renderAllergenIconsSection()}
        ${this._renderLevelCirclesSection()}
        ${this._renderIconInRingSection()}
        ${this._renderPhrasesSection()}
      </div>
    `;
  }

  // ------------------------------------------------------------------ //
  // Styles                                                               //
  // ------------------------------------------------------------------ //

  static get styles() {
    return css`
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
      }

      ha-formfield,
      details {
        margin-bottom: 8px;
      }

      .allergens-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .allergen-section {
        margin-bottom: 12px;
      }

      .allergen-section h4 {
        margin: 8px 0 4px 0;
        font-size: 0.9em;
        color: var(--secondary-text-color);
        font-weight: 500;
      }

      details summary {
        cursor: pointer;
        font-weight: bold;
        margin: 8px 0;
      }

      ha-slider {
        width: 100%;
      }

      ha-selector {
        width: 100%;
        --mdc-theme-primary: var(--primary-color);
      }

      .preset-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }

      .slider-row {
        display: grid;
        grid-template-columns: auto 3ch 1fr;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .slider-value {
        font-family: monospace;
        text-align: right;
        width: 3ch;
      }

      .slider-row ha-slider {
        width: 100%;
      }

      details {
        margin-bottom: 16px;
        border-radius: 6px;
        padding: 8px 0 0 0;
      }

      details > *:not(summary):not(details) {
        margin-left: 24px;
        margin-right: 24px;
      }

      details summary {
        font-weight: bold;
        cursor: pointer;
        background: var(--card-background-color, #f6f6f6);
        border-radius: 6px;
        padding: 10px 16px;
        border: 1px solid var(--divider-color, #ddd);
        color: var(--primary-text-color, #222);
        margin-bottom: 4px;
      }

      /* Anchor for the per-section reset button so it can centre itself, and
         reserve room on the right so a long section title can't run under the
         absolutely-positioned button. Applied to every summary (avoids :has(),
         which older Firefox ESR lacks); the extra right padding on the few
         reset-less nested summaries is just whitespace. */
      details > summary {
        position: relative;
        padding-right: 48px;
      }
      /* Compact ↺ reset button in the section header: small circle, vertically
         centred, ghost style until hovered/focused. */
      .section-reset {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        width: 26px;
        height: 26px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid var(--divider-color, #ccc);
        background: transparent;
        color: var(--secondary-text-color);
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .section-reset:hover,
      .section-reset:focus-visible {
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
      }
      .section-reset:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 1px;
      }

      details details {
        margin-left: 24px;
        margin-right: 24px;
        background: var(--secondary-background-color, #f9f9f9);
        border-left: 2px solid var(--primary-color, #bcd);
        padding: 8px 0 8px 8px;
      }

      details details summary {
        background: var(--card-background-color, #f0f7fc);
        border: 1px solid var(--ha-card-border-color, #cde);
        color: var(--primary-text-color, #222);
        margin-bottom: 4px;
        padding: 8px 12px;
        border-radius: 5px;
      }

      ha-formfield > ha-switch,
      ha-formfield > .mdc-form-field > ha-switch {
        margin: 0;
        padding: 0;
        width: auto;
        min-width: 0;
        box-sizing: content-box;
      }

      ha-formfield {
        padding: 0;
        margin: 0;
        box-sizing: border-box;
      }

      ha-switch {
        vertical-align: middle;
        width: 36px;
        height: 20px;
        background: none;
        border: none;
        box-sizing: border-box;
      }

      ha-formfield label,
      ha-formfield .mdc-label {
        vertical-align: middle;
        margin-left: 8px;
        margin-right: 0;
        padding: 0;
      }

      /* Section helper text below summary */
      .section-helper {
        font-size: 12px;
        color: var(--secondary-text-color);
        padding: 0 0 8px;
        margin-left: 24px;
        margin-right: 24px;
      }

      /* Subgroup header (uppercase divider inside a section) */
      .subgroup-header {
        text-transform: uppercase;
        font-size: 11px;
        font-weight: 600;
        color: var(--secondary-text-color);
        padding-top: 10px;
        border-top: 1px dashed var(--divider-color, #ccc);
        margin-top: 8px;
        margin-bottom: 4px;
        margin-left: 24px;
        margin-right: 24px;
      }

      ha-textfield[type="number"] {
        width: 80px;
        min-width: 80px;
        max-width: 100px;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-size: 1.1em;
      }
    `;
  }
}

if (!customElements.get("pollenprognos-badge-editor")) {
  customElements.define("pollenprognos-badge-editor", PollenPrognosBadgeEditor);
}

export default PollenPrognosBadgeEditor;
