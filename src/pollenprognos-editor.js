// src/pollenprognos-editor.js

import { LitElement, html, css } from "lit";

// Stub-config från adaptrar (för att editorn vet vilka fält som finns)
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";

// Rena konstanter från constants.js
import {
  TRANSLATIONS as EDITOR_LABELS,
  DWD_REGIONS,
  PP_POSSIBLE_CITIES,
} from "./constants.js";

// Recursive merge utility
const deepMerge = (target, source) => {
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

class PollenPrognosCardEditor extends LitElement {
  get debug() {
    return Boolean(this._config.debug);
  }

  static get properties() {
    return {
      _config: { type: Object },
      hass: { type: Object },
      installedCities: { type: Array },
      installedRegions: { type: Array },
      installedRegionIds: { type: Array },
      _initDone: { type: Boolean },
    };
  }

  /** Hämta tvåbokstavskod, fallback ’en’ */
  get _lang() {
    // HA:s språk, annars browser
    const ha = this._hass?.language?.slice(0, 2);
    const nav = navigator.language?.slice(0, 2);
    return (ha || nav || "en").toLowerCase();
  }

  /** Översätt nyckel till korrekt label */
  _t(key) {
    return (EDITOR_LABELS[this._lang] || EDITOR_LABELS.en)[key] || key;
  }

  constructor() {
    super();
    // 1) Rå-config från användar-YAML/editor
    this._userConfig = {};
    this._integrationExplicit = false;
    // 2) Den verkliga state som editorn ritar upp
    this._config = deepMerge(stubConfigPP, {});
    // 3) Listor och flagga för första gång-autodetect
    this.installedCities = [];
    this.installedRegionIds = [];
    this._initDone = false;
  }

  setConfig(config) {
    // Logga inkommande värden
    if (this.debug)
      console.debug("[Editor] setConfig – userConfig in:", config);

    // 1) Ackumulera nya värden över de som redan fanns
    this._userConfig = deepMerge(this._userConfig, config);
    this._integrationExplicit = this._userConfig.hasOwnProperty("integration");

    // 2) Bestäm integration: explicit > tidigare > fallback 'pp'
    const integration =
      this._userConfig.integration || this._config?.integration || "pp";

    // 3) Hämta rätt stub och slå ihop med samlad userConfig
    const base = integration === "dwd" ? stubConfigDWD : stubConfigPP;
    this._config = deepMerge(base, this._userConfig);

    // 4) Sätt alltid rätt type för preview
    this._config.type = "custom:pollenprognos-card";

    // 5) Nollställ init-flagga så auto-detect körs på nästa hass
    this._initDone = false;

    // Logga slutgiltigt resultat
    if (this.debug)
      console.debug("[Editor] setConfig – merged _config:", this._config);

    // *Ny kod*: meddela Home Assistant att config ändrats så att preview ritas om
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }),
    );

    this.requestUpdate();
  }

  set hass(hass) {
    if (this.debug)
      console.debug("[Editor] hass setter – before initDone:", {
        initDone: this._initDone,
        userConfig: this._userConfig,
        config: this._config,
      });

    this._hass = hass;

    const explicit = this._integrationExplicit;
    const ppStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.pollen_"),
    );
    const dwdStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.pollenflug_"),
    );

    // 1) Auto‐detect integration bara första gången om användaren INTE satt den explicit
    if (!this._initDone && !explicit) {
      if (ppStates.length) this._config.integration = "pp";
      else if (dwdStates.length) this._config.integration = "dwd";
    }

    // 2) Bygg listor för valbara regioner och städer
    const regionIds = Array.from(
      new Set(dwdStates.map((id) => id.split("_").pop())),
    ).sort((a, b) => Number(a) - Number(b));
    this.installedRegionIds = regionIds;

    const ppKeys = ppStates.map((id) =>
      id.slice("sensor.pollen_".length).replace(/_[^_]+$/, ""),
    );
    const uniqCities = Array.from(new Set(ppKeys));
    const keyFor = (name) =>
      name
        .toLowerCase()
        .replace(/[åä]/g, "a")
        .replace(/ö/g, "o")
        .replace(/[-\s]/g, "_");
    this.installedCities = PP_POSSIBLE_CITIES.filter((city) =>
      uniqCities.includes(keyFor(city)),
    ).sort((a, b) => a.localeCompare(b));

    // 3) Auto‐välj första region eller stad om användaren inte specificerat själv
    if (!this._initDone) {
      if (
        this._config.integration === "dwd" &&
        !this._userConfig.region_id &&
        regionIds.length
      ) {
        this._config.region_id = regionIds[0];
      }
      if (
        this._config.integration === "pp" &&
        !this._userConfig.city &&
        this.installedCities.length
      ) {
        this._config.city = this.installedCities[0];
      }
    }

    this._initDone = true;
    if (this.debug)
      console.debug("[Editor] hass setter – after initDone:", {
        initDone: this._initDone,
        userConfig: this._userConfig,
        config: this._config,
      });

    this.requestUpdate();
  }

  _onAllergenToggle(allergen, checked) {
    const s = new Set(this._config.allergens);
    checked ? s.add(allergen) : s.delete(allergen);
    this._updateConfig("allergens", [...s]);
  }

  _updateConfig(prop, value) {
    if (this.debug)
      console.debug("[Editor] _updateConfig – prop:", prop, "value:", value);

    // 1) Uppdatera userConfig
    const newUser = { ...this._userConfig };
    if (value === undefined) {
      delete newUser[prop];
    } else {
      newUser[prop] = value;
    }
    this._userConfig = newUser;

    let cfg;
    if (prop === "integration") {
      const newInt = value;
      const oldInt = this._config.integration;

      // 2) Rensa stad/region
      if (newInt === "dwd") {
        delete this._userConfig.city;
      } else {
        delete this._userConfig.region_id;
      }

      // 3) Rensa allergens så att stub används för nya integrationen
      delete this._userConfig.allergens;

      // 4) Rensa locale och days_to_show om de är stub för gamla integrationen
      const oldStub = oldInt === "dwd" ? stubConfigDWD : stubConfigPP;
      ["date_locale", "days_to_show"].forEach((key) => {
        if (
          Object.prototype.hasOwnProperty.call(this._userConfig, key) &&
          this._userConfig[key] === oldStub[key]
        ) {
          delete this._userConfig[key];
        }
      });

      // 5) Rensa bort DWD-phrases vid dwd→pp
      if (newInt === "pp" && this._userConfig.phrases) {
        const dwdP = stubConfigDWD.phrases;
        const userP = { ...this._userConfig.phrases };
        ["full", "short", "levels", "days", "no_information"].forEach((cat) => {
          if (!Object.prototype.hasOwnProperty.call(userP, cat)) return;
          if (cat === "no_information") {
            if (userP.no_information === dwdP.no_information) {
              delete userP.no_information;
            }
          } else if (Array.isArray(dwdP[cat])) {
            const arr = Array.isArray(userP.levels) ? [...userP.levels] : [];
            dwdP.levels.forEach((stubVal, i) => {
              if (arr[i] === stubVal) delete arr[i];
            });
            const filtered = arr.filter((v) => v !== undefined);
            if (filtered.length) userP.levels = filtered;
            else delete userP.levels;
          } else {
            const cloneObj = { ...userP[cat] };
            Object.entries(dwdP[cat]).forEach(([key, stubVal]) => {
              if (cloneObj[key] === stubVal) delete cloneObj[key];
            });
            if (Object.keys(cloneObj).length) {
              userP[cat] = cloneObj;
            } else {
              delete userP[cat];
            }
          }
        });
        this._userConfig.phrases = Object.keys(userP).length
          ? userP
          : undefined;
      }

      // 6) Bygg upp ny config från stub + userConfig
      const base = newInt === "dwd" ? stubConfigDWD : stubConfigPP;
      cfg = deepMerge(base, this._userConfig);
      cfg.integration = newInt;
    } else {
      // 7) För andra fält: bygg på senaste config
      cfg = { ...this._config, [prop]: value };
    }

    // 8) Alltid se till korrekt kort-typ
    cfg.type = this._config.type || "custom:pollenprognos-card";

    // 9) Spara och logga
    this._config = cfg;
    if (this.debug)
      console.debug(
        "[Editor] _updateConfig – userConfig now:",
        this._userConfig,
      );
    if (this.debug)
      console.debug("[Editor] _updateConfig – merged _config:", this._config);

    // 10) Triggera preview-uppdatering
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const c = this._config;
    const t = (key) => this._t(key);

    // pick the right “master list” of allergens
    const available =
      c.integration === "dwd"
        ? stubConfigDWD.allergens
        : stubConfigPP.allergens;

    return html`
      <div class="card-config">
        <!-- Integration -->
        <ha-formfield label="${t("integration")}">
          <ha-select
            .value=${c.integration}
            @selected=${(e) =>
              this._updateConfig("integration", e.target.value)}
            @closed=${(e) => e.stopPropagation()}
          >
            <mwc-list-item value="pp">PollenPrognos</mwc-list-item>
            <mwc-list-item value="dwd">DWD Pollenflug</mwc-list-item>
          </ha-select>
        </ha-formfield>

        <!-- Stad (PP) eller Region (DWD) -->
        ${c.integration === "pp"
          ? html`
              <ha-formfield label="${t("city")}">
                <ha-select
                  .value=${c.city || ""}
                  @selected=${(e) => this._updateConfig("city", e.target.value)}
                  @closed=${(e) => e.stopPropagation()}
                >
                  ${this.installedCities.map(
                    (city) => html`
                      <mwc-list-item .value=${city}>${city}</mwc-list-item>
                    `,
                  )}
                </ha-select>
              </ha-formfield>
            `
          : html`
              <ha-formfield label="${t("region_id")}">
                <ha-select
                  .value=${c.region_id || ""}
                  @selected=${(e) =>
                    this._updateConfig("region_id", e.target.value)}
                  @closed=${(e) => e.stopPropagation()}
                >
                  ${this.installedRegionIds.map(
                    (id) => html`
                      <mwc-list-item .value=${id}>
                        ${id} — ${DWD_REGIONS[id] || id}
                      </mwc-list-item>
                    `,
                  )}
                </ha-select>
              </ha-formfield>
            `}

        <!-- Titel -->
        <ha-formfield label="${t("title")}">
          <ha-textfield
            .value=${c.title || ""}
            placeholder="${t("title")}"
            @input=${(e) => {
              // e.target.value är "" när användaren raderat allt
              const v = e.target.value;
              this._updateConfig("title", v === "" ? undefined : v);
            }}
          ></ha-textfield>
        </ha-formfield>

        <!-- Layout switches -->
        <ha-formfield label="${t("minimal")}">
          <ha-switch
            .checked=${c.minimal}
            @change=${(e) => this._updateConfig("minimal", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${t("show_text")}">
          <ha-switch
            .checked=${c.show_text}
            @change=${(e) => this._updateConfig("show_text", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${t("show_empty_days")}">
          <ha-switch
            .checked=${c.show_empty_days}
            @change=${(e) =>
              this._updateConfig("show_empty_days", e.target.checked)}
          ></ha-switch>
        </ha-formfield>

        <!-- Day settings -->
        <ha-formfield label="${t("days_relative")}">
          <ha-switch
            .checked=${c.days_relative}
            @change=${(e) =>
              this._updateConfig("days_relative", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${t("days_abbreviated")}">
          <ha-switch
            .checked=${c.days_abbreviated}
            @change=${(e) =>
              this._updateConfig("days_abbreviated", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${t("days_uppercase")}">
          <ha-switch
            .checked=${c.days_uppercase}
            @change=${(e) =>
              this._updateConfig("days_uppercase", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${t("days_boldfaced")}">
          <ha-switch
            .checked=${c.days_boldfaced}
            @change=${(e) =>
              this._updateConfig("days_boldfaced", e.target.checked)}
          ></ha-switch>
        </ha-formfield>

        <!-- Days to show slider -->
        <ha-formfield label="${t("days_to_show")} ${c.days_to_show}">
          <ha-slider
            min="0"
            max="6"
            step="1"
            .value=${c.days_to_show}
            @change=${(e) =>
              this._updateConfig("days_to_show", Number(e.target.value))}
          ></ha-slider>
        </ha-formfield>

        <!-- Pollen threshold -->
        <ha-formfield label="${t("pollen_threshold")} ${c.pollen_threshold}">
          <ha-slider
            min="0"
            max="6"
            step="1"
            .value=${c.pollen_threshold}
            @change=${(e) =>
              this._updateConfig("pollen_threshold", Number(e.target.value))}
          ></ha-slider>
        </ha-formfield>

        <!-- Sort order -->
        <ha-formfield label="${t("sort")}">
          <ha-select
            .value=${c.sort}
            @selected=${(e) => this._updateConfig("sort", e.target.value)}
            @closed=${(e) => e.stopPropagation()}
          >
            ${[
              "value_ascending",
              "value_descending",
              "name_ascending",
              "name_descending",
            ].map(
              (o) => html`
                <mwc-list-item .value=${o}
                  >${o.replace("_", " ")}</mwc-list-item
                >
              `,
            )}
          </ha-select>
        </ha-formfield>

        <!-- Date locale -->
        <ha-formfield label="${t("locale")}">
          <ha-textfield
            .value=${c.date_locale}
            @input=${(e) => this._updateConfig("date_locale", e.target.value)}
          ></ha-textfield>
        </ha-formfield>

        <!-- Allergens -->
        <details>
          <summary>${t("allergens")}</summary>
          <div class="allergens-group">
            ${available.map(
              (allergenKey) => html`
                <ha-formfield .label=${allergenKey}>
                  <ha-checkbox
                    .checked=${c.allergens.includes(allergenKey)}
                    @change=${(e) =>
                      this._onAllergenToggle(allergenKey, e.target.checked)}
                  ></ha-checkbox>
                </ha-formfield>
              `,
            )}
          </div>
        </details>

        <!-- Phrases sections -->
        <h3>${t("phrases")}</h3>
        <details>
          <summary>${t("phrases_full")}</summary>
          ${available.map(
            (a) => html`
              <ha-formfield .label=${a}>
                <ha-textfield
                  .value=${c.phrases.full[a] || ""}
                  @input=${(e) => {
                    const p = {
                      ...c.phrases,
                      full: { ...c.phrases.full, [a]: e.target.value },
                    };
                    this._updateConfig("phrases", p);
                  }}
                ></ha-textfield>
              </ha-formfield>
            `,
          )}
        </details>

        <details>
          <summary>${t("phrases_short")}</summary>
          ${available.map(
            (a) => html`
              <ha-formfield .label=${a}>
                <ha-textfield
                  .value=${c.phrases.short[a] || ""}
                  @input=${(e) => {
                    const p = {
                      ...c.phrases,
                      short: { ...c.phrases.short, [a]: e.target.value },
                    };
                    this._updateConfig("phrases", p);
                  }}
                ></ha-textfield>
              </ha-formfield>
            `,
          )}
        </details>

        <details>
          <summary>${t("phrases_levels")}</summary>
          ${Array.from(
            { length: 7 },
            (_, i) => html`
              <ha-formfield .label=${i}>
                <ha-textfield
                  .value=${c.phrases.levels[i] || ""}
                  @input=${(e) => {
                    const lv = [...(c.phrases.levels || [])];
                    lv[i] = e.target.value;
                    const p = { ...c.phrases, levels: lv };
                    this._updateConfig("phrases", p);
                  }}
                ></ha-textfield>
              </ha-formfield>
            `,
          )}
        </details>

        <details>
          <summary>${t("phrases_days")}</summary>
          ${[0, 1, 2].map(
            (i) => html`
              <ha-formfield .label=${i}>
                <ha-textfield
                  .value=${c.phrases.days[i] || ""}
                  @input=${(e) => {
                    const dd = { ...(c.phrases.days || {}) };
                    dd[i] = e.target.value;
                    const p = { ...c.phrases, days: dd };
                    this._updateConfig("phrases", p);
                  }}
                ></ha-textfield>
              </ha-formfield>
            `,
          )}
        </details>

        <ha-formfield label="${t("no_information")}">
          <ha-textfield
            .value=${c.phrases.no_information || ""}
            @input=${(e) => {
              const p = { ...c.phrases, no_information: e.target.value };
              this._updateConfig("phrases", p);
            }}
          ></ha-textfield>
        </ha-formfield>

        <!-- Debug -->
        <ha-formfield label="${t("debug")}">
          <ha-switch
            .checked=${c.debug}
            @change=${(e) => this._updateConfig("debug", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
      </div>
    `;
  }

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
      details summary {
        cursor: pointer;
        font-weight: bold;
        margin: 8px 0;
      }
      ha-slider {
        width: 100%;
      }
      ha-select {
        width: 100%;
        --mdc-theme-primary: var(--primary-color);
      }
    `;
  }
}

customElements.define("pollenprognos-card-editor", PollenPrognosCardEditor);
