// src/pollenprognos-card.js
import { LitElement, html, css } from 'lit';
import { images } from './pollenprognos-images.js';

// Adapter-modulerna (du använder dem senare via CONSTANT_ADAPTERS eller direkt)
import * as PP from './adapters/pp.js';
import * as DWD from './adapters/dwd.js';

// Stub-konfigurationer
import { stubConfigPP }  from './adapters/pp.js';
import { stubConfigDWD } from './adapters/dwd.js';

// Statiska konstanter
import {
  DWD_REGIONS,
  TRANSLATIONS,
  ALLERGEN_TRANSLATION,
  ADAPTERS as CONSTANT_ADAPTERS,
  PP_POSSIBLE_CITIES
} from './constants.js';

const ADAPTERS = CONSTANT_ADAPTERS; // { pp: PP, dwd: DWD }

class PollenPrognosCard extends LitElement {
  /** Tvåbokstavskod, fallback en */
  get _lang() {
    const haLang = this._hass?.language?.slice(0,2);
    const navLang = navigator.language?.slice(0,2);
    return (haLang || navLang || 'en').toLowerCase();
  }

  /** Hämta text från TRANSLATIONS */
  _t(key) {
    return (TRANSLATIONS[this._lang] || TRANSLATIONS.en)[key] || '';
  }
  static properties = {
    hass:        { state: true },
    config:      {},
    sensors:     { state: true },
    days_to_show:{ state: true },
    displayCols: { state: true },
    header:      { state: true }
  };

  /**
   * Hämta inline-ikon för ett allergen + nivå.
   * Om integration === 'dwd' skalar vi state * 2 för bildvalet,
   * men behåller det ursprungliga state för ev. textvisning.
   */
  _getImageSrc(allergenReplaced, state) {
    // Råvärde från sensor
    const raw = Number(state);

    // Skala för DWD så att 0.5–3 → 1–6
    let scaled = raw;
    if (this.config.integration === 'dwd') {
      scaled = raw * 2;
    }

    // Avrunda till närmaste heltal och clamp mellan -1 och 6
    let lvl = Math.round(scaled);
    if (isNaN(lvl) || lvl < -1) lvl = -1;
    if (lvl > 6) lvl = 6;

    // Översätt allergen-nyckel till engelskt internt namn
    const key = ALLERGEN_TRANSLATION[allergenReplaced] || allergenReplaced;

    // Försök allergen-specifik ikon, annars global nivå-ikon
    const specific = images[`${key}_${lvl}_png`];
    return specific || images[`${lvl}_png`];
  }

  constructor() {
    super();
    this.days_to_show = 4;
    this.displayCols = [];
    this.header = '';
    this._initDone = false;
    this._userConfig = {};
    this.sensors      = [];
  }

  static async getConfigElement() {
    await customElements.whenDefined('pollenprognos-card-editor');
    return document.createElement('pollenprognos-card-editor');
  }

  static getStubConfig() {
    return {
      integration:      'pp',
      city:             '',
      region_id:        '',
      allergens:        ['Al','Alm','Björk','Ek','Malörtsambrosia','Gråbo','Gräs','Hassel','Sälg och viden'],
      minimal:          false,
      show_text:        true,
      show_empty_days:  true,
      debug:            false,
      days_to_show:     4,
      days_relative:    true,
      days_abbreviated: false,
      days_uppercase:   false,
      days_boldfaced:   false,
      pollen_threshold: 1,
      sort:             'value_descending',
      date_locale:      'sv-SE',
      title:            undefined,
      phrases: {
        full:           {},
        short:          {},
        levels:         [],
        days:           {},
        no_information: ''
      }
    };
  }

setConfig(config) {
  // store *exactly* what the user wrote
  this._userConfig = { ...config };
  // only mark “explicit” if they *really* wrote `integration:` in their YAML/UI
  this._integrationExplicit =
    config.hasOwnProperty('integration') &&
    config.integration !== stubConfigPP.integration;
  // trigger a re-run of the hass‐setter
  this._initDone = false;
  if (this._hass) this.hass = this._hass;
}

set hass(hass) {
  this._hass = hass;

  // figure out if the user explicitly set "integration" or not
  const explicit = !!this._integrationExplicit;

  // detect *PP* sensors (but exclude any DWD “pollenflug_” ones)
  const ppStates = Object.keys(hass.states).filter(id =>
    id.startsWith('sensor.pollen_') && !id.startsWith('sensor.pollenflug_')
  );

  // detect *DWD* sensors
  const dwdStates = Object.keys(hass.states).filter(id =>
    id.startsWith('sensor.pollenflug_')
  );

  // decide integration
  let integration = this._userConfig.integration;  // may be undefined
  if (!explicit) {
    if (ppStates.length)       integration = 'pp';
    else if (dwdStates.length) integration = 'dwd';
  }
    console.debug('[PollenPrognos] picked before fallback', { integration, explicit });
  // extra safety: if it still says “pp” but there are *no* PP sensors, flip to DWD
  if (!explicit && integration === 'pp' && ppStates.length === 0 && dwdStates.length) {
        console.debug('[PollenPrognos] falling back from PP → DWD');
    integration = 'dwd';
  }

  // Hämta stub-defaults *utan* att tvinga integration
  const stubPP  = PollenPrognosCard.getStubConfig();
  const stubDWD = DWD.stubConfigDWD;
  const baseStub = integration === 'dwd' ? stubDWD : stubPP;

  // Slå ihop stub + det användaren faktiskt skrev
  const cfg = {
    ...baseStub,
    ...this._userConfig,
    integration,
  };

  // (resten av din DWD-fallback, automat-region, header, fetchForecast osv…)
  // this.config = cfg;

  // DWD-fallback: tvinga fram DWD-defaults
  //    - vid autodetektering (explicit=false)
  //    - eller om användaren inte explicit ändrat just det fältet
  if (integration === 'dwd') {
    if (!explicit || !this._userConfig.hasOwnProperty('allergens')) {
      cfg.allergens    = stubDWD.allergens;
    }
    if (!explicit || !this._userConfig.hasOwnProperty('days_to_show')) {
      cfg.days_to_show = stubDWD.days_to_show;
    }
    if (!explicit || !this._userConfig.hasOwnProperty('date_locale')) {
      cfg.date_locale  = stubDWD.date_locale;
    }
  }

  // Automatisk region-/stad-val om det saknas
  if (integration === 'dwd') {
    if (!cfg.region_id && dwdStates.length) {
      cfg.region_id = Array.from(new Set(dwdStates.map(id => id.split('_').pop())))
        .sort((a,b)=>Number(a)-Number(b))[0];
    }
  } else {
    if (!cfg.city && ppStates.length) {
      cfg.city = ppStates[0]
        .slice('sensor.pollen_'.length)
        .split('_').slice(0,-1).join('_');
    }
  }

  // Spara den slutgiltiga configen och sätt header
  this.config = cfg;
  if (typeof cfg.title === 'string') this.header = cfg.title;
  else if (cfg.title === false)      this.header = '';
  else {
    let loc;
    if (cfg.integration === 'dwd') {
      loc = DWD_REGIONS[cfg.region_id] || cfg.region_id;
    } else {
      // hitta motsvarande namn i PP_POSSIBLE_CITIES
      const key = cfg.city;
      const pretty = PP_POSSIBLE_CITIES.find(name =>
        name.toLowerCase()
        .replace(/[åä]/g,'a').replace(/ö/g,'o')
        .replace(/[-\s]/g,'_')
        === key
      );
      loc = pretty || cfg.city;
    }
    this.header = `${this._t('header_prefix')} ${loc}`;
  }

  // Hämta och rendera prognosen
  const adapter = ADAPTERS[cfg.integration] || PP;
    console.debug('[PollenPrognos] final cfg', cfg);
  adapter.fetchForecast(hass, cfg)
    .then(sensors => {
      this.sensors      = sensors;
      this.days_to_show = cfg.days_to_show;
      this.displayCols  = Array.from(
        { length: cfg.show_empty_days ? cfg.days_to_show : (sensors[0]?.days?.length || 0) },
        (_, i) => i
      );
      this.requestUpdate();
    })
    .catch(err => console.error('Error fetching pollen forecast:', err));
}


  _renderMinimalHtml() {
    return html`
      <ha-card>
        ${this.header
            ? html`<h1 class="header">${this.header}</h1>`
            : ''}
        <div class="flex-container">
          ${this.sensors.map(sensor => html`
            <div class="sensor">
              <img
                class="box"
                src="${this._getImageSrc(sensor.allergenReplaced, sensor.day0.state)}"
              />
              ${this.config.show_text
                  ? html`
                  <span class="short-text">
                    ${sensor.allergenShort} (${sensor.day0.state})
                  </span>`
                  : ''}
            </div>
          `)}
        </div>
      </ha-card>
    `;
  }


  _renderNormalHtml() {
    const daysBold = Boolean(this.config.days_boldfaced);
    const cols     = this.displayCols;

    return html`
      <ha-card>
        ${this.header
            ? html`<h1 class="header">${this.header}</h1>`
            : ''}
        <table class="forecast">
          <thead>
            <tr>
              <th></th>
              ${cols.map(i => html`
                <th style="font-weight: ${daysBold ? 'bold' : 'normal'}">
                  ${this.sensors[0][`day${i}`].day}
                </th>
              `)}
            </tr>
          </thead>
          ${this.sensors.map(sensor => html`
            <tr class="allergen" valign="top">
              <td>
                <!-- här använder vi översättaren -->
                <img
                  class="allergen"
                  src="${this._getImageSrc(sensor.allergenReplaced, sensor.day0.state)}"
                />
              </td>
              ${cols.map(i => html`
                <td>
                  <img
                    src="${this._getImageSrc('', sensor[`day${i}`].state)}"
                  />
                </td>
              `)}
            </tr>
            ${this.config.show_text ? html`
              <tr class="allergen" valign="top">
                <td>${sensor.allergenCapitalized}</td>
                ${cols.map(i => html`
                  <td><p>${sensor[`day${i}`].state_text}</p></td>
                `)}
              </tr>
            ` : ''}
          `)}
        </table>
      </ha-card>
    `;
  }

  render() {
    // Om vi inte har någon sensordata alls, visa fel
    if (!this.sensors.length) {
      const name = this.config.integration === 'dwd'
        ? 'DWD Pollenflug'
        : 'PollenPrognos';
      return html`
    <ha-card>
      <div class="card-error">
        ${this._t('error')} (${name})
      </div>
    </ha-card>
  `;
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
    /* Rubrik: lägg på 16px sidopadding för att matcha innehållet */
    .header {
      margin: 0;
      padding: 4px 16px 12px; /* top 4, sidor 16, bottom 12px */
      @apply --paper-font-headline;
      line-height: 40px;
      color: var(--primary-text-color);
    }

    .forecast {
      width:100%;
      padding:7px;
    }
    td {
      padding:1px;
      text-align:center;
      width:100px;
      font-size:smaller;
    }
    img.allergen {
      width:40px;
      height:40px;
    }
    img {
      width:50px;
      height:50px;
    }
    .flex-container {
      display:flex;
      flex-wrap:wrap;
      justify-content:space-evenly;
      align-items:center;
      padding:16px;
    }
    .sensor {
      flex:1;
      min-width:20%;
      text-align:center;
    }
    .short-text {
      display:block;
    }
    .card-error {
      padding:16px;
      color:var(--error-text-color,#b71c1c);
      font-weight:500;
      line-height:1.4;
    }
    .card-error a {
      color:var(--primary-color);
      text-decoration:underline;
    }
  `;
  }

}

customElements.define('pollenprognos-card', PollenPrognosCard);

export default PollenPrognosCard;

