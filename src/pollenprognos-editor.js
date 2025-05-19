import { LitElement, html, css } from 'lit';
import { stubConfigPP } from './adapters/pp.js';
import { stubConfigDWD } from './adapters/dwd.js';

// Recursive merge utility
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

const TRANSLATIONS = {
  en: {
    integration:      'Integration',
    city:             'City',
    region_id:        'Region ID',
    title:            'Title (empty = auto)',
    minimal:          'Minimal',
    show_text:        'Show text',
    show_empty_days:  'Show empty days',
    days_relative:    'Relative days (today/tomorrow)',
    days_abbreviated: 'Abbreviate weekdays',
    days_uppercase:   'Uppercase weekdays',
    days_boldfaced:   'Bold weekdays',
    days_to_show:     'Days to show:',
    pollen_threshold: 'Threshold:',
    sort:             'Sort order',
    locale:           'Locale',
    allergens:        'Allergens',
    phrases_full:     'Phrases – full',
    phrases_short:    'Phrases – short',
    phrases_levels:   'Phrases – levels',
    phrases_days:     'Phrases – days',
    no_information:   'No information',
    debug:            'Debug',
  },
  sv: {
    integration:      'Integration',
    city:             'Stad',
    region_id:        'Region ID',
    title:            'Titel (tom = auto)',
    minimal:          'Minimal',
    show_text:        'Visa text',
    show_empty_days:  'Visa tomma dagar',
    days_relative:    'Relativa dagar (idag/imorgon)',
    days_abbreviated: 'Förkorta veckodagar',
    days_uppercase:   'Versaler veckodagar',
    days_boldfaced:   'Fetstil veckodagar',
    days_to_show:     'Antal dagar:',
    pollen_threshold: 'Tröskelvärde:',
    sort:             'Sortering',
    locale:           'Locale',
    allergens:        'Allergener',
    phrases_full:     'Fraser – full',
    phrases_short:    'Fraser – kort',
    phrases_levels:   'Fraser – nivåer',
    phrases_days:     'Fraser – dagar',
    no_information:   'Ingen information',
    debug:            'Debug',
  },
  de: {
    integration:      'Integration',
    city:             'Stadt',
    region_id:        'Region ID',
    title:            'Titel (leer = Auto)',
    minimal:          'Minimal',
    show_text:        'Text anzeigen',
    show_empty_days:  'Leere Tage anzeigen',
    days_relative:    'Relative Tage (heute/morgen)',
    days_abbreviated: 'Wochentage abkürzen',
    days_uppercase:   'Wochentage groß',
    days_boldfaced:   'Wochentage fett',
    days_to_show:     'Anzahl Tage:',
    pollen_threshold: 'Schwelle:',
    sort:             'Sortierung',
    locale:           'Locale',
    allergens:        'Allergene',
    phrases_full:     'Phrasen – full',
    phrases_short:    'Phrasen – kurz',
    phrases_levels:   'Phrasen – Stufen',
    phrases_days:     'Phrasen – Tage',
    no_information:   'Keine Information',
    debug:            'Debug',
  }
};

class PollenPrognosCardEditor extends LitElement {
  static get properties() {
    return {
      _config:         { type: Object },
      hass:            { type: Object },
      installedCities: { type: Array },
      _initDone:       { type: Boolean }
    };
  }

  /** Hämta tvåbokstavskod, fallback ’en’ */
  get _lang() {
    // HA:s språk, annars browser
    const ha = this._hass?.language?.slice(0,2);
    const nav = navigator.language?.slice(0,2);
    return (ha || nav || 'en').toLowerCase();
  }

  /** Översätt nyckel till korrekt label */
  _t(key) {
    return (TRANSLATIONS[this._lang] || TRANSLATIONS.en)[key] || key;
  }
  constructor() {
    super();
    // initialize with PP stub
    this._config = deepMerge(stubConfigPP, {});
    this.installedCities = [];
    this._initDone = false;
  }

  setConfig(config) {
    // if switching integration, reset to that stub
    if (this._config.integration !== config.integration) {
      const base = config.integration === 'dwd' ? stubConfigDWD : stubConfigPP;
      this._config = deepMerge(base, config);
    } else {
      this._config = deepMerge(this._config, config);
    }
    this.requestUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    // detect installed cities for PP
    const keys = Object.keys(hass.states)
      .filter(id => id.startsWith('sensor.pollen_'))
      .map(id => id.slice('sensor.pollen_'.length).split('_')[0]);
    const uniq = [...new Set(keys)];
    // map to display names using stub list
    const allNames = Object.keys(stubConfigPP.phrases?.days).length ? [] : [];
    // use stubConfigPP allergen list for possible cities
    const possible = [
      'Borlänge','Bräkne-Hoby','Eskilstuna','Forshaga','Gävle','Göteborg',
      'Hässleholm','Jönköping','Kristianstad','Ljusdal','Malmö',
      'Norrköping','Nässjö','Piteå','Skövde','Stockholm',
      'Storuman','Sundsvall','Umeå','Visby','Västervik','Östersund'
    ];
    const keyFor = n => n.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g,'o').replace(/[-\s]/g,'_');
    this.installedCities = possible
      .filter(name => uniq.includes(keyFor(name)))
      .sort((a,b)=>a.localeCompare(b));

    // for PP auto-select first installed
    if (!this._initDone && this._config.integration === 'pp' && !this._config.city && this.installedCities.length) {
      this._updateConfig('city', this.installedCities[0]);
    }
    this._initDone = true;
  }

  _onAllergenToggle(allergen, checked) {
    const s = new Set(this._config.allergens);
    checked ? s.add(allergen) : s.delete(allergen);
    this._updateConfig('allergens', [...s]);
  }

  _updateConfig(prop, value) {
    const cfg = { ...this._config, [prop]: value };
    this._config = cfg;
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: cfg }, bubbles: true, composed: true
    }));
  }

render() {
  const c = this._config;
  const t = key => this._t(key);

  return html`
    <div class="card-config">
      <!-- Integration selector -->
      <ha-formfield label="${t('integration')}">
        <ha-select
          .value=${c.integration}
          @selected=${e => this._updateConfig('integration', e.target.value)}
          @closed=${e => e.stopPropagation()}
        >
          <mwc-list-item value="pp">PollenPrognos (SMHI)</mwc-list-item>
          <mwc-list-item value="dwd">DWD Pollenflug</mwc-list-item>
        </ha-select>
      </ha-formfield>

      <!-- City or Region -->
      ${c.integration === 'pp' ? html`
        <ha-formfield label="${t('city')}">
          <ha-select
            .value=${c.city || ''}
            @selected=${e => this._updateConfig('city', e.target.value)}
            @closed=${e => e.stopPropagation()}
          >
            ${this.installedCities.map(city => html`
              <mwc-list-item .value=${city}>${city}</mwc-list-item>
            `)}
          </ha-select>
        </ha-formfield>
      ` : html`
        <ha-formfield label="${t('region_id')}">
          <ha-textfield
            .value=${c.region_id || ''}
            placeholder="${t('region_id')}"
            @input=${e => this._updateConfig('region_id', e.target.value)}
          ></ha-textfield>
        </ha-formfield>
      `}

      <!-- Title -->
      <ha-formfield label="${t('title')}">
        <ha-textfield
          .value=${c.title || ''}
          placeholder="${t('title')}"
          @input=${e => this._updateConfig('title', e.target.value || undefined)}
        ></ha-textfield>
      </ha-formfield>

      <!-- Layout switches -->
      <ha-formfield label="${t('minimal')}">
        <ha-switch
          .checked=${c.minimal}
          @change=${e => this._updateConfig('minimal', e.target.checked)}
        ></ha-switch>
      </ha-formfield>
      <ha-formfield label="${t('show_text')}">
        <ha-switch
          .checked=${c.show_text}
          @change=${e => this._updateConfig('show_text', e.target.checked)}
        ></ha-switch>
      </ha-formfield>
      <ha-formfield label="${t('show_empty_days')}">
        <ha-switch
          .checked=${c.show_empty_days}
          @change=${e => this._updateConfig('show_empty_days', e.target.checked)}
        ></ha-switch>
      </ha-formfield>

      <!-- Day settings -->
      <ha-formfield label="${t('days_relative')}">
        <ha-switch
          .checked=${c.days_relative}
          @change=${e => this._updateConfig('days_relative', e.target.checked)}
        ></ha-switch>
      </ha-formfield>
      <ha-formfield label="${t('days_abbreviated')}">
        <ha-switch
          .checked=${c.days_abbreviated}
          @change=${e => this._updateConfig('days_abbreviated', e.target.checked)}
        ></ha-switch>
      </ha-formfield>
      <ha-formfield label="${t('days_uppercase')}">
        <ha-switch
          .checked=${c.days_uppercase}
          @change=${e => this._updateConfig('days_uppercase', e.target.checked)}
        ></ha-switch>
      </ha-formfield>
      <ha-formfield label="${t('days_boldfaced')}">
        <ha-switch
          .checked=${c.days_boldfaced}
          @change=${e => this._updateConfig('days_boldfaced', e.target.checked)}
        ></ha-switch>
      </ha-formfield>

      <!-- Days to show slider -->
      <ha-formfield label="${t('days_to_show')} ${c.days_to_show}">
        <ha-slider
          min="0" max="6" step="1"
          .value=${c.days_to_show}
          @change=${e => this._updateConfig('days_to_show', Number(e.target.value))}
        ></ha-slider>
      </ha-formfield>

      <!-- Pollen threshold -->
      <ha-formfield label="${t('pollen_threshold')} ${c.pollen_threshold}">
        <ha-slider
          min="0" max="6" step="1"
          .value=${c.pollen_threshold}
          @change=${e => this._updateConfig('pollen_threshold', Number(e.target.value))}
        ></ha-slider>
      </ha-formfield>

      <!-- Sort order -->
      <ha-formfield label="${t('sort')}">
        <ha-select
          .value=${c.sort}
          @selected=${e => this._updateConfig('sort', e.target.value)}
          @closed=${e => e.stopPropagation()}
        >
          ${[
            'value_ascending',
            'value_descending',
            'name_ascending',
            'name_descending'
          ].map(o => html`
            <mwc-list-item .value=${o}>${o.replace('_',' ')}</mwc-list-item>
          `)}
        </ha-select>
      </ha-formfield>

      <!-- Date locale -->
      <ha-formfield label="${t('locale')}">
        <ha-textfield
          .value=${c.date_locale}
          @input=${e => this._updateConfig('date_locale', e.target.value)}
        ></ha-textfield>
      </ha-formfield>

      <!-- Allergens -->
      <details>
        <summary>${t('allergens')}</summary>
        <div class="allergens-group">
          ${stubConfigPP.allergens.map(a => html`
            <ha-formfield .label=${a}>
              <ha-checkbox
                .checked=${c.allergens.includes(a)}
                @change=${e => this._onAllergenToggle(a, e.target.checked)}
              ></ha-checkbox>
            </ha-formfield>
          `)}
        </div>
      </details>

      <!-- Phrases sections -->
      <h3>${t('phrases_full')}</h3>
      <details>
        <summary>${t('phrases_full')}</summary>
        ${stubConfigPP.allergens.map(a => html`
          <ha-formfield .label=${a}>
            <ha-textfield
              .value=${c.phrases.full[a] || ''}
              @input=${e => {
                const p = { ...c.phrases, full: { ...c.phrases.full, [a]: e.target.value }};
                this._updateConfig('phrases', p);
              }}
            ></ha-textfield>
          </ha-formfield>
        `)}
      </details>

      <details>
        <summary>${t('phrases_short')}</summary>
        ${stubConfigPP.allergens.map(a => html`
          <ha-formfield .label=${a}>
            <ha-textfield
              .value=${c.phrases.short[a] || ''}
              @input=${e => {
                const p = { ...c.phrases, short: { ...c.phrases.short, [a]: e.target.value }};
                this._updateConfig('phrases', p);
              }}
            ></ha-textfield>
          </ha-formfield>
        `)}
      </details>

      <details>
        <summary>${t('phrases_levels')}</summary>
        ${Array.from({ length: 7 }, (_, i) => html`
          <ha-formfield .label=${i}>
            <ha-textfield
              .value=${c.phrases.levels[i] || ''}
              @input=${e => {
                const lv = [...(c.phrases.levels || [])];
                lv[i] = e.target.value;
                const p = { ...c.phrases, levels: lv };
                this._updateConfig('phrases', p);
              }}
            ></ha-textfield>
          </ha-formfield>
        `)}
      </details>

      <details>
        <summary>${t('phrases_days')}</summary>
        ${[0,1,2].map(i => html`
          <ha-formfield .label=${i}>
            <ha-textfield
              .value=${c.phrases.days[i] || ''}
              @input=${e => {
                const dd = { ...(c.phrases.days || {}) };
                dd[i] = e.target.value;
                const p = { ...c.phrases, days: dd };
                this._updateConfig('phrases', p);
              }}
            ></ha-textfield>
          </ha-formfield>
        `)}
      </details>

      <ha-formfield label="${t('no_information')}">
        <ha-textfield
          .value=${c.phrases.no_information || ''}
          @input=${e => {
            const p = { ...c.phrases, no_information: e.target.value };
            this._updateConfig('phrases', p);
          }}
        ></ha-textfield>
      </ha-formfield>

      <!-- Debug -->
      <ha-formfield label="${t('debug')}">
        <ha-switch
          .checked=${c.debug}
          @change=${e => this._updateConfig('debug', e.target.checked)}
        ></ha-switch>
      </ha-formfield>
    </div>
  `;
}

  static get styles() {
    return css`
      .card-config { display:flex; flex-direction:column; gap:12px; padding:16px; }
      ha-formfield, details { margin-bottom:8px; }
      .allergens-group { display:flex; flex-wrap:wrap; gap:8px; }
      details summary { cursor:pointer; font-weight:bold; margin:8px 0; }
      ha-slider { width:100%; }
      ha-select { width:100%; --mdc-theme-primary: var(--primary-color); }
    `;
  }
}

customElements.define('pollenprognos-card-editor', PollenPrognosCardEditor);

