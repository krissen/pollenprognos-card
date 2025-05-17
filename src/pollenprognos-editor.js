// src/pollenprognos-editor.js

import { LitElement, html, css } from 'lit';

// --- Hjälpfunktion för rekursiv merge ---
const deepMerge = (target, source) => {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof target[key] === 'object' &&
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
  static get properties() {
    return {
      _config:         { type: Object },
      hass:            { type: Object },
      installedCities: { type: Array },
      _initDone:       { type: Boolean },
    };
  }

  constructor() {
    super();
    this._config = {
      city:             '',
      allergens:        [],
      days_to_show:     4,
      days_relative:    true,
      days_abbreviated: false,
      days_uppercase:   false,
      days_boldfaced:   false,
      minimal:          false,
      show_text:        false,
      show_empty_days:  true,
      pollen_threshold: 1,
      sort:             'value_descending',
      date_locale:      'sv-SE',
      title:            undefined,
      debug:            false,
      phrases: {
        full: {},
        short: {},
        levels: [],
        days: {},
        no_information: ''
      }
    };
    this.installedCities = [];
    this._initDone = false;
  }

  setConfig(config) {
    this._config = deepMerge(this._config, config);
  }

  set hass(hass) {
    this._hass = hass;
    // Bygg lista med installerade städer
    const installedKeys = new Set(
      Object.keys(hass.states)
        .filter(id => id.startsWith('sensor.pollen_'))
        .map(id => {
          const rem = id.slice('sensor.pollen_'.length);
          return rem.slice(0, rem.lastIndexOf('_'));
        })
    );
    const possibleCities = [
      'Borlänge','Bräkne-Hoby','Eskilstuna','Forshaga','Gävle','Göteborg',
      'Hässleholm','Jönköping','Kristianstad','Ljusdal','Malmö',
      'Norrköping','Nässjö','Piteå','Skövde','Stockholm',
      'Storuman','Sundsvall','Umeå','Visby','Västervik','Östersund'
    ];
    const keyFor = name => name.toLowerCase()
      .replace(/[åä]/g,'a').replace(/ö/g,'o')
      .replace(/[-\s]/g,'_');

    this.installedCities = possibleCities
      .filter(city => installedKeys.has(keyFor(city)))
      .sort((a, b) => a.localeCompare(b));

    if (!this._initDone && !this._config.city && this.installedCities.length) {
      this._updateConfig('city', this.installedCities[0]);
    }
    this._initDone = true;
  }

  get allAllergens() {
    return [
      'Al','Alm','Björk','Ek','Malörtsambrosia',
      'Gråbo','Gräs','Hassel','Sälg och viden'
    ];
  }

  render() {
    const cityValue = this._config.city || '';
    return html`
      <div class="card-config">
        <!-- Stad -->
        <ha-formfield label="Stad">
          <ha-select
            style="width:100%"
            .value=${cityValue}
            @selected=${e => {
              e.stopPropagation();
              this._updateConfig('city', e.target.value);
            }}
            @closed=${e => e.stopPropagation()}
          >
            ${this.installedCities.map(city => html`
              <mwc-list-item .value=${city}>${city}</mwc-list-item>
            `)}
          </ha-select>
        </ha-formfield>

        <!-- Egen titel -->
        <ha-formfield label="Titel (tom = auto)">
          <ha-textfield
            .value=${this._config.title || ''}
            placeholder="Ange egen titel eller lämna tom"
            @input=${e => this._updateConfig('title', e.target.value || undefined)}
          ></ha-textfield>
        </ha-formfield>

        <!-- Layout-switchar -->
        <ha-formfield label="Minimal layout">
          <ha-switch
            .checked=${this._config.minimal}
            @change=${e => this._updateConfig('minimal', e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="Visa text under ikoner">
          <ha-switch
            .checked=${this._config.show_text}
            @change=${e => this._updateConfig('show_text', e.target.checked)}
          ></ha-switch>
        </ha-formfield>

        <!-- Veckodagar -->
        <ha-formfield label="Visa tomma dagar">
          <ha-switch
            .checked=${this._config.show_empty_days}
            @change=${e => this._updateConfig('show_empty_days', e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label='Relativa dagar ("idag" vs veckodag)'>
          <ha-switch
            .checked=${this._config.days_relative}
            @change=${e => this._updateConfig('days_relative', e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="Förkorta veckodagar (inte relativa)">
          <ha-switch
            .checked=${this._config.days_abbreviated}
            @change=${e => this._updateConfig('days_abbreviated', e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="Veckodagar i versaler">
          <ha-switch
            .checked=${this._config.days_uppercase}
            @change=${e => this._updateConfig('days_uppercase', e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="Veckodagar i fetstil">
          <ha-switch
            .checked=${this._config.days_boldfaced}
            @change=${e => this._updateConfig('days_boldfaced', e.target.checked)}
          ></ha-switch>
        </ha-formfield>

        <!-- Dagar och tröskel -->
        <ha-formfield label="Antal dagar att visa: ${this._config.days_to_show}">
          <ha-slider
            min="0" max="4" step="1"
            .value=${this._config.days_to_show}
            @change=${e => this._updateConfig('days_to_show', Number(e.target.value))}
          ></ha-slider>
        </ha-formfield>

        <!-- Allergener -->
        <details>
          <summary>Allergener</summary>
          <div class="allergens-group">
            ${this.allAllergens.map(allergen => html`
              <ha-formfield .label=${allergen}>
                <ha-checkbox
                  .checked=${this._config.allergens.includes(allergen)}
                  @change=${e => this._onAllergenToggle(allergen, e.target.checked)}
                ></ha-checkbox>
              </ha-formfield>
            `)}
          </div>
        </details>

        <ha-formfield label="Tröskelvärde av pollen för visning: ${this._config.pollen_threshold}">
          <ha-slider
            min="0" max="6" step="1"
            .value=${this._config.pollen_threshold}
            @change=${e => this._updateConfig('pollen_threshold', Number(e.target.value))}
          ></ha-slider>
        </ha-formfield>

        <!-- Sortering -->
        <ha-formfield label="Sorteringsordning för allergener">
          <ha-select
            style="width:100%"
            .value=${this._config.sort}
            @selected=${e => {
              e.stopPropagation();
              this._updateConfig('sort', e.target.value);
            }}
            @closed=${e => e.stopPropagation()}
          >
            ${[
              'value_ascending','value_descending',
              'name_ascending','name_descending'
            ].map(o => html`
              <mwc-list-item .value=${o}>${o.replace('_',' ')}</mwc-list-item>
            `)}
          </ha-select>
        </ha-formfield>

        <!-- Fraser -->
        <h3>Fraser</h3>
        <ha-formfield label="Locale för veckodagar">
          <ha-textfield
            .value=${this._config.date_locale}
            placeholder="t.ex. sv-SE eller en-GB"
            @input=${e => this._updateConfig('date_locale', e.target.value)}
          ></ha-textfield>
        </ha-formfield>

        <details>
          <summary>phrases.full (fullständiga namn)</summary>
          ${this.allAllergens.map(allergen => html`
            <ha-formfield .label=${allergen}>
              <ha-textfield
                .value=${this._config.phrases.full[allergen]||''}
                @input=${e => {
                  const p = { ...this._config.phrases };
                  p.full = { ...p.full, [allergen]: e.target.value };
                  this._updateConfig('phrases', p);
                }}
              ></ha-textfield>
            </ha-formfield>
          `)}
        </details>

        <details>
          <summary>phrases.short (kortnamn)</summary>
          ${this.allAllergens.map(allergen => html`
            <ha-formfield .label=${allergen}>
              <ha-textfield
                .value=${this._config.phrases.short[allergen]||''}
                @input=${e => {
                  const p = { ...this._config.phrases };
                  p.short = { ...p.short, [allergen]: e.target.value };
                  this._updateConfig('phrases', p);
                }}
              ></ha-textfield>
            </ha-formfield>
          `)}
        </details>

        <details>
          <summary>phrases.levels (värde 0–6)</summary>
          ${Array.from({ length: 7 }, (_, i) => html`
            <ha-formfield .label=${i}>
              <ha-textfield
                .value=${this._config.phrases.levels[i]||''}
                @input=${e => {
                  const p = { ...this._config.phrases };
                  const lv = [...(p.levels||[])];
                  lv[i] = e.target.value;
                  p.levels = lv;
                  this._updateConfig('phrases', p);
                }}
              ></ha-textfield>
            </ha-formfield>
          `)}
        </details>

        <ha-formfield label="no_information">
          <ha-textfield
            .value=${this._config.phrases.no_information||''}
            @input=${e => {
              const p = { ...this._config.phrases };
              p.no_information = e.target.value;
              this._updateConfig('phrases', p);
            }}
          ></ha-textfield>
        </ha-formfield>

        <details>
          <summary>phrases.days (0=idag,1=imorgon,2=övermorgon)</summary>
          ${[0,1,2].map(i => html`
            <ha-formfield .label=${i}>
              <ha-textfield
                .value=${this._config.phrases.days[i]||''}
                @input=${e => {
                  const p = { ...this._config.phrases };
                  const dd = { ...(p.days||{}) };
                  dd[i] = e.target.value;
                  p.days = dd;
                  this._updateConfig('phrases', p);
                }}
              ></ha-textfield>
            </ha-formfield>
          `)}
        </details>

        <!-- Debug-switch -->
        <ha-formfield label="Debug-läge">
          <ha-switch
            .checked=${this._config.debug}
            @change=${e => this._updateConfig('debug', e.target.checked)}
          ></ha-switch>
        </ha-formfield>
      </div>
    `;
  }

  _onAllergenToggle(allergen, checked) {
    const s = new Set(this._config.allergens);
    checked ? s.add(allergen) : s.delete(allergen);
    this._updateConfig('allergens', [...s]);
  }

  _updateConfig(prop, value) {
    const newConfig = { ...this._config, [prop]: value };
    this._config = newConfig;
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: newConfig },
      bubbles: true, composed: true
    }));
  }

  static get styles() {
    return css`
      .card-config { display:flex; flex-direction:column; gap:12px; padding:16px; }
      ha-formfield, details { margin-bottom:8px; }
      .allergens-group { display:flex; flex-wrap:wrap; gap:8px; }
      details summary { cursor:pointer; font-weight:bold; margin:8px 0; }
      ha-slider { width:100%; }
      ha-select { --mdc-theme-primary: var(--primary-color); }
    `;
  }
}

customElements.define('pollenprognos-card-editor', PollenPrognosCardEditor);

