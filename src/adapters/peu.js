// src/adapters/peu.js
import { t, detectLang } from "../i18n.js";
import { ALLERGEN_TRANSLATION } from "../constants.js";
import { LEVELS_DEFAULTS } from "../utils/levels-defaults.js";
import { buildLevelNames } from "../utils/level-names.js";

// Skapa stubConfigPEU – allergener enligt din sensor.py, i engelsk slugform!
export const stubConfigPEU = {
  integration: "peu",
  location: "",
  allergens: [
    "alder",
    "ash",
    "beech",
    "birch",
    "cypress_family",
    "elm",
    "grasses",
    "hazel",
    "lime",
    "fungal_spores",
    "mugwort",
    "nettle_family",
    "oak",
    "olive",
    "plane_tree",
    "ragweed",
    "rye",
    "willow",
  ],
  minimal: false,
  minimal_gap: 35,
  background_color: "",
  icon_size: "48",
  text_size_ratio: 1,
  ...LEVELS_DEFAULTS,
  show_text_allergen: true,
  show_value_text: true,
  show_value_numeric: false,
  show_value_numeric_in_circle: false,
  show_empty_days: false,
  debug: false,
  show_version: true,
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
  const debug = Boolean(config.debug);
  const lang = detectLang(hass, config.date_locale);
  const locale =
    config.date_locale ||
    hass.locale?.language ||
    hass.language ||
    `${lang}-${lang.toUpperCase()}`;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);

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
  // Levels from PEU are reported as 0–4 but scaled to 0–6 in the card.
  // Accept either five or seven custom names and map them to the 0–6 scale.
  const defaultNumLevels = 5; // original scale
  const levelNamesDefault = Array.from({ length: 7 }, (_, i) =>
    t(`card.levels.${i}`, lang),
  );
  let levelNames = levelNamesDefault.slice();
  if (Array.isArray(userLevels)) {
    if (userLevels.length === 7) {
      levelNames = buildLevelNames(userLevels, lang);
    } else if (userLevels.length === defaultNumLevels) {
      const map = [0, 1, 3, 5, 6];
      map.forEach((lvl, idx) => {
        const val = userLevels[idx];
        if (val != null && val !== "") levelNames[lvl] = val;
      });
    }
  }
  const noInfoLabel = phrases.no_information || t("card.no_information", lang);
  const userDays = phrases.days;

  const maxLevel =
    config.integration === "dwd" ? 3 : config.integration === "peu" ? 4 : 6;

  const testVal = (v) => {
    const n = Number(v);
    return isNaN(n) || n < 0 ? -1 : n > maxLevel ? maxLevel : n;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days_to_show = config.days_to_show ?? stubConfigPEU.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigPEU.pollen_threshold;

  // Plats/slug-hantering
  // location_slug kan sättas explicit, men om inte så loopar vi igenom tillgängliga sensorer
  const peuStates = Object.keys(hass.states).filter((id) =>
    id.startsWith("sensor.polleninformation_"),
  );
  let locationSlug = config.location;
  if (!locationSlug && peuStates.length) {
    // Extract full location slug (everything after "sensor.polleninformation_" and before last "_<allergen>")
    const match = peuStates[0].match(/^sensor\.polleninformation_(.+)_[^_]+$/);
    locationSlug = match ? match[1] : "";
  }
  // Lista platser om vi vill visa i editorn (kan samlas ihop)
  // const availableLocations = Array.from(new Set(peuStates.map(id => id.split("_")[2])));

  const sensors = [];
  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.days = [];
      const allergenSlug = allergen; // redan slugifierat i peu
      dict.allergenReplaced = allergenSlug;

      // Allergen-namn, phrases, i18n, capitalisering
      if (fullPhrases[allergenSlug]) {
        dict.allergenCapitalized = fullPhrases[allergenSlug];
      } else {
        const canonKey = ALLERGEN_TRANSLATION[allergenSlug] || allergenSlug;
        const lookup = t(`card.allergen.${canonKey}`, lang);
        dict.allergenCapitalized =
          lookup !== `card.allergen.${canonKey}`
            ? lookup
            : allergenSlug.charAt(0).toUpperCase() + allergenSlug.slice(1);
      }
      if (config.allergens_abbreviated) {
        const userShort = shortPhrases[allergenSlug];
        dict.allergenShort =
          userShort ||
          t(`editor.phrases_short.${allergenSlug}`, lang) ||
          dict.allergenCapitalized;
      } else {
        dict.allergenShort = dict.allergenCapitalized;
      }

      // Hitta sensor: sensor.polleninformation_<locationSlug>_<allergenSlug>
      let sensorId = locationSlug
        ? `sensor.polleninformation_${locationSlug}_${allergenSlug}`
        : null;
      if (!sensorId || !hass.states[sensorId]) {
        // Leta fallback-sensor bland peuStates
        const cands = peuStates.filter((id) => {
          const match = id.match(/^sensor\.polleninformation_(.+)_(.+)$/);
          if (!match) return false;
          const loc = match[1];
          const allergen = match[2];
          return (
            (!locationSlug || loc === locationSlug) && allergen === allergenSlug
          );
        });

        if (cands.length === 1) sensorId = cands[0];
        else continue;
      }
      const sensor = hass.states[sensorId];
      if (!sensor?.attributes?.forecast) throw "Missing forecast";
      dict.entity_id = sensorId;

      // Forecast-hantering: forecast är en array med datumobjekt
      const rawForecast = sensor.attributes.forecast;
      // Skapa ett index för snabbsök på datum
      const forecastMap = Array.isArray(rawForecast)
        ? rawForecast.reduce((o, entry) => {
            const key = entry.time || entry.datetime;
            o[key] = entry;
            return o;
          }, {})
        : {};

      // Sortera datum
      const rawDates = Object.keys(forecastMap).sort(
        (a, b) => new Date(a) - new Date(b),
      );
      const upcoming = rawDates.filter((d) => new Date(d) >= today);

      // Fyll ut till rätt antal dagar
      let forecastDates = [];
      if (upcoming.length >= days_to_show) {
        forecastDates = upcoming.slice(0, days_to_show);
      } else {
        forecastDates = upcoming.slice();
        let lastDate =
          upcoming.length > 0 ? new Date(upcoming[upcoming.length - 1]) : today;
        while (forecastDates.length < days_to_show) {
          lastDate = new Date(lastDate.getTime() + 86400000);
          const yyyy = lastDate.getFullYear();
          const mm = String(lastDate.getMonth() + 1).padStart(2, "0");
          const dd = String(lastDate.getDate()).padStart(2, "0");
          forecastDates.push(`${yyyy}-${mm}-${dd}T00:00:00`);
        }
      }

      // Bygg dag-objekt
      forecastDates.forEach((dateStr, idx) => {
        const raw = forecastMap[dateStr] || {};
        const level = testVal(raw.level);
        if (level !== null && level >= 0) {
          const d = new Date(dateStr);
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

          let scaledLevel;
          if (level < 2) {
            scaledLevel = Math.floor((level * 6) / 4);
          } else {
            scaledLevel = Math.ceil((level * 6) / 4);
          }

          const dayObj = {
            name: dict.allergenCapitalized,
            day: label,
            state: level,
            state_text:
              scaledLevel < 0
                ? noInfoLabel
                : levelNames[scaledLevel] || t(`card.levels.${scaledLevel}`, lang),
          };

          dict[`day${idx}`] = dayObj;
          dict.days.push(dayObj);
        }
      });

      // Threshold-filter
      const meets = dict.days.some((d) => d.state >= pollen_threshold);
      if (meets || pollen_threshold === 0) sensors.push(dict);
    } catch (e) {
      if (debug) console.warn(`Fel vid allergen ${allergen}:`, e);
    }
  }

  // Sortera
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

  if (debug) console.debug("PEU.fetchForecast — done", sensors);
  return sensors;
}
