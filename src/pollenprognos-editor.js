// src/pollenprognos-editor.js
import { LitElement, html, css } from "lit";
import { t, detectLang } from "./i18n.js";

// Stub-config från adaptrar (så att editorn vet vilka fält som finns)
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";

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

  _resetAll() {
    if (this.debug) console.debug("[Editor] resetAll");
    this._userConfig = {};
    this.setConfig({ integration: this._config.integration });
  }

  _resetPhrases(lang) {
    if (this.debug) console.debug("[Editor] resetPhrases – lang:", lang);
    if (lang === "sv") {
      this._updateConfig("date_locale", "sv-SE");
      const keys =
        this._config.integration === "dwd"
          ? stubConfigDWD.allergens
          : this._config.allergens;
      const full = {};
      keys.forEach((k) => (full[k] = t(`editor.phrase_full.${k}`, lang)));
      this._updateConfig("phrases", {
        full,
        short: {},
        levels: Array.from({ length: 7 }, (_, i) =>
          t(`editor.phrases_levels.${i}`, lang),
        ),
        days: {
          0: t("editor.phrases_days.0", lang),
          1: t("editor.phrases_days.1", lang),
          2: t("editor.phrases_days.2", lang),
        },
        no_information: t("editor.no_information", lang),
      });
      return;
    }
    if (lang === "en") {
      this._updateConfig("date_locale", "en-US");
      this._updateConfig("phrases", {
        full: {},
        short: {},
        levels: Array.from({ length: 7 }, (_, i) =>
          t(`editor.phrases_levels.${i}`, lang),
        ),
        days: {
          0: t("editor.phrases_days.0", lang),
          1: t("editor.phrases_days.1", lang),
          2: t("editor.phrases_days.2", lang),
        },
        no_information: t("editor.no_information", lang),
      });
      return;
    }
    if (lang === "de") {
      this._updateConfig("date_locale", "de-DE");
      const keys =
        this._config.integration === "dwd"
          ? stubConfigDWD.allergens
          : this._config.allergens;
      const full = {};
      keys.forEach((k) => (full[k] = t(`editor.phrase_full.${k}`, lang)));
      this._updateConfig("phrases", {
        full,
        short: {},
        levels: Array.from({ length: 7 }, (_, i) =>
          t(`editor.phrases_levels.${i}`, lang),
        ),
        days: {
          0: t("editor.phrases_days.0", lang),
          1: t("editor.phrases_days.1", lang),
          2: t("editor.phrases_days.2", lang),
        },
        no_information: t("editor.no_information", lang),
      });
      return;
    }
  }

  static get properties() {
    return {
      _config: { type: Object },
      hass: { type: Object },
      installedCities: { type: Array },
      installedRegionIds: { type: Array },
      _initDone: { type: Boolean },
    };
  }

  get _lang() {
    return detectLang(this._hass, this._config.date_locale);
  }

  _t(key) {
    return t(`editor.${key}`, this._lang);
  }

  constructor() {
    super();
    this._userConfig = {};
    this._integrationExplicit = false;
    this._config = deepMerge(stubConfigPP, {});
    this.installedCities = [];
    this.installedRegionIds = [];
    this._initDone = false;
  }

  setConfig(config) {
    if (this.debug)
      console.debug("[Editor] setConfig – userConfig in:", config);
    this._userConfig = deepMerge(this._userConfig, config);
    this._integrationExplicit = this._userConfig.hasOwnProperty("integration");
    const integration =
      this._userConfig.integration || this._config.integration || "pp";
    const base = integration === "dwd" ? stubConfigDWD : stubConfigPP;
    this._config = deepMerge(base, this._userConfig);
    this._config.type = "custom:pollenprognos-card";
    this._initDone = false;
    if (this.debug)
      console.debug("[Editor] setConfig – merged _config:", this._config);
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
    this._hass = hass;
    const explicit = this._integrationExplicit;
    const ppStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.pollen_"),
    );
    const dwdStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.pollenflug_"),
    );
    if (!this._initDone && !explicit) {
      if (ppStates.length) this._config.integration = "pp";
      else if (dwdStates.length) this._config.integration = "dwd";
    }
    this.installedRegionIds = Array.from(
      new Set(dwdStates.map((id) => id.split("_").pop())),
    ).sort((a, b) => Number(a) - Number(b));
    const uniqCities = Array.from(
      new Set(ppStates.map((id) => id.slice(13).replace(/_[^_]+$/, ""))),
    );
    this.installedCities = uniqCities;
    if (!this._initDone) {
      if (
        this._config.integration === "dwd" &&
        !this._userConfig.region_id &&
        this.installedRegionIds.length
      ) {
        this._config.region_id = this.installedRegionIds[0];
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
    this.requestUpdate();
  }

  _onAllergenToggle(allergen, checked) {
    const set = new Set(this._config.allergens);
    checked ? set.add(allergen) : set.delete(allergen);
    this._updateConfig("allergens", [...set]);
  }

  _updateConfig(prop, value) {
    if (this.debug)
      console.debug("[Editor] _updateConfig – prop:", prop, "value:", value);
    const newUser = { ...this._userConfig };
    if (value === undefined) delete newUser[prop];
    else newUser[prop] = value;
    this._userConfig = newUser;
    let cfg;
    if (prop === "integration") {
      const newInt = value;
      delete this._userConfig[newInt === "dwd" ? "city" : "region_id"];
      delete this._userConfig.allergens;
      const base = newInt === "dwd" ? stubConfigDWD : stubConfigPP;
      cfg = deepMerge(base, this._userConfig);
      cfg.integration = newInt;
    } else {
      cfg = { ...this._config, [prop]: value };
    }
    cfg.type = this._config.type;
    this._config = cfg;
    if (this.debug) console.debug("[Editor] updated _config:", this._config);
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const c = {
      phrases: {
        full: {},
        short: {},
        levels: [],
        days: {},
        no_information: "",
      },
      ...this._config,
    };
    return html`
      <div class="card-config">
        <div class="preset-buttons">
          <mwc-button @click=${() => this._resetAll()}>
            ${this._t("preset_reset_all")}
          </mwc-button>
        </div>
        <ha-formfield label="${this._t("integration")}">
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
        <ha-formfield label="${this._t("city")}">
          <ha-select
            .value=${c.city}
            @selected=${(e) => this._updateConfig("city", e.target.value)}
            @closed=${(e) => e.stopPropagation()}
          >
            ${this.installedCities.map(
              (city) =>
                html`<mwc-list-item .value=${city}>${city}</mwc-list-item>`,
            )}
          </ha-select>
        </ha-formfield>
        <!-- fler fält enligt tidigare mönster, ersätt alla t("key") med this._t("key") -->
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
      .preset-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }
    `;
  }
}

customElements.define("pollenprognos-card-editor", PollenPrognosCardEditor);
