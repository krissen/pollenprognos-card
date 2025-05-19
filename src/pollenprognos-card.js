import { LitElement, html, css } from 'lit';
import { images } from './pollenprognos-images.js';

import * as PP from './adapters/pp.js';
import * as DWD from './adapters/dwd.js';

import { stubConfigPP }  from './adapters/pp.js';
import { stubConfigDWD } from './adapters/dwd.js';

const DWD_REGIONS = {
  '11': 'Schleswig-Holstein und Hamburg',
  '12': 'Schleswig-Holstein und Hamburg',
  '20': 'Mecklenburg-Vorpommern',
  '31': 'Niedersachsen und Bremen',
  '32': 'Niedersachsen und Bremen',
  '41': 'Nordrhein-Westfalen',
  '42': 'Nordrhein-Westfalen',
  '43': 'Nordrhein-Westfalen',
  '50': 'Brandenburg und Berlin',
  '61': 'Sachsen-Anhalt',
  '62': 'Sachsen-Anhalt',
  '71': 'Thüringen',
  '72': 'Thüringen',
  '81': 'Sachsen',
  '82': 'Sachsen',
  '91': 'Hessen',
  '92': 'Hessen',
  '101': 'Rheinland-Pfalz und Saarland',
  '102': 'Rheinland-Pfalz und Saarland',
  '103': 'Rheinland-Pfalz und Saarland',
  '111': 'Baden-Württemberg',
  '112': 'Baden-Württemberg',
  '113': 'Baden-Württemberg',
  '121': 'Bayern',
  '122': 'Bayern',
  '123': 'Bayern',
  '124': 'Bayern',
};
const TRANSLATIONS = {
  en: {
    header_prefix:   'Pollen forecast for',
    error:           'No pollen sensors found. Have you installed the correct integration and selected a region in the card config?'
  },
  sv: {
    header_prefix:   'Pollenprognos för',
    error:           'Inga pollen-sensorer hittades. Har du installerat rätt integration och valt region i kortets konfiguration?'
  },
  de: {
    header_prefix:   'Pollenprognose für',
    error:           'Keine Pollensensoren gefunden. Haben Sie die richtige Integration installiert und eine Region in der Kartenkonfiguration ausgewählt?'
  }
};

const ALLERGEN_TRANSLATION = {
  // Svenska
  al:               'alder',
  alm:              'elm',
  bjork:            'birch',
  ek:               'oak',
  grabo:            'mugwort',
  gras:             'grass',
  hassel:           'hazel',
  malortsambrosia:  'ragweed',
  salg_och_viden:   'willow',

  // Tyska (DWD), normaliserade via replaceAAO
  erle:     'alder',
  ambrosia: 'ragweed',
  esche:    'ash',
  birke:    'birch',
  hasel:    'hazel',
  graeser:  'grass',    // från 'gräser'
  beifuss:  'mugwort',  // från 'beifuss'
  roggen:   'rye'
};


const ADAPTERS = {
  pp: PP,
  dwd: DWD
};

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
    this.sensors = [];
    this.days_to_show = 4;
    this.displayCols = [];
    this.header = '';
    this._initDone = false;
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
    // 1) Börja med PP-stub
    const defaults = stubConfigPP;
    // 2) Slå ihop stub + user-config, men radera stub.integration om användaren inte satt något
    const merged = { ...defaults, ...config };
    if (!config.hasOwnProperty('integration')) {
      delete merged.integration;
    }
    this.config = merged;

    // 3) Om det *verkligen* var en manuell DWD-val → ersätt stub-värden
    if (this.config.integration === 'dwd') {
      this.config.allergens    = stubConfigDWD.allergens;
      this.config.days_to_show = stubConfigDWD.days_to_show;
      this.config.date_locale  = stubConfigDWD.date_locale;
    }

    // 4) Markera explicit ENDAST om integration skiljer sig från PP-stubben
    this._integrationExplicit =
      config.hasOwnProperty('integration') &&
      config.integration !== stubConfigPP.integration;

    this._initDone = false;
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;

    // 1) Läs av användar-explicit val
    const explicit = !!this._integrationExplicit;

    // 2) Hämta vilka sensorer som finns
    const ppStates  = Object.keys(hass.states).filter(s => s.startsWith('sensor.pollen_'));
    const dwdStates = Object.keys(hass.states).filter(s => s.startsWith('sensor.pollenflug_'));

    // 3) Bestäm integration (PP om explict valt, annars PP om finns, annars DWD om finns)
    let integration = this.config.integration;
    if (!explicit) {
      if (ppStates.length)       integration = 'pp';
      else if (dwdStates.length) integration = 'dwd';
    }

    // 4) **Fallback**: om vi nu landade på PP men det finns inga PP-sensorer, men det finns DWD → kör DWD direkt
    if (!explicit && integration === 'pp' && ppStates.length === 0 && dwdStates.length) {
      integration = 'dwd';
    }

    // 5) Ta fram rätt stub-defaults och slå ihop med user-config
    const stubPP  = PollenPrognosCard.getStubConfig();
    const stubDWD = DWD.stubConfigDWD;
    const baseStub = integration === 'dwd' ? stubDWD : stubPP;

      console.debug('📡 fallback check', { explicit, pp: ppStates.length, dwd: dwdStates.length, integration });


    const cfg = {
      ...baseStub,
      ...this.config,
      integration,
    };

    // 6) Om DWD, auto-välj första region om saknas
    if (integration === 'dwd') {
      if (!cfg.region_id && dwdStates.length) {
        cfg.region_id = Array.from(new Set(dwdStates.map(id => id.split('_').pop())))
          .sort((a,b)=>Number(a)-Number(b))[0];
      }
    } else {
      // PP: auto-välj första stad om saknas
      if (!cfg.city && ppStates.length) {
        cfg.city = ppStates[0]
          .slice('sensor.pollen_'.length)
          .split('_')
          .slice(0, -1)
          .join('_');
      }
    }

    // 7) Spara config och rubrik
    this.config = cfg;
    if (typeof cfg.title === 'string') this.header = cfg.title;
    else if (cfg.title === false)      this.header = '';
    else {
      const loc = cfg.integration === 'dwd'
        ? (DWD_REGIONS[cfg.region_id] || cfg.region_id)
        : cfg.city;
      this.header = `${this._t('header_prefix')} ${loc}`;
    }

    // 8) Hämta prognosen
    const adapter = ADAPTERS[cfg.integration] || PP;
    adapter.fetchForecast(hass, cfg)
      .then(sensors => {
        this.sensors      = sensors;
        this.days_to_show = cfg.days_to_show;
        this.displayCols  = Array.from(
          { length: cfg.show_empty_days
            ? cfg.days_to_show
            : (sensors[0]?.days?.length || 0)
          },
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

