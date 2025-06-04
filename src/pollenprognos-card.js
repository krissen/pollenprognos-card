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
    tapAction: {},
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
    this.tapAction = null;
  }

  static async getConfigElement() {
    await customElements.whenDefined("pollenprognos-card-editor");
    return document.createElement("pollenprognos-card-editor");
  }

  static getStubConfig() {
    return stubConfigPP;
  }

  setConfig(config) {
    // 1) Kopiera in användarens råa config
    this._userConfig = { ...config };
    // Stöd för tap_action via config
    this.tapAction = config.tap_action || null;

    // 2) Markera integration som explicit
    this._integrationExplicit =
      config.hasOwnProperty("integration") &&
      config.integration !== stubConfigPP.integration;

    // 3) -- NYTT! -- gör fallback redan här, för preview
    if (!this._integrationExplicit && this._hass) {
      const allIds = Object.keys(this._hass.states);
      const hasPP = allIds.some(
        (id) =>
          id.startsWith("sensor.pollen_") &&
          !id.startsWith("sensor.pollenflug_"),
      );
      const hasDWD = allIds.some((id) => id.startsWith("sensor.pollenflug_"));
      if (!hasPP && hasDWD) {
        this._userConfig.integration = "dwd";
        if (this.debug)
          console.debug("[PollenPrognos] fallback to DWD in setConfig");
      }
    }

    // 5) Återställ init-flaggan så att set hass körs om
    this._initDone = false;

    // 6) Om vi redan har hass tillgängligt, trigga set hass direkt
    if (this._hass) {
      this.hass = this._hass;
    }
  }

  set hass(hass) {
    this._hass = hass;
    const explicit = !!this._integrationExplicit;

    // 1) Hitta sensorer
    const ppStates = Object.keys(hass.states).filter(
      (id) =>
        id.startsWith("sensor.pollen_") && !id.startsWith("sensor.pollenflug_"),
    );
    const dwdStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.pollenflug_"),
    );

    // 2) Autodetektera integration (men respektera explicit)
    let integration = this._userConfig.integration;
    if (!explicit) {
      if (ppStates.length) {
        integration = "pp";
      } else if (dwdStates.length) {
        integration = "dwd";
        this._userConfig = {};
      }
    }

    // 3) Fallback: om vi valt PP men inga PP-sensorer finns, falla tillbaka till DWD
    if (
      !explicit &&
      integration === "pp" &&
      !ppStates.length &&
      dwdStates.length
    ) {
      integration = "dwd";
      this._userConfig = {};
    }

    // 4) Sammanslå stub + userConfig
    const baseStub = integration === "dwd" ? stubConfigDWD : stubConfigPP;
    const cfg = { ...baseStub, ...this._userConfig, integration };

    // 5) Auto-fyll date_locale första gången om användaren inte satt något
    if (!this._userConfig.hasOwnProperty("date_locale")) {
      const detectedLangCode = detectLang(hass, null);
      const localeTag =
        this._hass?.locale?.language ||
        this._hass?.language ||
        `${detectedLangCode}-${detectedLangCode.toUpperCase()}`;
      cfg.date_locale = localeTag;
      if (this.debug) {
        console.debug(
          "[PollenPrognos] auto-filling date_locale:",
          cfg.date_locale,
        );
      }
    }
    // 6) Automatisk region/stad
    if (integration === "dwd" && !cfg.region_id && dwdStates.length) {
      cfg.region_id = Array.from(
        new Set(dwdStates.map((id) => id.split("_").pop())),
      ).sort((a, b) => Number(a) - Number(b))[0];
    } else if (integration === "pp" && !cfg.city && ppStates.length) {
      cfg.city = ppStates[0]
        .slice("sensor.pollen_".length)
        .replace(/_[^_]+$/, "");
    }

    // 7) Spara config och header
    this.config = cfg;
    this.tapAction = cfg.tap_action || this.tapAction || null;
    if (typeof cfg.title === "string") {
      this.header = cfg.title;
    } else if (cfg.title === false) {
      this.header = "";
    } else {
      const loc =
        integration === "dwd"
          ? DWD_REGIONS[cfg.region_id] || cfg.region_id
          : PP_POSSIBLE_CITIES.find(
              (n) =>
                n
                  .toLowerCase()
                  .replace(/[åä]/g, "a")
                  .replace(/ö/g, "o")
                  .replace(/[-\s]/g, "_") === cfg.city,
            ) || cfg.city;
      this.header = `${this._t("card.header_prefix")} ${loc}`;
    }

    // 8) Hämta prognos
    const adapter = ADAPTERS[cfg.integration] || PP;
    adapter
      .fetchForecast(hass, cfg)
      .then((sensors) => {
        this.sensors = sensors;
        this.days_to_show = cfg.days_to_show;
        this.displayCols = Array.from(
          {
            length: cfg.show_empty_days
              ? cfg.days_to_show
              : sensors[0]?.days.length || 0,
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
          ${this.sensors.map((sensor) => {
            const txt = sensor.day0.state_text || "";
            const num = sensor.day0.state;
            // Bygg upp label-strängen
            let label = "";
            if (this.config.show_text_allergen) {
              label += this.config.allergens_abbreviated
                ? sensor.allergenShort
                : sensor.allergenCapitalized;
            }
            if (this.config.show_value_text && this.config.show_value_numeric) {
              if (label) label += ": ";
              label += `${txt} (${num})`;
            } else if (this.config.show_value_text) {
              if (label) label += ": ";
              label += txt;
            } else if (this.config.show_value_numeric) {
              if (label) label += " ";
              label += `(${num})`;
            }
            return html`
              <div class="sensor">
                <img
                  class="box"
                  src="${this._getImageSrc(
                    sensor.allergenReplaced,
                    sensor.day0.state,
                  )}"
                />
                ${label ? html`<span class="short-text">${label}</span>` : ""}
              </div>
            `;
          })}
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
                (i) => html`
                  <th style="font-weight: ${daysBold ? "bold" : "normal"}">
                    ${this.sensors[0].days[i]?.day || ""}
                  </th>
                `,
              )}
            </tr>
          </thead>

          ${this.sensors.map(
            (sensor) => html`
              <!-- Rad 1: bara ikoner -->
              <tr class="allergen-icon-row" valign="top">
                <td>
                  <img
                    class="allergen"
                    src="${this._getImageSrc(
                      sensor.allergenReplaced,
                      sensor.days[0]?.state,
                    )}"
                  />
                </td>
                ${cols.map(
                  (i) => html`
                    <td>
                      <div class="icon-wrapper">
                        <img
                          src="${this._getImageSrc("", sensor.days[i]?.state)}"
                        />
                        ${this.config.show_value_numeric_in_circle
                          ? html`<span class="circle-overlay">
                              ${sensor.days[i]?.state ?? ""}
                            </span>`
                          : ""}
                      </div>
                    </td>
                  `,
                )}
              </tr>

              <!-- Rad 2: allergennamn + text/nummer under dagarna -->
              ${this.config.show_text_allergen ||
              this.config.show_value_text ||
              this.config.show_value_numeric
                ? html`
                    <tr class="allergen-text-row" valign="top">
                      <td>
                        ${this.config.show_text_allergen
                          ? this.config.allergens_abbreviated
                            ? sensor.allergenShort
                            : sensor.allergenCapitalized
                          : ""}
                      </td>
                      ${cols.map((i) => {
                        const txt = sensor.days[i]?.state_text || "";
                        const num = sensor.days[i]?.state;
                        let content = "";
                        if (
                          this.config.show_value_text &&
                          this.config.show_value_numeric
                        ) {
                          content = `${txt} (${num})`;
                        } else if (this.config.show_value_text) {
                          content = txt;
                        } else if (this.config.show_value_numeric) {
                          content = String(num);
                        }
                        return html`<td>${content}</td>`;
                      })}
                    </tr>
                  `
                : ""}
            `,
          )}
        </table>
      </ha-card>
    `;
  }

  render() {
    if (!this.sensors.length) {
      const nameKey = `card.integration.${this.config.integration}`;
      const name = this._t(nameKey);
      return html`
        <ha-card
          @click="${this._handleTapAction}"
          style="cursor: ${this.tapAction ? "pointer" : "auto"}"
        >
          <div class="card-error">${this._t("card.error")} (${name})</div>
        </ha-card>
      `;
    }
    const cardContent = this.config.minimal
      ? this._renderMinimalHtml()
      : this._renderNormalHtml();
    return html`
      <ha-card
        @click="${this._handleTapAction}"
        style="cursor: ${this.tapAction ? "pointer" : "auto"}"
      >
        ${cardContent}
      </ha-card>
    `;
  }

  getCardSize() {
    return this.sensors.length + 1;
  }

  _handleTapAction(e) {
    if (!this.tapAction || !this._hass) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    const action = this.tapAction.type || "more-info";
    let entity = this.tapAction.entity || "camera.pollen";
    switch (action) {
      case "more-info":
        this._fire("hass-more-info", { entityId: entity });
        break;
      case "navigate":
        if (this.tapAction.navigation_path)
          window.history.pushState(null, "", this.tapAction.navigation_path);
        break;
      case "call-service":
        if (
          this.tapAction.service &&
          typeof this.tapAction.service === "string"
        ) {
          const [domain, service] = this.tapAction.service.split(".");
          this._hass.callService(
            domain,
            service,
            this.tapAction.service_data || {},
          );
        }
        break;
      // Fler fall vid behov
    }
  }

  _fire(type, detail, options) {
    const event = new Event(type, {
      bubbles: true,
      cancelable: false,
      composed: true,
      ...options,
    });
    event.detail = detail;
    this.dispatchEvent(event);
    return event;
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
        border-collapse: separate;
        border-spacing: 0 4px;
      }
      .icon-wrapper {
        position: relative;
        display: inline-block;
      }
      .icon-wrapper .circle-overlay {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 0.75rem;
        font-weight: bold;
        color: var(--primary-text-color);
        pointer-events: none;
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
