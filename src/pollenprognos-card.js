import { LitElement, html, css } from 'lit';

import { images } from './pollenprognos-images.js';

class PollenCardv2 extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {}
    };
  }

  static async getConfigElement() {
    await customElements.whenDefined('pollenprognos-card-editor');
    return document.createElement('pollenprognos-card-editor');
  }

  static getStubConfig() {
    return {
      city: '',
      allergens: [
        'Al','Alm','Björk','Ek','Malörtsambrosia',
        'Gråbo','Gräs','Hassel','Sälg och viden'
      ],
      minimal: false,
      show_text: true,
      show_empty_days: true,
      debug: false,
      days_to_show: 4,
      days_relative: true,
      days_abbreviated: false,
      days_uppercase: false,
      days_boldfaced: false,
      pollen_threshold: 1,
      sort: 'value_descending',
      date_locale: 'sv-SE',
      title: undefined,
      phrases: {
        full: {},
        short: {},
        levels: [],
        days: {},
        no_information: ''
      }
    };
  }

  set hass(hass) {
    this._hass = hass;
    const debug        = Boolean(this.config.debug);
    const capitalize   = s => s.charAt(0).toUpperCase() + s.slice(1);
    const parseLocal   = s => {
      const [ymd] = s.split("T");
      const [y, m, d] = ymd.split("-").map(Number);
      return new Date(y, m - 1, d);
    };
    const replaceAAO  = intext => intext.toLowerCase()
      .replaceAll("å","a").replaceAll("ä","a").replaceAll("ö","o")
      .replaceAll(" / ","_").replaceAll("-","_").replaceAll(" ","_");

    const phrases         = this.config.phrases || {};
    const allergenFull    = phrases.full  || {};
    const allergenShort   = phrases.short || {};
    const levelNames      = phrases.levels || [
      "Ingen pollen","Låga halter","Låga-måttliga halter",
      "Måttliga halter","Måttliga-höga halter","Höga halter",
      "Mycket höga halter"
    ];
    const noInfoLabel     = phrases.no_information || "(Ingen information)";
    const dayLabels       = phrases.days || {};
    const locale          = this.config.date_locale || "sv-SE";
    this.days_to_show     = this.config.days_to_show ?? 4;
    this.pollen_threshold = this.config.pollen_threshold ?? 1;
    const daysRelative    = this.config.days_relative !== false;
    const dayAbbrev       = Boolean(this.config.days_abbreviated);
    const daysUppercase   = Boolean(this.config.days_uppercase);
    const daysBoldfaced   = Boolean(this.config.days_boldfaced);
    const showEmpty       = this.config.show_empty_days == null
      ? true
      : Boolean(this.config.show_empty_days);

    // HEADER / TITLE
    if (typeof this.config.title === "string") {
      this.header = this.config.title;
    } else if (this.config.title === false) {
      this.header = "";
    } else {
      this.header = `Pollenprognos för ${capitalize(this.config.city)}`;
    }

    if (debug) console.log("---- pollenprognos-card start ----");
    if (debug) console.log("Stad:", this.config.city);
    if (debug) console.log("Allergener från config:", this.config.allergens);

    const sensors = [];
    const test_val = val => {
      const n = Number(val);
      if (isNaN(n) || n < 0) return -1;
      if (n > 6) return 6;
      return n;
    };

    // Midnatt idag
    const today = new Date(); today.setHours(0,0,0,0);

    // Loop through each allergen
    for (const allergen of this.config.allergens) {
      try {
        const dict = {};
        dict.allergenReplaced   = replaceAAO(allergen);
        dict.allergenCapitalized = allergenFull[allergen] || capitalize(allergen);
        dict.allergenShort      = allergenShort[allergen] ||
          dict.allergenCapitalized.replace("Sälg och viden","Vide");

        // Find the right sensor
        const expectedId = `sensor.pollen_${replaceAAO(this.config.city)}_${dict.allergenReplaced}`;
        let sensorId = expectedId;
        if (!hass.states[expectedId]) {
          const cands = Object.keys(hass.states).filter(id =>
            id.startsWith(`sensor.pollen_`) &&
            id.includes(dict.allergenReplaced)
          );
          if (cands.length === 1) {
            sensorId = cands[0];
          } else {
            continue;
          }
        }
        const sensor = hass.states[sensorId];
        if (!sensor?.attributes?.forecast) throw "Saknar forecast";

        // Normalize forecast to a map if it's an array
        const rawForecast = sensor.attributes.forecast;
        const forecastMap = Array.isArray(rawForecast)
          ? rawForecast.reduce((o, entry) => {
              const key = entry.time || entry.datetime;
              o[key] = entry;
              return o;
            }, {})
          : rawForecast;

        // Sort and filter dates
        const rawDates = Object.keys(forecastMap)
          .sort((a,b) => parseLocal(a) - parseLocal(b));
        const upcoming = rawDates.filter(d => parseLocal(d) >= today);

        // Base list of actual dates
        let datesToUse = upcoming.length
          ? upcoming.slice(0, this.days_to_show)
          : [ rawDates[rawDates.length - 1] ];

        const baseCount = upcoming.length > 0
          ? Math.min(upcoming.length, this.days_to_show)
          : 1;

        // If showing empty days: add placeholders
        if (showEmpty) {
          while (datesToUse.length < this.days_to_show) {
            const idx = datesToUse.length;
            dict[`day${idx}`] = {
              name:       dict.allergenCapitalized,
              day:        "–",
              state:      -1,
              state_text: noInfoLabel
            };
            datesToUse.push(null);
          }
        }

        // Extrapolate forward to get exactly days_to_show dates
        let forecastDates = [];
        if (upcoming.length) {
          forecastDates = upcoming.slice(0, this.days_to_show);
          if (forecastDates.length < this.days_to_show) {
            const lastReal = parseLocal(forecastDates[forecastDates.length-1]);
            for (let add = 1; forecastDates.length < this.days_to_show; add++) {
              const nl = new Date(
                lastReal.getFullYear(),
                lastReal.getMonth(),
                lastReal.getDate() + add
              );
              const yyyy = nl.getFullYear();
              const mm   = String(nl.getMonth()+1).padStart(2,"0");
              const dd   = String(nl.getDate()).padStart(2,"0");
              forecastDates.push(`${yyyy}-${mm}-${dd}T00:00:00`);
            }
          }
        } else {
          const lastHist = rawDates[rawDates.length-1];
          forecastDates = [ lastHist ];
          const baseDate = parseLocal(lastHist);
          for (let add = 1; forecastDates.length < this.days_to_show; add++) {
            const nl = new Date(
              baseDate.getFullYear(),
              baseDate.getMonth(),
              baseDate.getDate() + add
            );
            const yyyy = nl.getFullYear();
            const mm   = String(nl.getMonth()+1).padStart(2,"0");
            const dd   = String(nl.getDate()).padStart(2,"0");
            forecastDates.push(`${yyyy}-${mm}-${dd}T00:00:00`);
          }
        }

        // Determine which columns to render
        const totalCols = showEmpty
          ? this.days_to_show
          : baseCount;
        this.displayCols = Array.from({ length: totalCols }, (_,i) => i);

        // Build day0...dayN
        forecastDates.forEach((dateStr, idx) => {
          const raw   = forecastMap[dateStr] || {};
          const level = test_val(raw.level);
          const d     = parseLocal(dateStr);
          const diff  = Math.floor((d - today)/(1000*60*60*24));

          let label;
          if (!daysRelative) {
            label = d.toLocaleDateString(locale, {
              weekday: dayAbbrev ? "short" : "long"
            });
          } else {
            if (dayLabels[diff] !== undefined)      label = dayLabels[diff];
            else if (diff === 0)                    label = "Idag";
            else if (diff === 1)                    label = "Imorgon";
            else if (diff === 2)                    label = "I övermorgon";
            else if (diff === -1)                   label = "Igår";
            else if (diff === -2)                   label = "I förrgår";
            else if (diff < -2)                     label = d.toLocaleDateString(locale, { day:"numeric", month:"short" });
            else                                    label = d.toLocaleDateString(locale, {
              weekday: dayAbbrev ? "short" : "long"
            });
          }
          label = capitalize(label);
          if (daysUppercase) label = label.toUpperCase();

          dict[`day${idx}`] = {
            name:       dict.allergenCapitalized,
            day:        label,
            state:      level,
            state_text: level === -1
              ? noInfoLabel
              : (levelNames[level] ?? raw.level_name)
          };
        });

        // Threshold filter
        let meets = this.pollen_threshold === 0;
        for (let i = 0; i < baseCount && !meets; i++) {
          if (dict[`day${i}`].state >= this.pollen_threshold) meets = true;
        }
        if (meets) sensors.push(dict);

      } catch (e) {
        console.warn(`Fel vid allergen ${allergen}:`, e);
      }
    }

    // Sort and save
    const sorter = {
      value_ascending:  (a,b)=>a.day0.state - b.day0.state,
      value_descending: (a,b)=>b.day0.state - a.day0.state,
      name_descending:  (a,b)=>b.allergenCapitalized.localeCompare(a.allergenCapitalized),
      default:          (a,b)=>b.day0.state - a.day0.state
    };
    sensors.sort(sorter[this.config.sort] || sorter.default);

    if (debug) console.log("🧩 Slutliga sensors-array:", sensors);
    this.sensors = sensors;
  }

  _renderMinimalHtml() {
    return html`
      <ha-card>
        ${this.header ? html`<h1 class="card-header">${this.header}</h1>` : ''}
        <div class="flex-container">
          ${this.sensors.map(sensor => html`
            <div class="sensor">
              <img class="box"
                src="${images[`${sensor.allergenReplaced}_${sensor.day0.state}_png`] 
                       ?? images['0_png']}"
              />
              ${this.config.show_text
                ? html`<span class="short-text">${sensor.allergenShort} (${sensor.day0.state})</span>`
                : ''}
            </div>`)}
        </div>
      </ha-card>
    `;
  }

  _renderNormalHtml() {
    const daysBold = Boolean(this.config.days_boldfaced);
    const cols = this.displayCols;

    return html`
      <ha-card>
        ${this.header ? html`<h1 class="card-header">${this.header}</h1>` : ''}
        <table class="forecast">
          <thead>
            <tr>
              <th></th>
              ${cols.map(i => html`
                <th style="font-weight: ${daysBold ? 'bold' : 'normal'}">
                  ${this.sensors[0][`day${i}`].day}
                </th>`)}
            </tr>
          </thead>
          ${this.sensors.map(sensor => html`
            <tr class="allergen" valign="top">
              <td>
                <img class="allergen"
                  src="${images[`${sensor.allergenReplaced}_${sensor.day0.state}_png`]}"
                />
              </td>
              ${cols.map(i => html`
                <td>
                  <img
                    src="${images[`${sensor[`day${i}`].state}_png`]
                            ?? images['0_png']}"
                  />
                </td>`)}
            </tr>
            ${this.config.show_text ? html`
              <tr class="allergen" valign="top">
                <td>${sensor.allergenCapitalized}</td>
                ${cols.map(i => html`
                  <td><p>${sensor[`day${i}`].state_text}</p></td>`)}
              </tr>
            ` : ''}
          `)}
        </table>
      </ha-card>
    `;
  }

  render() {
    if (!this.sensors || this.sensors.length === 0) {
      return html`
        <ha-card>
          <div class="card-error">
            Inga pollen-sensorer hittades. Har du installerat integrationen
            <a href="https://github.com/JohNan/homeassistant-pollenprognos"
               target="_blank" rel="noopener">
              homeassistant-pollenprognos
            </a>
            och valt en stad?
          </div>
        </ha-card>
      `;
    }

    const debug = Boolean(this.config.debug);
    if (debug) console.log(
      ">>> pollenprognos.render:",
      "minimal=", this.config.minimal,
      "days_to_show=", this.days_to_show,
      "sensors.length=", this.sensors.length
    );

    if (this.config.minimal) {
      return this._renderMinimalHtml();
    } else {
      return this._renderNormalHtml();
    }
  }

  setConfig(config) {
    const defaults = {
      city:             '',
      allergens:        [],
      days_to_show:     4,
      pollen_threshold: 1,
      show_empty_days:  true,
      show_text:        true,
      minimal:          false,
      sort:             'default',
      debug:            false
    };
    this.config = { ...defaults, ...config };
    // assign image map
    this.images = images;
  }

  getCardSize() {
    return this.sensors.length + 1;
  }

  static get styles() {
    return css`
      .header { padding: 4px 0 12px; @apply --paper-font-headline; color: var(--primary-text-color); }
      .forecast { width:100%; padding:7px; }
      td { padding:1px; text-align:center; width:100px; font-size:smaller; }
      img.allergen { width:40px; height:40px; }
      img { width:50px; height:50px; }
      .flex-container { display:flex; flex-wrap:wrap; justify-content:space-evenly; padding:16px; }
      .sensor { flex:1; min-width:20%; text-align:center; }
      .short-text { display:block; }
      .card-error { padding:16px; color:var(--error-text-color,#b71c1c); font-weight:500; line-height:1.4; }
      .card-error a { color:var(--primary-color); text-decoration:underline; }
    `;
  }
}

customElements.define("pollenprognos-card", PollenCardv2);

