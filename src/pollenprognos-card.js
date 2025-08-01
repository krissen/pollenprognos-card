// src/pollenprognos-card.js
import { LitElement, html, css } from "lit";
import { slugify } from "./utils/slugify.js";
import { images } from "./pollenprognos-images.js";
import { t, detectLang } from "./i18n.js";
import * as PP from "./adapters/pp.js";
import { normalize, normalizeDWD } from "./utils/normalize.js";
import { findAvailableSensors } from "./utils/sensors.js";
import * as DWD from "./adapters/dwd.js";
import * as PEU from "./adapters/peu.js";
import * as SILAM from "./adapters/silam.js";
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";
import { COSMETIC_FIELDS } from "./constants.js";
import { stubConfigPEU } from "./adapters/peu.js";
import { stubConfigSILAM } from "./adapters/silam.js";
import { LEVELS_DEFAULTS } from "./utils/levels-defaults.js";
import { getSilamReverseMap, findSilamWeatherEntity } from "./utils/silam.js";
import { deepEqual } from "./utils/confcompare.js";
import {
  DWD_REGIONS,
  ALLERGEN_TRANSLATION,
  ADAPTERS as CONSTANT_ADAPTERS,
  PP_POSSIBLE_CITIES,
} from "./constants.js";
import silamAllergenMap from "./adapters/silam_allergen_map.json" assert { type: "json" };
import {
  Chart,
  ArcElement,
  DoughnutController,
  Tooltip,
  Legend,
} from "https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.esm.js";

// Chart.js registreren
Chart.register(ArcElement, DoughnutController, Tooltip, Legend);
const ADAPTERS = CONSTANT_ADAPTERS;

class PollenPrognosCard extends LitElement {
  _forecastUnsub = null; // Unsubscribe-funktion
  _forecastEvent = null; // Forecast-event (ex. hourly forecast från subscribe)

  _chartCache = new Map();
  _versionLogged = false;

  _renderLevelCircle(
    level,
    {
      colors = LEVELS_DEFAULTS.levels_colors,
      emptyColor = LEVELS_DEFAULTS.levels_empty_color,
      gapColor = LEVELS_DEFAULTS.levels_gap_color,
      thickness = LEVELS_DEFAULTS.levels_thickness,
      gap = LEVELS_DEFAULTS.levels_gap,
      size = 100,
    },
    displayValue,
  ) {
    // Create a unique key for this chart configuration
    const allergen = arguments[2] || "default";
    const dayIndex = arguments[3] || 0;
    const chartId = `chart-${allergen}-${dayIndex}-${level}`;

    // Use a reference element that will be populated in firstUpdated or updated
    return html`
      <div
        id="${chartId}"
        class="level-circle"
        style="display: inline-block; width: ${size}px; height: ${size}px; position: relative;"
        .level="${level}"
        .displayValue="${displayValue}"
        .colors="${JSON.stringify(colors)}"
        .emptyColor="${emptyColor}"
        .gapColor="${gapColor}"
        .thickness="${thickness}"
        .gap="${gap}"
        .size="${size}"
        .showValue="${this.config && this.config.show_value_numeric_in_circle}"
        .fontWeight="${this.config?.levels_text_weight || "normal"}"
        .fontSizeRatio="${this.config?.levels_text_size || 0.2}"
        .textColor="${this.config?.levels_text_color ||
        "var(--primary-text-color)"}"
      ></div>
    `;
  }

  // In the updated() method, update the part that adds the text to the chart:
  // Add the text overlay if showValue is true
  if(showValue) {
    const valueText = document.createElement("div");
    valueText.className = "level-value-text";
    valueText.textContent = level;

    // Improved positioning and styling
    valueText.style.position = "absolute";
    valueText.style.top = "50%";
    valueText.style.left = "50%";
    valueText.style.transform = "translate(-50%, -50%)";

    // Get custom styling from container attributes
    const fontWeight = container.fontWeight || "normal"; // Default to normal instead of bold
    const fontSizeRatio = parseFloat(container.fontSizeRatio) || 0.2; // Smaller default ratio
    const textColor = container.textColor || "var(--primary-text-color)";
    const textSizeRatio = this.config?.text_size_ratio ?? 1;

    // Apply custom styling
    valueText.style.fontSize = `${size * fontSizeRatio}px`;
    valueText.style.fontWeight = fontWeight;
    valueText.style.color = textColor;

    // For small sizes, add extra adjustments
    if (size < 42) {
      valueText.style.lineHeight = "1";
      valueText.style.height = "1em"; // Fix height for small sizes
    }

    container.appendChild(valueText);
  }

  updated(changedProps) {
    // Handle forecast subscription
    if (changedProps.has("config") || changedProps.has("_hass")) {
      this._subscribeForecastIfNeeded();
    }

    // After rendering, find all chart containers and create/update charts
    this.updateComplete.then(() => {
      this.renderRoot.querySelectorAll(".level-circle").forEach((container) => {
        // Extract properties from the container
        const level = Number(container.level || 0);
        const displayValue =
          container.displayValue != null ? container.displayValue : level;
        const colors = JSON.parse(container.colors || "[]");
        const numSegments = colors.length;
        const safeLevel = Math.min(level, numSegments);
        const emptyColor = container.emptyColor;
        const gapColor = container.gapColor;
        const thickness = Number(container.thickness);
        const gap = Number(container.gap);
        const size = Number(container.size);
        const showValue = container.showValue;

        // Get custom styling from container attributes
        const fontWeight = container.fontWeight || "normal";
        const fontSizeRatio = parseFloat(container.fontSizeRatio) || 0.2;
        const textColor = container.textColor || "var(--primary-text-color)";

        // Check if we already have a chart for this container
        let chart = this._chartCache.get(container.id);

        // Remove previously added text element, if any
        const existingText = container.querySelector(".level-value-text");
        if (existingText) existingText.remove();

        if (!chart) {
          // Create canvas if it doesn't exist
          container.innerHTML = "";
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          container.appendChild(canvas);

          // Create data arrays
          const data = Array(numSegments).fill(1);
          const bg = Array(numSegments)
            .fill(emptyColor)
            .map((c, i) => (i < safeLevel ? colors[i] : emptyColor));
          const bc = Array(numSegments).fill(gapColor);

          // Create new chart
          chart = new Chart(canvas.getContext("2d"), {
            type: "doughnut",
            data: {
              labels: Array(numSegments).fill(""),
              datasets: [
                {
                  data,
                  backgroundColor: bg,
                  borderColor: bc,
                  borderWidth: gap,
                },
              ],
            },
            options: {
              rotation: -Math.PI / 2,
              cutout: `${100 - thickness}%`,
              responsive: false,
              maintainAspectRatio: false,
              animation: {
                duration: 0,
                animateRotate: false,
                animateScale: false,
                easing: "linear",
              },
              transitions: {
                active: {
                  animation: {
                    duration: 0,
                    animateRotate: false,
                    animateScale: false,
                    easing: "linear",
                  },
                },
                show: {
                  animations: {
                    numbers: { duration: 0, easing: "linear" },
                    colors: { duration: 0, easing: "linear" },
                  },
                },
                hide: {
                  animations: {
                    numbers: { duration: 0, easing: "linear" },
                    colors: { duration: 0, easing: "linear" },
                  },
                },
              },
              plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
              },
            },
          });
          // Add to cache
          this._chartCache.set(container.id, chart);
        } else {
          // Update existing chart if level changed
          const datasets = chart.data.datasets;
          if (datasets && datasets[0]) {
            const bg = Array(datasets[0].backgroundColor.length)
              .fill(emptyColor)
              .map((c, i) => (i < safeLevel ? colors[i] : emptyColor));

            datasets[0].backgroundColor = bg;
            chart.update("none"); // Update without animation
          }
        }

        // Add the text overlay if showValue is true
        if (showValue) {
          const valueText = document.createElement("div");
          valueText.className = "level-value-text";
          valueText.textContent = displayValue;

          // Improved positioning and styling
          valueText.style.position = "absolute";
          valueText.style.top = "50%";
          valueText.style.left = "50%";
          valueText.style.transform = "translate(-50%, -50%)";

          // Apply custom styling
          valueText.style.fontSize = `${size * fontSizeRatio}px`;
          valueText.style.fontWeight = fontWeight;
          valueText.style.color = textColor;

          // For small sizes, add extra adjustments
          if (size < 42) {
            valueText.style.lineHeight = "1";
            valueText.style.height = "1em"; // Fix height for small sizes
          }

          container.appendChild(valueText);
        }
      });
    });

    // Call parent's updated if it exists
    if (super.updated) super.updated(changedProps);
  }
  // Clean up charts when component is disconnected
  disconnectedCallback() {
    super.disconnectedCallback();

    // Clean up forecast subscription
    if (this._forecastUnsub) {
      Promise.resolve(this._forecastUnsub).then((fn) => {
        if (typeof fn === "function") fn();
      });
      this._forecastUnsub = null;
    }

    // Destroy cached charts
    this._chartCache.forEach((chart) => {
      chart.destroy();
    });
    this._chartCache.clear();
  }

  _updateSensorsAndColumns(filtered, availableSensors, cfg) {
    // Calculate expected values for comparison
    let daysCount = 0;
    if (cfg.show_empty_days) {
      daysCount = cfg.days_to_show;
    } else if (filtered.length > 0 && filtered[0].days) {
      daysCount = Math.min(filtered[0].days.length, cfg.days_to_show);
    }
    const expectedDisplayCols = Array.from({ length: daysCount }, (_, i) => i);

    // Only update if any relevant value has changed
    if (
      deepEqual(this.sensors, filtered) &&
      this._availableSensorCount === availableSensors.length &&
      this.days_to_show === daysCount &&
      deepEqual(this.displayCols, expectedDisplayCols)
    ) {
      return;
    }

    this.sensors = filtered;
    this._availableSensorCount = availableSensors.length;
    this.days_to_show = daysCount;
    this.displayCols = expectedDisplayCols;

    if (this.debug) {
      console.debug("Days to show:", this.days_to_show);
      console.debug("Display columns:", this.displayCols);
    }
    this.requestUpdate();
  }
  _subscribeForecastIfNeeded() {
    if (!this.config || !this._hass) return;

    // Avsluta tidigare subscription (alltid promisifierat)
    if (this._forecastUnsub) {
      Promise.resolve(this._forecastUnsub).then((fn) => {
        if (typeof fn === "function") fn();
      });
      this._forecastUnsub = null;
    }

    if (this.config.integration === "silam" && this.config.location) {
      const locationSlug = this.config.location.toLowerCase();
      const lang = this.config?.date_locale?.split("-")[0] || "en";
      const suffixes =
        silamAllergenMap.weather_suffixes?.[lang] ||
        silamAllergenMap.weather_suffixes?.en ||
        [];
      if (this.debug) {
        const allWeather = Object.keys(this._hass.states).filter(
          (id) =>
            typeof id === "string" && id.startsWith("weather.silam_pollen_"),
        );
        console.debug(
          "[Card][Debug] Alla weather-entities i hass.states:",
          allWeather,
        );
        console.debug("[Card][Debug] locationSlug:", locationSlug);
        console.debug("[Card][Debug] Suffixes:", suffixes);
      }
      const entityId = findSilamWeatherEntity(this._hass, locationSlug, lang);
      let forecastType = "daily";
      if (this.config && this.config.mode === "twice_daily") {
        forecastType = "twice_daily";
      } else if (this.config && this.config.mode === "hourly") {
        forecastType = "hourly";
      }
      if (entityId) {
        this._forecastUnsub = this._hass.connection.subscribeMessage(
          (event) => {
            if (this.debug) {
              console.debug(
                "[Card][subscribeForecast] forecastEvent RECEIVED:",
                event,
              );
            }
            this._forecastEvent = event;
            // Kör fetch direkt!
            this._updateSensorsAfterForecastEvent();
            // this.requestUpdate();
          },
          {
            type: "weather/subscribe_forecast",
            entity_id: entityId,
            forecast_type: forecastType,
          },
        );
        if (this.debug) {
          console.debug("[Card][subscribeForecast] Subscribed for", entityId);
        }
      } else if (this.debug) {
        console.debug(
          "[Card] Hittar ingen weather-entity för location",
          locationSlug,
        );
      }
    }
  }

  _updateSensorsAfterForecastEvent() {
    if (
      this.config &&
      this.config.integration === "silam" &&
      this._forecastEvent
    ) {
      const adapter = ADAPTERS[this.config.integration] || PP;
      adapter
        .fetchForecast(this._hass, this.config, this._forecastEvent)
        .then((sensors) => {
          const availableSensors = findAvailableSensors(
            this.config,
            this._hass,
            this.debug,
          );
          this._updateSensorsAndColumns(sensors, availableSensors, this.config);
          // this.sensors = sensors;
          // this.requestUpdate();
        });
    }
  }



  get debug() {
    // return true;
    return Boolean(this.config && this.config.debug);
  }

  get _lang() {
    return detectLang(this._hass, this.config?.date_locale);
  }

  _t(key) {
    return t(key, this._lang);
  }

  _hasTapAction() {
    const ta = this.tapAction;
    return ta && ta.type && ta.type !== "none";
  }

  static get properties() {
    return {
      hass: { state: true },
      config: {},
      sensors: { state: true },
      days_to_show: { state: true },
      displayCols: { state: true },
      header: { state: true },
      tapAction: {},
      _isLoaded: { type: Boolean, state: true },
    };
  }

  _getImageSrc(allergenReplaced, state) {
    const raw = Number(state);
    let scaled = raw;
    let min = -1,
      max = 6;
    if (this.config.integration === "dwd") {
      scaled = raw * 2;
      max = 6;
    } else if (this.config.integration === "peu") {
      // Map PEU levels 0–4 to the card scale 0–6 using the
      // same logic as in the adapter for text strings.
      scaled = raw < 2 ? Math.floor((raw * 6) / 4) : Math.ceil((raw * 6) / 4);
      max = 6;
      min = 0;
    }
    let lvl = Math.round(scaled);
    if (isNaN(lvl) || lvl < min) lvl = min;
    if (lvl > max) lvl = max;

    // if (this.debug) {
    //   console.debug(
    //     `[getImageSrc] allergenReplaced=${allergenReplaced} state=${state} scaled=${scaled} lvl=${lvl}`,
    //   );
    // }

    const key = ALLERGEN_TRANSLATION[allergenReplaced] || allergenReplaced;
    const specific = images[`${key}_${lvl}_png`];

    // if (this.debug) {
    //   console.debug(
    //     `[getImageSrc] key=${key} specific=${!!specific} images[${key}_${lvl}_png]`,
    //     images[`${key}_${lvl}_png`],
    //   );
    // }

    return specific || images[`${lvl}_png`];
  }

  constructor() {
    super();
    this.days_to_show = 4;
    this.displayCols = [];
    this.header = "";
    this._initDone = false;
    this._userConfig = {};
    this.sensors = [];
    this.tapAction = null;
  }

  static async getConfigElement() {
    await customElements.whenDefined("pollenprognos-card-editor");
    return document.createElement("pollenprognos-card-editor");
  }

  setConfig(config) {
    // Skip update if config is unchanged
    if (deepEqual(this._userConfig, config)) return;

    // Explicit integration
    this._integrationExplicit = config.hasOwnProperty("integration");
    this.tapAction = config.tap_action || null;

    // Select relevant stub for integration
    let integration = config.integration;
    let stub;
    if (integration === "pp") stub = stubConfigPP;
    else if (integration === "peu") stub = stubConfigPEU;
    else if (integration === "dwd") stub = stubConfigDWD;
    else if (integration === "silam") stub = stubConfigSILAM;
    else stub = stubConfigPP;

    // Only keep allowed fields from user config
    const allowedFields = Object.keys(stub).concat([
      "allergens",
      "icon_size",
      "city",
      "location",
      "region_id",
      "tap_action",
      "debug",
      "show_version",
      "title",
      "days_to_show",
      "date_locale",
    ]);
    let cleanedUserConfig = {};
    for (const k of allowedFields) {
      if (k in config) cleanedUserConfig[k] = config[k];
    }

    // Build final config from stub + cleaned user params
    const nextConfig = { ...stub, ...cleanedUserConfig, integration };

    // --- Detect cosmetic-only updates (e.g. icon_size, text_size_ratio) ---
    const prevConfig = this.config || {};
    const changedKeys = Object.keys(cleanedUserConfig).filter(
      (k) => !deepEqual(cleanedUserConfig[k], prevConfig[k]),
    );
    const onlyCosmetic =
      changedKeys.length > 0 &&
      changedKeys.every((k) => COSMETIC_FIELDS.includes(k));
    if (onlyCosmetic) {
      // Cosmetic-only: update config, stay loaded, re-render
      this._userConfig = { ...config };
      this.config = nextConfig;
      this._isLoaded = true;
      this.requestUpdate();
      return;
    }

    // If data-driven change: update userConfig, config, and fetch new data
    this._userConfig = { ...config };
    this.config = nextConfig;
    if (!this._versionLogged && this.config.show_version !== false) {
      console.info(
        `%c🤧 Pollenprognos Card: version ${__VERSION__}`,
        "background:#f0e68c;color:#000;padding:2px 4px;border-radius:2px;",
      );
      this._versionLogged = true;
    }
    this._initDone = false;
    if (this._hass) {
      this.hass = this._hass;
    }
  }
  set hass(hass) {
    if (this._hass === hass) return;
    this._hass = hass;
    const explicit = !!this._integrationExplicit;
    if (this.debug)
      console.debug("[Card] set hass called; explicit:", explicit);

    // Sensordetektion
    const ppStates = Object.keys(hass.states).filter(
      (id) =>
        typeof id === "string" &&
        id.startsWith("sensor.pollen_") &&
        !id.startsWith("sensor.pollenflug_"),
    );
    const dwdStates = Object.keys(hass.states).filter(
      (id) => typeof id === "string" && id.startsWith("sensor.pollenflug_"),
    );
    const peuStates = Object.keys(hass.states).filter(
      (id) =>
        typeof id === "string" && id.startsWith("sensor.polleninformation_"),
    );
    const silamStates = Object.keys(hass.states).filter(
      (id) => typeof id === "string" && id.startsWith("sensor.silam_pollen_"),
    );

    if (this.debug) {
      console.debug("Sensor states detected:");
      console.debug("PP:", ppStates);
      console.debug("DWD:", dwdStates);
      console.debug("PEU:", peuStates);
      console.debug("SILAM:", silamStates);
    }

    // Bestäm integration (PEU går före DWD)
    let integration = this._userConfig.integration;
    if (!explicit) {
      if (ppStates.length) integration = "pp";
      else if (peuStates.length) integration = "peu";
      else if (dwdStates.length) integration = "dwd";
      else if (silamStates.length) integration = "silam";
    }

    // Plocka rätt stub
    let baseStub;
    if (integration === "dwd") baseStub = stubConfigDWD;
    else if (integration === "peu") baseStub = stubConfigPEU;
    else if (integration === "pp") baseStub = stubConfigPP;
    else if (integration === "silam") baseStub = stubConfigSILAM;
    else console.error("Unknown integration:", integration);

    // Sätt config rätt — utan allergens
    const { allergens, ...userConfigWithoutAllergens } = this._userConfig;
    const cfg = {
      ...baseStub,
      ...userConfigWithoutAllergens,
      integration,
    };

    if (
      this._integrationExplicit &&
      Array.isArray(allergens) &&
      allergens.length > 0
    ) {
      // Endast om integrationen är explicit satt av användaren (inte autodetect)
      if (this.debug) {
        console.debug(
          "[Card] Explicit integration (",
          integration,
          "); using user-defined allergens:",
          allergens,
        );
      }
      cfg.allergens = allergens;
    } else {
      if (this.debug) {
        console.debug(
          "[Card] Using stub allergens for integration:",
          integration,
        );
      }
      // Om integrationen INTE är explicit (autodetect): använd stubben
      if (integration === "pp") cfg.allergens = stubConfigPP.allergens;
      else if (integration === "peu") cfg.allergens = stubConfigPEU.allergens;
      else if (integration === "dwd") cfg.allergens = stubConfigDWD.allergens;
      else if (integration === "silam")
        cfg.allergens = stubConfigSILAM.allergens;
    }

    // Fyll date_locale
    if (!cfg.hasOwnProperty("date_locale")) {
      const detectedLangCode = detectLang(hass, null);
      const localeTag =
        this._hass?.locale?.language ||
        this._hass?.language ||
        `${detectedLangCode}-${detectedLangCode.toUpperCase()}`;
      cfg.date_locale = localeTag;
      if (this.debug) {
        console.debug("[Card] auto-filling date_locale:", cfg.date_locale);
      }
    }

    // Automatisk region/stad/location
    if (integration === "dwd" && !cfg.region_id && dwdStates.length) {
      cfg.region_id = Array.from(
        new Set(dwdStates.map((id) => id.split("_").pop())),
      ).sort((a, b) => Number(a) - Number(b))[0];
      if (this.debug)
        console.debug("[Card] Auto-set region_id:", cfg.region_id);
    } else if (integration === "pp" && !cfg.city && ppStates.length) {
      cfg.city = ppStates[0]
        .slice("sensor.pollen_".length)
        .replace(/_[^_]+$/, "");
      if (this.debug) console.debug("[Card] Auto-set city:", cfg.city);
    } else if (integration === "peu" && !cfg.location && peuStates.length) {
      // Samla alla location_slug från entity attributes (om de finns)
      const peuLocations = Array.from(
        new Set(
          peuStates
            .map((eid) => {
              const attr = hass.states[eid]?.attributes || {};
              return attr.location_slug || null;
            })
            .filter(Boolean),
        ),
      );
      cfg.location = peuLocations[0] || null;
      if (this.debug)
        console.debug(
          "[Card][PEU] Auto-set location (location_slug):",
          cfg.location,
          peuLocations,
        );
    } else if (integration === "silam" && !cfg.location && silamStates.length) {
      // Samla alla unika location-namn från entity_id
      const silamLocations = Array.from(
        new Set(
          silamStates
            .map((eid) => {
              // sensor.silam_pollen_<location>_<allergen>
              // plocka ut location (mellan "sensor.silam_pollen_" och sista "_")
              const m = eid.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
              return m ? m[1] : null;
            })
            .filter(Boolean),
        ),
      );
      cfg.location = silamLocations[0] || null;
      if (this.debug)
        console.debug(
          "[Card][SILAM] Auto-set location (location):",
          cfg.location,
          silamLocations,
        );
    }

    // Spara config och header
    this.config = cfg;
    this.tapAction = cfg.tap_action || this.tapAction || null;

    if (this.debug) {
      console.debug("[Card][Debug] Aktiv integration:", integration);
      console.debug("[Card][Debug] Allergens i config:", cfg.allergens);
    }

    // Header
    if (
      cfg.title === "false" ||
      cfg.title === false ||
      (typeof cfg.title === "string" && cfg.title.trim() === "")
    ) {
      this.header = "";
    } else if (
      typeof cfg.title === "string" &&
      cfg.title.trim() !== "" &&
      cfg.title !== "true"
    ) {
      this.header = cfg.title;
    } else {
      let loc = "";
      if (integration === "dwd") {
        loc = DWD_REGIONS[cfg.region_id] || cfg.region_id;
      } else if (integration === "peu") {
        // Hitta alla peu-entities
        const peuEntities = Object.values(hass.states).filter(
          (s) =>
            s &&
            typeof s === "object" &&
            typeof s.entity_id === "string" &&
            s.entity_id.startsWith("sensor.polleninformation_"),
        );
        // Hitta entity där slug-attribut eller entity_id matchar cfg.location
        const match = peuEntities.find((s) => {
          const attr = s.attributes || {};
          const slug =
            attr.location_slug ||
            s.entity_id
              .replace("sensor.polleninformation_", "")
              .replace(/_[^_]+$/, "");
          // Always slugify both sides for matching!
          return slugify(slug) === slugify(cfg.location || "");
        });
        let title = "";
        if (match) {
          const attr = match.attributes;
          title =
            attr.location_title ||
            attr.friendly_name?.match(/\((.*?)\)/)?.[1] ||
            cfg.location;
        }
        loc = title || cfg.location || "";
      } else if (integration === "silam") {
        const pollenAllergens = [
          "alder",
          "birch",
          "grass",
          "hazel",
          "mugwort",
          "olive",
          "ragweed",
        ];
        const SilamValidAllergenSlugs = new Set(
          Object.values(silamAllergenMap.mapping).flatMap((langMap) =>
            Object.entries(langMap)
              .filter(([localSlug, engAllergen]) =>
                pollenAllergens.includes(engAllergen),
              )
              .map(([localSlug]) => localSlug),
          ),
        );
        // Hämta alla silam-entities med giltig allergen
        const silamEntities = Object.values(hass.states).filter((s) => {
          if (
            !s ||
            typeof s !== "object" ||
            typeof s.entity_id !== "string" ||
            !s.entity_id.startsWith("sensor.silam_pollen_")
          )
            return false;
          const match = s.entity_id.match(
            /^sensor\.silam_pollen_(.*)_([^_]+)$/,
          );
          if (!match) return false;
          const allergenSlug = match[2];
          return SilamValidAllergenSlugs.has(allergenSlug);
        });
        const wantedSlug = slugify(cfg.location || "");

        // Hitta första entity med samma slugificerade location
        const match = silamEntities.find((s) => {
          const eid = s.entity_id.replace("sensor.silam_pollen_", "");
          const locPart = eid.replace(/_[^_]+$/, "").replace(/^[-\s]+/, "");
          return slugify(locPart) === wantedSlug;
        });

        let title = "";
        if (match) {
          const attr = match.attributes;
          title =
            attr.location_title ||
            attr.friendly_name
              ?.replace(/^SILAM Pollen\s*-?\s*/i, "")
              .replace(/\s+\p{L}+$/u, "")
              .trim() ||
            cfg.location;
          title = title.replace(/^[-\s]+/, "");
        }

        loc = title || cfg.location || "";
      } else {
        loc =
          PP_POSSIBLE_CITIES.find(
            (n) =>
              n
                .toLowerCase()
                .replace(/[åä]/g, "a")
                .replace(/ö/g, "o")
                .replace(/[-\s]/g, "_") === cfg.city,
          ) || cfg.city;
      }
      this.header = `${this._t("card.header_prefix")} ${loc}`;
      if (this.debug) console.debug("[Card] header set to:", this.header);
    }

    // Hämta prognos via rätt adapter
    const adapter = ADAPTERS[cfg.integration] || PP;
    let fetchPromise = null;
    if (cfg.integration === "silam") {
      if (!this._forecastEvent) {
        if (this.debug) {
          console.debug(
            "[Card] Forecast mode: väntar på forecast-event innan fetch.",
          );
        }
        return;
      }
      if (!this._forecastEvent) {
        this.sensors = [];
        this.days_to_show = 0;
        this.displayCols = [];
        if (this.debug) {
          console.debug(
            "[Card] Forecast mode: forecast-event saknas, nollställer sensordata och visar laddar...",
          );
        }
        this.requestUpdate();
        return;
      }
      fetchPromise = adapter.fetchForecast(hass, cfg, this._forecastEvent);
    } else {
      fetchPromise = adapter.fetchForecast(hass, cfg);
    }
    if (fetchPromise) {
      return fetchPromise
        .then((sensors) => {
          if (this.debug) {
            console.debug("[Card][Debug] Sensors före filtrering:", sensors);
            console.debug(
              "[Card][Debug] Förväntade allergener från config:",
              cfg.allergens,
            );
          }

          if (this.debug) {
            console.debug(
              "[Card][Debug] Alla tillgängliga hass.states:",
              Object.keys(hass.states),
            );
            console.debug("[Card] Användaren har valt city:", cfg.city);
            console.debug(
              "[Card] Användaren har valt allergener:",
              cfg.allergens,
            );
            console.debug("[Card] Användaren har valt plats:", cfg.location);
          }

          const availableSensors = findAvailableSensors(cfg, hass, this.debug);
          const availableSensorCount = availableSensors.length;

          // --- AUTODETECT HASS-SLUG-SPRÅK FÖR SILAM ---
          let silamReverse = {};
          if (cfg.integration === "silam") {
            // Alla silam-entiteter för platsen
            const silamStates = Object.keys(hass.states).filter((id) => {
              const m = id.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
              return m && m[1] === (cfg.location || "");
            });

            // Loopa igenom alla sensors och alla mapping-språk
            for (const eid of silamStates) {
              const m = eid.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/);
              if (!m) continue;
              const haSlug = m[2];
              // Gå igenom alla språk och leta master-slug
              let found = false;
              for (const [lang, mapping] of Object.entries(
                silamAllergenMap.mapping,
              )) {
                if (mapping[haSlug]) {
                  silamReverse[mapping[haSlug]] = haSlug;
                  found = true;
                  break; // sluta efter första träff (det räcker, unikt per system)
                }
              }
              // Om ingen träff – debugga gärna
              if (!found && this.debug) {
                console.debug(
                  `[Card][SILAM] Hittade ingen mapping för haSlug: '${haSlug}'`,
                );
              }
            }
            if (this.debug) {
              console.debug(
                "[Card][SILAM] silamReverse byggd baserat på existerande sensors:",
                silamReverse,
              );
            }
          }

          // Filtrera adapterns sensors så att endast de finns i availableSensors
          let filtered = sensors.filter((s) => {
            if (
              cfg.integration === "silam" &&
              silamReverse &&
              (!cfg.mode || cfg.mode === "daily")
            ) {
              const loc = cfg.location || "";
              // Mappar master->haSlug för entity_id
              const key =
                silamReverse[s.allergenReplaced] || s.allergenReplaced;
              const id = `sensor.silam_pollen_${loc}_${key}`;
              if (this.debug) {
                console.debug(
                  `[Card][Debug][SILAM filter] allergenReplaced: '${s.allergenReplaced}', key: '${key}', id: '${id}', available: ${availableSensors.includes(id)}`,
                );
              }
              return availableSensors.includes(id);
            }
            return true; // fallback: visa alla
          });

          // Endast *normalisering/namn*-filtrering för de andra integrationerna!
          if (
            Array.isArray(cfg.allergens) &&
            cfg.allergens.length > 0 &&
            cfg.integration !== "silam"
          ) {
            let allowed;
            let getKey;
            if (integration === "dwd") {
              allowed = new Set(cfg.allergens.map((a) => normalizeDWD(a)));
              getKey = (s) => normalizeDWD(s.allergenReplaced || "");
            } else {
              if (this.debug) {
                console.debug(
                  "[Card][Debug] Använder normalisering för allergener:",
                  cfg.allergens,
                );
              }
              allowed = new Set(cfg.allergens.map((a) => normalize(a)));
              getKey = (s) => normalize(s.allergenReplaced || "");
            }
            filtered = filtered.filter((s) => {
              const allergenKey = getKey(s);
              const ok = allowed.has(allergenKey);
              if (!ok && this.debug) {
                console.debug(
                  `[Card][Debug] Sensor '${allergenKey}' är EJ tillåten (ej i allowed)`,
                  s,
                );
              }
              return ok;
            });
          }

          const explicitLocation = this._integrationExplicit && !!cfg.location;
          const noAvailableSensors = availableSensorCount === 0;

          if (explicitLocation && noAvailableSensors) {
            this._explicitLocationNoSensors = true;
            this._updateSensorsAndColumns([], [], cfg);
            if (this.debug) {
              console.warn(
                `[Card] Ingen sensor hittad för explicit vald plats: '${cfg.location}'`,
              );
            }
            return;
          } else {
            this._explicitLocationNoSensors = false;
            this._updateSensorsAndColumns(filtered, availableSensors, cfg);
          }
        })

        .catch((err) => {
          console.error("[Card] Error fetching pollen forecast:", err);
          if (this.debug) console.debug("[Card] fetchForecast error:", err);
        });
    }
    // this.requestUpdate();
  }

  _renderMinimalHtml() {
    const textSizeRatio = this.config?.text_size_ratio ?? 1;

    return html`
      ${this.header ? html`<div class="card-header">${this.header}</div>` : ""}
      <div class="card-content">
        <div
          class="flex-container"
          style="gap: ${this.config?.minimal_gap ?? 35}px;"
        >
          ${(this.sensors || []).map((sensor) => {
            const txt = sensor.day0?.state_text ?? "";
            const num = sensor.day0?.state ?? "";
            let label = "";
            if (this.config?.show_text_allergen) {
              label += this.config?.allergens_abbreviated
                ? sensor.allergenShort ?? ""
                : sensor.allergenCapitalized ?? "";
            }
            if (
              this.config?.show_value_text &&
              this.config?.show_value_numeric
            ) {
              if (label) label += ": ";
              label += `${txt} (${num})`;
            } else if (this.config?.show_value_text) {
              if (label) label += ": ";
              label += txt;
            } else if (this.config?.show_value_numeric) {
              if (label) label += " ";
              label += `(${num})`;
            }
            return html`
              <div class="sensor minimal">
                <img
                  class="pollen-img"
                  src="${this._getImageSrc(
                    sensor.allergenReplaced,
                    sensor.day0?.state,
                  )}"
                />
                ${label
                  ? html`<span
                      class="short-text"
                      style="font-size: ${1.0 * textSizeRatio}em;"
                      >${label}</span
                    >`
                  : ""}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  _renderNormalHtml() {
    const textSizeRatio = this.config?.text_size_ratio ?? 1;
    const daysBold = Boolean(this.config.days_boldfaced);
    const cols = this.displayCols;
    const rawColors = this.config.levels_colors ?? [
      "#ffeb3b",
      "#ffc107",
      "#ff9800",
      "#ff5722",
      "#e64a19",
      "#d32f2f",
    ];
    // Number of segments in the level circle depends on the integration.
    // PEU only uses four segments while all others use six.
    const segments = this.config.integration === "peu" ? 4 : 6;
    const colors = rawColors.slice(0, segments);
    const emptyColor = this.config.levels_empty_color ?? "var(--divider-color)";
    const gapColor =
      this.config.levels_gap_color ?? "var(--card-background-color)";
    const thickness = this.config.levels_thickness ?? 60;
    const gap = this.config.levels_gap ?? 5;
    const iconSize = Number(this.config.icon_size) || 48;
    const iconRatio = Number(this.config.levels_icon_ratio) || 1;
    const size = Math.min(100, Math.max(1, iconSize * iconRatio));

    if (this.debug) {
      console.debug("Display columns:", cols);
    }

    return html`
      ${this.header ? html`<div class="card-header">${this.header}</div>` : ""}
      <div class="card-content">
        <div class="forecast-content">
          <table class="forecast"">
            <colgroup>
              ${[0, ...cols].map(
                () => html`<col style="width: ${100 / (cols.length + 1)}%;" />`,
              )}
            </colgroup>
            <thead>
              <tr>
                <th></th>
                ${cols.map(
                  (i) => html`
                    <th
                      style="font-weight: ${daysBold
                        ? "bold"
                        : "normal"}; text-align: center;"
                    >
                      <div
                        style="display: flex; flex-direction: column; align-items: center;"
                      >
                        <span
                          class="day-header"
                          style="font-size: ${1.0 * textSizeRatio}em;"
                        >
                          ${this.sensors[0].days[i]?.day || ""}
                        </span>
                        ${this.config.mode === "twice_daily" &&
                        this.sensors[0].days[i]?.icon
                          ? html`<ha-icon
                              icon="${this.sensors[0].days[i].icon}"
                              style="margin-top: 2px;"
                            ></ha-icon>`
                          : ""}
                      </div>
                    </th>
                  `,
                )}
              </tr>
            </thead>
            ${this.sensors.map(
              (sensor) => html`
                <!-- Rad 1: bara ikoner -->
                <tr class="allergen-icon-row" valign="top">
                  <td>
                    <img
                      class="pollen-img"
                      src="${this._getImageSrc(
                        sensor.allergenReplaced,
                        sensor.days[0]?.state,
                      )}"
                    />
                  </td>
                  ${cols.map(
                    (i) => html`
                      <td>
                        ${(() => {
                          const raw = Number(sensor.days[i]?.state) || 0;
                          let levelVal = raw;
                          if (this.config.integration === "dwd") {
                            levelVal = raw * 2; // scale 0–3 to 0–6
                          } else if (this.config.integration === "peu") {
                            levelVal =
                              raw < 2
                                ? Math.floor((raw * 6) / 4)
                                : Math.ceil((raw * 6) / 4); // scale 0–4 to 0–6
                          }
                          return this._renderLevelCircle(
                            levelVal,
                            {
                              colors,
                              emptyColor,
                              gapColor,
                              thickness,
                              gap,
                              size,
                            },
                            sensor.allergenReplaced,
                            i,
                            raw,
                          );
                        })()}
                      </td>
                    `,
                  )}
                </tr>
                <!-- Rad 2: allergennamn + text/nummer under dagarna -->
                ${this.config.show_text_allergen ||
                this.config.show_value_text ||
                this.config.show_value_numeric
                  ? html`
                      <tr class="allergen-text-row">
                        <td>
                          <span style="font-size: ${1.0 * textSizeRatio}em;">
                            ${this.config.show_text_allergen
                              ? this.config.allergens_abbreviated
                                ? sensor.allergenShort
                                : sensor.allergenCapitalized
                              : ""}
                          </span>
                        </td>
                        ${cols.map((i) => {
                          const txt = sensor.days[i]?.state_text || "";
                          const num = sensor.days[i]?.state;
                          let content = "";
                          if (
                            this.config.show_value_text &&
                            this.config.show_value_numeric
                          ) {
                            content = `${txt} (${num})`;
                          } else if (this.config.show_value_text) {
                            content = txt;
                          } else if (this.config.show_value_numeric) {
                            content = String(num);
                          }
                          return html`<td>
                            <span style="font-size: ${1.0 * textSizeRatio}em;"
                              >${content}</span
                            >
                          </td>`;
                        })}
                      </tr>
                    `
                  : ""}
              `,
            )}
          </table>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.config) return html``;

    // Visa laddningsruta endast om vi INTE är laddade och saknar sensorer
    if (!this._isLoaded && (!this.sensors || !this.sensors.length)) {
      return html`
        <ha-card>
          <div style="padding: 1em; text-align: center;">
            ${this._t("card.loading_forecast") || "Loading forecast..."}
          </div>
        </ha-card>
      `;
    }

    // Visa felruta endast om vi är laddade och saknar sensorer
    if (this._isLoaded && (!this.sensors || !this.sensors.length)) {
      const nameKey = `card.integration.${this.config.integration}`;
      const name = this._t(nameKey);
      let errorMsg = "";
      if (this._availableSensorCount === 0) {
        errorMsg = this._t("card.error_no_sensors");
      } else {
        errorMsg = this._t("card.error_filtered_sensors");
      }
      return html`
        <ha-card>
          <div class="card-error">${errorMsg} (${name})</div>
        </ha-card>
      `;
    }

    // Rendera alltid sensors om de finns, oavsett laddningstillstånd
    const cardContent = this.config.minimal
      ? this._renderMinimalHtml()
      : this._renderNormalHtml();

    const tapAction = this.config.tap_action || null;
    const bgStyle = this.config.background_color?.trim?.()
      ? `background-color: ${this.config.background_color.trim()};`
      : "";
    const cursorStyle =
      tapAction && tapAction.type && tapAction.type !== "none"
        ? "pointer"
        : "auto";
    const imgSize =
      Number(this.config.icon_size) > 0 ? Number(this.config.icon_size) : 48;
    const cardStyle = `
    ${bgStyle}
    cursor: ${cursorStyle};
    --pollen-icon-size: ${imgSize}px;
  `;

    return html`
      <ha-card
        style="${cardStyle}"
        @click="${tapAction && tapAction.type && tapAction.type !== "none"
          ? this._handleTapAction
          : null}"
      >
        ${cardContent}
      </ha-card>
    `;
  }
  getCardSize() {
    return this.sensors.length + 1;
  }

  _handleTapAction(e) {
    if (!this.tapAction || !this._hass) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    const action = this.tapAction.type || "more-info";
    let entity = this.tapAction.entity || "camera.pollen";
    switch (action) {
      case "more-info":
        this._fire("hass-more-info", { entityId: entity });
        break;
      case "navigate":
        if (this.tapAction.navigation_path)
          window.history.pushState(null, "", this.tapAction.navigation_path);
        break;
      case "call-service":
        if (
          this.tapAction.service &&
          typeof this.tapAction.service === "string"
        ) {
          const [domain, service] = this.tapAction.service.split(".");
          this._hass.callService(
            domain,
            service,
            this.tapAction.service_data || {},
          );
        }
        break;
    }
  }

  _fire(type, detail, options) {
    const event = new Event(type, {
      bubbles: true,
      cancelable: false,
      composed: true,
      ...options,
    });
    event.detail = detail;
    this.dispatchEvent(event);
    return event;
  }

  static get styles() {
    return css`
      /* normalhtml */
      .forecast {
        width: 100%; /* Fyll hela kortet! */
        table-layout: fixed;
        border-collapse: separate;
        border-spacing: 0 2px;
        margin: 0 auto;
      }
      .forecast th,
      .forecast td {
        vertical-align: middle;
        min-width: 36px;
        /* Sätt ingen max-width – då tillåts kolumnerna expandera */
        padding: 2px 2px;
        text-align: center;
        white-space: normal;
        overflow-wrap: break-word;
        word-break: break-word;
        line-height: 1.2;
      }

      /* Gör bilder/ikoner alltid så stora som cellen tillåter */
      .icon-wrapper {
        width: 100%;
        display: block;
        margin: 0 auto;
        text-align: center;
        position: relative;
      }

      .day-header {
        display: block;
        width: 100%;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: center;
        margin: 0 auto;
      }

      .icon-wrapper img {
        display: block;
        margin: 0 auto;
        width: 70%;
        height: auto;
        max-width: 60px;
        min-width: 18px;
      }

      img.allergen {
        width: 100%;
        height: auto;
        display: block;
        margin: 0 auto;
        max-width: 60px;
      }

      .pollen-img {
        display: block;
        width: var(--pollen-icon-size, 48px);
        max-width: var(--pollen-icon-size, 48px);
        min-width: 0;
        height: auto;
        margin: 0 auto 6px auto;
      }

      .level-circle {
        width: var(--pollen-icon-size, 48px);
        max-width: var(--pollen-icon-size, 48px);
        min-width: 0;
        height: auto;
        margin: 0 auto 6px auto;
      }

      .forecast-content {
        width: 100%;
        overflow-x: auto;
        display: flex;
        justify-content: center;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .forecast-content::-webkit-scrollbar {
        display: none;
      }

      .allergen-icon-row td {
        padding-top: 4px;
        padding-bottom: 1px;
      }

      .allergen-text-row td {
        vertical-align: top !important; /* Tvinga innehållet uppåt */
        text-align: center;
        padding-top: 6px;
        padding-bottom: 2px; /* eller vad som känns lagom */
      }

      .icon-wrapper .circle-overlay {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 0.7rem;
        font-weight: bold;
        color: var(--primary-text-color);
        pointer-events: none;
        text-shadow:
          0 1px 3px #fff,
          0 0 2px #fff;
      }

      .forecast td {
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
        line-height: 1.2;
      }

      .sensor {
        display: flex;
        flex-direction: column; /* Stapla bild och text VERTIKALT */
        align-items: center; /* Centrera horisontellt */
        justify-content: flex-start;
        flex: 1 1 120px; /* Flexibel bredd, min 120px – justera fritt */
        min-width: 80px;
        max-width: 180px;
        margin: 0 4px;
      }

      /* minimalhtml */

      .flex-container {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        width: 100%;
        /* No font-size set here */
      }
      .sensor.minimal {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        flex: 0 1 auto; /* Allow blocks to shrink tightly */
        min-width: 0; /* Allow as narrow as possible */
        max-width: none; /* No max width */
        margin: 0; /* No extra spacing, only gap from flex-container */
      }

      .short-text {
        display: block;
        text-align: center;
        margin-top: 2px;
        word-break: break-word;
        white-space: normal;
      }
      .pollen-img,
      .level-circle {
        width: var(--pollen-icon-size, 48px);
        height: var(--pollen-icon-size, 48px);
        max-width: var(--pollen-icon-size, 48px);
        max-height: var(--pollen-icon-size, 48px);
        min-width: 0;
        min-height: 0;
        object-fit: contain;
        margin: 0 auto 6px auto;
        display: block;
        vertical-align: middle;
      }
      .level-value-text {
        max-width: 100%;
        max-height: 100%;
        overflow: hidden;
        text-align: center;
        white-space: nowrap;
      }
    `;
  }
}

customElements.define("pollenprognos-card", PollenPrognosCard);
export default PollenPrognosCard;
