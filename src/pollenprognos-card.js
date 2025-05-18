import { LitElement, html, css } from 'lit';
import { images } from './pollenprognos-images.js';

import * as PP from './adapters/pp.js';
import * as DWD from './adapters/dwd.js';

// --- lägg in högst upp i src/pollenprognos-card.js ---
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

/**
 * Returns the right Base64-inlined image from our map,
 * falling back to the global level-icons if needed.
 */
_getImageSrc(allergenReplaced, state) {
  // translate to our internal English key if available
  const key = ALLERGEN_TRANSLATION[allergenReplaced] || allergenReplaced;
  // try allergen-specific icon
  const custom = images[`${key}_${state}_png`];
  if (custom) return custom;
  // otherwise global level icon (”0_png”, “-1_png”, etc)
  return images[`${state}_png`];
}

const ADAPTERS = {
  pp: PP,
  dwd: DWD
};

class PollenPrognosCard extends LitElement {
  static properties = {
    hass:        { state: true },
    config:      {},
    sensors:     { state: true },
    days_to_show:{ state: true },
    displayCols: { state: true },
    header:      { state: true }
  };

  constructor() {
    super();
    this.sensors = [];
    this.days_to_show = 4;
    this.displayCols = [];
    this.header = '';
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
    const defaults = PollenPrognosCard.getStubConfig();
    this.config = { ...defaults, ...config };
  }

  set hass(hass) {
    this._hass = hass;
    const cfg = { ...this.config };

    // För DWD: använd region_id för city och standard-allergener
    if (cfg.integration === 'dwd') {
      cfg.city = cfg.region_id;
      cfg.allergens = DWD.stubConfigDWD.allergens;
    }

    const debug = Boolean(cfg.debug);

    // HEADER / TITLE
    if (typeof cfg.title === 'string') {
      this.header = cfg.title;
    } else if (cfg.title === false) {
      this.header = '';
    } else {
      const loc = cfg.integration === 'dwd' ? cfg.region_id : cfg.city;
      this.header = `Pollenprognos för ${loc}`;
    }

    if (debug) {
      console.log('---- pollenprognos-card start ----');
      console.log('Integration:', cfg.integration);
      console.log('Region/City:', cfg.integration === 'dwd' ? cfg.region_id : cfg.city);
      console.log('Allergens:', cfg.allergens);
    }

    const adapter = ADAPTERS[cfg.integration] || PP;
    adapter.fetchForecast(hass, cfg)
      .then(sensors => {
        this.sensors = sensors;
        this.days_to_show = cfg.days_to_show;
        this.displayCols = Array.from(
          { length: cfg.show_empty_days ? cfg.days_to_show : (sensors[0]?.days?.length || 0) },
          (_, i) => i
        );
        this.requestUpdate();
      })
      .catch(err => {
        console.error('Error fetching pollen forecast:', err);
      });
  }


_renderMinimalHtml() {
  return html`
    <ha-card>
      ${this.header ? html`<h1 class="header">${this.header}</h1>` : ''}
      <div class="flex-container">
        ${this.sensors.map(sensor => html`
          <div class="sensor">
            <img
              class="box"
              src="${this._getImageSrc(sensor.allergenReplaced, sensor.day0.state)}"
            />
            ${this.config.show_text
              ? html`<span class="short-text">
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
      ${this.header ? html`<h1 class="header">${this.header}</h1>` : ''}
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
    if (!this.sensors.length) {
      return html`
        <ha-card>
          <div class="card-error">
            Inga pollen-sensorer hittades. Har du installerat rätt integration
            och valt region i kortets konfiguration?
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
      /* Titelnhetsstyling hämtad från äldre version */
      .header {
        /* nollställ ev. använd standardmarginaler/padding */
        margin: 0;
        padding: 4px 0 12px;
        /* använd Ha-card rubrik-typografi */
        @apply --paper-font-headline;
        /* tidigar radhöjd i äldre kod */
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
        padding: 16px;
        /* återinför align-items för enhetlig vertikal centrering */
        align-items: center;
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
      .card-error a {
        color: var(--primary-color);
        text-decoration: underline;
      }
    `;
  }

}

customElements.define('pollenprognos-card', PollenPrognosCard);

export default PollenPrognosCard;

