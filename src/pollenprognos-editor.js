// src/pollenprognos-editor.js
import { LitElement, html, css } from "lit";
import { t, detectLang } from "./i18n.js";

// Stub-config från adaptrar (så att editorn vet vilka fält som finns)
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";

import { PP_POSSIBLE_CITIES, DWD_REGIONS } from "./constants.js";

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
      keys.forEach((k) => (full[k] = t(`editor.phrases_full.${k}`, lang)));
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
      // Hämta alla allergen-nycklar beroende på integration
      const keys =
        this._config.integration === "dwd"
          ? stubConfigDWD.allergens
          : stubConfigPP.allergens;
      // Bygg upp full-fraserna
      const full = {};
      keys.forEach((k) => (full[k] = t(`editor.phrases_full.${k}`, lang)));
      // Uppdatera hela phrases-objektet
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
    if (lang === "de") {
      this._updateConfig("date_locale", "de-DE");
      const keys =
        this._config.integration === "dwd"
          ? stubConfigDWD.allergens
          : this._config.allergens;
      const full = {};
      keys.forEach((k) => (full[k] = t(`editor.phrases_full.${k}`, lang)));
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
    // 1) Rensa stub‐integration, stub‐days och stub‐locale
    const incoming = { ...config };
    if (
      !this._integrationExplicit &&
      incoming.integration === stubConfigPP.integration
    ) {
      if (this.debug) console.debug("[Editor] dropped stub integration");
      delete incoming.integration;
    }
    if (
      !this._daysExplicit &&
      incoming.days_to_show === stubConfigPP.days_to_show
    ) {
      if (this.debug) console.debug("[Editor] dropped stub days_to_show");
      delete incoming.days_to_show;
    }
    // Här kollar vi om det är stub från *rätt* stubConfig beroende på integration:
    const stubLocale = (
      incoming.integration === "dwd" ? stubConfigDWD : stubConfigPP
    ).date_locale;
    if (!this._localeExplicit && incoming.date_locale === stubLocale) {
      if (this.debug) console.debug("[Editor] dropped stub date_locale");
      delete incoming.date_locale;
    }

    // 2) Slå ihop med userConfig
    if (this.debug)
      console.debug("[Editor] after cleaning, incoming:", incoming);
    this._userConfig = deepMerge(this._userConfig, incoming);

    // 3) Sätt explicit‐flaggor per fält
    this._integrationExplicit = this._userConfig.hasOwnProperty("integration");
    this._daysExplicit = this._userConfig.hasOwnProperty("days_to_show");
    this._localeExplicit = this._userConfig.hasOwnProperty("date_locale");

    // 4) Autodetektera integration om inte explicit
    let integration = this._userConfig.integration;
    if (!this._integrationExplicit && this._hass) {
      const all = Object.keys(this._hass.states);
      if (all.some((id) => id.startsWith("sensor.pollen_"))) integration = "pp";
      else if (all.some((id) => id.startsWith("sensor.pollenflug_")))
        integration = "dwd";
      this._userConfig.integration = integration;
      if (this.debug)
        console.debug("[Editor] auto-detected integration:", integration);
    }

    // 5) Bygg config från stub + userConfig
    const baseStub = integration === "dwd" ? stubConfigDWD : stubConfigPP;
    this._config = deepMerge(baseStub, this._userConfig);
    this._config.integration = integration;
    this._config.type = "custom:pollenprognos-card";

    // 6) Återställ days_to_show om inte explicit
    if (!this._daysExplicit) {
      this._config.days_to_show = baseStub.days_to_show;
      if (this.debug)
        console.debug(
          "[Editor] reset days_to_show to stub:",
          baseStub.days_to_show,
        );
    }

    // 7) Autofyll date_locale om inte explicit, nu baserat på HA language
    if (!this._localeExplicit) {
      // detectLang prioriterar hass.language över stub‐värde
      const detected = detectLang(this._hass, null);
      let locale;
      switch (detected) {
        case "sv":
          locale = "sv-SE";
          break;
        case "de":
          locale = "de-DE";
          break;
        case "fi":
          locale = "fi-FI";
          break;
        default:
          locale = "en-US";
      }
      this._config.date_locale = locale;
      if (this.debug)
        console.debug(
          "[Editor] autofilled date_locale:",
          locale,
          "(HA language was:",
          detected,
          ")",
        );
    }

    this._initDone = false;

    // 8) Uppdatera listor för cities/regions om hass finns
    if (this._hass) {
      const all = Object.keys(this._hass.states);
      this.installedRegionIds = Array.from(
        new Set(
          all
            .filter((id) => id.startsWith("sensor.pollenflug_"))
            .map((id) => id.split("_").pop()),
        ),
      ).sort((a, b) => Number(a) - Number(b));
      const ppKeys = new Set(
        all
          .filter(
            (id) =>
              id.startsWith("sensor.pollen_") &&
              !id.startsWith("sensor.pollenflug_"),
          )
          // plocka bort prefix och suffix, så det matchar PP_POSSIBLE_CITIES
          .map((id) =>
            id.slice("sensor.pollen_".length).replace(/_[^_]+$/, ""),
          ),
      );
      this.installedCities = PP_POSSIBLE_CITIES.filter((c) =>
        ppKeys.has(
          c
            .toLowerCase()
            .replace(/[åä]/g, "a")
            .replace(/ö/g, "o")
            .replace(/[-\s]/g, "_"),
        ),
      ).sort();
    }

    // 9) Auto‐välj city/region om inte explicit
    if (!this._integrationExplicit) {
      if (
        integration === "dwd" &&
        !this._userConfig.region_id &&
        this.installedRegionIds.length
      ) {
        this._config.region_id = this.installedRegionIds[0];
      }
      if (
        integration === "pp" &&
        !this._userConfig.city &&
        this.installedCities.length
      ) {
        this._config.city = this.installedCities[0];
      }
    }

    // 10) Skicka tillbaka config till HA‐formuläret och rerender
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

    // Hitta alla sensor-ID för PP respektive DWD
    const ppStates = Object.keys(hass.states).filter(
      (id) =>
        id.startsWith("sensor.pollen_") && !id.startsWith("sensor.pollenflug_"),
    );
    const dwdStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.pollenflug_"),
    );

    // 1) Autodetektera integration om användaren inte valt själv
    let integration = this._userConfig.integration;
    if (!explicit) {
      if (ppStates.length) integration = "pp";
      else if (dwdStates.length) integration = "dwd";

      // Spara tillbaka det här valet så dropdownen visar rätt
      this._userConfig.integration = integration;
    }

    // 2) Slå ihop stub + användar-config
    const base = integration === "dwd" ? stubConfigDWD : stubConfigPP;
    this._config = deepMerge(base, this._userConfig);
    this._config.integration = integration;
    this._config.type = "custom:pollenprognos-card";

    // 3) Fyll installerade regioner/städer
    this.installedRegionIds = Array.from(
      new Set(dwdStates.map((id) => id.split("_").pop())),
    ).sort((a, b) => Number(a) - Number(b));

    const uniqKeys = Array.from(
      new Set(
        ppStates.map((id) =>
          id.slice("sensor.pollen_".length).replace(/_[^_]+$/, ""),
        ),
      ),
    );
    this.installedCities = PP_POSSIBLE_CITIES.filter((city) =>
      uniqKeys.includes(
        city
          .toLowerCase()
          .replace(/[åä]/g, "a")
          .replace(/ö/g, "o")
          .replace(/[-\s]/g, "_"),
      ),
    ).sort((a, b) => a.localeCompare(b));

    // 4) Auto-välj första region/stad om användaren inte satt något
    if (!this._initDone) {
      if (
        integration === "dwd" &&
        !this._userConfig.region_id &&
        this.installedRegionIds.length
      ) {
        this._config.region_id = this.installedRegionIds[0];
      }
      if (
        integration === "pp" &&
        !this._userConfig.city &&
        this.installedCities.length
      ) {
        this._config.city = this.installedCities[0];
      }
    }
    this._initDone = true;

    // 5) Dispatch’a så att HA:r-editorn ritar om formuläret med nya värden
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }),
    );

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
        <!-- Återställ-knapp -->
        <div class="preset-buttons">
          <mwc-button @click=${() => this._resetAll()}>
            ${this._t("preset_reset_all")}
          </mwc-button>
        </div>

        <!-- Integration -->
        <ha-formfield label="${this._t("integration")}">
          <ha-select
            .value=${c.integration}
            @selected=${(e) =>
              this._updateConfig("integration", e.target.value)}
            @closed=${(e) => e.stopPropagation()}
          >
            <mwc-list-item value="pp"
              >${this._t("integration.pp")}</mwc-list-item
            >
            <mwc-list-item value="dwd"
              >${this._t("integration.dwd")}</mwc-list-item
            >
          </ha-select>
        </ha-formfield>

        <!-- Stad (PP) eller Region (DWD) -->
        ${c.integration === "pp"
          ? html`
              <ha-formfield label="${this._t("city")}">
                <ha-select
                  .value=${c.city || ""}
                  @selected=${(e) => this._updateConfig("city", e.target.value)}
                  @closed=${(e) => e.stopPropagation()}
                >
                  ${this.installedCities.map(
                    (city) =>
                      html`<mwc-list-item .value=${city}
                        >${city}</mwc-list-item
                      >`,
                  )}
                </ha-select>
              </ha-formfield>
            `
          : html`
              <ha-formfield label="${this._t("region_id")}">
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
        <ha-formfield label="${this._t("title")}">
          <ha-textfield
            .value=${c.title || ""}
            placeholder="${this._t("title")}"
            @input=${(e) => {
              const v = e.target.value;
              this._updateConfig("title", v === "" ? undefined : v);
            }}
          ></ha-textfield>
        </ha-formfield>

        <!-- Layout-switchar -->
        <ha-formfield label="${this._t("minimal")}">
          <ha-switch
            .checked=${c.minimal}
            @change=${(e) => this._updateConfig("minimal", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${this._t("show_text")}">
          <ha-switch
            .checked=${c.show_text}
            @change=${(e) => this._updateConfig("show_text", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${this._t("show_value")}">
          <ha-switch
            .checked=${c.show_value}
            @change=${(e) => this._updateConfig("show_value", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${this._t("show_empty_days")}">
          <ha-switch
            .checked=${c.show_empty_days}
            @change=${(e) =>
              this._updateConfig("show_empty_days", e.target.checked)}
          ></ha-switch>
        </ha-formfield>

        <!-- Dag-inställningar -->
        <ha-formfield label="${this._t("days_relative")}">
          <ha-switch
            .checked=${c.days_relative}
            @change=${(e) =>
              this._updateConfig("days_relative", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${this._t("days_abbreviated")}">
          <ha-switch
            .checked=${c.days_abbreviated}
            @change=${(e) =>
              this._updateConfig("days_abbreviated", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${this._t("days_uppercase")}">
          <ha-switch
            .checked=${c.days_uppercase}
            @change=${(e) =>
              this._updateConfig("days_uppercase", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${this._t("days_boldfaced")}">
          <ha-switch
            .checked=${c.days_boldfaced}
            @change=${(e) =>
              this._updateConfig("days_boldfaced", e.target.checked)}
          ></ha-switch>
        </ha-formfield>

        <!-- Antal dagar -->
        <ha-formfield label="${this._t("days_to_show")} ${c.days_to_show}">
          <ha-slider
            min="0"
            max="6"
            step="1"
            .value=${c.days_to_show}
            @change=${(e) =>
              this._updateConfig("days_to_show", Number(e.target.value))}
          ></ha-slider>
        </ha-formfield>

        <!-- Tröskel -->
        <ha-formfield
          label="${this._t("pollen_threshold")} ${c.pollen_threshold}"
        >
          <ha-slider
            min="0"
            max="6"
            step="1"
            .value=${c.pollen_threshold}
            @change=${(e) =>
              this._updateConfig("pollen_threshold", Number(e.target.value))}
          ></ha-slider>
        </ha-formfield>

        <!-- Sortering -->
        <ha-formfield label="${this._t("sort")}">
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
              (o) =>
                html`<mwc-list-item .value=${o}
                  >${o.replace("_", " ")}</mwc-list-item
                >`,
            )}
          </ha-select>
        </ha-formfield>

        <!-- Språk-inställning -->
        <ha-formfield label="${this._t("locale")}">
          <ha-textfield
            .value=${c.date_locale}
            @input=${(e) => this._updateConfig("date_locale", e.target.value)}
          ></ha-textfield>
        </ha-formfield>

        <!-- Allergener (detaljerad) -->
        <details>
          <summary>${this._t("allergens")}</summary>
          <div class="allergens-group">
            ${(c.integration === "dwd"
              ? stubConfigDWD.allergens
              : stubConfigPP.allergens
            ).map(
              (key) => html`
                <ha-formfield .label=${key}>
                  <ha-checkbox
                    .checked=${c.allergens.includes(key)}
                    @change=${(e) =>
                      this._onAllergenToggle(key, e.target.checked)}
                  ></ha-checkbox>
                </ha-formfield>
              `,
            )}
          </div>
        </details>

        <!-- Fraser -->
        <h3>${this._t("phrases")}</h3>
        <div class="preset-buttons">
          <mwc-button @click=${() => this._resetPhrases("sv")}>
            ${this._t("preset_svenska")}
          </mwc-button>
          <mwc-button @click=${() => this._resetPhrases("de")}>
            ${this._t("preset_tyska")}
          </mwc-button>
          <mwc-button @click=${() => this._resetPhrases("en")}>
            ${this._t("preset_english")}
          </mwc-button>
        </div>
        <details>
          <summary>${this._t("phrases_full")}</summary>
          ${(c.integration === "dwd"
            ? stubConfigDWD.allergens
            : stubConfigPP.allergens
          ).map(
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
          <summary>${this._t("phrases_short")}</summary>
          ${(c.integration === "dwd"
            ? stubConfigDWD.allergens
            : stubConfigPP.allergens
          ).map(
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
          <summary>${this._t("phrases_levels")}</summary>
          ${Array.from({ length: 7 }, (_, i) => i).map(
            (i) => html`
              <ha-formfield .label=${i}>
                <ha-textfield
                  .value=${c.phrases.levels[i] || ""}
                  @input=${(e) => {
                    const lv = [...c.phrases.levels];
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
          <summary>${this._t("phrases_days")}</summary>
          ${[0, 1, 2].map(
            (i) => html`
              <ha-formfield .label=${i}>
                <ha-textfield
                  .value=${c.phrases.days[i] || ""}
                  @input=${(e) => {
                    const dd = { ...c.phrases.days, [i]: e.target.value };
                    this._updateConfig("phrases", { ...c.phrases, days: dd });
                  }}
                ></ha-textfield>
              </ha-formfield>
            `,
          )}
        </details>
        <ha-formfield label="${this._t("no_information")}">
          <ha-textfield
            .value=${c.phrases.no_information || ""}
            @input=${(e) =>
              this._updateConfig("phrases", {
                ...c.phrases,
                no_information: e.target.value,
              })}
          ></ha-textfield>
        </ha-formfield>

        <!-- Debug -->
        <ha-formfield label="${this._t("debug")}">
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
