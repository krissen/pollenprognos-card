// src/pollenprognos-editor.js
import { LitElement, html, css } from 'lit';
import { stubConfigPP } from './adapters/pp.js';
import { stubConfigDWD } from './adapters/dwd.js';

// Deep merge utility
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
      _config:   { type: Object },
      hass:      { type: Object },
      _initDone: { type: Boolean }
    };
  }

  constructor() {
    super();
    this._config = { integration: 'pp', ...deepMerge(stubConfigPP, {}) };
    this._initDone = false;
  }

  setConfig(config) {
    if (this._config.integration !== config.integration) {
      const baseStub = config.integration === 'dwd' ? stubConfigDWD : stubConfigPP;
      this._config = { integration: config.integration, ...deepMerge(baseStub, config) };
    } else {
      this._config = deepMerge(this._config, config);
    }
    this.requestUpdate();
  }

  render() {
    const c = this._config;
    return html`
      <div class="card-config">
        <ha-formfield label="Integration">
          <ha-select
            .value=${c.integration}
            @selected=${e => this._updateConfig('integration', e.target.value)}
            @closed=${e => e.stopPropagation()}
          >
            <mwc-list-item value="pp">PollenPrognos (SMHI)</mwc-list-item>
            <mwc-list-item value="dwd">DWD Pollenflug</mwc-list-item>
          </ha-select>
        </ha-formfield>

        ${c.integration === 'pp'
          ? this._renderPPConfig()
          : this._renderDWDConfig()}
      </div>
    `;
  }

  _renderPPConfig() {
    const c = this._config;
    return html`
      <ha-formfield label="Stad">
        <ha-textfield
          .value=${c.city || ''}
          placeholder="Ange stad"
          @input=${e => this._updateConfig('city', e.target.value)}
        ></ha-textfield>
      </ha-formfield>
      ${this._commonConfig()}
    `;
  }

  _renderDWDConfig() {
    const c = this._config;
    return html`
      <ha-formfield label="Region-ID (från DWD)">
        <ha-textfield
          .value=${c.region_id || ''}
          placeholder="Ange region_id"
          @input=${e => this._updateConfig('region_id', e.target.value)}
        ></ha-textfield>
      </ha-formfield>
      ${this._commonConfig()}
    `;
  }

  _commonConfig() {
    const c = this._config;
    return html`
      <ha-formfield label="Minimal layout">
        <ha-switch
          .checked=${c.minimal}
          @change=${e => this._updateConfig('minimal', e.target.checked)}
        ></ha-switch>
      </ha-formfield>

      <ha-formfield label="Visa text under ikoner">
        <ha-switch
          .checked=${c.show_text}
          @change=${e => this._updateConfig('show_text', e.target.checked)}
        ></ha-switch>
      </ha-formfield>

      <ha-formfield label="Visa tomma dagar">
        <ha-switch
          .checked=${c.show_empty_days}
          @change=${e => this._updateConfig('show_empty_days', e.target.checked)}
        ></ha-switch>
      </ha-formfield>

      <ha-slider
        label="Antal dagar att visa: ${c.days_to_show}"
        min="0" max="6" step="1"
        .value=${c.days_to_show}
        @change=${e => this._updateConfig('days_to_show', Number(e.target.value))}
      ></ha-slider>

      <ha-slider
        label="Tröskelvärde: ${c.pollen_threshold}"
        min="0" max="6" step="1"
        .value=${c.pollen_threshold}
        @change=${e => this._updateConfig('pollen_threshold', Number(e.target.value))}
      ></ha-slider>

      <ha-formfield label="Debug">
        <ha-switch
          .checked=${c.debug}
          @change=${e => this._updateConfig('debug', e.target.checked)}
        ></ha-switch>
      </ha-formfield>
    `;
  }

  _updateConfig(prop, value) {
    const newConfig = { ...this._config, [prop]: value };
    this._config = newConfig;
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: newConfig },
        bubbles: true,
        composed: true
      })
    );
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
      ha-slider,
      ha-textfield {
        width: 100%;
      }
      ha-select {
        width: 100%;
        --mdc-theme-primary: var(--primary-color);
      }
    `;
  }
}

customElements.define('pollenprognos-card-editor', PollenPrognosCardEditor);

