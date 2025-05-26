// src/pollenprognos-card.js
import { LitElement, html, css } from "lit";
import { images } from "./pollenprognos-images.js";
import { t, detectLang } from "./i18n.js";

// Adapter-moduler
import * as PP from "./adapters/pp.js";
import * as DWD from "./adapters/dwd.js";

// Stub-konfigurationer
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";

// Statiska konstanter
import {
  DWD_REGIONS,
  ALLERGEN_TRANSLATION,
  ADAPTERS as CONSTANT_ADAPTERS,
  PP_POSSIBLE_CITIES,
} from "./constants.js";

const ADAPTERS = CONSTANT_ADAPTERS; // { pp: PP, dwd: DWD }

class PollenPrognosCard extends LitElement {
  get debug() {
    return Boolean(this.config?.debug);
  }

  get _lang() {
    return detectLang(this._hass, this.config?.date_locale);
  }

  _t(key) {
    return t(key, this._lang);
  }

  static properties = {
    hass: { state: true },
    config: {},
    sensors: { state: true },
    days_to_show: { state: true },
    displayCols: { state: true },
    header: { state: true },
  };

  _getImageSrc(allergenReplaced, state) {
    const raw = Number(state);
    let scaled = raw;
    if (this.config.integration === "dwd") scaled = raw * 2;
    let lvl = Math.round(scaled);
    if (isNaN(lvl) || lvl < -1) lvl = -1;
    if (lvl > 6) lvl = 6;
    const key = ALLERGEN_TRANSLATION[allergenReplaced] || allergenReplaced;
    const specific = images[`${key}_${lvl}_png`];
    return specific || images[`${lvl}_png`];
  }

  constructor() {
    super();
    this.days_to_show = 4;
    this.displayCols = [];
    this.header = "";
    this._initDone = false;
    this._userConfig = {};
    this.sensors = [];
  }

  static async getConfigElement() {
    await customElements.whenDefined("pollenprognos-card-editor");
    return document.createElement("pollenprognos-card-editor");
  }

  static getStubConfig() {
    return stubConfigPP;
  }

  setConfig(config) {
    this._userConfig = { ...config };
    this._integrationExplicit =
      config.hasOwnProperty("integration") &&
      config.integration !== stubConfigPP.integration;
    this._initDone = false;
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    const explicit = !!this._integrationExplicit;
    const ppStates = Object.keys(hass.states).filter(
      (id) =>
        id.startsWith("sensor.pollen_") && !id.startsWith("sensor.pollenflug_"),
    );
    const dwdStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.pollenflug_"),
    );

    let integration = this._userConfig.integration;
    if (!explicit) {
      this._userConfig = {};
      if (ppStates.length) integration = "pp";
      else if (dwdStates.length) integration = "dwd";
    }
    if (this.debug) console.debug("[PollenPrognos] integration:", integration);
    if (
      !explicit &&
      integration === "pp" &&
      !ppStates.length &&
      dwdStates.length
    )
      integration = "dwd";

    const baseStub = integration === "dwd" ? stubConfigDWD : stubConfigPP;
    const cfg = { ...baseStub, ...this._userConfig, integration };

    if (integration === "dwd") {
      if (!explicit || !this._userConfig.allergens)
        cfg.allergens = stubConfigDWD.allergens;
      if (!explicit || !this._userConfig.days_to_show)
        cfg.days_to_show = stubConfigDWD.days_to_show;
      if (!explicit || !this._userConfig.date_locale)
        cfg.date_locale = stubConfigDWD.date_locale;
    }

    if (integration === "dwd" && !cfg.region_id && dwdStates.length) {
      cfg.region_id = Array.from(
        new Set(dwdStates.map((id) => id.split("_").pop())),
      ).sort((a, b) => Number(a) - Number(b))[0];
    } else if (integration === "pp" && !cfg.city && ppStates.length) {
      cfg.city = ppStates[0]
        .slice("sensor.pollen_".length) // rätta till slice-index
        .replace(/_[^_]+$/, "");
    }

    this.config = cfg;
    if (typeof cfg.title === "string") this.header = cfg.title;
    else if (cfg.title === false) this.header = "";
    else {
      let loc;
      if (cfg.integration === "dwd")
        loc = DWD_REGIONS[cfg.region_id] || cfg.region_id;
      else {
        const key = cfg.city;
        const pretty = PP_POSSIBLE_CITIES.find(
          (n) =>
            n
              .toLowerCase()
              .replace(/[åä]/g, "a")
              .replace(/ö/g, "o")
              .replace(/[-\s]/g, "_") === key,
        );
        loc = pretty || cfg.city;
      }
      this.header = `${this._t("card.header_prefix")} ${loc}`;
    }

    const adapter = ADAPTERS[cfg.integration] || PP;
    if (this.debug) console.debug("[PollenPrognos] final cfg", cfg);
    adapter
      .fetchForecast(hass, cfg)
      .then((sensors) => {
        this.sensors = sensors;
        this.days_to_show = cfg.days_to_show;
        this.displayCols = Array.from(
          {
            length: cfg.show_empty_days
              ? cfg.days_to_show
              : sensors[0]?.days?.length || 0,
          },
          (_, i) => i,
        );
        this.requestUpdate();
      })
      .catch((err) => console.error("Error fetching pollen forecast:", err));
  }

  _renderMinimalHtml() {
    return html`
      <ha-card>
        ${this.header ? html`<h1 class="header">${this.header}</h1>` : ""}
        <div class="flex-container">
          ${this.sensors.map(
            (sensor) => html`
              <div class="sensor">
                <img
                  class="box"
                  src="${this._getImageSrc(
                    sensor.allergenReplaced,
                    sensor.day0.state,
                  )}"
                />
                ${this.config.show_text || this.config.show_value
                  ? html`<span class="short-text">
                      ${this.config.show_text ? sensor.allergenShort : ""}
                      ${this.config.show_value
                        ? this.config.show_text
                          ? ` (${sensor.day0.state})`
                          : sensor.day0.state
                        : ""}
                    </span>`
                  : ""}
              </div>
            `,
          )}
        </div>
      </ha-card>
    `;
  }

  _renderNormalHtml() {
    const daysBold = Boolean(this.config.days_boldfaced);
    const cols = this.displayCols;

    return html`
      <ha-card>
        ${this.header ? html`<h1 class="header">${this.header}</h1>` : ""}
        <table class="forecast">
          <thead>
            <tr>
              <th></th>
              ${cols.map(
                (i) =>
                  html`<th style="font-weight: ${daysBold ? "bold" : "normal"}">
                    ${this.sensors[0][`day${i}`].day}
                  </th>`,
              )}
            </tr>
          </thead>

          ${this.sensors.map(
            (sensor) => html`
              <tr class="allergen" valign="top">
                <td>
                  <img
                    class="allergen"
                    src="${this._getImageSrc(
                      sensor.allergenReplaced,
                      sensor.day0.state,
                    )}"
                  />
                  ${this.config.show_value
                    ? html`<div class="value-text">${sensor.day0.state}</div>`
                    : ""}
                </td>
                ${cols.map(
                  (i) =>
                    html`<td>
                      <img
                        src="${this._getImageSrc("", sensor[`day${i}`].state)}"
                      />${this.config.show_value
                        ? html`<div class="value-text">
                            ${sensor[`day${i}`].state}
                          </div>`
                        : ""}
                    </td>`,
                )}
              </tr>
              <tr class="allergen" valign="top">
                <td>${sensor.allergenCapitalized}</td>
                ${cols.map(
                  (i) =>
                    html`<td>
                      ${this.config.show_text
                        ? html`<p>${sensor[`day${i}`].state_text}</p>`
                        : ""}
                    </td>`,
                )}
              </tr>
            `,
          )}
        </table>
      </ha-card>
    `;
  }

  render() {
    if (!this.sensors.length) {
      const name =
        this.config.integration === "dwd" ? "DWD Pollenflug" : "PollenPrognos";
      return html`<ha-card
        ><div class="card-error">
          ${this._t("card.error")} (${name})
        </div></ha-card
      >`;
    }
    return this.config.minimal
      ? this._renderMinimalHtml()
      : this._renderNormalHtml();
  }

  getCardSize() {
    return this.sensors.length + 1;
  }

  static get styles() {
    return css`
      .header {
        margin: 0;
        padding: 4px 16px 12px;
        @apply --paper-font-headline;
        line-height: 40px;
        color: var(--primary-text-color);
      }
      .forecast {
        width: 100%;
        padding: 7px;
      }
      td {
        padding: 1px;
        text-align: center;
        width: 100px;
        font-size: smaller;
      }
      img.allergen {
        width: 40px;
        height: 40px;
      }
      img {
        width: 50px;
        height: 50px;
      }
      .flex-container {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-evenly;
        align-items: center;
        padding: 16px;
      }
      .sensor {
        flex: 1;
        min-width: 20%;
        text-align: center;
      }
      .short-text {
        display: block;
      }
      .card-error {
        padding: 16px;
        color: var(--error-text-color, #b71c1c);
        font-weight: 500;
        line-height: 1.4;
      }
      .value-text {
        font-size: smaller;
        margin-top: 4px;
        display: block;
        text-align: center;
      }
    `;
  }
}

customElements.define("pollenprognos-card", PollenPrognosCard);
export default PollenPrognosCard;
