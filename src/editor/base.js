// src/editor/base.js
//
// Shared base class for pollenprognos editors (card + badge).
//
// Provides:
//   - deepMerge utility (re-exported)
//   - get debug(), get _lang(), _t()
//   - _buildIntegrationOptions()
//   - _getAllergenDisplayName()
//   - _hasSilamWeatherEntity()
//   - _editorConfig(), _currentAllergens(), _currentNumLevels(), _thresholdParams()
//   - _renderIntegrationSection() — §1 Integration & Location
//   - _renderAllergensSection()   — §2 Allergens
//   - _renderAppearanceSection()  — §5 Card appearance
//
// Both editors extend this class. Section methods read from this._config
// and call this._updateConfig / this._hass — both editors must expose those.

import { LitElement, html } from "lit";
import { t, detectLang } from "../i18n.js";
import { normalize } from "../utils/normalize.js";
import { slugify } from "../utils/slugify.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { getAllAdapterIds, getStubConfig } from "../adapter-registry.js";
import {
  stubConfigDWD,
  discoverDwdSensors,
  DWD_ENTITY_ID_RE,
} from "../adapters/dwd.js";
import {
  PEU_ALLERGENS,
  discoverPeuSensors,
  extractPeuLocationSlugFromEntityId,
} from "../adapters/peu.js";
import { SILAM_ALLERGENS } from "../adapters/silam.js";
import { stubConfigKleenex } from "../adapters/kleenex/index.js";
import { stubConfigPLU } from "../adapters/plu.js";
import {
  ATMO_ALLERGENS,
  discoverAtmoSensors,
  findAtmoLocationBySlug,
} from "../adapters/atmo.js";
import {
  GPL_BASE_ALLERGENS,
  discoverGplSensors,
  discoverGplAllergens,
} from "../adapters/gpl/index.js";
import {
  GP_BASE_ALLERGENS,
  discoverGpSensors,
  discoverGpAllergens,
} from "../adapters/gp/index.js";
import { stubConfigMSW, discoverMswSensors } from "../adapters/msw.js";
import {
  discoverSilamSensors,
  resolveDiscoveredLocation,
} from "../utils/silam.js";
import { findLocationBySlug } from "../utils/adapter-helpers.js";
import {
  PP_POSSIBLE_CITIES,
  DWD_REGIONS,
  toCanonicalAllergenKey,
} from "../constants.js";
import {
  stubConfigPP,
  discoverPpSensors,
  extractCitySlugFromEntityId as extractPpCitySlugFromEntityId,
} from "../adapters/pp.js";

import silamAllergenMap from "../adapters/silam_allergen_map.json" assert { type: "json" };

// ------------------------------------------------------------------ //
// Recursive merge utility — shared by both editors.                   //
// ------------------------------------------------------------------ //

export const deepMerge = (target, source) => {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof target[key] === "object" &&
      target[key] !== null
    ) {
      out[key] = deepMerge(target[key], val);
    } else {
      out[key] = val;
    }
  }
  return out;
};

// ------------------------------------------------------------------ //
// Base class                                                           //
// ------------------------------------------------------------------ //

/**
 * Shared base for the card editor and the badge editor.
 *
 * Subclass contract — every subclass MUST provide:
 *   - reactive `_config` and `_hass` (plus a `hass` setter)
 *   - `_updateConfig(prop, value)` that merges into `_config` and dispatches
 *     the `config-changed` event
 *   - the allergen-list mutators the Allergens section calls:
 *     `_onAllergenToggle(allergen, checked)`,
 *     `_toggleSelectAllAllergens(allergens)`, `_toggleAllergenSubset(subset)`
 *
 * Subclasses MAY override `_showTitleSection()` / `_showModeSelector()` to drop
 * card-only controls (the badge editor returns false for both).
 */
export class PollenEditorBase extends LitElement {
  // ------------------------------------------------------------------
  // Presentation hooks (overridable by subclasses)
  // ------------------------------------------------------------------

  // Whether the Integration/Location section shows the Title sub-group.
  // Cards render a title inside their ha-card; the badge editor overrides
  // this to false (a chrome-less badge has no title).
  _showTitleSection() {
    return true;
  }

  // Whether the Integration/Location section shows the forecast-mode selector
  // (SILAM/PEU daily / twice_daily / hourly...). The badge renders today's
  // value only, so the badge editor overrides this to false.
  _showModeSelector() {
    return true;
  }

  // ------------------------------------------------------------------
  // Simple accessors (shared)
  // ------------------------------------------------------------------

  get debug() {
    // return true;
    return Boolean(this._config?.debug);
  }

  // Editor translations always follow the Home Assistant language.
  get _lang() {
    return detectLang(this._hass);
  }

  _t(key) {
    return t(`editor.${key}`, this._lang);
  }

  // ------------------------------------------------------------------
  // Integration detection helper (SILAM weather entity check)
  // ------------------------------------------------------------------

  _hasSilamWeatherEntity(location, entityWeather = null) {
    if (
      !this._hass ||
      !this._hass.states ||
      typeof this._hass.states !== "object"
    )
      return false;

    // Manual override short-circuit: when the user supplied an explicit
    // entity_weather, it exists in hass.states, AND it's in the weather.*
    // domain, treat it as the weather entity even though discovery wouldn't
    // find one for location="manual". Unblocks the mode selector
    // (daily/twice_daily/hourly) for manual mode. Without the weather.*
    // guard, a stray sensor.* entity could silently enable a mode selector
    // that fails at runtime when the forecast subscription is attempted.
    if (
      location === "manual" &&
      entityWeather &&
      typeof entityWeather === "string" &&
      entityWeather.startsWith("weather.") &&
      this._hass.states[entityWeather]
    ) {
      return true;
    }

    // Primärt: discovery-baserad check
    const discovery = discoverSilamSensors(this._hass, this.debug);
    if (discovery.locations.size > 0) {
      const resolved = resolveDiscoveredLocation(discovery, location || "", this.debug);
      if (resolved) return !!resolved.weatherEntity;
      // Discovery had data but location didn't match — still try regex fallback
    }

    // Fallback: regex-baserad check
    if (!location) {
      const candidates = Object.keys(this._hass.states)
        .filter(
          (id) =>
            typeof id === "string" && id.startsWith("weather.silam_pollen_"),
        )
        .map((id) =>
          id.replace(/^weather\.silam_pollen_/, "").replace(/_.+$/, ""),
        )
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort();
      if (this.debug) {
        console.debug(
          "[Editor] _hasSilamWeatherEntity: found locations:",
          candidates,
        );
      }
      return candidates.length > 0;
    }
    const lang = detectLang(this._hass);
    const suffixes =
      silamAllergenMap.weather_suffixes?.[lang] ||
      silamAllergenMap.weather_suffixes?.en ||
      [];
    const loc = location.toLowerCase();
    for (const suffix of suffixes) {
      const entityId = `weather.silam_pollen_${loc}_${suffix}`;
      if (entityId in this._hass.states) return true;
    }
    const prefix = `weather.silam_pollen_${loc}_`;
    return Object.keys(this._hass.states).some(
      (id) => typeof id === "string" && id.startsWith(prefix),
    );
  }

  // ------------------------------------------------------------------
  // Integration dropdown builder
  // ------------------------------------------------------------------

  /**
   * Build the integration dropdown options as a single visible list with two
   * alphabetically-sorted segments: detected/installed integrations first,
   * non-detected after. With ten supported integrations the legacy fixed
   * order is hard to scan; sorting plus prioritizing the user's actual
   * installs cuts down on bouncing.
   *
   * Detection comes from this._detectedIntegrations, populated by
   * `set hass()`. When hass has not been set yet the set is empty and the
   * dropdown falls back to a single alphabetically-sorted list of all
   * registered adapters.
   */
  _buildIntegrationOptions() {
    const detected = this._detectedIntegrations || new Set();
    const ids = getAllAdapterIds();
    const labelOf = (id) => this._t(`integration.${id}`);
    const byLabel = (a, b) => labelOf(a).localeCompare(labelOf(b), this._lang);
    const installed = ids.filter((id) => detected.has(id)).sort(byLabel);
    const rest = ids.filter((id) => !detected.has(id)).sort(byLabel);
    return [...installed, ...rest].map((id) => ({
      value: id,
      label: labelOf(id),
    }));
  }

  // ------------------------------------------------------------------
  // Allergen display name helper
  // ------------------------------------------------------------------

  _getAllergenDisplayName(allergenKey) {
    if (allergenKey === undefined || allergenKey === null) return "";
    const raw = typeof allergenKey === "string" ? allergenKey : String(allergenKey);
    const slug = slugify(raw);
    const canonical = toCanonicalAllergenKey(slug);
    const translationKey = `phrases_full.${canonical}`;
    const translated = this._t(translationKey);
    if (translated && translated !== translationKey) {
      return translated;
    }
    if (raw) {
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
    return canonical ? canonical.charAt(0).toUpperCase() + canonical.slice(1) : "";
  }

  // ------------------------------------------------------------------
  // Per-render computed helpers (used by section methods)
  // ------------------------------------------------------------------

  /**
   * Returns the merged "c" config object that section templates read from.
   * Equivalent to the render()-local `c` variable in the card editor.
   */
  _editorConfig() {
    return {
      phrases: {
        full: {},
        short: {},
        levels: [],
        days: {},
        no_information: "",
      },
      ...LEVELS_DEFAULTS,
      ...this._config,
    };
  }

  /**
   * Returns the allergen list for the current integration.
   * Equivalent to the render()-local `allergens` variable in the card editor.
   */
  _currentAllergens() {
    const c = this._editorConfig();
    return c.integration === "dwd"
      ? stubConfigDWD.allergens
      : c.integration === "peu"
        ? PEU_ALLERGENS
        : c.integration === "silam"
          ? SILAM_ALLERGENS
          : c.integration === "kleenex"
            ? stubConfigKleenex.allergens
            : c.integration === "plu"
              ? stubConfigPLU.allergens
              : c.integration === "gpl"
                ? [...GPL_BASE_ALLERGENS, ...(this.installedGplPlants || [])]
                : c.integration === "gp"
                  ? [...GP_BASE_ALLERGENS, ...(this.installedGpPlants || [])]
                  : c.integration === "atmo"
                ? ATMO_ALLERGENS
                : c.integration === "msw"
                  ? stubConfigMSW.allergens
                  : stubConfigPP.allergens;
  }

  /**
   * Returns the number of pollen levels for the current integration.
   * Equivalent to the render()-local `numLevels` variable in the card editor.
   */
  _currentNumLevels() {
    const c = this._editorConfig();
    return c.integration === "dwd"
      ? 4
      : c.integration === "peu" || c.integration === "msw"
        ? 5
        : c.integration === "gpl" || c.integration === "gp"
          ? 6
          : c.integration === "plu"
            ? 4
            : 7;
  }

  /**
   * Returns the slider parameters for the pollen_threshold control.
   * Equivalent to the render()-local `thresholdParams` variable in the card editor.
   */
  _thresholdParams() {
    const c = this._editorConfig();
    return c.integration === "dwd"
      ? { min: 0, max: 3, step: 0.5 }
      : c.integration === "peu" || c.integration === "msw"
        ? { min: 0, max: 4, step: 1 }
        : c.integration === "gpl" || c.integration === "gp"
          ? { min: 0, max: 5, step: 1 }
          : c.integration === "plu"
            ? { min: 0, max: 3, step: 1 }
            : { min: 0, max: 6, step: 1 };
  }

  // ------------------------------------------------------------------
  // §1 Integration & Location section
  // ------------------------------------------------------------------

  _renderIntegrationSection() {
    const c = this._editorConfig();
    return html`
      <!-- §1 Integration & Location -->
      <details open>
        <summary>${this._t("summary_integration_and_place")}</summary>
        <div class="section-helper">${this._t("helper_integration_and_place")}</div>

        <div class="subgroup-header">${this._t("subgroup_source")}</div>

        <ha-formfield label="${this._t("integration")}">
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: this._buildIntegrationOptions(),
              },
            }}
            .value=${c.integration}
            @value-changed=${(e) => {
              const v = e.detail?.value;
              if (v !== undefined) this._updateConfig("integration", v);
            }}
          ></ha-selector>
        </ha-formfield>
        ${c.integration === "pp"
          ? html`
              <ha-formfield label="${this._t("city")}">
                <ha-selector
                  .hass=${this._hass}
                  .selector=${{
                    select: {
                      mode: "dropdown",
                      options: [
                        {
                          value: "",
                          label: this._t("location_autodetect"),
                        },
                        ...(this.installedPpLocations || []).map(([key, label]) => ({
                          value: key,
                          label,
                        })),
                        {
                          value: "manual",
                          label: this._t("location_manual"),
                        },
                      ],
                    },
                  }}
                  .value=${c.city || ""}
                  @value-changed=${(e) => {
                    const v = e.detail?.value;
                    if (v !== undefined) this._updateConfig("city", v);
                  }}
                ></ha-selector>
              </ha-formfield>
            `
          : c.integration === "peu"
            ? html`
                <ha-formfield label="${this._t("location")}">
                  <ha-selector
                    .hass=${this._hass}
                    .selector=${{
                      select: {
                        mode: "dropdown",
                        options: [
                          {
                            value: "",
                            label: this._t("location_autodetect"),
                          },
                          ...(this.installedPeuLocations || []).map(([slug, title]) => ({
                            value: slug,
                            label: title,
                          })),
                          {
                            value: "manual",
                            label: this._t("location_manual"),
                          },
                        ],
                      },
                    }}
                    .value=${c.location || ""}
                    @value-changed=${(e) => {
                      const v = e.detail?.value;
                      if (v !== undefined) this._updateConfig("location", v);
                    }}
                  ></ha-selector>
                </ha-formfield>
              `
            : c.integration === "silam"
              ? html`
                  <ha-formfield label="${this._t("location")}">
                    <ha-selector
                      .hass=${this._hass}
                      .selector=${{
                        select: {
                          mode: "dropdown",
                          options: [
                            {
                              value: "",
                              label: this._t("location_autodetect"),
                            },
                            ...(this.installedSilamLocations || []).map(([slug, title]) => ({
                              value: slug,
                              label: title,
                            })),
                            {
                              value: "manual",
                              label: this._t("location_manual"),
                            },
                          ],
                        },
                      }}
                      .value=${c.location || ""}
                      @value-changed=${(e) => {
                        const v = e.detail?.value;
                        if (v !== undefined) this._updateConfig("location", v);
                      }}
                    ></ha-selector>
                  </ha-formfield>
                `
              : c.integration === "kleenex"
                ? html`
                    <ha-formfield label="${this._t("location")}">
                      <ha-selector
                        .hass=${this._hass}
                        .selector=${{
                          select: {
                            mode: "dropdown",
                            options: [
                              {
                                value: "",
                                label: this._t("location_autodetect"),
                              },
                              ...(this.installedKleenexLocations || []).map(([slug, title]) => ({
                                value: slug,
                                label: title,
                              })),
                              {
                                value: "manual",
                                label: this._t("location_manual"),
                              },
                            ],
                          },
                        }}
                        .value=${c.location || ""}
                        @value-changed=${(e) => {
                          const v = e.detail?.value;
                          if (v !== undefined) this._updateConfig("location", v);
                        }}
                      ></ha-selector>
                    </ha-formfield>
                  `
                : c.integration === "atmo"
                  ? html`
                      <ha-formfield label="${this._t("location")}">
                        <ha-selector
                          .hass=${this._hass}
                          .selector=${{
                            select: {
                              mode: "dropdown",
                              options: [
                                {
                                  value: "",
                                  label: this._t("location_autodetect"),
                                },
                                ...(this.installedAtmoLocations || []).map(([slug, title]) => ({
                                  value: slug,
                                  label: title,
                                })),
                                {
                                  value: "manual",
                                  label: this._t("location_manual"),
                                },
                              ],
                            },
                          }}
                          .value=${c.location || ""}
                          @value-changed=${(e) => {
                            const v = e.detail?.value;
                            if (v !== undefined) this._updateConfig("location", v);
                          }}
                        ></ha-selector>
                      </ha-formfield>
                    `
                : c.integration === "gpl" || c.integration === "gp" || c.integration === "msw"
                  ? html`
                      <ha-formfield label="${this._t("location")}">
                        <ha-selector
                          .hass=${this._hass}
                          .selector=${{
                            select: {
                              mode: "dropdown",
                              options: [
                                {
                                  value: "",
                                  label: this._t("location_autodetect"),
                                },
                                ...(c.integration === "gp"
                                  ? (this.installedGpLocations || [])
                                  : c.integration === "msw"
                                    ? (this.installedMswLocations || [])
                                    : (this.installedGplLocations || [])
                                ).map(([slug, title]) => ({
                                  value: slug,
                                  label: title,
                                })),
                                {
                                  value: "manual",
                                  label: this._t("location_manual"),
                                },
                              ],
                            },
                          }}
                          .value=${c.location || ""}
                          @value-changed=${(e) => {
                            const v = e.detail?.value;
                            if (v !== undefined) this._updateConfig("location", v);
                          }}
                        ></ha-selector>
                      </ha-formfield>
                    `
                : c.integration === "plu"
                  ? html`
                      <ha-formfield label="${this._t("location")}">
                        <ha-selector
                          .hass=${this._hass}
                          .selector=${{
                            select: {
                              mode: "dropdown",
                              options: [
                                {
                                  value: "",
                                  label: this._t("location_autodetect"),
                                },
                                {
                                  value: "manual",
                                  label: this._t("location_manual"),
                                },
                              ],
                            },
                          }}
                          .value=${c.location === "manual" ? "manual" : ""}
                          @value-changed=${(e) => {
                            const v = e.detail?.value;
                            if (v !== undefined) this._updateConfig("location", v);
                          }}
                        ></ha-selector>
                      </ha-formfield>
                    `
                : html`
                    <ha-formfield label="${this._t("region_id")}">
                      <ha-selector
                        .hass=${this._hass}
                        .selector=${{
                          select: {
                            mode: "dropdown",
                            options: [
                              {
                                value: "",
                                label: this._t("location_autodetect"),
                              },
                              ...(this.installedDwdLocations || []).map(([key, label]) => ({
                                value: key,
                                label,
                              })),
                              {
                                value: "manual",
                                label: this._t("location_manual"),
                              },
                            ],
                          },
                        }}
                        .value=${c.region_id || ""}
                        @value-changed=${(e) => {
                          const v = e.detail?.value;
                          if (v !== undefined) this._updateConfig("region_id", v);
                        }}
                      ></ha-selector>
                    </ha-formfield>
                  `}
        ${!this._showModeSelector()
          ? ""
          : c.integration === "silam" && this._hasSilamWeatherEntity(c.location, c.entity_weather)
          ? html`
              <ha-formfield label="${this._t("mode")}">
                <ha-selector
                  .hass=${this._hass}
                  .selector=${{
                    select: {
                      mode: "dropdown",
                      options: [
                        { value: "daily", label: this._t("mode_daily") },
                        { value: "twice_daily", label: this._t("mode_twice_daily") },
                        { value: "hourly", label: this._t("mode_hourly") },
                      ],
                    },
                  }}
                  .value=${c.mode || "daily"}
                  @value-changed=${(e) => {
                    const v = e.detail?.value;
                    if (v !== undefined) this._updateConfig("mode", v);
                  }}
                ></ha-selector>
              </ha-formfield>
            `
          : c.integration === "peu"
            ? html`
                <ha-formfield label="${this._t("mode")}">
                  <ha-selector
                    .hass=${this._hass}
                    .selector=${{
                      select: {
                        mode: "dropdown",
                        options: [
                          { value: "daily", label: this._t("mode_daily") },
                          { value: "twice_daily", label: this._t("mode_twice_daily") },
                          { value: "hourly", label: this._t("mode_hourly") },
                          { value: "hourly_second", label: this._t("mode_hourly_second") },
                          { value: "hourly_third", label: this._t("mode_hourly_third") },
                          { value: "hourly_fourth", label: this._t("mode_hourly_fourth") },
                          { value: "hourly_sixth", label: this._t("mode_hourly_sixth") },
                          { value: "hourly_eighth", label: this._t("mode_hourly_eighth") },
                        ],
                      },
                    }}
                    .value=${c.mode || "daily"}
                    @value-changed=${(e) => {
                      const v = e.detail?.value;
                      if (v !== undefined) this._updateConfig("mode", v);
                    }}
                  ></ha-selector>
                </ha-formfield>
                <p>${this._t("peu_nondaily_expl")}</p>
              `
            : ""}
        ${(c.integration === "pp" && c.city === "manual") ||
        (c.integration === "dwd" && c.region_id === "manual") ||
        ((c.integration === "peu" || c.integration === "silam" || c.integration === "kleenex" || c.integration === "atmo" || c.integration === "gpl" || c.integration === "gp" || c.integration === "plu") &&
          c.location === "manual")
          ? html`
              <details>
                <summary>${this._t("summary_entity_prefix_suffix")}</summary>
                <ha-formfield label="${this._t("entity_prefix")}">
                  <ha-textfield
                    .value=${c.entity_prefix || ""}
                    placeholder="${this._t("entity_prefix_placeholder")}"
                    @input=${(e) =>
                      this._updateConfig("entity_prefix", e.target.value)}
                  ></ha-textfield>
                </ha-formfield>
                <ha-formfield label="${this._t("entity_suffix")}">
                  <ha-textfield
                    .value=${c.entity_suffix || ""}
                    placeholder="${this._t("entity_suffix_placeholder")}"
                    @input=${(e) =>
                      this._updateConfig("entity_suffix", e.target.value)}
                  ></ha-textfield>
                </ha-formfield>
                ${c.integration === "silam"
                  ? html`
                      <ha-formfield label="${this._t("entity_weather")}">
                        <ha-textfield
                          .value=${c.entity_weather || ""}
                          placeholder="${this._t("entity_weather_placeholder")}"
                          @input=${(e) =>
                            this._updateConfig("entity_weather", e.target.value)}
                        ></ha-textfield>
                      </ha-formfield>
                    `
                  : ""}
              </details>
            `
          : ""}

        <!-- Title subgroup inside §1 (suppressed for elements with no card chrome) -->
        ${this._showTitleSection()
          ? html`
              <div class="subgroup-header">${this._t("subgroup_title")}</div>
              <div style="display:flex; gap:8px; align-items:center;">
                <ha-formfield label="${this._t("title_hide")}">
                  <ha-checkbox
                    .checked=${c.title === false}
                    @change=${(e) => {
                      if (e.target.checked) {
                        this._updateConfig("title", false);
                      } else {
                        this._updateConfig("title", true);
                      }
                    }}
                  ></ha-checkbox>
                </ha-formfield>
                <ha-formfield label="${this._t("title_automatic")}">
                  <ha-checkbox
                    .checked=${c.title === true || c.title === undefined}
                    @change=${(e) => {
                      if (e.target.checked) {
                        this._updateConfig("title", true);
                      } else {
                        this._updateConfig("title", "");
                      }
                    }}
                  ></ha-checkbox>
                </ha-formfield>
              </div>
              <ha-formfield label="${this._t("title")}">
                <ha-textfield
                  .value=${typeof c.title === "string"
                    ? c.title
                    : c.title === false
                      ? "(false)"
                      : ""}
                  placeholder="${this._t("title_placeholder")}"
                  .disabled=${c.title === false}
                  @input=${(e) => {
                    const val = e.target.value;
                    if (val.trim() === "") {
                      this._updateConfig("title", true);
                    } else {
                      this._updateConfig("title", val);
                    }
                  }}
                ></ha-textfield>
              </ha-formfield>
            `
          : ""}
      </details>
    `;
  }

  // ------------------------------------------------------------------
  // §2 Allergens section
  // ------------------------------------------------------------------

  _renderAllergensSection() {
    const c = this._editorConfig();
    const allergens = this._currentAllergens();
    const thresholdParams = this._thresholdParams();

    const SORT_VALUES = [
      "value_ascending",
      "value_descending",
      "name_ascending",
      "name_descending",
      "none",
    ];
    const sortOptions = SORT_VALUES.map((opt) => ({
      value: opt,
      label: this._t(`sort_${opt}`),
    }));

    return html`
      <!-- §2 Allergens (promoted to §2, moved from old §3) -->
      <details>
        <summary>${this._t("summary_allergens")}</summary>
        <div class="section-helper">${this._t("helper_allergens")}</div>
        ${c.integration === "kleenex" || c.integration === "gpl" || c.integration === "gp"
          ? html`
              <!-- Category allergens (controlled by checkbox) -->
              <div class="allergen-section">
                <h4
                  style="margin: 8px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                >
                  ${this._t("allergens_header_category")}
                </h4>
                <div class="allergens-group">
                  ${["trees_cat", "grass_cat", "weeds_cat"].map((key) => {
                    const displayName = this._getAllergenDisplayName(key);
                    return html`
                      <ha-formfield .label=${displayName}>
                        <ha-checkbox
                          .checked=${c.allergens.includes(key)}
                          @change=${(e) =>
                            this._onAllergenToggle(key, e.target.checked)}
                        ></ha-checkbox>
                      </ha-formfield>
                    `;
                  })}
                </div>
              </div>

              <!-- Individual allergens -->
              <div class="allergen-section">
                <h4
                  style="margin: 16px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                >
                  ${this._t("allergens_header_specific")}
                </h4>
                <div class="allergens-group">
                  ${allergens
                    .filter(
                      (key) =>
                        !["trees_cat", "grass_cat", "weeds_cat"].includes(
                          key,
                        ),
                    )
                    .sort((a, b) => {
                      const displayA = this._getAllergenDisplayName(a);
                      const displayB = this._getAllergenDisplayName(b);
                      return displayA.localeCompare(displayB);
                    })
                    .map((key) => {
                      const displayName = this._getAllergenDisplayName(key);
                      return html`
                        <ha-formfield .label=${displayName}>
                          <ha-checkbox
                            .checked=${c.allergens.includes(key)}
                            @change=${(e) =>
                              this._onAllergenToggle(key, e.target.checked)}
                          ></ha-checkbox>
                        </ha-formfield>
                      `;
                    })}
                </div>
              </div>
            `
          : c.integration === "atmo"
            ? html`
                <!-- Atmo France: Summary / Pollen / Pollution blocks -->
                <div class="allergen-section">
                  <h4
                    style="margin: 8px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                  >
                    ${this._t("allergens_header_summary")}
                  </h4>
                  <div class="allergens-group">
                    ${["allergy_risk", "qualite_globale"]
                      .filter((key) => allergens.includes(key))
                      .map((key) => {
                        const displayName =
                          this._getAllergenDisplayName(key);
                        return html`
                          <ha-formfield .label=${displayName}>
                            <ha-checkbox
                              .checked=${c.allergens.includes(key)}
                              @change=${(e) =>
                                this._onAllergenToggle(
                                  key,
                                  e.target.checked,
                                )}
                            ></ha-checkbox>
                          </ha-formfield>
                        `;
                      })}
                  </div>
                </div>
                <div class="allergen-section">
                  <h4
                    style="margin: 16px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                  >
                    ${this._t("allergens_header_pollen")}
                  </h4>
                  <div class="allergens-group">
                    ${allergens
                      .filter(
                        (key) =>
                          !["allergy_risk", "qualite_globale", "pm25", "pm10", "ozone", "no2", "so2"].includes(key),
                      )
                      .sort((a, b) => {
                        const displayA = this._getAllergenDisplayName(a);
                        const displayB = this._getAllergenDisplayName(b);
                        return displayA.localeCompare(displayB);
                      })
                      .map((key) => {
                        const displayName =
                          this._getAllergenDisplayName(key);
                        return html`
                          <ha-formfield .label=${displayName}>
                            <ha-checkbox
                              .checked=${c.allergens.includes(key)}
                              @change=${(e) =>
                                this._onAllergenToggle(
                                  key,
                                  e.target.checked,
                                )}
                            ></ha-checkbox>
                          </ha-formfield>
                        `;
                      })}
                  </div>
                </div>
                <div class="allergen-section">
                  <h4
                    style="margin: 16px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                  >
                    ${this._t("allergens_header_pollution")}
                  </h4>
                  <div class="allergens-group">
                    ${["pm25", "pm10", "ozone", "no2", "so2"]
                      .filter((key) => allergens.includes(key))
                      .map((key) => {
                        const displayName =
                          this._getAllergenDisplayName(key);
                        return html`
                          <ha-formfield .label=${displayName}>
                            <ha-checkbox
                              .checked=${c.allergens.includes(key)}
                              @change=${(e) =>
                                this._onAllergenToggle(
                                  key,
                                  e.target.checked,
                                )}
                            ></ha-checkbox>
                          </ha-formfield>
                        `;
                      })}
                  </div>
                </div>
              `
            : html`
                <!-- Standard allergen display -->
                <div class="allergens-group">
                  ${allergens.map((key) => {
                    const displayName = this._getAllergenDisplayName(key);
                    return html`
                      <ha-formfield .label=${displayName}>
                        <ha-checkbox
                          .checked=${c.allergens.includes(key)}
                          @change=${(e) =>
                            this._onAllergenToggle(key, e.target.checked)}
                        ></ha-checkbox>
                      </ha-formfield>
                    `;
                  })}
                </div>
              `}
        <div class="preset-buttons">
          <ha-button
            @click=${() => {
              const allAllergens =
                c.integration === "kleenex"
                  ? [...allergens, "trees_cat", "grass_cat", "weeds_cat"]
                  : allergens;
              this._toggleSelectAllAllergens(allAllergens);
            }}
          >
            ${this._t("select_all_allergens")}
          </ha-button>
          ${c.integration === "atmo"
            ? html`
                <ha-button
                  @click=${() => {
                    const pollenKeys = allergens.filter(
                      (k) =>
                        !["allergy_risk", "qualite_globale", "pm25", "pm10", "ozone", "no2", "so2"].includes(k),
                    );
                    this._toggleAllergenSubset(pollenKeys);
                  }}
                >
                  ${this._t("select_all_pollen")}
                </ha-button>
                <ha-button
                  @click=${() => {
                    const pollutionKeys = ["pm25", "pm10", "ozone", "no2", "so2"].filter(
                      (k) => allergens.includes(k),
                    );
                    this._toggleAllergenSubset(pollutionKeys);
                  }}
                >
                  ${this._t("select_all_pollution")}
                </ha-button>
              `
            : ""}
        </div>
        <div class="slider-row">
          <div class="slider-text">${this._t("pollen_threshold")}</div>
          <div class="slider-value">${c.pollen_threshold}</div>
          <ha-slider
            min="${thresholdParams.min}"
            max="${thresholdParams.max}"
            step="${thresholdParams.step}"
            .value=${c.pollen_threshold}
            @input=${(e) =>
              this._updateConfig("pollen_threshold", Number(e.target.value))}
          ></ha-slider>
        </div>
        <ha-formfield label="${this._t("sort")}">
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: sortOptions,
              },
            }}
            .value=${c.sort}
            @value-changed=${(e) => {
              const v = e.detail?.value;
              if (v !== undefined) this._updateConfig("sort", v);
            }}
          ></ha-selector>
        </ha-formfield>
        ${c.integration === "kleenex" || c.integration === "gpl" || c.integration === "gp"
          ? html`
              <ha-formfield
                label="${this._t("sort_category_allergens_first")}"
              >
                <ha-checkbox
                  .checked=${c.sort_category_allergens_first}
                  @change=${(e) =>
                    this._updateConfig(
                      "sort_category_allergens_first",
                      e.target.checked,
                    )}
                ></ha-checkbox>
              </ha-formfield>
            `
          : ""}
        ${
          // Pin-to-top toggle. Hidden for the summary-block integrations
          // when the block is on, since pinning a row that has been promoted
          // to the block is a no-op (issue #222). PEU keeps it unconditionally.
          (c.integration === "peu" ||
            ((c.integration === "silam" ||
              c.integration === "atmo" ||
              c.integration === "gpl") &&
              !c.show_summary_block))
            ? html`
              <ha-formfield
                label="${c.integration === "silam"
                  ? this._t("index_top")
                  : this._t("allergy_risk_top")}"
              >
                <ha-checkbox
                  .checked=${c.integration === "silam"
                    ? c.index_top
                    : c.allergy_risk_top}
                  @change=${(e) =>
                    this._updateConfig(
                      c.integration === "silam"
                        ? "index_top"
                        : "allergy_risk_top",
                      e.target.checked,
                    )}
                ></ha-checkbox>
              </ha-formfield>
            `
          : ""}
        ${
          // Summary block (issue #222): opt-in overall-risk indicator above
          // the rows. Available for the three aggregate-risk integrations.
          c.integration === "silam" ||
          c.integration === "atmo" ||
          c.integration === "gpl"
            ? html`
              <ha-formfield label="${this._t("show_summary_block")}">
                <ha-checkbox
                  .checked=${c.show_summary_block === true}
                  @change=${(e) =>
                    this._updateConfig("show_summary_block", e.target.checked)}
                ></ha-checkbox>
              </ha-formfield>
              ${c.show_summary_block
                ? html`
                    <ha-formfield label="${this._t("show_summary_row")}">
                      <ha-checkbox
                        .checked=${c.show_summary_row === true}
                        @change=${(e) =>
                          this._updateConfig(
                            "show_summary_row",
                            e.target.checked,
                          )}
                      ></ha-checkbox>
                    </ha-formfield>
                    ${c.show_summary_row
                      ? html`
                          <ha-formfield
                            label="${this._t("show_summary_separator")}"
                          >
                            <ha-checkbox
                              .checked=${c.show_summary_separator !== false}
                              @change=${(e) =>
                                this._updateConfig(
                                  "show_summary_separator",
                                  e.target.checked,
                                )}
                            ></ha-checkbox>
                          </ha-formfield>
                        `
                      : ""}
                    ${c.integration === "gpl"
                      ? html`
                          <ha-formfield
                            label="${this._t("show_summary_top_types")}"
                          >
                            <ha-checkbox
                              .checked=${c.show_summary_top_types !== false}
                              @change=${(e) =>
                                this._updateConfig(
                                  "show_summary_top_types",
                                  e.target.checked,
                                )}
                            ></ha-checkbox>
                          </ha-formfield>
                          <ha-formfield
                            label="${this._t(
                              "show_summary_plants_in_season",
                            )}"
                          >
                            <ha-checkbox
                              .checked=${c.show_summary_plants_in_season !==
                              false}
                              @change=${(e) =>
                                this._updateConfig(
                                  "show_summary_plants_in_season",
                                  e.target.checked,
                                )}
                            ></ha-checkbox>
                          </ha-formfield>
                        `
                      : ""}
                  `
                : ""}
            `
          : ""}
        ${c.integration === "atmo"
          ? html`
              <ha-formfield
                label="${this._t("sort_pollution_block")}"
              >
                <ha-checkbox
                  .checked=${c.sort_pollution_block}
                  @change=${(e) =>
                    this._updateConfig(
                      "sort_pollution_block",
                      e.target.checked,
                    )}
                ></ha-checkbox>
              </ha-formfield>
              ${c.sort_pollution_block
                ? html`
                    <ha-formfield
                      label="${this._t("pollution_block_position")}"
                    >
                      <ha-selector
                        .hass=${this._hass}
                        .selector=${{
                          select: {
                            mode: "dropdown",
                            options: [
                              {
                                value: "bottom",
                                label: this._t("pollution_block_bottom"),
                              },
                              {
                                value: "top",
                                label: this._t("pollution_block_top"),
                              },
                            ],
                          },
                        }}
                        .value=${c.pollution_block_position || "bottom"}
                        @value-changed=${(e) => {
                          const v = e.detail?.value;
                          if (v !== undefined)
                            this._updateConfig("pollution_block_position", v);
                        }}
                      ></ha-selector>
                    </ha-formfield>
                    <ha-formfield
                      label="${this._t("show_block_separator")}"
                    >
                      <ha-checkbox
                        .checked=${c.show_block_separator}
                        @change=${(e) =>
                          this._updateConfig(
                            "show_block_separator",
                            e.target.checked,
                          )}
                      ></ha-checkbox>
                    </ha-formfield>
                  `
                : ""}
            `
          : ""}
      </details>
    `;
  }

  // ------------------------------------------------------------------
  // §5 Card appearance section
  // ------------------------------------------------------------------

  _renderAppearanceSection() {
    const c = this._editorConfig();
    return html`
      <!-- §5 Card appearance -->
      <details>
        <summary>${this._t("summary_card_appearance")}</summary>
        <div class="section-helper">${this._t("helper_card_appearance")}</div>
        <ha-formfield label="${this._t("background_color")}">
            <div style="display:flex; gap:8px; align-items:center;">
              <ha-textfield
                .value=${c.background_color || ""}
                placeholder="${this._t("background_color_placeholder") ||
                "#ffffff"}"
                @input=${(e) =>
                  this._updateConfig("background_color", e.target.value)}
                style="width: 120px;"
              ></ha-textfield>
              <input
                type="color"
                .value=${c.background_color &&
                /^#[0-9a-fA-F]{6}$/.test(c.background_color)
                  ? c.background_color
                  : "#ffffff"}
                @input=${(e) =>
                  this._updateConfig("background_color", e.target.value)}
                style="width: 36px; height: 32px; border: none; background: none; cursor: pointer;"
                title="${this._t("background_color_picker") || "Pick color"}"
              />
            </div>
          </ha-formfield>
          <ha-formfield label="${this._t("icon_size")}">
            <ha-slider
              min="16"
              max="128"
              step="1"
              .value=${c.icon_size ?? 48}
              @input=${(e) =>
                this._updateConfig("icon_size", Number(e.target.value))}
              style="width: 120px;"
            ></ha-slider>
            <ha-textfield
              .value=${c.icon_size ?? 48}
              type="number"
              min="16"
              max="128"
              step="1"
              @input=${(e) =>
                this._updateConfig("icon_size", Number(e.target.value))}
              style="width: 80px;"
            ></ha-textfield>
          </ha-formfield>
          <ha-formfield label="${this._t("text_size_ratio")}">
            <ha-slider
              min="0.5"
              max="2"
              step="0.05"
              .value=${c.text_size_ratio ?? 1}
              @input=${(e) =>
                this._updateConfig("text_size_ratio", Number(e.target.value))}
              style="width: 120px;"
            ></ha-slider>
            <ha-textfield
              type="number"
              .value=${c.text_size_ratio ?? 1}
              min="0.5"
              max="2"
              step="0.05"
              @input=${(e) =>
                this._updateConfig("text_size_ratio", Number(e.target.value))}
              style="width: 80px;"
            ></ha-textfield>
          </ha-formfield>
      </details>
    `;
  }
}
