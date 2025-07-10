import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { normalize } from "../utils/normalize.js";

export const stubConfigPP = {
  integration: "pp",
  city: "",
  allergens: [
    "Al",
    "Alm",
    "Bok",
    "Björk",
    "Ek",
    "Malörtsambrosia",
    "Gråbo",
    "Gräs",
    "Hassel",
    "Sälg och viden",
  ],
  minimal: false,
  background_color: "",
  show_text_allergen: true,
  show_value_text: true,
  show_value_numeric: false,
  show_value_numeric_in_circle: false,
  show_empty_days: true,
  debug: false,
  days_to_show: 4,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 1,
  sort: "value_descending",
  allergens_abbreviated: false,
  date_locale: undefined,
  title: undefined,
  phrases: { full: {}, short: {}, levels: [], days: {}, no_information: "" },
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Language and locale
  // Figure out the base language code ("sv", "en", "de", …)
  const lang = detectLang(hass, config.date_locale);
  // Turn it into a full locale tag for dates (sv-SE, de-DE, fi-FI, en-US)
  const locale =
    config.date_locale ||
    hass.locale?.language ||
    hass.language ||
    `${lang}-${lang.toUpperCase()}`;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);

  // Phrases with user overrides
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

  const testVal = (v) => {
    const n = Number(v);
    return isNaN(n) || n < 0 ? null : n > 6 ? 6 : n;
  };

  const days_to_show = config.days_to_show ?? stubConfigPP.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigPP.pollen_threshold;

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.days = []; // Initialize a days array
      const rawKey = normalize(allergen);
      dict.allergenReplaced = rawKey;

      // Allergen name resolution
      if (this.debug) {
        console.log(
          "[PP] allergen",
          allergen,
          "fullPhrases keys",
          Object.keys(fullPhrases),
        );
      }
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
      // Kolla om vi ska använda kortnamn
      if (config.allergens_abbreviated) {
        // Canonical key för lookup i phrases_short
        const canonKey = ALLERGEN_TRANSLATION[rawKey] || rawKey;
        const userShort = shortPhrases[allergen];
        dict.allergenShort =
          userShort ||
          t(`editor.phrases_short.${canonKey}`, lang) ||
          dict.allergenCapitalized;
      } else {
        dict.allergenShort = dict.allergenCapitalized;
      }
      // Sensor lookup
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
      dict.entity_id = sensorId;

      // Build forecastMap
      const rawForecast = sensor.attributes.forecast;
      const forecastMap = Array.isArray(rawForecast)
        ? rawForecast.reduce((o, entry) => {
            const key = entry.time || entry.datetime;
            o[key] = entry;
            return o;
          }, {})
        : rawForecast;

      // Sort and slice dates
      // Hämta och sortera prognosdatum
      const rawDates = Object.keys(forecastMap).sort(
        (a, b) => parseLocal(a) - parseLocal(b),
      );
      const upcoming = rawDates.filter((d) => parseLocal(d) >= today);

      // Padda ut till exactly days_to_show datum
      let forecastDates = [];
      if (upcoming.length >= days_to_show) {
        // Tillräckligt många kommande – ta de första N
        forecastDates = upcoming.slice(0, days_to_show);
      } else {
        // Lägg först in vad som finns
        forecastDates = upcoming.slice();
        // Sedan bygg på dag för dag framåt
        // (antingen från senast i upcoming, eller från idag)
        let lastDate =
          upcoming.length > 0
            ? parseLocal(upcoming[upcoming.length - 1])
            : today;

        while (forecastDates.length < days_to_show) {
          lastDate = new Date(lastDate.getTime() + 86400000);
          const yyyy = lastDate.getFullYear();
          const mm = String(lastDate.getMonth() + 1).padStart(2, "0");
          const dd = String(lastDate.getDate()).padStart(2, "0");
          forecastDates.push(`${yyyy}-${mm}-${dd}T00:00:00`);
        }
      }
      // Iterate forecast days
      forecastDates.forEach((dateStr, idx) => {
        const raw = forecastMap[dateStr] || {};
        const level = testVal(raw.level);
        const d = parseLocal(dateStr);
        const diff = Math.round((d - today) / 86400000);
        let label;

        if (!daysRelative) {
          label = d.toLocaleDateString(locale, {
            weekday: dayAbbrev ? "short" : "long",
          });
          label = label.charAt(0).toUpperCase() + label.slice(1);
        } else if (userDays[diff] != null) {
          label = userDays[diff];
        } else if (diff >= 0 && diff <= 2) {
          label = t(`card.days.${diff}`, lang);
        } else {
          label = d.toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
          });
        }
        if (daysUppercase) label = label.toUpperCase();

        if (level !== null) {
          const dayObj = {
            name: dict.allergenCapitalized,
            day: label,
            state: level,
            state_text: levelNames[level],
          };
          dict[`day${idx}`] = dayObj;
          dict.days.push(dayObj);
        }
        // Om du vill kunna visa "no information"-text när show_empty_days == true
        // else if (config.show_empty_days) {
        //   const dayObj = {
        //     name: dict.allergenCapitalized,
        //     day: label,
        //     state: null,
        //     state_text: noInfoLabel,
        //   };
        //   dict[`day${idx}`] = dayObj;
        //   dict.days.push(dayObj);
        // }
      });

      // Threshold filtering
      const meets = dict.days.some((d) => d.state >= pollen_threshold);
      if (meets || pollen_threshold === 0) sensors.push(dict);
    } catch (e) {
      console.warn(`[PP] Fel vid allergen ${allergen}:`, e);
    }
  }

  // Sorting
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
