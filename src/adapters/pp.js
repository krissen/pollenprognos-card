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
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
};

export async function fetchForecast(hass, config) {
  const sensors = [];
  const debug = Boolean(config.debug);
  const { ALLERGEN_TRANSLATION } = await import("../constants.js");
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const parseLocal = (s) => {
    const [ymd] = s.split("T");
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Språk och locale: respektera användar-inställning
  const lang = detectLang(hass, config.date_locale);
  const locale = config.date_locale || stubConfigPP.date_locale;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);

  // Phrases: ge userConfig företräde
  const phrases = {
    full: {},
    short: {},
    levels: [],
    days: {},
    no_information: "",
    ...(config.phrases || {}),
  };
  const fullPhrases = phrases.full;
  const shortPhrases = phrases.short;
  const userLevels = phrases.levels;
  const levelNames =
    Array.isArray(userLevels) && userLevels.length === 7
      ? userLevels
      : Array.from({ length: 7 }, (_, i) => t(`card.levels.${i}`, lang));
  const noInfoLabel = phrases.no_information || t("card.no_information", lang);
  const userDays = phrases.days;

  if (debug)
    console.debug("PP.fetchForecast — start", { city: config.city, lang });

  const normalize = (s) =>
    s
      .toLowerCase()
      .replace(/[åä]/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]/g, "_");
  const testVal = (v) => {
    const n = Number(v);
    return isNaN(n) || n < 0 ? -1 : n > 6 ? 6 : n;
  };

  const days_to_show = config.days_to_show ?? stubConfigPP.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigPP.pollen_threshold;

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      const rawKey = normalize(allergen);
      dict.allergenReplaced = rawKey;

      // Allergen-namn: user eller i18n eller fallback
      if (fullPhrases[allergen]) {
        dict.allergenCapitalized = fullPhrases[allergen];
      } else {
        const transKey = ALLERGEN_TRANSLATION[rawKey] || rawKey;
        const lookup = t(`card.allergen.${transKey}`, lang);
        dict.allergenCapitalized =
          lookup !== `card.allergen.${transKey}`
            ? lookup
            : capitalize(allergen);
      }
      dict.allergenShort = shortPhrases[allergen] || dict.allergenCapitalized;

      // Hitta sensor
      const cityKey = normalize(config.city);
      let sensorId = `sensor.pollen_${cityKey}_${rawKey}`;
      if (!hass.states[sensorId]) {
        const cands = Object.keys(hass.states).filter(
          (id) =>
            id.startsWith(`sensor.pollen_${cityKey}_`) && id.includes(rawKey),
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

      // Loopar dagarna
      forecastDates.forEach((dateStr, idx) => {
        const raw = forecastMap[dateStr] || {};
        const level = testVal(raw.level);
        const d = parseLocal(dateStr);
        const diff = Math.round((d - today) / 86400000);
        let label;

        if (!daysRelative) {
          // Visa veckodagar med första bokstaven stor
          label = d.toLocaleDateString(locale, {
            weekday: dayAbbrev ? "short" : "long",
          });
          label = label.charAt(0).toUpperCase() + label.slice(1);
        } else if (userDays[diff] != null) {
          // Relativa dagar från användarens config
          label = userDays[diff];
        } else if (diff >= 0 && diff <= 2) {
          // Standard relative days från i18n
          label = t(`card.days.${diff}`, lang);
        } else {
          // Datum som dag mån
          label = d.toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
          });
        }
        if (daysUppercase) label = label.toUpperCase();

        dict[`day${idx}`] = {
          name: dict.allergenCapitalized,
          day: label,
          state: level,
          state_text: level < 0 ? noInfoLabel : levelNames[level],
        };
      });

      // Filtrera med tröskel
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
  sensors.sort(
    {
      value_ascending: (a, b) => a.day0.state - b.day0.state,
      value_descending: (a, b) => b.day0.state - a.day0.state,
      name_ascending: (a, b) =>
        a.allergenCapitalized.localeCompare(b.allergenCapitalized),
      name_descending: (a, b) =>
        b.allergenCapitalized.localeCompare(a.allergenCapitalized),
    }[config.sort] || ((a, b) => b.day0.state - a.day0.state),
  );

  if (debug) console.debug("PP.fetchForecast — done", sensors);
  return sensors;
}
