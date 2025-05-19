// src/adapters/dwd.js

/**
 * Adapter för DWD Pollenflug‐integration.
 * Exporterar:
 *  - stubConfigDWD: standard‐värden för setConfig / editor
 *  - fetchForecast(hass, config): bygger sensors‐array utifrån Home Assistant‐data
 */

const DOMAIN = 'dwd_pollenflug';
const ATTR_VAL_TOMORROW   = 'state_tomorrow';
const ATTR_VAL_IN_2_DAYS  = 'state_in_2_days';
const ATTR_DESC_TODAY     = 'state_today_desc';
const ATTR_DESC_TOMORROW  = 'state_tomorrow_desc';
const ATTR_DESC_IN_2_DAYS = 'state_in_2_days_desc';

export const stubConfigDWD = {
  integration:       'dwd',
  region_id:         '',  // DWD-regionens ID
  allergens:         [
    'erle', 'ambrosia', 'esche', 'birke',
    'hasel', 'gräser', 'beifuss', 'roggen'
  ],
  minimal:           false,
  show_text:         true,
  show_empty_days:   true,
  debug:             false,
  days_to_show:      2,
  days_relative:     true,
  days_abbreviated:  false,
  days_uppercase:    false,
  days_boldfaced:    false,
  pollen_threshold:  1,
  sort:              'value_descending',
  date_locale:       'de-DE',
  title:             undefined,
  phrases: {
    full:    {
      erle:     'Erle',
      ambrosia: 'Ambrosia',
      esche:    'Esche',
      birke:    'Birke',
      hasel:    'Hasel',
      gräser:   'Gräser',
      beifuss:  'Beifuß',
      roggen:   'Roggen'
    },
    short:   {},
    levels:  [
      'keine Belastung','keine bis geringe Belastung','geringe Belastung',
      'geringe bis mittlere Belastung','mittlere Belastung','mittliga bis hohe Belastning',
      'hohe Belastning'
    ],
    days:    {},
    no_information: ''
  }
};

export async function fetchForecast(hass, config) {
  const debug            = Boolean(config.debug);
  const capitalize       = s => s.charAt(0).toUpperCase() + s.slice(1);
  const phrases          = config.phrases || {};
  const allergenFull     = phrases.full  || {};
  const allergenShort    = phrases.short || {};
  const levelNames       = (phrases.levels && phrases.levels.length === 7)
    ? phrases.levels
    : [
      'keine Belastung','keine bis geringe Belastung','geringe Belastung',
      'geringe bis mittlere Belastning','mittliga Belastning','mittliga bis hohe Belastning',
      'hohe Belastning'
    ];
  const noInfoLabel      = phrases.no_information || '';
  const locale           = config.date_locale || 'de-DE';
  const dayLabels        = phrases.days || {};
  const days_to_show     = config.days_to_show ?? 2;
  const pollen_threshold = config.pollen_threshold ?? 1;
  const daysRelative     = config.days_relative !== false;
  const dayAbbrev        = Boolean(config.days_abbreviated);
  const daysUppercase    = Boolean(config.days_uppercase);
  const showEmpty        = config.show_empty_days == null
    ? true
    : Boolean(config.show_empty_days);

  if (debug) console.log('DWD adapter: fetchForecast start', config);

  const replaceAAO = intext => intext
    .toLowerCase()
    .replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue').replaceAll('ß','ss');
  const test_val = val => {
    const n = Number(val);
    return isNaN(n) ? -1 : n;
  };

  const today   = new Date(); today.setHours(0,0,0,0);
  const sensors = [];

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.allergenReplaced   = replaceAAO(allergen);
      dict.allergenCapitalized = allergenFull[allergen] || capitalize(allergen);
      dict.allergenShort      = allergenShort[allergen] || dict.allergenCapitalized;

      // Bygg sensor-ID: sensor.pollenflug_<allergen>_<region_id>
      const region = config.region_id;
      let sensorId = region
        ? `sensor.pollenflug_${dict.allergenReplaced}_${region}`
        : null;

      if (!sensorId || !hass.states[sensorId]) {
        // Fallback: hitta exakt en sensor för allergenet
        const cands = Object.keys(hass.states)
          .filter(id => id.startsWith(`sensor.pollenflug_${dict.allergenReplaced}_`));
        if (cands.length === 1) sensorId = cands[0];
        else continue;
      }

      const sensor = hass.states[sensorId];

      // Extrahera nivåer
      const todayVal = test_val(sensor.state);
      const tomVal   = test_val(sensor.attributes[ATTR_VAL_TOMORROW]);
      const twoVal   = test_val(sensor.attributes[ATTR_VAL_IN_2_DAYS]);

      // Bygg nivå-array
      const levels = [
        { date: today,           level: todayVal, name: dict.allergenCapitalized },
        { date: new Date(today.getTime()+86400000), level: tomVal, name: dict.allergenCapitalized },
        { date: new Date(today.getTime()+2*86400000), level: twoVal, name: dict.allergenCapitalized }
      ];

      // Pad vid färre dagar
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx*86400000),
          level: -1,
          name: dict.allergenCapitalized
        });
      }

      // Bygg upp dict.day0…dayN
      levels.forEach((entry, idx) => {
        const diff = Math.round((entry.date - today)/86400000);
        let dayLabel;
        if (!daysRelative) {
          dayLabel = entry.date.toLocaleDateString(locale, { weekday: dayAbbrev ? 'short' : 'long' });
        } else if (dayLabels[diff] !== undefined) {
          dayLabel = dayLabels[diff];
        } else if (diff === 0) {
          dayLabel = 'Heute';
        } else if (diff === 1) {
          dayLabel = 'Morgen';
        } else if (diff === 2) {
          dayLabel = 'Übermorgen';
        } else {
          dayLabel = entry.date.toLocaleDateString(locale, { day:'numeric', month:'short' });
        }
        if (daysUppercase) dayLabel = dayLabel.toUpperCase();

        dict[`day${idx}`] = {
          name:       entry.name,
          day:        dayLabel,
          state:      entry.level,
          state_text: entry.level < 0
            ? noInfoLabel
            : (sensor.attributes[
                idx === 0 ? ATTR_DESC_TODAY
              : idx === 1 ? ATTR_DESC_TOMORROW
              : ATTR_DESC_IN_2_DAYS
              ] || levelNames[entry.level] || '')
        };
      });

      // Filtera med tröskel
      const baseCount = Math.min(days_to_show, levels.length);
      let meets = pollen_threshold === 0;
      for (let i = 0; i < baseCount && !meets; i++) {
        if (dict[`day${i}`].state >= pollen_threshold) meets = true;
      }
      if (meets) sensors.push(dict);

    } catch (e) {
      console.warn(`DWD adapter: fel för allergen ${allergen}:`, e);
    }
  }

  // Sortera allergener
  const sorter = {
    value_ascending:  (a,b) => a.day0.state - b.day0.state,
    value_descending: (a,b) => b.day0.state - a.day0.state,
    name_descending:  (a,b) => b.allergenCapitalized.localeCompare(a.allergenCapitalized),
    default:          (a,b) => b.day0.state - a.day0.state
  };
  sensors.sort(sorter[config.sort] || sorter.default);

  if (debug) console.log('DWD adapter: färdigt sensors‐array:', sensors);
  return sensors;
}

