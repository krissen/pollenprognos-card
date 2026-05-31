// src/pollenprognos-badge-editor.js
//
// Visual editor for the pollenprognos-badge element.
// Extends PollenEditorBase to share integration/location and allergen sections.

import { html, css } from "lit";
import { detectLang } from "./i18n.js";
import { getStubConfig } from "./adapter-registry.js";
import { PollenEditorBase, deepMerge } from "./editor/base.js";
import { LEVELS_DEFAULTS } from "./utils/levels-defaults.js";
import { coerceBool } from "./utils/adapter-helpers.js";

class PollenPrognosBadgeEditor extends PollenEditorBase {
  // ------------------------------------------------------------------ //
  // Reactive properties                                                  //
  // ------------------------------------------------------------------ //

  static get properties() {
    return {
      _config: { type: Object },
      hass: { type: Object },
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
    };
  }

  // ------------------------------------------------------------------ //
  // hass setter                                                          //
  // ------------------------------------------------------------------ //

  /**
   * Store hass so section methods (_renderIntegrationSection etc.) can
   * read this._hass. For the badge MVP we don't run full integration
   * auto-detection; _buildIntegrationOptions() falls back gracefully to
   * the alphabetical list when _detectedIntegrations is empty.
   *
   * @param {object} hass
   */
  set hass(hass) {
    this._hass = hass;
    // Update selected phrase language on first hass arrival
    if (!this._selectedPhraseLang) {
      this._selectedPhraseLang = detectLang(hass, this._config?.date_locale);
    }
    this.requestUpdate();
  }

  get hass() {
    return this._hass;
  }

  // ------------------------------------------------------------------ //
  // Config update                                                        //
  // ------------------------------------------------------------------ //

  /**
   * Thin config update: deep-merge the new prop/value into _config and
   * fire the config-changed event that HA's editor framework listens to.
   * Shape mirrors the card editor's dispatch exactly.
   *
   * @param {string} prop
   * @param {*} value
   */
  _updateConfig(prop, value) {
    if (!this._config) return;
    const newConfig = deepMerge(this._config, { [prop]: value });
    this._config = newConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
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
        <summary>${this._t("summary_badge_content")}</summary>
        <div class="section-helper">${this._t("helper_badge_content")}</div>

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

        <ha-formfield label="${this._t("badge_show_label")}">
          <ha-switch
            .checked=${c.badge_show_label === true}
            @change=${(e) =>
              this._updateConfig("badge_show_label", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
      </details>
    `;
  }

  // ------------------------------------------------------------------ //
  // Render                                                               //
  // ------------------------------------------------------------------ //

  render() {
    if (!this._config) return html``;

    return html`
      <div class="card-config">
        ${this._renderIntegrationSection()}
        ${this._renderBadgeContentSection()}
        ${this._renderAllergensSection()}
        ${this._renderAppearanceSection()}
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
