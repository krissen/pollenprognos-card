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

const REGION_MAP = {
  11: 'Schleswig-Holstein und Hamburg',
  12: 'Schleswig-Holstein und Hamburg',
  20: 'Mecklenburg-Vorpommern',
  31: 'Niedersachsen und Bremen',
  // … och så vidare …
  124: 'Mainfranken'
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
    phrases:          'Phrases',
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
    phrases:          'Fraser',
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
    phrases:          'Phrasen',
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
      installedRegions:{ type: Array },
      installedRegionIds: { type: Array },
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
    this._config = deepMerge(stubConfigPP, {});
    this.installedCities = [];
    this.installedRegions = [];
    this._initDone = false;
  }

  setConfig(config) {
    // 1) Om vi byter integration, återställ helt mot stub och slå ihop
    if (this._config.integration !== config.integration) {
      const base = config.integration === 'dwd' ? stubConfigDWD : stubConfigPP;
      // börja från ett rent stub-objekt
      this._config = deepMerge(base, {});
      // slå på användarens egna overrides
      this._config = deepMerge(this._config, config);
      // återställ days_to_show & locale till stub-värden
      this._config.days_to_show = base.days_to_show;
      this._config.date_locale  = base.date_locale;
      this._config.allergens = base.allergens;
    } else {
      // samma integration, bara merge in nya värden
      this._config = deepMerge(this._config, config);
    }

    // säkerställ att type alltid ligger kvar – annars kan inte förhandsvisningen ritas
    this._config = { ...this._config, type: 'custom:pollenprognos-card' };

    this.requestUpdate();
  }

  set hass(hass) {
    this._hass = hass;

    // Hitta alla PP- och DWD-sensorer
    const ppStates  = Object.keys(hass.states)
      .filter(id => id.startsWith('sensor.pollen_'));
    const dwdStates = Object.keys(hass.states)
      .filter(id => id.startsWith('sensor.pollenflug_'));

    // 1) Auto-välj integration EN GÅNG: PP om vi har några PP-sensorer,
    // annars DWD om vi har några DWD-sensorer
    if (!this._initDone) {
      if (ppStates.length) {
        this._updateConfig('integration', 'pp');
      } else if (dwdStates.length) {
        this._updateConfig('integration', 'dwd');
      }
    }

    // 2) Bygg lista med installerade DWD‐regionkoder
    const regionIds = Array.from(new Set(
      dwdStates.map(id => id.split('_').pop())
    )).sort((a, b) => Number(a) - Number(b));
    this.installedRegionIds = regionIds;

    // 3) Om DWD och inget region_id valt → välj första
    if (this._config.integration === 'dwd' && regionIds.length && !this._config.region_id) {
      this._updateConfig('region_id', regionIds[0]);
    }

    // 4) Bygg lista installerade PP-städer (hela key före sista “_”)
    const ppKeys = ppStates.map(id => {
      const rem = id.slice('sensor.pollen_'.length);
      return rem.slice(0, rem.lastIndexOf('_'));
    });
    const uniqCities = Array.from(new Set(ppKeys));
    const possible   = [
      'Borlänge','Bräkne-Hoby','Eskilstuna','Forshaga','Gävle','Göteborg',
      'Hässleholm','Jönköping','Kristianstad','Ljusdal','Malmö',
      'Norrköping','Nässjö','Piteå','Skövde','Stockholm',
      'Storuman','Sundsvall','Umeå','Visby','Västervik','Östersund'
    ];
    const keyFor = name => name.toLowerCase()
      .replace(/[åä]/g,'a').replace(/ö/g,'o')
      .replace(/[-\s]/g,'_');
    this.installedCities = possible
      .filter(city => uniqCities.includes(keyFor(city)))
      .sort((a, b) => a.localeCompare(b));

    // 5) Om PP och inget city valt → välj första
    if (!this._initDone
      && this._config.integration === 'pp'
      && !this._config.city
      && this.installedCities.length) {
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
  // Börja alltid från det som redan finns
  const cfg = { ...this._config };

  if (prop === 'integration') {
    // Välj ny integration
    cfg.integration = value;
    // Hämta stub för den nya integrationen
    const base = value === 'dwd' ? stubConfigDWD : stubConfigPP;
    // Nollställ enbart days_to_show och date_locale
    cfg.days_to_show = base.days_to_show;
    cfg.date_locale  = base.date_locale;
    cfg.allergens = base.allergens;
    // Släng bort det gamle integrations-fältet
    if (value === 'dwd') {
      delete cfg.city;
      // (valfritt) auto-välj första region_id om ej satt
      if (!cfg.region_id && this.installedRegionIds?.length) {
        cfg.region_id = this.installedRegionIds[0];
      }
    } else {
      delete cfg.region_id;
      // (valfritt) auto-välj första stad om ej satt
      if (!cfg.city && this.installedCities?.length) {
        cfg.city = this.installedCities[0];
      }
    }
  } else {
    // Bara ett vanligt fältbyte
    cfg[prop] = value;
  }

  // Se till att type alltid finns kvar
  cfg.type = this._config.type || 'custom:pollenprognos-card';

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
      <!-- Integration -->
      <ha-formfield label="${t('integration')}">
        <ha-select
          .value=${c.integration}
          @selected=${e => this._updateConfig('integration', e.target.value)}
          @closed=${e => e.stopPropagation()}
        >
          <mwc-list-item value="pp">PollenPrognos</mwc-list-item>
          <mwc-list-item value="dwd">DWD Pollenflug</mwc-list-item>
        </ha-select>
      </ha-formfield>

      <!-- Stad (PP) eller Region (DWD) -->
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
          <ha-select
            .value=${c.region_id || ''}
            @selected=${e => this._updateConfig('region_id', e.target.value)}
            @closed=${e => e.stopPropagation()}
          >
            ${this.installedRegionIds.map(id => html`
              <mwc-list-item .value=${id}>
                ${id} — ${DWD_REGIONS[id] || id}
              </mwc-list-item>
            `)}
          </ha-select>
        </ha-formfield>
      `}

      <!-- Titel -->
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
    <h3>${t('phrases')}</h3>
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

