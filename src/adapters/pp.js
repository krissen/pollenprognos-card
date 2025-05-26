import { t, detectLang } from "../i18n.js";

export const stubConfigPP = {
  integration: "pp",
  city: "",
  allergens: [
    "Al",
    "Alm",
    "Björk",
    "Ek",
    "Malörtsambrosia",
    "Gråbo",
    "Gräs",
    "Hassel",
    "Sälg och viden",
  ],
  minimal: false,
  show_text: true,
  show_value: false,
  show_empty_days: true,
  debug: false,
  days_to_show: 4,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 1,
  sort: "value_descending",
  date_locale: "sv-SE",
  title: undefined,
  phrases: {
    full: {},
    short: {},
    levels: [
      "Ingen pollen",
      "Låga halter",
      "Låga–måttliga halter",
      "Måttliga halter",
      "Måttliga–höga halter",
      "Höga halter",
      "Mycket höga halter",
    ],
    days: {
      0: "Idag",
      1: "Imorgon",
      2: "I övermorgon",
    },
    no_information: "(Ingen information)",
  },
};

export async function fetchForecast(hass, config) {
  const sensors = [];
  const debug = Boolean(config.debug);
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const parseLocal = (s) => {
    const [ymd] = s.split("T");
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const replaceAAO = (intext) =>
    intext
      .toLowerCase()
      .replaceAll("å", "a")
      .replaceAll("ä", "a")
      .replaceAll("ö", "o")
      .replaceAll(" / ", "_")
      .replaceAll("-", "_")
      .replaceAll(" ", "_");
  const test_val = (val) => {
    const n = Number(val);
    if (isNaN(n) || n < 0) return -1;
    if (n > 6) return 6;
    return n;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Språkinställningar
  const lang = detectLang(hass, config.date_locale);
  const locale = config.date_locale || stubConfigPP.date_locale;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);

  // Översättnings-fallback (stubConfigPP.phrases som default)
  const phrases = {
    ...stubConfigPP.phrases,
    ...config.phrases,
  };
  const noInfoLabel = phrases.no_information;
  const levelNames =
    Array.isArray(phrases.levels) && phrases.levels.length === 7
      ? phrases.levels
      : stubConfigPP.phrases.levels;
  const dayLabels = phrases.days;

  if (debug) {
    console.debug("PP.fetchForecast — start", { city: config.city, lang });
  }

  const cityKey = replaceAAO(config.city);
  const showEmpty = config.show_empty_days !== false;
  const days_to_show = config.days_to_show ?? stubConfigPP.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigPP.pollen_threshold;

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.allergenReplaced = replaceAAO(allergen);
      dict.allergenCapitalized = phrases.full[allergen] || capitalize(allergen);
      dict.allergenShort = phrases.short[allergen] || dict.allergenCapitalized;

      // Hitta sensor-ID
      const expectedId = `sensor.pollen_${cityKey}_${dict.allergenReplaced}`;
      let sensorId = expectedId;
      if (!hass.states[expectedId]) {
        const cands = Object.keys(hass.states).filter(
          (id) =>
            id.startsWith(`sensor.pollen_${cityKey}_`) &&
            id.includes(dict.allergenReplaced),
        );
        if (cands.length === 1) sensorId = cands[0];
        else continue;
      }
      const sensor = hass.states[sensorId];
      if (!sensor?.attributes?.forecast) throw "Missing forecast";

      // Bygg forecastMap
      const rawForecast = sensor.attributes.forecast;
      const forecastMap = Array.isArray(rawForecast)
        ? rawForecast.reduce((o, entry) => {
            const key = entry.time || entry.datetime;
            o[key] = entry;
            return o;
          }, {})
        : rawForecast;

      // Bestäm datum
      const rawDates = Object.keys(forecastMap).sort(
        (a, b) => parseLocal(a) - parseLocal(b),
      );
      const upcoming = rawDates.filter((d) => parseLocal(d) >= today);

      const forecastDates = upcoming.length
        ? upcoming.slice(0, days_to_show)
        : rawDates.slice(-1).reduce(
            (arr, last) => {
              const base = parseLocal(last);
              while (arr.length < days_to_show) {
                const nl = new Date(base.getTime() + arr.length * 86400000);
                const yyyy = nl.getFullYear();
                const mm = String(nl.getMonth() + 1).padStart(2, "0");
                const dd = String(nl.getDate()).padStart(2, "0");
                arr.push(`${yyyy}-${mm}-${dd}T00:00:00`);
              }
              return arr;
            },
            [rawDates[rawDates.length - 1]],
          );

      // Placera tomma dagar
      if (showEmpty && forecastDates.length < days_to_show) {
        for (let i = forecastDates.length; i < days_to_show; i++) {
          dict[`day${i}`] = {
            name: dict.allergenCapitalized,
            day: "–",
            state: -1,
            state_text: noInfoLabel,
          };
        }
      }

      // Loopar dagarna
      forecastDates.forEach((dateStr, idx) => {
        const raw = forecastMap[dateStr] || {};
        const level = test_val(raw.level);
        const d = parseLocal(dateStr);
        const diff = Math.round((d - today) / 86400000);
        let label;
        if (daysRelative && dayLabels[diff] != null) {
          label = dayLabels[diff];
        } else {
          label = d.toLocaleDateString(locale, {
            weekday: dayAbbrev ? "short" : "long",
          });
        }
        if (daysUppercase) label = label.toUpperCase();

        dict[`day${idx}`] = {
          name: dict.allergenCapitalized,
          day: capitalize(label),
          state: level,
          state_text:
            level < 0 ? noInfoLabel : levelNames[level] || noInfoLabel,
        };
      });

      // Tröskel
      const meets = Array.from(
        { length: days_to_show },
        (_, i) => dict[`day${i}`]?.state ?? -1,
      ).some((v) => v >= pollen_threshold);
      if (meets || pollen_threshold === 0) sensors.push(dict);
    } catch (e) {
      console.warn(`Fel vid allergen ${allergen}:`, e);
    }
  }

  // Sortering
  const sorters = {
    value_ascending: (a, b) => a.day0.state - b.day0.state,
    value_descending: (a, b) => b.day0.state - a.day0.state,
    name_ascending: (a, b) =>
      a.allergenCapitalized.localeCompare(b.allergenCapitalized),
    name_descending: (a, b) =>
      b.allergenCapitalized.localeCompare(a.allergenCapitalized),
  };
  sensors.sort(sorters[config.sort] || sorters.value_descending);

  if (debug) console.debug("PP.fetchForecast — färdigt", sensors);
  return sensors;
}
