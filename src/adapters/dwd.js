// src/adapters/dwd.js

const DOMAIN = "dwd_pollenflug";
const ATTR_VAL_TOMORROW = "state_tomorrow";
const ATTR_VAL_IN_2_DAYS = "state_in_2_days";
const ATTR_DESC_TODAY = "state_today_desc";
const ATTR_DESC_TOMORROW = "state_tomorrow_desc";
const ATTR_DESC_IN_2_DAYS = "state_in_2_days_desc";

export const stubConfigDWD = {
  integration: "dwd",
  region_id: "",
  allergens: [
    "erle",
    "ambrosia",
    "esche",
    "birke",
    "hasel",
    "gräser",
    "beifuss",
    "roggen",
  ],
  minimal: false,
  show_text: true,
  show_value: false,
  show_empty_days: true,
  debug: false,
  days_to_show: 2,
  days_relative: true,
  days_abbreviated: false,
  days_uppercase: false,
  days_boldfaced: false,
  pollen_threshold: 1,
  sort: "value_descending",
  date_locale: "de-DE",
  title: undefined,
  phrases: {
    full: {
      erle: "Erle",
      ambrosia: "Ambrosia",
      esche: "Esche",
      birke: "Birke",
      hasel: "Hasel",
      gräser: "Gräser",
      beifuss: "Beifuß",
      roggen: "Roggen",
    },
    short: {},
    levels: [
      "keine Belastung",
      "keine bis geringe Belastung",
      "geringe Belastung",
      "geringe bis mittlere Belastung",
      "mittlere Belastung",
      "mittliga bis hohe Belastning",
      "hohe Belastning",
    ],
    days: {},
    no_information: "",
  },
};

export async function fetchForecast(hass, config) {
  const debug = Boolean(config.debug);
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const phrases = config.phrases || {};
  const levelNames =
    Array.isArray(phrases.levels) && phrases.levels.length === 7
      ? phrases.levels
      : stubConfigDWD.phrases.levels;

  const noInfoLabel = phrases.no_information || "";
  const locale = config.date_locale || stubConfigDWD.date_locale;
  const dayLabels = phrases.days || {};
  const days_to_show = config.days_to_show ?? stubConfigDWD.days_to_show;
  const pollen_threshold =
    config.pollen_threshold ?? stubConfigDWD.pollen_threshold;
  const daysRelative = config.days_relative !== false;
  const dayAbbrev = Boolean(config.days_abbreviated);
  const daysUppercase = Boolean(config.days_uppercase);

  if (debug) {
    console.log("DWD adapter: fetchForecast start", { config, levelNames });
  }

  const replaceAAO = (intext) =>
    intext
      .toLowerCase()
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replaceAll("ß", "ss");
  const test_val = (val) => {
    const n = Number(val);
    return isNaN(n) ? -1 : n;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sensors = [];

  for (const allergen of config.allergens) {
    try {
      const dict = {};
      dict.allergenReplaced = replaceAAO(allergen);
      dict.allergenCapitalized =
        (phrases.full || {})[allergen] || capitalize(allergen);
      dict.allergenShort =
        (phrases.short || {})[allergen] || dict.allergenCapitalized;

      // Hitta sensor‐ID
      const region = config.region_id;
      let sensorId = region
        ? `sensor.pollenflug_${dict.allergenReplaced}_${region}`
        : null;
      if (!sensorId || !hass.states[sensorId]) {
        const cands = Object.keys(hass.states).filter((id) =>
          id.startsWith(`sensor.pollenflug_${dict.allergenReplaced}_`),
        );
        if (cands.length === 1) sensorId = cands[0];
        else continue;
      }
      const sensor = hass.states[sensorId];

      // Extrahera råvärden
      const todayVal = test_val(sensor.state);
      const tomVal = test_val(sensor.attributes[ATTR_VAL_TOMORROW]);
      const twoVal = test_val(sensor.attributes[ATTR_VAL_IN_2_DAYS]);

      // Bygg nivå‐array
      const levels = [
        { date: today, level: todayVal, name: dict.allergenCapitalized },
        {
          date: new Date(today.getTime() + 86400000),
          level: tomVal,
          name: dict.allergenCapitalized,
        },
        {
          date: new Date(today.getTime() + 2 * 86400000),
          level: twoVal,
          name: dict.allergenCapitalized,
        },
      ];
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
          name: dict.allergenCapitalized,
        });
      }

      // Bygg upp dict.day0…dayN
      levels.forEach((entry, idx) => {
        const diff = Math.round((entry.date - today) / 86400000);
        let dayLabel;
        if (!daysRelative) {
          dayLabel = entry.date.toLocaleDateString(locale, {
            weekday: dayAbbrev ? "short" : "long",
          });
        } else if (dayLabels[diff] !== undefined) {
          dayLabel = dayLabels[diff];
        } else if (diff === 0) {
          dayLabel = "Heute";
        } else if (diff === 1) {
          dayLabel = "Morgen";
        } else if (diff === 2) {
          dayLabel = "Übermorgen";
        } else {
          dayLabel = entry.date.toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
          });
        }
        if (daysUppercase) dayLabel = dayLabel.toUpperCase();

        // Sensorns egen beskrivning som fallback
        const sensorDesc =
          sensor.attributes[
            idx === 0
              ? ATTR_DESC_TODAY
              : idx === 1
                ? ATTR_DESC_TOMORROW
                : ATTR_DESC_IN_2_DAYS
          ] || "";

        // --- Här gör vi den viktiga justeringen: --
        // dubblar råvärdet innan vi gör text‐uppslaget:
        const scaled = entry.level * 2;
        const lvlIndex = Math.round(scaled);

        const text =
          lvlIndex < 0
            ? noInfoLabel
            : levelNames[lvlIndex] != null
              ? levelNames[lvlIndex]
              : sensorDesc;

        dict[`day${idx}`] = {
          name: entry.name,
          day: dayLabel,
          // state lämnar vi orört (0.5–3)
          state: entry.level,
          // state_text med rätt textfras
          state_text: text,
        };
      });

      // Filtrera bort allergener under tröskel
      const baseCount = Math.min(days_to_show, levels.length);
      let meets = pollen_threshold === 0;
      for (let i = 0; i < baseCount && !meets; i++) {
        if (levels[i].level >= pollen_threshold) meets = true;
      }
      if (meets) sensors.push(dict);
    } catch (e) {
      console.warn(`DWD adapter: fel för allergen ${allergen}:`, e);
    }
  }

  // Sortera enligt config.sort
  sensors.sort(
    {
      value_ascending: (a, b) => a.day0.state - b.day0.state,
      value_descending: (a, b) => b.day0.state - a.day0.state,
      name_descending: (a, b) =>
        b.allergenCapitalized.localeCompare(a.allergenCapitalized),
    }[config.sort] || ((a, b) => b.day0.state - a.day0.state),
  );

  if (debug) console.log("DWD adapter: färdigt sensors‐array:", sensors);
  return sensors;
}
