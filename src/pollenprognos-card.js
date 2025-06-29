// src/pollenprognos-card.js
import { LitElement, html, css } from "lit";
import { images } from "./pollenprognos-images.js";
import { t, detectLang } from "./i18n.js";
import * as PP from "./adapters/pp.js";
import { normalize, normalizeDWD } from "./utils/normalize.js";
import { getSilamReverseMap, findAvailableSensors } from "./utils/sensors.js";
import * as DWD from "./adapters/dwd.js";
import * as PEU from "./adapters/peu.js";
import * as SILAM from "./adapters/silam.js";
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";
import { stubConfigPEU } from "./adapters/peu.js";
import { stubConfigSILAM } from "./adapters/silam.js";
import {
  DWD_REGIONS,
  ALLERGEN_TRANSLATION,
  ADAPTERS as CONSTANT_ADAPTERS,
  PP_POSSIBLE_CITIES,
} from "./constants.js";
import silamAllergenMap from "./adapters/silam_allergen_map.json" assert { type: "json" };

const ADAPTERS = CONSTANT_ADAPTERS;

class PollenPrognosCard extends LitElement {
  get debug() {
    // return true;
    return Boolean(this.config && this.config.debug);
  }

  get _lang() {
    return detectLang(this._hass, this.config?.date_locale);
  }

  _t(key) {
    return t(key, this._lang);
  }

  _hasTapAction() {
    const ta = this.tapAction;
    return ta && ta.type && ta.type !== "none";
  }

  static get properties() {
    return {
      hass: { state: true },
      config: {},
      sensors: { state: true },
      days_to_show: { state: true },
      displayCols: { state: true },
      header: { state: true },
      tapAction: {},
    };
  }

  _getImageSrc(allergenReplaced, state) {
    const raw = Number(state);
    let scaled = raw;
    let min = -1,
      max = 6;
    if (this.config.integration === "dwd") {
      scaled = raw * 2;
      max = 6;
    } else if (this.config.integration === "peu") {
      scaled = Math.round((raw * 6) / 4); // Skala peu 0–4 till 0–6 för bild
      max = 6;
      min = 0;
    }
    let lvl = Math.round(scaled);
    if (isNaN(lvl) || lvl < min) lvl = min;
    if (lvl > max) lvl = max;
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

  // static getStubConfig() {
  //   return stubConfigPP;
  // }

  setConfig(config) {
    // Kopiera användarens config
    this._userConfig = { ...config };
    this.tapAction = config.tap_action || null;

    // Markera explicit integration
    this._integrationExplicit = config.hasOwnProperty("integration");

    // Byt till relevant stub för integration och nollställ övriga fält
    let integration = this._userConfig.integration;
    let stub;
    if (integration === "pp") stub = stubConfigPP;
    else if (integration === "peu") stub = stubConfigPEU;
    else if (integration === "dwd") stub = stubConfigDWD;
    else if (integration === "silam") stub = stubConfigSILAM;
    else stub = stubConfigPP;

    // Spara enbart tillåtna fält
    const allowedFields = Object.keys(stub).concat([
      "allergens",
      "city",
      "location",
      "region_id",
      "tap_action",
      "debug", // om du vill ha det
      "title",
      "days_to_show",
      "date_locale",
      // lägg till fler globala configfält om det behövs
    ]);
    // Kopiera endast tillåtna fält från användarens config
    let cleanedUserConfig = {};
    for (const k of allowedFields) {
      if (k in this._userConfig) cleanedUserConfig[k] = this._userConfig[k];
    }

    // Starta om config från stub, plus user-params
    this._userConfig = { ...stub, ...cleanedUserConfig, integration };

    this._initDone = false;
    if (this._hass) {
      this.hass = this._hass;
    }
  }

  set hass(hass) {
    this._hass = hass;
    const explicit = !!this._integrationExplicit;
    if (this.debug)
      console.debug("[Card] set hass called; explicit:", explicit);

    // Sensordetektion
    const ppStates = Object.keys(hass.states).filter(
      (id) =>
        id.startsWith("sensor.pollen_") && !id.startsWith("sensor.pollenflug_"),
    );
    const dwdStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.pollenflug_"),
    );
    const peuStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.polleninformation_"),
    );
    const silamStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.silam_pollen_"),
    );

    if (this.debug) {
      console.debug("Sensor states detected:");
      console.debug("PP:", ppStates);
      console.debug("DWD:", dwdStates);
      console.debug("PEU:", peuStates);
      console.debug("SILAM:", silamStates);
    }

    // Bestäm integration (PEU går före DWD)
    let integration = this._userConfig.integration;
    if (!explicit) {
      if (ppStates.length) integration = "pp";
      else if (peuStates.length) integration = "peu";
      else if (dwdStates.length) integration = "dwd";
      else if (silamStates.length) integration = "silam";
    }

    // Plocka rätt stub
    let baseStub;
    if (integration === "dwd") baseStub = stubConfigDWD;
    else if (integration === "peu") baseStub = stubConfigPEU;
    else if (integration === "pp") baseStub = stubConfigPP;
    else if (integration === "silam") baseStub = stubConfigSILAM;
    else console.error("Unknown integration:", integration);

    // Sätt config rätt — utan allergens
    const { allergens, ...userConfigWithoutAllergens } = this._userConfig;
    const cfg = {
      ...baseStub,
      ...userConfigWithoutAllergens,
      integration,
    };

    if (
      this._integrationExplicit &&
      Array.isArray(allergens) &&
      allergens.length > 0
    ) {
      // Endast om integrationen är explicit satt av användaren (inte autodetect)
      if (this.debug) {
        console.debug(
          "[Card] Explicit integration (",
          integration,
          "); using user-defined allergens:",
          allergens,
        );
      }
      cfg.allergens = allergens;
    } else {
      if (this.debug) {
        console.debug(
          "[Card] Using stub allergens for integration:",
          integration,
        );
      }
      // Om integrationen INTE är explicit (autodetect): använd stubben
      if (integration === "pp") cfg.allergens = stubConfigPP.allergens;
      else if (integration === "peu") cfg.allergens = stubConfigPEU.allergens;
      else if (integration === "dwd") cfg.allergens = stubConfigDWD.allergens;
      else if (integration === "silam")
        cfg.allergens = stubConfigSILAM.allergens;
    }

    // Fyll date_locale
    if (!cfg.hasOwnProperty("date_locale")) {
      const detectedLangCode = detectLang(hass, null);
      const localeTag =
        this._hass?.locale?.language ||
        this._hass?.language ||
        `${detectedLangCode}-${detectedLangCode.toUpperCase()}`;
      cfg.date_locale = localeTag;
      if (this.debug) {
        console.debug("[Card] auto-filling date_locale:", cfg.date_locale);
      }
    }

    // Automatisk region/stad/location
    if (integration === "dwd" && !cfg.region_id && dwdStates.length) {
      cfg.region_id = Array.from(
        new Set(dwdStates.map((id) => id.split("_").pop())),
      ).sort((a, b) => Number(a) - Number(b))[0];
      if (this.debug)
        console.debug("[Card] Auto-set region_id:", cfg.region_id);
    } else if (integration === "pp" && !cfg.city && ppStates.length) {
      cfg.city = ppStates[0]
        .slice("sensor.pollen_".length)
        .replace(/_[^_]+$/, "");
      if (this.debug) console.debug("[Card] Auto-set city:", cfg.city);
    } else if (integration === "peu" && !cfg.location && peuStates.length) {
      // Samla alla location_slug från entity attributes (om de finns)
      const peuLocations = Array.from(
        new Set(
          peuStates
            .map((eid) => {
              const attr = hass.states[eid]?.attributes || {};
              return attr.location_slug || null;
            })
            .filter(Boolean),
        ),
      );
      cfg.location = peuLocations[0] || null;
      if (this.debug)
        console.debug(
          "[Card][PEU] Auto-set location (location_slug):",
          cfg.location,
          peuLocations,
        );
    } else if (integration === "silam" && !cfg.location && silamStates.length) {
      // Samla alla unika location-namn från entity_id
      const silamLocations = Array.from(
        new Set(
          silamStates
            .map((eid) => {
              // sensor.silam_pollen_<location>_<allergen>
              // plocka ut location (mellan "sensor.silam_pollen_" och sista "_")
              const m = eid.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
              return m ? m[1] : null;
            })
            .filter(Boolean),
        ),
      );
      cfg.location = silamLocations[0] || null;
      if (this.debug)
        console.debug(
          "[Card][SILAM] Auto-set location (location):",
          cfg.location,
          silamLocations,
        );
    }

    // Spara config och header
    this.config = cfg;
    this.tapAction = cfg.tap_action || this.tapAction || null;

    if (this.debug) {
      console.debug("[Card][Debug] Aktiv integration:", integration);
      console.debug("[Card][Debug] Allergens i config:", cfg.allergens);
    }

    // Header
    if (
      cfg.title === "false" ||
      cfg.title === false ||
      (typeof cfg.title === "string" && cfg.title.trim() === "")
    ) {
      this.header = "";
    } else if (
      typeof cfg.title === "string" &&
      cfg.title.trim() !== "" &&
      cfg.title !== "true"
    ) {
      this.header = cfg.title;
    } else {
      let loc = "";
      if (integration === "dwd") {
        loc = DWD_REGIONS[cfg.region_id] || cfg.region_id;
      } else if (integration === "peu") {
        // Hitta alla peu-entities
        const peuEntities = Object.values(hass.states).filter((s) =>
          s.entity_id.startsWith("sensor.polleninformation_"),
        );
        // Hitta entity där slug-attribut eller entity_id matchar cfg.location
        const match = peuEntities.find((s) => {
          const attr = s.attributes || {};
          const slug =
            attr.location_slug ||
            s.entity_id
              .replace("sensor.polleninformation_", "")
              .replace(/_[^_]+$/, "");
          return slug === cfg.location;
        });
        let title = "";
        if (match) {
          const attr = match.attributes;
          title =
            attr.location_title ||
            attr.friendly_name?.match(/\((.*?)\)/)?.[1] ||
            cfg.location;
        }
        loc = title || cfg.location || "";
      } else if (integration === "silam") {
        // Hitta alla silam-entities
        const silamEntities = Object.values(hass.states).filter((s) =>
          s.entity_id.startsWith("sensor.silam_pollen_"),
        );
        // Extrahera location från entity_id (sensor.silam_pollen_<location>_<allergen>)
        let silamLoc = cfg.location;
        if (!silamLoc && silamEntities.length) {
          // Gissa första unika location
          silamLoc = silamEntities[0].entity_id
            .replace("sensor.silam_pollen_", "")
            .replace(/_[^_]+$/, "")
            .replace(/^[-\s]+/, ""); // <-- Trimma här!
        }
        // Hitta första entity med denna location
        const match = silamEntities.find((s) => {
          const eid = s.entity_id.replace("sensor.silam_pollen_", "");
          const locPart = eid.replace(/_[^_]+$/, "").replace(/^[-\s]+/, ""); // <-- Trimma även här!
          return locPart === silamLoc;
        });
        let title = "";
        if (match) {
          const attr = match.attributes;
          // Försök hitta mer beskrivande namn, annars använd location
          title =
            attr.location_title ||
            attr.friendly_name?.match(/SILAM Pollen (.+?) [^ ]+$/)?.[1] ||
            silamLoc;
          title = title.replace(/^[-\s]+/, ""); // <-- Trim även title!
        }
        loc = title || silamLoc || "";
      } else {
        loc =
          PP_POSSIBLE_CITIES.find(
            (n) =>
              n
                .toLowerCase()
                .replace(/[åä]/g, "a")
                .replace(/ö/g, "o")
                .replace(/[-\s]/g, "_") === cfg.city,
          ) || cfg.city;
      }
      this.header = `${this._t("card.header_prefix")} ${loc}`;
      if (this.debug) console.debug("[Card] header set to:", this.header);
    }

    // Hämta prognos via rätt adapter
    const adapter = ADAPTERS[cfg.integration] || PP;
    adapter
      .fetchForecast(hass, cfg)
      .then((sensors) => {
        if (this.debug) {
          console.debug("[Card][Debug] Sensors före filtrering:", sensors);
          console.debug(
            "[Card][Debug] Förväntade allergener från config:",
            cfg.allergens,
          );
        }

        if (this.debug) {
          console.debug(
            "[Card][Debug] Alla tillgängliga hass.states:",
            Object.keys(hass.states),
          );
          console.debug("[Card] Användaren har valt city:", cfg.city);
          console.debug(
            "[Card] Användaren har valt allergener:",
            cfg.allergens,
          );
          console.debug("[Card] Användaren har valt plats:", cfg.location);
        }

        const availableSensors = findAvailableSensors(cfg, hass, this.debug);
        const availableSensorCount = availableSensors.length;

        // --- AUTODETECT HASS-SLUG-SPRÅK FÖR SILAM ---
        let silamReverse = {};
        if (cfg.integration === "silam") {
          // Alla silam-entiteter för platsen
          const silamStates = Object.keys(hass.states).filter((id) => {
            const m = id.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
            return m && m[1] === (cfg.location || "");
          });

          // Loopa igenom alla sensors och alla mapping-språk
          for (const eid of silamStates) {
            const m = eid.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
            if (!m) continue;
            const haSlug = m[2];
            // Gå igenom alla språk och leta master-slug
            let found = false;
            for (const [lang, mapping] of Object.entries(
              silamAllergenMap.mapping,
            )) {
              if (mapping[haSlug]) {
                silamReverse[mapping[haSlug]] = haSlug;
                found = true;
                break; // sluta efter första träff (det räcker, unikt per system)
              }
            }
            // Om ingen träff – debugga gärna
            if (!found && this.debug) {
              console.debug(
                `[Card][SILAM] Hittade ingen mapping för haSlug: '${haSlug}'`,
              );
            }
          }
          if (this.debug) {
            console.debug(
              "[Card][SILAM] silamReverse byggd baserat på existerande sensors:",
              silamReverse,
            );
          }
        }

        // Filtrera adapterns sensors så att endast de finns i availableSensors
        let filtered = sensors.filter((s) => {
          if (cfg.integration === "silam" && silamReverse) {
            const loc = cfg.location || "";
            // Mappar master->haSlug för entity_id
            const key = silamReverse[s.allergenReplaced] || s.allergenReplaced;
            const id = `sensor.silam_pollen_${loc}_${key}`;
            if (this.debug) {
              console.debug(
                `[Card][Debug][SILAM filter] allergenReplaced: '${s.allergenReplaced}', key: '${key}', id: '${id}', available: ${availableSensors.includes(id)}`,
              );
            }
            return availableSensors.includes(id);
          }
          return true; // fallback: visa alla
        });

        // Endast *normalisering/namn*-filtrering för de andra integrationerna!
        if (
          Array.isArray(cfg.allergens) &&
          cfg.allergens.length > 0 &&
          cfg.integration !== "silam"
        ) {
          let allowed;
          let getKey;
          if (integration === "dwd") {
            allowed = new Set(cfg.allergens.map((a) => normalizeDWD(a)));
            getKey = (s) => normalizeDWD(s.allergenReplaced || "");
          } else {
            if (this.debug) {
              console.debug(
                "[Card][Debug] Använder normalisering för allergener:",
                cfg.allergens,
              );
            }
            allowed = new Set(cfg.allergens.map((a) => normalize(a)));
            getKey = (s) => normalize(s.allergenReplaced || "");
          }
          filtered = filtered.filter((s) => {
            const allergenKey = getKey(s);
            const ok = allowed.has(allergenKey);
            if (!ok && this.debug) {
              console.debug(
                `[Card][Debug] Sensor '${allergenKey}' är EJ tillåten (ej i allowed)`,
                s,
              );
            }
            return ok;
          });
        }

        const explicitLocation = this._integrationExplicit && !!cfg.location;
        const noAvailableSensors = availableSensorCount === 0;

        if (explicitLocation && noAvailableSensors) {
          this.sensors = [];
          this._availableSensorCount = 0;
          this._explicitLocationNoSensors = true;
          if (this.debug) {
            console.warn(
              `[Card] Ingen sensor hittad för explicit vald plats: '${cfg.location}'`,
            );
          }
          this.requestUpdate();
          return;
        } else {
          this._explicitLocationNoSensors = false;
          this.sensors = filtered;
          this._availableSensorCount = availableSensors.length;
          let daysCount = 0;
          if (cfg.show_empty_days) {
            daysCount = cfg.days_to_show;
          } else if (filtered.length > 0 && filtered[0].days) {
            daysCount = filtered[0].days.length;
          }
          this.days_to_show = daysCount;
          this.displayCols = Array.from({ length: daysCount }, (_, i) => i);

          this.requestUpdate();
        }
      })

      .catch((err) => {
        console.error("[Card] Error fetching pollen forecast:", err);
        if (this.debug) console.debug("[Card] fetchForecast error:", err);
      });
  }

  _renderMinimalHtml() {
    return html`
      <ha-card>
        ${this.header ? html`<h1 class="header">${this.header}</h1>` : ""}
        <div class="flex-container">
          ${this.sensors.map((sensor) => {
            const txt = sensor.day0.state_text || "";
            const num = sensor.day0.state;
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
      let errorMsg = "";
      if (this._availableSensorCount === 0) {
        errorMsg = this._t("card.error_no_sensors"); // "Inga pollen-sensorer hittades. Har du installerat rätt integration och valt region i kortets konfiguration?"
      } else {
        errorMsg = this._t("card.error_filtered_sensors"); // "Inga sensorer matchar din filtrering. Kontrollera valda allergener och tröskel."
      }
      return html`
        <ha-card
          @click="${this._hasTapAction() ? this._handleTapAction : null}"
          style="cursor: ${this.tapAction &&
          this.tapAction.type &&
          this.tapAction.type !== "none"
            ? "pointer"
            : "auto"}"
        >
          <div class="card-error">${errorMsg} (${name})</div>
        </ha-card>
      `;
    }
    const cardContent = this.config.minimal
      ? this._renderMinimalHtml()
      : this._renderNormalHtml();
    return html`
      <ha-card
        @click="${this._handleTapAction}"
        style="cursor: ${this.tapAction &&
        this.tapAction.type &&
        this.tapAction.type !== "none"
          ? "pointer"
          : "auto"}"
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
