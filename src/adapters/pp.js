// src/adapters/pp.js

/**
 * Stub-config för original Pollenprognos-integration (PP)
 * Används av editorn som default
 */
export const stubConfigPP = {
  integration:      'pp',
  city:             '',
  allergens:        [
    'Al','Alm','Björk','Ek','Malörtsambrosia',
    'Gråbo','Gräs','Hassel','Sälg och viden'
  ],
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

/**
 * Hämta och bygg sensors-array för PP.
 * @param {object} hass  Home Assistant-objektet
 * @param {object} config  Kortkonfiguration
 * @returns {Promise<Array>}  Promise som löser till en array av allergen-objekt
 */

export async function fetchForecast(hass, config) {
  const sensors = [];
  const debug           = Boolean(config.debug);
  const capitalize      = s => s.charAt(0).toUpperCase() + s.slice(1);
  const parseLocal      = s => {
    const [ymd] = s.split("T");
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const replaceAAO     = intext => intext.toLowerCase()
    .replaceAll("å","a").replaceAll("ä","a").replaceAll("ö","o")
    .replaceAll(" / ","_").replaceAll("-","_").replaceAll(" ","_");
  const test_val       = val => {
    const n = Number(val);
    if (isNaN(n) || n < 0) return -1;
    if (n > 6) return 6;
    return n;
  };

  const today          = new Date();
  today.setHours(0,0,0,0);

  const cityKey        = replaceAAO(config.city);
  const showEmpty      = config.show_empty_days != null
    ? Boolean(config.show_empty_days)
    : true;
  // **Nya variabler för locale och dagformat**
  const locale         = config.date_locale || "sv-SE";
  const daysRelative   = config.days_relative !== false;
  const dayAbbrev      = Boolean(config.days_abbreviated);
  const daysUppercase  = Boolean(config.days_uppercase);
  const noInfoLabel    = config.phrases?.no_information || "(Ingen information)";
  const allergenFull   = config.phrases?.full  || {};
  const allergenShort  = config.phrases?.short || {};
  const levelNames     = config.phrases?.levels || [
    "Ingen pollen","Låga halter","Låga-måttliga halter",
    "Måttliga halter","Måttliga-höga halter","Höga halter",
    "Mycket höga halter"
  ];
  const dayLabels      = config.phrases?.days   || {};
  const days_to_show   = config.days_to_show    ?? 4;
  const pollen_threshold = config.pollen_threshold ?? 1;

  if (debug) {
    console.log("PP.fetchForecast — start");
    console.log("City key:", cityKey);
    console.log("Allergens:", config.allergens);
  }

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.allergenReplaced    = replaceAAO(allergen);
      dict.allergenCapitalized = allergenFull[allergen] || capitalize(allergen);
      dict.allergenShort       = allergenShort[allergen]
        || dict.allergenCapitalized.replace("Sälg och viden","Vide");

      // Hitta sensor‐ID
      const expectedId = `sensor.pollen_${cityKey}_${dict.allergenReplaced}`;
      let sensorId = expectedId;
      if (!hass.states[expectedId]) {
        const cands = Object.keys(hass.states).filter(id =>
          id.startsWith(`sensor.pollen_${cityKey}_`)
          && id.includes(dict.allergenReplaced)
        );
        if (cands.length === 1) {
          sensorId = cands[0];
        } else {
          continue;
        }
      }
      const sensor = hass.states[sensorId];
      if (!sensor?.attributes?.forecast) throw "Saknar forecast";

      // Bygg forecastMap
      const rawForecast = sensor.attributes.forecast;
      const forecastMap = Array.isArray(rawForecast)
        ? rawForecast.reduce((o,entry) => {
            const key = entry.time || entry.datetime;
            o[key] = entry;
            return o;
          }, {})
        : rawForecast;

      // Rådatum sorterat
      const rawDates = Object.keys(forecastMap)
        .sort((a,b) => parseLocal(a) - parseLocal(b));
      const upcoming = rawDates.filter(d => parseLocal(d) >= today);

      // Välj datum att visa
      let forecastDates;
      if (upcoming.length) {
        forecastDates = upcoming.slice(0, days_to_show);
      } else {
        // fallback: sista historiska datum + påfyllning
        const last = rawDates[rawDates.length - 1];
        forecastDates = [ last ];
        const base = parseLocal(last);
        while (forecastDates.length < days_to_show) {
          const nl = new Date(base.getFullYear(), base.getMonth(), base.getDate() + forecastDates.length);
          const yyyy = nl.getFullYear();
          const mm   = String(nl.getMonth()+1).padStart(2,"0");
          const dd   = String(nl.getDate()  ).padStart(2,"0");
          forecastDates.push(`${yyyy}-${mm}-${dd}T00:00:00`);
        }
      }

      // Visa tomma dagar som placeholders
      if (showEmpty && forecastDates.length < days_to_show) {
        const missing = days_to_show - forecastDates.length;
        for (let i = 0; i < missing; i++) {
          dict[`day${forecastDates.length + i}`] = {
            name:       dict.allergenCapitalized,
            day:        "–",
            state:      -1,
            state_text: noInfoLabel
          };
        }
      }

      // **Här är den uppdaterade loopen för dagsetiketter**:
      forecastDates.forEach((dateStr, idx) => {
        const raw   = forecastMap[dateStr] || {};
        const level = test_val(raw.level);
        const d     = parseLocal(dateStr);
        const diff  = Math.round((d - today)/(1000*60*60*24));
        let label;

        if (!daysRelative) {
          // Alltid språkberoende veckodag
          label = d.toLocaleDateString(locale, {
            weekday: dayAbbrev ? "short" : "long"
          });
        } else {
          // Relativa namn för dag 0–2 om du vill
          if (dayLabels[diff] !== undefined) {
            label = dayLabels[diff];
          } else if (diff === 0) {
            label = "Idag";
          } else if (diff === 1) {
            label = "Imorgon";
          } else if (diff === 2) {
            label = "I övermorgon";
          } else {
            // Övriga dagar: språkberoende veckodag
            label = d.toLocaleDateString(locale, {
              weekday: dayAbbrev ? "short" : "long"
            });
          }
        }

        // Sista justeringar
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

      // Tröskel-filter
      const baseCount = Math.min(days_to_show, forecastDates.length);
      let meets = pollen_threshold === 0;
      for (let i = 0; i < baseCount && !meets; i++) {
        if (dict[`day${i}`].state >= pollen_threshold) meets = true;
      }
      if (meets) sensors.push(dict);

    } catch (e) {
      console.warn(`Fel vid allergen ${allergen}:`, e);
    }
  }

  // Sortera allergener enligt config.sort
  const sorter = {
    value_ascending:  (a,b) => a.day0.state - b.day0.state,
    value_descending: (a,b) => b.day0.state - a.day0.state,
    name_descending:  (a,b) => b.allergenCapitalized.localeCompare(a.allergenCapitalized),
    default:          (a,b) => b.day0.state - a.day0.state
  };
  sensors.sort(sorter[config.sort] || sorter.default);

  if (debug) console.log("PP.fetchForecast — färdigt:", sensors);

  return sensors;
}
