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
//   - _inheritState() — computed inherit/gap locals for §6/§7
//   - _renderIntegrationSection() — §1 Integration & Location
//   - _renderAllergensSection()   — §2 Allergens
//   - _renderAppearanceSection()  — §5 Card appearance
//   - _renderAllergenIconsSection() — §6 Allergen icons
//   - _renderLevelCirclesSection()  — §7 Level circles
//   - _renderIconInRingSection()    — §8 Icon in ring
//   - _applyVisualConfigSideEffects(prop, value, config) — shared visual side-effects
//   - _resetAll() — reset to stub defaults while preserving location keys
//
// Both editors extend this class. Section methods read from this._config
// and call this._updateConfig / this._hass — both editors must expose those.
//
// _applyVisualConfigSideEffects CONTRACT:
//   - Receives (prop, value, config) where config is a shallow copy of the
//     current _config.
//   - Returns { config, handled } where config is the (possibly mutated) config
//     and handled=true means the caller should dispatch config-changed immediately
//     and return (skipping the normal merge path).
//   - The caller is responsible for writing config back to this._config,
//     updating this._userConfig (if used), and dispatching config-changed.
//   - The method does NOT touch this._config or this._userConfig directly.
//     It operates purely on the passed-in config object and returns it.
//   - The icon_in_ring branch needs the session flag this._thicknessAutoShifted;
//     the caller must maintain that flag based on the returned state.

import { LitElement, html } from "lit";
import { t, detectLang, SUPPORTED_LOCALES } from "../i18n.js";
import { normalize } from "../utils/normalize.js";
import { slugify } from "../utils/slugify.js";
import {
  LEVELS_DEFAULTS,
  convertStrokeWidthToGap,
  NORMAL_DEFAULT_THICKNESS,
  ICON_IN_RING_DEFAULT_THICKNESS,
} from "../utils/levels-defaults.js";
import { getAllAdapterIds } from "../adapter-registry.js";
import {
  discoverDwdSensors,
  DWD_ENTITY_ID_RE,
} from "../adapters/dwd.js";
import {
  discoverPeuSensors,
  extractPeuLocationSlugFromEntityId,
} from "../adapters/peu.js";
import {
  discoverAtmoSensors,
  findAtmoLocationBySlug,
} from "../adapters/atmo.js";
import {
  discoverGplSensors,
  discoverGplAllergens,
} from "../adapters/gpl/index.js";
import {
  discoverGpSensors,
  discoverGpAllergens,
} from "../adapters/gp/index.js";
import { discoverMswSensors } from "../adapters/msw.js";
import {
  discoverSilamSensors,
  resolveDiscoveredLocation,
} from "../utils/silam.js";
import { findLocationBySlug } from "../utils/adapter-helpers.js";
import { numLevelsForIntegration } from "../utils/level-counts.js";
import { allergenListForIntegration } from "./integration-allergens.js";
import {
  PP_POSSIBLE_CITIES,
  DWD_REGIONS,
  toCanonicalAllergenKey,
} from "../constants.js";
import {
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
    return allergenListForIntegration(c.integration, {
      installedGplPlants: this.installedGplPlants || [],
      installedGpPlants: this.installedGpPlants || [],
    });
  }

  /**
   * Returns the number of pollen levels for the current integration.
   * Equivalent to the render()-local `numLevels` variable in the card editor.
   */
  _currentNumLevels() {
    const c = this._editorConfig();
    return numLevelsForIntegration(c.integration);
  }

  /**
   * Whether the current integration exposes a raw measurement (concentration /
   * index) distinct from the calculated level, so the numeric_value_raw
   * level-vs-raw toggle is meaningful. PP/DWD/Atmo/GPL/GP/MSW have no distinct
   * raw value. Mirrors the resolveNumericValue contract.
   */
  _integrationHasRawValue(integration) {
    return ["plu", "peu", "silam", "kleenex"].includes(integration);
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
  // Inherit-state helper (used by §6 and §7 section methods)
  // ------------------------------------------------------------------

  /**
   * Computes the three locals that §6 and §7 templates depend on.
   * Keeps the computation in one place so both sections stay in sync.
   *
   * @returns {{ inheritMode: string, gapSynced: boolean, gapDisabled: boolean }}
   */
  _inheritState() {
    const c = this._editorConfig();
    const inheritMode = c.levels_inherit_mode || "inherit_allergen";
    const gapSynced = c.allergen_levels_gap_synced ?? true;
    const gapDisabled = inheritMode === "inherit_allergen" && gapSynced;
    return { inheritMode, gapSynced, gapDisabled };
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
          ${this._showCardSizeControls()
            ? html`
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
                      this._updateConfig(
                        "text_size_ratio",
                        Number(e.target.value),
                      )}
                    style="width: 120px;"
                  ></ha-slider>
                  <ha-textfield
                    type="number"
                    .value=${c.text_size_ratio ?? 1}
                    min="0.5"
                    max="2"
                    step="0.05"
                    @input=${(e) =>
                      this._updateConfig(
                        "text_size_ratio",
                        Number(e.target.value),
                      )}
                    style="width: 80px;"
                  ></ha-textfield>
                </ha-formfield>
              `
            : ""}
          ${this._renderAppearanceExtras()}
      </details>
    `;
  }

  // Whether the Card appearance section shows the card-only size controls
  // (icon_size, text_size_ratio). The badge editor overrides this to false
  // because badge_scale governs the whole badge size instead.
  _showCardSizeControls() {
    return true;
  }

  // Extra controls appended inside the Card appearance section. Empty on the
  // base; the badge editor overrides it to add badge_scale and the label
  // controls, so badge size lives in "Card appearance" like the card's size.
  _renderAppearanceExtras() {
    return html``;
  }

  // ------------------------------------------------------------------
  // §6 Allergen icons section
  // ------------------------------------------------------------------

  _renderAllergenIconsSection() {
    const c = this._editorConfig();
    return html`
      <!-- §6 Allergen icons -->
      <details>
        <summary>${this._t("summary_allergen_icons")}</summary>
        <div class="section-helper">${this._t("helper_allergen_icons")}</div>
        <ha-formfield
          label="${this._t("allergen_color_mode") ||
          "Allergen Color Mode"}"
        >
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: [
                  {
                    value: "default_colors",
                    label:
                      this._t("allergen_color_default_colors") ||
                      "Default Colors",
                  },
                  {
                    value: "custom",
                    label:
                      this._t("allergen_color_custom") || "Custom Colors",
                  },
                ],
              },
            }}
            .value=${c.allergen_color_mode || "default_colors"}
            @value-changed=${(e) => {
              const v = e.detail?.value;
              if (v !== undefined)
                this._updateConfig("allergen_color_mode", v);
            }}
          ></ha-selector>
        </ha-formfield>

            ${c.allergen_color_mode === "custom"
              ? html`
                  <ha-formfield
                    label="${this._t("allergen_colors") ||
                    "Allergen Colors (by Level)"}"
                  >
                    <div
                      style="display: flex; flex-direction: column; gap: 8px;"
                    >
                      ${(() => {
                        const defaultAllergenColors =
                          LEVELS_DEFAULTS.allergen_colors;
                        const allergenColors =
                          c.allergen_colors || defaultAllergenColors;

                        return allergenColors.map(
                          (col, i) => html`
                            <div
                              style="display: flex; align-items: center; gap: 8px;"
                            >
                              <span style="min-width: 60px;"
                                >Level ${i}:</span
                              >
                              <input
                                type="color"
                                .value=${(() => {
                                  if (i === 0 && col.includes("rgba")) {
                                    return "#c8c8c8";
                                  }
                                  return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                                    col,
                                  )
                                    ? col
                                    : "#000000";
                                })()}
                                @input=${(e) => {
                                  const newColors = [...allergenColors];
                                  newColors[i] = e.target.value;
                                  this._updateConfig(
                                    "allergen_colors",
                                    newColors,
                                  );
                                }}
                                style="width: 28px; height: 28px; border: none; background: none;"
                              />
                              <ha-textfield
                                .value=${col}
                                placeholder="${i === 0
                                  ? this._t("allergen_empty_placeholder") ||
                                    "rgba(200,200,200,0.15)"
                                  : this._t("allergen_colors_placeholder") ||
                                    "#ffcc00"}"
                                @input=${(e) => {
                                  const newColors = [...allergenColors];
                                  newColors[i] = e.target.value;
                                  this._updateConfig(
                                    "allergen_colors",
                                    newColors,
                                  );
                                }}
                                style="width: 120px;"
                              ></ha-textfield>
                              <ha-button
                                outlined
                                title="${this._t("allergen_colors_reset") ||
                                "Reset"}"
                                @click=${() => {
                                  const newColors = [...allergenColors];
                                  newColors[i] =
                                    LEVELS_DEFAULTS.allergen_colors[i];
                                  this._updateConfig(
                                    "allergen_colors",
                                    newColors,
                                  );
                                }}
                                style="margin-left: 8px;"
                                >↺</ha-button
                              >
                            </div>
                          `,
                        );
                      })()}
                    </div>
                  </ha-formfield>

                  <ha-formfield
                    label="${this._t("no_allergens_color") ||
                    "No Allergens Color"}"
                  >
                    <div
                      style="display: flex; align-items: center; gap: 8px;"
                    >
                      <input
                        type="color"
                        .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                          c.no_allergens_color ||
                            LEVELS_DEFAULTS.no_allergens_color,
                        )
                          ? c.no_allergens_color ||
                            LEVELS_DEFAULTS.no_allergens_color
                          : "#a9cfe0"}
                        @input=${(e) =>
                          this._updateConfig(
                            "no_allergens_color",
                            e.target.value,
                          )}
                        style="width: 28px; height: 28px; border: none; background: none;"
                      />
                      <ha-textfield
                        .value=${c.no_allergens_color ||
                        LEVELS_DEFAULTS.no_allergens_color}
                        placeholder="${this._t(
                          "no_allergens_color_placeholder",
                        ) || "#a9cfe0"}"
                        @input=${(e) =>
                          this._updateConfig(
                            "no_allergens_color",
                            e.target.value,
                          )}
                        style="width: 100px;"
                      ></ha-textfield>
                      <ha-button
                        outlined
                        title="${this._t("no_allergens_color_reset") ||
                        "Reset"}"
                        @click=${() =>
                          this._updateConfig(
                            "no_allergens_color",
                            LEVELS_DEFAULTS.no_allergens_color,
                          )}
                        style="margin-left: 8px;"
                        >↺</ha-button
                      >
                    </div>
                  </ha-formfield>
                `
              : ""}
        <ha-formfield
          label="${this._t("allergen_outline_color")}"
        >
          <div style="display: flex; align-items: center; gap: 8px;">
            <input
              type="color"
              .value=${(() => {
                const color =
                  c.allergen_outline_color ||
                  LEVELS_DEFAULTS.levels_gap_color;
                if (color.includes("rgba")) {
                  return "#c8c8c8";
                }
                return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color)
                  ? color
                  : "#c8c8c8";
              })()}
              @input=${(e) =>
                this._updateConfig(
                  "allergen_outline_color",
                  e.target.value,
                )}
              style="width: 28px; height: 28px; border: none; background: none;"
            />
            <ha-textfield
              .value=${c.allergen_outline_color ||
              LEVELS_DEFAULTS.levels_gap_color}
              placeholder="${this._t(
                "allergen_outline_placeholder",
              ) || "rgba(200,200,200,1)"}"
              @input=${(e) =>
                this._updateConfig(
                  "allergen_outline_color",
                  e.target.value,
                )}
              style="width: 100px;"
            ></ha-textfield>
            <ha-button
              outlined
              title="${this._t("allergen_outline_reset") || "Reset"}"
              @click=${() =>
                this._updateConfig(
                  "allergen_outline_color",
                  LEVELS_DEFAULTS.levels_gap_color,
                )}
              style="margin-left: 8px;"
              >↺</ha-button
            >
          </div>
        </ha-formfield>
        <ha-formfield
          label="${this._t("allergen_stroke_color_synced")}"
        >
          <ha-checkbox
            .checked=${c.allergen_stroke_color_synced ?? true}
            @change=${(e) =>
              this._updateConfig(
                "allergen_stroke_color_synced",
                e.target.checked,
              )}
          ></ha-checkbox>
        </ha-formfield>
        <ha-formfield
          label="${this._t("allergen_stroke_width")}"
        >
          <ha-slider
            min="0"
            max="150"
            step="5"
            .value=${c.allergen_stroke_width ?? LEVELS_DEFAULTS.allergen_stroke_width}
            @input=${(e) => {
              const value = Number(e.target.value);
              this._updateConfig("allergen_stroke_width", value);
              const { inheritMode, gapSynced } = this._inheritState();
              if (inheritMode === "inherit_allergen" && gapSynced) {
                const levelGap = convertStrokeWidthToGap(value);
                this._updateConfig("levels_gap", levelGap);
              }
            }}
            style="width: 120px;"
          ></ha-slider>
          <ha-textfield
            type="number"
            min="0"
            max="150"
            step="5"
            .value=${c.allergen_stroke_width ?? LEVELS_DEFAULTS.allergen_stroke_width}
            @input=${(e) => {
              const value = e.target.value === "" ? LEVELS_DEFAULTS.allergen_stroke_width : Number(e.target.value);
              this._updateConfig("allergen_stroke_width", value);
              const { inheritMode, gapSynced } = this._inheritState();
              if (inheritMode === "inherit_allergen" && gapSynced) {
                const levelGap = convertStrokeWidthToGap(value);
                this._updateConfig("levels_gap", levelGap);
              }
            }}
            style="width: 80px;"
          ></ha-textfield>
          <ha-button
            outlined
            title="${this._t("allergen_stroke_width_reset") || "Reset"}"
            @click=${() =>
              this._updateConfig(
                "allergen_stroke_width",
                LEVELS_DEFAULTS.allergen_stroke_width,
              )}
            style="margin-left: 8px;"
            >↺</ha-button
          >
        </ha-formfield>
        <div class="field-helper">${this._t("helper_allergen_stroke_width")}</div>
      </details>
    `;
  }

  // ------------------------------------------------------------------
  // §7 Level circles section
  // ------------------------------------------------------------------

  // Whether the Level circles section shows the numeric-value-in-circle toggle.
  // The card editor uses it; the badge editor hides it because badge_visual
  // (ring_value) is the single source of truth there — the switch would be a
  // false affordance (the element re-derives show_value_numeric_in_circle).
  _showNumericInCircleToggle() {
    return true;
  }

  _renderLevelCirclesSection() {
    const c = this._editorConfig();
    const { inheritMode, gapSynced, gapDisabled } = this._inheritState();
    return html`
      <!-- §7 Level circles -->
      <details>
        <summary>${this._t("summary_level_circles")}</summary>
        <div class="section-helper">${this._t("helper_level_circles")}</div>
        <ha-formfield
          label="${this._t("levels_inherit_mode")}"
        >
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: [
                  {
                    value: "inherit_allergen",
                    label:
                      this._t("levels_inherit_allergen") ||
                      "Inherit from Allergen Colors",
                  },
                  {
                    value: "custom",
                    label:
                      this._t("levels_custom") || "Use Custom Level Colors",
                  },
                ],
              },
            }}
            .value=${c.levels_inherit_mode || "inherit_allergen"}
            @value-changed=${(e) => {
              const v = e.detail?.value;
              if (v !== undefined) this._updateConfig("levels_inherit_mode", v);
            }}
          ></ha-selector>
        </ha-formfield>

        ${inheritMode === "inherit_allergen"
          ? html`
              <ha-formfield
                label="${this._t("allergen_levels_gap_synced")}"
              >
                <ha-checkbox
                  .checked=${c.allergen_levels_gap_synced ?? true}
                  @change=${(e) =>
                    this._updateConfig(
                      "allergen_levels_gap_synced",
                      e.target.checked,
                    )}
                ></ha-checkbox>
              </ha-formfield>
              <div class="field-helper">${this._t("helper_allergen_levels_gap_synced")}</div>
            `
          : ""}

        ${inheritMode === "custom"
          ? html`
              <ha-formfield label="${this._t("levels_colors")}">
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${c.levels_colors.map(
                    (col, i) => html`
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <input
                          type="color"
                          .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(col)
                            ? col
                            : "#000000"}
                          @input=${(e) => {
                            const newColors = [...c.levels_colors];
                            newColors[i] = e.target.value;
                            this._updateConfig("levels_colors", newColors);
                          }}
                          style="width: 28px; height: 28px; border: none; background: none;"
                        />
                        <ha-textfield
                          .value=${col}
                          placeholder="${this._t("levels_colors_placeholder")}"
                          @input=${(e) => {
                            const newColors = [...c.levels_colors];
                            newColors[i] = e.target.value;
                            this._updateConfig("levels_colors", newColors);
                          }}
                          style="width: 100px;"
                        ></ha-textfield>
                        <ha-button
                          outlined
                          title="${this._t("levels_reset")}"
                          @click=${() => {
                            const newColors = [...c.levels_colors];
                            newColors[i] = LEVELS_DEFAULTS.levels_colors[i];
                            this._updateConfig("levels_colors", newColors);
                          }}
                          style="margin-left: 8px;"
                          >↺</ha-button
                        >
                      </div>
                    `,
                  )}
                </div>
              </ha-formfield>

              <ha-formfield label="${this._t("levels_empty_color")}">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <input
                    type="color"
                    .value=${(() => {
                      const color =
                        c.levels_empty_color ||
                        LEVELS_DEFAULTS.levels_empty_color;
                      if (color.includes("rgba")) {
                        return "#c8c8c8";
                      }
                      return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color)
                        ? color
                        : "#c8c8c8";
                    })()}
                    @input=${(e) =>
                      this._updateConfig("levels_empty_color", e.target.value)}
                    style="width: 28px; height: 28px; border: none; background: none;"
                  />
                  <ha-textfield
                    .value=${c.levels_empty_color}
                    placeholder="${this._t("levels_colors_placeholder")}"
                    @input=${(e) =>
                      this._updateConfig("levels_empty_color", e.target.value)}
                    style="width: 100px;"
                  ></ha-textfield>
                  <ha-button
                    outlined
                    title="${this._t("levels_reset")}"
                    @click=${() =>
                      this._updateConfig(
                        "levels_empty_color",
                        LEVELS_DEFAULTS.levels_empty_color,
                      )}
                    style="margin-left: 8px;"
                    >↺</ha-button
                  >
                </div>
              </ha-formfield>
            `
          : ""}

        <ha-formfield label="${this._t("levels_thickness")}">
          <ha-slider
            min="10"
            max="90"
            step="1"
            .value=${c.levels_thickness}
            @input=${(e) =>
              this._updateConfig("levels_thickness", Number(e.target.value))}
            style="width: 120px;"
          ></ha-slider>
          <ha-textfield
            type="number"
            .value=${c.levels_thickness}
            @input=${(e) =>
              this._updateConfig("levels_thickness", Number(e.target.value))}
            style="width: 80px;"
          ></ha-textfield>
          <ha-button
            outlined
            title="${this._t("levels_reset")}"
            @click=${() =>
              this._updateConfig("levels_thickness", LEVELS_DEFAULTS.levels_thickness)}
            style="margin-left: 8px;"
            >↺</ha-button
          >
        </ha-formfield>

        <ha-formfield
          label="${this._t("levels_gap")}"
          .disabled=${gapDisabled}
        >
          <ha-slider
            min="0"
            max="20"
            step="1"
            .value=${c.levels_gap}
            .disabled=${gapDisabled}
            @input=${(e) =>
              this._updateConfig("levels_gap", Number(e.target.value))}
            style="width: 120px;"
          ></ha-slider>
          <ha-textfield
            type="number"
            .value=${c.levels_gap}
            .disabled=${gapDisabled}
            @input=${(e) =>
              this._updateConfig("levels_gap", Number(e.target.value))}
            style="width: 80px;"
          ></ha-textfield>
          <ha-button
            outlined
            title="${this._t("levels_reset")}"
            .disabled=${gapDisabled}
            @click=${() =>
              this._updateConfig("levels_gap", LEVELS_DEFAULTS.levels_gap)}
            style="margin-left: 8px;"
            >↺</ha-button
          >
        </ha-formfield>
        <div class="field-helper">
          ${gapDisabled
            ? this._t("helper_levels_gap_synced")
            : this._t("helper_levels_gap_unsynced")}
        </div>

        ${inheritMode === "custom" || !gapSynced
          ? html`
              <ha-formfield label="${this._t("levels_gap_color")}">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <input
                    type="color"
                    .value=${(() => {
                      const color =
                        c.levels_gap_color || LEVELS_DEFAULTS.levels_gap_color;
                      if (color.includes("rgba")) {
                        return "#c8c8c8";
                      }
                      return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color)
                        ? color
                        : "#c8c8c8";
                    })()}
                    @input=${(e) =>
                      this._updateConfig("levels_gap_color", e.target.value)}
                    style="width: 28px; height: 28px; border: none; background: none;"
                  />
                  <ha-textfield
                    .value=${c.levels_gap_color}
                    placeholder="${this._t("levels_colors_placeholder")}"
                    @input=${(e) =>
                      this._updateConfig("levels_gap_color", e.target.value)}
                    style="width: 100px;"
                  ></ha-textfield>
                  <ha-button
                    outlined
                    title="${this._t("levels_reset")}"
                    @click=${() =>
                      this._updateConfig(
                        "levels_gap_color",
                        LEVELS_DEFAULTS.levels_gap_color,
                      )}
                    style="margin-left: 8px;"
                    >↺</ha-button
                  >
                </div>
              </ha-formfield>
            `
          : ""}

        ${this._showNumericInCircleToggle()
          ? html`
              <ha-formfield
                label="${this._t("show_value_numeric_in_circle")}"
              >
                <ha-switch
                  .checked=${c.show_value_numeric_in_circle}
                  @change=${(e) =>
                    this._updateConfig(
                      "show_value_numeric_in_circle",
                      e.target.checked,
                    )}
                ></ha-switch>
              </ha-formfield>
              <div class="field-helper">
                ${this._t("helper_show_value_numeric_in_circle")}
              </div>
            `
          : ""}

        ${this._integrationHasRawValue(c.integration)
          ? html`
              <ha-formfield label="${this._t("numeric_value_raw")}">
                <ha-switch
                  .checked=${c.numeric_value_raw === true ||
                  (c.integration === "peu" &&
                    c.numeric_state_raw_risk === true)}
                  @change=${(e) => {
                    const on = e.target.checked;
                    this._updateConfig("numeric_value_raw", on);
                    // Migrate off the legacy PEU alias so the two cannot
                    // diverge (turning the switch off must not leave
                    // numeric_state_raw_risk: true silently showing raw).
                    if (c.numeric_state_raw_risk === true) {
                      this._updateConfig("numeric_state_raw_risk", false);
                    }
                  }}
                ></ha-switch>
              </ha-formfield>
              <div class="field-helper">
                ${this._t("helper_numeric_value_raw")}
              </div>
            `
          : ""}

        <ha-formfield label="${this._t("levels_text_weight")}">
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: [
                  { value: "normal", label: "Normal" },
                  { value: "500", label: "Medium" },
                  { value: "bold", label: "Bold" },
                ],
              },
            }}
            .value=${c.levels_text_weight || "normal"}
            @value-changed=${(e) => {
              const v = e.detail?.value;
              if (v !== undefined) this._updateConfig("levels_text_weight", v);
            }}
          ></ha-selector>
        </ha-formfield>

        <ha-formfield label="${this._t("levels_text_size")}">
          <ha-slider
            min="0.1"
            max="0.5"
            step="0.05"
            .value=${c.levels_text_size || 0.3}
            @input=${(e) =>
              this._updateConfig("levels_text_size", Number(e.target.value))}
            style="width: 120px;"
          ></ha-slider>
          <ha-textfield
            type="number"
            .value=${c.levels_text_size || 0.3}
            @input=${(e) =>
              this._updateConfig("levels_text_size", Number(e.target.value))}
            style="width: 80px;"
          ></ha-textfield>
        </ha-formfield>

        <ha-formfield label="${this._t("levels_icon_ratio")}">
          <ha-slider
            min="0.1"
            max="2"
            step="0.05"
            .value=${c.levels_icon_ratio || 1}
            @input=${(e) =>
              this._updateConfig("levels_icon_ratio", Number(e.target.value))}
            style="width: 120px;"
          ></ha-slider>
          <ha-textfield
            type="number"
            .value=${c.levels_icon_ratio || 1}
            @input=${(e) =>
              this._updateConfig("levels_icon_ratio", Number(e.target.value))}
            style="width: 80px;"
          ></ha-textfield>
        </ha-formfield>

        <ha-formfield label="${this._t("levels_text_color")}">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input
              type="color"
              .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                c.levels_text_color || "",
              )
                ? c.levels_text_color
                : "#000000"}
              @input=${(e) =>
                this._updateConfig("levels_text_color", e.target.value)}
              style="width: 28px; height: 28px; border: none; background: none;"
            />
            <ha-textfield
              .value=${c.levels_text_color || ""}
              placeholder="var(--primary-text-color)"
              @input=${(e) =>
                this._updateConfig("levels_text_color", e.target.value)}
              style="width: 100px;"
            ></ha-textfield>
          </div>
        </ha-formfield>
      </details>
    `;
  }

  // ------------------------------------------------------------------
  // §8 Icon in ring section
  // ------------------------------------------------------------------

  // Whether the icon-in-ring on/off checkbox is shown. The card editor uses it
  // to toggle icon_in_ring; the badge editor hides it because badge_visual is
  // the single source of truth there — a checkbox would be a false affordance
  // (the element re-derives icon_in_ring) and its side effect could silently
  // clobber a user-set levels_thickness.
  _showIconInRingToggle() {
    return true;
  }

  _renderIconInRingSection() {
    const c = this._editorConfig();
    return html`
      <!-- §8 Icon in ring -->
      <details>
        <summary>${this._t("summary_icon_in_ring")}</summary>
        <div class="section-helper">${this._t("helper_icon_in_ring")}</div>
        ${this._showIconInRingToggle()
          ? html`
              <ha-formfield label="${this._t("icon_in_ring")}">
                <ha-checkbox
                  .checked=${c.icon_in_ring === true}
                  @change=${(e) =>
                    this._updateConfig("icon_in_ring", e.target.checked)}
                ></ha-checkbox>
              </ha-formfield>
            `
          : ""}
        <ha-formfield
          label="${this._t("icon_in_ring_size_ratio")}"
        >
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-slider
              min="0.2"
              max="0.9"
              step="0.05"
              .value=${c.icon_in_ring_size_ratio ??
              LEVELS_DEFAULTS.icon_in_ring_size_ratio}
              @input=${(e) =>
                this._updateConfig(
                  "icon_in_ring_size_ratio",
                  Number(e.target.value),
                )}
            ></ha-slider>
            <ha-textfield
              type="number"
              min="0.2"
              max="0.9"
              step="0.05"
              .value=${c.icon_in_ring_size_ratio ??
              LEVELS_DEFAULTS.icon_in_ring_size_ratio}
              @change=${(e) =>
                this._updateConfig(
                  "icon_in_ring_size_ratio",
                  Number(e.target.value),
                )}
              style="width: 80px;"
            ></ha-textfield>
          </div>
        </ha-formfield>
        <ha-formfield
          label="${this._t("icon_in_ring_color_mode")}"
        >
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: [
                  {
                    value: "static",
                    label:
                      this._t("icon_in_ring_color_static") ||
                      "Static color",
                  },
                  {
                    value: "follow_level",
                    label:
                      this._t("icon_in_ring_color_follow") ||
                      "Follow level color",
                  },
                ],
              },
            }}
            .value=${c.icon_in_ring_color_mode || "static"}
            @value-changed=${(e) => {
              const v = e.detail?.value;
              if (v !== undefined)
                this._updateConfig("icon_in_ring_color_mode", v);
            }}
          ></ha-selector>
        </ha-formfield>
        ${(c.icon_in_ring_color_mode || "static") === "static"
          ? html`
              <ha-formfield
                label="${this._t("icon_in_ring_static_color")}"
              >
                <div style="display: flex; align-items: center; gap: 8px;">
                  <input
                    type="color"
                    .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                      c.icon_in_ring_static_color || "",
                    )
                      ? c.icon_in_ring_static_color
                      : "#000000"}
                    @input=${(e) =>
                      this._updateConfig(
                        "icon_in_ring_static_color",
                        e.target.value,
                      )}
                    style="width: 28px; height: 28px; border: none; background: none;"
                  />
                  <ha-textfield
                    .value=${c.icon_in_ring_static_color || ""}
                    placeholder="${LEVELS_DEFAULTS.icon_in_ring_static_color}"
                    @input=${(e) =>
                      this._updateConfig(
                        "icon_in_ring_static_color",
                        e.target.value,
                      )}
                    style="width: 100px;"
                  ></ha-textfield>
                </div>
              </ha-formfield>
            `
          : ""}
      </details>
    `;
  }

  // Presentation hooks for the phrases section: subclasses that do not display
  // level names or day labels (e.g. the badge) override these to false.
  _showPhraseShort() {
    return true;
  }

  _showPhraseLevels() {
    return true;
  }

  _showPhraseDays() {
    return true;
  }

  /**
   * Seed config.phrases with the localized default names for the chosen
   * language (the "Apply translations" action), and set date_locale to it.
   * Shared by the card and badge editors. Uses _currentAllergens() so the
   * GPL/GP installed plants are included via the editor's discovered list.
   */
  _resetPhrases(lang) {
    if (this.debug) console.debug("[Editor] resetPhrases - lang:", lang);
    this._updateConfig("date_locale", lang);

    const integration = this._config?.integration;
    const rawKeys = this._currentAllergens();

    const full = {};
    const short = {};
    rawKeys.forEach((raw) => {
      const normKey = normalize(raw);
      const canonKey = toCanonicalAllergenKey(normKey);
      // SILAM's aggregate uses the user-facing 'index' name, not 'allergy_risk'.
      const transKey = normKey === "index" ? "index" : canonKey;
      full[raw] = t(`editor.phrases_full.${transKey}`, lang);
      short[raw] = t(`editor.phrases_short.${transKey}`, lang);
    });

    const numLevels = this._currentNumLevels();
    // 5-level integrations (MSW, PEU, Kleenex) use the scale-specific severity
    // labels rather than the first five of the 7-level palette.
    const levelKeyPrefix =
      integration === "msw" ||
      integration === "peu" ||
      integration === "kleenex"
        ? "editor.phrases_levels5"
        : "editor.phrases_levels";
    const levels = Array.from({ length: numLevels }, (_, i) =>
      t(`${levelKeyPrefix}.${i}`, lang),
    );

    const days = {
      0: t(`editor.phrases_days.0`, lang),
      1: t(`editor.phrases_days.1`, lang),
      2: t(`editor.phrases_days.2`, lang),
    };

    this._updateConfig("phrases", {
      full,
      short,
      levels,
      days,
      no_information: t("editor.no_information", lang),
    });
  }

  /**
   * The "Translations & strings" section (locale override + custom phrases),
   * shared by the card and badge editors. Level-name and day-label subsections
   * are gated by _showPhraseLevels() / _showPhraseDays() so the badge (which
   * renders neither) can hide them. Null-safe on config.phrases.
   */
  _renderPhrasesSection() {
    const c = this._editorConfig();
    const allergens = this._currentAllergens();
    const numLevels = this._currentNumLevels();
    // Type-guard every phrases subfield: YAML can supply a wrong type (e.g.
    // phrases.levels as an object), which would otherwise break rendering.
    const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
    const phrases = isObj(c.phrases) ? c.phrases : {};
    const full = isObj(phrases.full) ? phrases.full : {};
    const short = isObj(phrases.short) ? phrases.short : {};
    const levels = Array.isArray(phrases.levels) ? phrases.levels : [];
    const days = isObj(phrases.days) ? phrases.days : {};
    // Default the language selector from the config's date_locale (not just the
    // HA language) so an existing per-locale override is reflected before the
    // user touches the dropdown. Guard date_locale to a string: detectLang
    // calls .slice() on it, so a non-string YAML value would throw here.
    const dateLocale =
      typeof c.date_locale === "string" ? c.date_locale : undefined;
    const selectedLang =
      this._selectedPhraseLang || detectLang(this._hass, dateLocale);
    return html`
      <!-- Translations & strings -->
      <details>
        <summary>${this._t("summary_translation_and_strings")}</summary>
        <div class="section-helper">
          ${this._t("helper_translation_and_strings")}
        </div>
        <ha-formfield label="${this._t("locale")}">
          <ha-textfield
            .value=${c.date_locale || ""}
            @input=${(e) => this._updateConfig("date_locale", e.target.value)}
          ></ha-textfield>
        </ha-formfield>
        <h3>${this._t("phrases")}</h3>
        <div class="preset-buttons">
          <ha-formfield label="${this._t("phrases_translate_all")}">
            <ha-selector
              .hass=${this._hass}
              .selector=${{
                select: {
                  mode: "dropdown",
                  options: SUPPORTED_LOCALES.map((code) => ({
                    value: code,
                    label:
                      new Intl.DisplayNames([this._lang], {
                        type: "language",
                      }).of(code) || code,
                  })),
                },
              }}
              .value=${selectedLang}
              @value-changed=${(e) => {
                const v = e.detail?.value;
                if (v !== undefined) this._selectedPhraseLang = v;
              }}
            ></ha-selector>
          </ha-formfield>
          <ha-button
            outlined
            @click=${() =>
              this._resetPhrases(this._selectedPhraseLang || selectedLang)}
          >
            ${this._t("phrases_apply")}
          </ha-button>
        </div>
        <details>
          <summary>${this._t("phrases_full")}</summary>
          ${allergens.map(
            (a) => html`
              <ha-formfield .label=${a}>
                <ha-textfield
                  .value=${full[a] || ""}
                  @input=${(e) => {
                    const p = {
                      ...phrases,
                      full: { ...full, [a]: e.target.value },
                    };
                    this._updateConfig("phrases", p);
                  }}
                ></ha-textfield>
              </ha-formfield>
            `,
          )}
        </details>
        ${this._showPhraseShort()
          ? html`
              <details>
                <summary>${this._t("phrases_short")}</summary>
                ${allergens.map(
                  (a) => html`
                    <ha-formfield .label=${a}>
                      <ha-textfield
                        .value=${short[a] || ""}
                        @input=${(e) => {
                          const p = {
                            ...phrases,
                            short: { ...short, [a]: e.target.value },
                          };
                          this._updateConfig("phrases", p);
                        }}
                      ></ha-textfield>
                    </ha-formfield>
                  `,
                )}
              </details>
            `
          : ""}
        ${this._showPhraseLevels()
          ? html`
              <details>
                <summary>${this._t("phrases_levels")}</summary>
                ${Array.from({ length: numLevels }, (_, i) => i).map(
                  (i) => html`
                    <ha-formfield .label=${i}>
                      <ha-textfield
                        .value=${levels[i] || ""}
                        @input=${(e) => {
                          const lv = [...levels];
                          lv[i] = e.target.value;
                          this._updateConfig("phrases", {
                            ...phrases,
                            levels: lv,
                          });
                        }}
                      ></ha-textfield>
                    </ha-formfield>
                  `,
                )}
              </details>
            `
          : ""}
        ${this._showPhraseDays()
          ? html`
              <details>
                <summary>${this._t("phrases_days")}</summary>
                ${[0, 1, 2].map(
                  (i) => html`
                    <ha-formfield .label=${i}>
                      <ha-textfield
                        .value=${days[i] || ""}
                        @input=${(e) => {
                          const dd = { ...days, [i]: e.target.value };
                          this._updateConfig("phrases", {
                            ...phrases,
                            days: dd,
                          });
                        }}
                      ></ha-textfield>
                    </ha-formfield>
                  `,
                )}
              </details>
            `
          : ""}
        <ha-formfield label="${this._t("no_information")}">
          <ha-textfield
            .value=${phrases.no_information || ""}
            @input=${(e) =>
              this._updateConfig("phrases", {
                ...phrases,
                no_information: e.target.value,
              })}
          ></ha-textfield>
        </ha-formfield>
      </details>
    `;
  }

  // ------------------------------------------------------------------
  // Shared visual config side-effects
  // ------------------------------------------------------------------

  /**
   * Applies visual config side-effects shared between the card editor and
   * the badge editor. Operates on a passed-in config object (shallow copy
   * of _config) and returns the (possibly mutated) config plus a `handled`
   * flag.
   *
   * When handled=true, the caller MUST dispatch config-changed immediately
   * and return (skip normal merge). The caller owns _config, _userConfig,
   * and this._thicknessAutoShifted — this method does not touch them.
   *
   * @param {string} prop
   * @param {*} value
   * @param {object} config  Shallow copy of current _config to mutate
   * @returns {{ config: object, handled: boolean, thicknessAutoShifted: boolean|null }}
   *   thicknessAutoShifted is non-null only when the icon_in_ring branch fires;
   *   null means leave this._thicknessAutoShifted unchanged.
   */
  _applyVisualConfigSideEffects(prop, value, config) {
    // icon_in_ring auto-toggle for levels_thickness.
    if (prop === "icon_in_ring") {
      const prev = config.icon_in_ring === true;
      const next = value === true;
      if (prev !== next) {
        const currentThickness =
          config.levels_thickness ?? LEVELS_DEFAULTS.levels_thickness;
        const newConfig = { ...config, icon_in_ring: next };
        let thicknessAutoShifted = this._thicknessAutoShifted || false;
        if (next && currentThickness === NORMAL_DEFAULT_THICKNESS) {
          newConfig.levels_thickness = ICON_IN_RING_DEFAULT_THICKNESS;
          thicknessAutoShifted = true;
        } else if (
          !next &&
          thicknessAutoShifted &&
          currentThickness === ICON_IN_RING_DEFAULT_THICKNESS
        ) {
          newConfig.levels_thickness = NORMAL_DEFAULT_THICKNESS;
          thicknessAutoShifted = false;
        }
        return { config: newConfig, handled: true, thicknessAutoShifted };
      }
    }

    // levels_inherit_mode: reset/sync related color properties.
    if (prop === "levels_inherit_mode") {
      if (value === "custom" && config.levels_inherit_mode !== "custom") {
        const newConfig = {
          ...config,
          levels_inherit_mode: value,
          levels_gap: LEVELS_DEFAULTS.levels_gap,
          levels_colors: LEVELS_DEFAULTS.levels_colors,
          levels_empty_color: LEVELS_DEFAULTS.levels_empty_color,
          levels_gap_color: LEVELS_DEFAULTS.levels_gap_color,
        };
        return { config: newConfig, handled: true, thicknessAutoShifted: null };
      } else if (
        value === "inherit_allergen" &&
        config.levels_inherit_mode === "custom"
      ) {
        const currentStrokeWidth =
          config.allergen_stroke_width || LEVELS_DEFAULTS.allergen_stroke_width;
        const syncedGap = convertStrokeWidthToGap(currentStrokeWidth);
        const currentAllergenColors =
          config.allergen_colors || LEVELS_DEFAULTS.allergen_colors;
        const syncedEmptyColor =
          currentAllergenColors[0] || LEVELS_DEFAULTS.levels_empty_color;
        const newConfig = {
          ...config,
          levels_inherit_mode: value,
          levels_gap: syncedGap,
          levels_empty_color: syncedEmptyColor,
          allergen_levels_gap_synced: true,
        };
        return { config: newConfig, handled: true, thicknessAutoShifted: null };
      }
    }

    // allergen_colors: sync levels_empty_color when in inherit mode.
    if (prop === "allergen_colors" && Array.isArray(value)) {
      const newConfig = { ...config, allergen_colors: value };
      if (
        (config.levels_inherit_mode || "inherit_allergen") === "inherit_allergen"
      ) {
        if (value[0]) {
          newConfig.levels_empty_color = value[0];
        }
      }
      return { config: newConfig, handled: true, thicknessAutoShifted: null };
    }

    // allergen_stroke_width reset: sync levels_gap.
    if (
      prop === "allergen_stroke_width" &&
      value === LEVELS_DEFAULTS.allergen_stroke_width
    ) {
      const newConfig = { ...config, allergen_stroke_width: value };
      if (
        (config.levels_inherit_mode || "inherit_allergen") ===
          "inherit_allergen" &&
        (config.allergen_levels_gap_synced ?? true)
      ) {
        const levelGap = convertStrokeWidthToGap(value);
        newConfig.levels_gap = levelGap;
      }
      return { config: newConfig, handled: true, thicknessAutoShifted: null };
    }

    // Level visual property resets: ensure chart re-rendering.
    if (
      (prop === "levels_thickness" ||
        prop === "levels_gap" ||
        prop === "levels_colors" ||
        prop === "levels_empty_color" ||
        prop === "levels_gap_color") &&
      value === LEVELS_DEFAULTS[prop]
    ) {
      const newConfig = { ...config, [prop]: value };
      return { config: newConfig, handled: true, thicknessAutoShifted: null };
    }

    // allergen_color_mode reset to default_colors.
    if (
      prop === "allergen_color_mode" &&
      value === "default_colors" &&
      config.allergen_color_mode === "custom"
    ) {
      const newConfig = {
        ...config,
        allergen_color_mode: value,
        allergen_colors: LEVELS_DEFAULTS.allergen_colors,
        allergen_outline_color: LEVELS_DEFAULTS.levels_gap_color,
        no_allergens_color: LEVELS_DEFAULTS.no_allergens_color,
      };
      return { config: newConfig, handled: true, thicknessAutoShifted: null };
    }

    // levels_thickness manual edit after auto-shift: signal caller to clear the flag.
    if (prop === "levels_thickness" && this._thicknessAutoShifted) {
      return { config, handled: false, thicknessAutoShifted: false };
    }

    return { config, handled: false, thicknessAutoShifted: null };
  }

  // ------------------------------------------------------------------
  // Reset to stub defaults
  // ------------------------------------------------------------------

  /**
   * Resets the card/badge config to stub defaults while preserving location
   * identity keys (city, location, region_id, entity_prefix, entity_suffix,
   * entity_weather, type). Both editors inherit this; the badge editor works
   * correctly because badge_* keys are absent from the stub and will revert
   * to undefined (the badge element re-applies its own defaults on setConfig).
   */
  _resetAll() {
    const KEEP = [
      "city", "location", "region_id",
      "entity_prefix", "entity_suffix", "entity_weather",
      "type",
    ];
    const integration = this._config?.integration ?? "pp";
    const preserved = {};
    for (const k of KEEP) {
      if (this._config?.[k] !== undefined) preserved[k] = this._config[k];
    }
    // Reset = keep only the identity/location keys plus integration; drop every
    // other key so defaults take over. Build the persisted config from the
    // preserved keys ONLY (no stub spread) — baking stub defaults back in would
    // re-bloat the saved YAML and, for the badge, defeat the user-set-only
    // persistence that lets a present value count as deliberate.
    const fresh = { ...preserved, integration };
    // setConfig (subclass) normalises and re-seeds its own state for rendering.
    this.setConfig(fresh);
    // Dispatch the clean reset config (identity keys only), not the stub-merged
    // _config used for rendering.
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: fresh },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
