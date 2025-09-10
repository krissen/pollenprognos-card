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
import * as KLEENEX from "./adapters/kleenex.js";
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";
import { COSMETIC_FIELDS } from "./constants.js";
import { stubConfigPEU } from "./adapters/peu.js";
import { stubConfigSILAM } from "./adapters/silam.js";
import { stubConfigKleenex } from "./adapters/kleenex.js";
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
} from "chart.js/auto";

// Chart.js registreren
Chart.register(ArcElement, DoughnutController, Tooltip, Legend);
const ADAPTERS = CONSTANT_ADAPTERS;

class PollenPrognosCard extends LitElement {
  _forecastUnsub = null; // Unsubscribe-funktion
  _forecastEvent = null; // Forecast-event (ex. hourly forecast från subscribe)

  _chartCache = new Map();
  _versionLogged = false;
  _error = null; // Holds error translation key when something goes wrong

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
    allergen = "default",
    dayIndex = 0,
    displayLevel = level,
    entityId = null,
    clickable = true,
  ) {
    // Create a unique key for this chart configuration
    const chartId = `chart-${allergen}-${dayIndex}-${level}`;

    // Use attributes instead of properties so values persist if DOM is cloned
    return html`
      <div
        id="${chartId}"
        class="level-circle"
        style="display: inline-block; width: ${size}px; height: ${size}px; position: relative;${
          clickable && entityId ? " cursor: pointer;" : ""
        }"
        data-level="${level}"
        data-display-level="${displayLevel}"
        data-colors='${JSON.stringify(colors)}'
        data-empty-color="${emptyColor}"
        data-gap-color="${gapColor}"
        data-thickness="${thickness}"
        data-gap="${gap}"
        data-size="${size}"
        data-show-value="${this.config && this.config.show_value_numeric_in_circle}"
        data-font-weight="${this.config?.levels_text_weight || "normal"}"
        data-font-size-ratio="${this.config?.levels_text_size || 0.2}"
        data-text-color="${
          this.config?.levels_text_color || "var(--primary-text-color)"
        }"
        @click=${(e) => {
          if (clickable && entityId) {
            e.stopPropagation();
            this._openEntity(entityId);
          }
        }}
      ></div>
    `;
  }

  _openEntity(entityId) {
    const ev = new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    });
    this.dispatchEvent(ev);
  }

  /**
   * Build or refresh all level-circle charts in the current DOM.
   * Chart options are stored as data attributes so charts can be
   * reconstructed after the DOM is cloned or replaced.
   */
  _rebuildCharts() {
    const containers = this.renderRoot?.querySelectorAll(".level-circle") || [];
    const activeIds = new Set();

    containers.forEach((container) => {
      activeIds.add(container.id);

      // Extract values from data attributes
      const level = Number(container.dataset.level || 0);
      const displayLevel = Number(container.dataset.displayLevel ?? level);
      const colors = JSON.parse(container.dataset.colors || "[]");
      const numSegments = colors.length;
      const safeLevel = Math.min(level, numSegments);
      const emptyColor = container.dataset.emptyColor;
      const gapColor = container.dataset.gapColor;
      const thickness = Number(container.dataset.thickness);
      const gap = Number(container.dataset.gap);
      const size = Number(container.dataset.size);
      const showValue = container.dataset.showValue === "true";

      // Get custom styling from data attributes
      const fontWeight = container.dataset.fontWeight || "normal";
      const fontSizeRatio = parseFloat(container.dataset.fontSizeRatio) || 0.2;
      const textColor = container.dataset.textColor || "var(--primary-text-color)";

      // Retrieve existing chart if it exists
      let chart = this._chartCache.get(container.id);

      // Remove old text overlay, if any
      const existingText = container.querySelector(".level-value-text");
      if (existingText) existingText.remove();

      // Recreate chart if missing or detached
      if (!chart || !container.contains(chart.canvas)) {
        if (chart) chart.destroy();
        container.innerHTML = "";
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        container.appendChild(canvas);

        const data = Array(numSegments).fill(1);
        const bg = Array(numSegments)
          .fill(emptyColor)
          .map((c, i) => (i < safeLevel ? colors[i] : emptyColor));
        const bc = Array(numSegments).fill(gapColor);

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

        this._chartCache.set(container.id, chart);
      } else {
        // Update existing chart if level changed
        const datasets = chart.data.datasets;
        if (datasets && datasets[0]) {
          const bg = Array(datasets[0].backgroundColor.length)
            .fill(emptyColor)
            .map((c, i) => (i < safeLevel ? colors[i] : emptyColor));

          datasets[0].backgroundColor = bg;
          chart.update("none");
        }
      }

      // Add numeric text overlay if requested
      if (showValue) {
        const valueText = document.createElement("div");
        valueText.className = "level-value-text";
        valueText.textContent = displayLevel;
        valueText.style.position = "absolute";
        valueText.style.top = "50%";
        valueText.style.left = "50%";
        valueText.style.transform = "translate(-50%, -50%)";
        valueText.style.fontSize = `${size * fontSizeRatio}px`;
        valueText.style.fontWeight = fontWeight;
        valueText.style.color = textColor;
        if (size < 42) {
          valueText.style.lineHeight = "1";
          valueText.style.height = "1em";
        }
        container.appendChild(valueText);
      }
    });

    // Remove charts whose containers disappeared
    this._chartCache.forEach((cachedChart, id) => {
      if (!activeIds.has(id)) {
        cachedChart.destroy();
        this._chartCache.delete(id);
      }
    });
  }

  updated(changedProps) {
    // Handle forecast subscription
    if (changedProps.has("config") || changedProps.has("_hass")) {
      this._subscribeForecastIfNeeded();
    }

    // After rendering, ensure all charts exist
    this.updateComplete.then(() => this._rebuildCharts());

    // Call parent's updated if it exists
    if (super.updated) super.updated(changedProps);
  }
  // Recreate charts when element is connected, useful after DOM cloning
  connectedCallback() {
    super.connectedCallback();
    Promise.resolve().then(() => this._rebuildCharts());
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

    // Determine if an update is required. Always update when data has not been loaded yet.
    const needsUpdate =
      !this._isLoaded ||
      !deepEqual(this.sensors, filtered) ||
      this._availableSensorCount !== availableSensors.length ||
      this.days_to_show !== daysCount ||
      !deepEqual(this.displayCols, expectedDisplayCols);
    if (!needsUpdate) {
      return;
    }

    // Store latest sensor information and mark data as loaded.
    this.sensors = filtered;
    this._availableSensorCount = availableSensors.length;
    this.days_to_show = daysCount;
    this.displayCols = expectedDisplayCols;
    this._isLoaded = true; // Allow render() to show specific error messages.
    this._error = null; // Clear previous errors on successful update

    if (this.debug) {
      console.debug("Days to show:", this.days_to_show);
      console.debug("Display columns:", this.displayCols);
      console.debug(`[Card] Final sensors for display (${filtered.length}):`, filtered.map(s => ({ 
        name: s.allergenCapitalized, 
        allergen: s.allergenReplaced, 
        has_days: !!s.days, 
        days_length: s.days?.length, 
        entity_id: s.entity_id,
        day0_state: s.day0?.state
      })));
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
        this._error = null; // Clear location errors when entity is found
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
      } else {
        if (this.debug) {
          console.debug(
            "[Card] Hittar ingen weather-entity för location",
            locationSlug,
          );
        }
        // Mark as loaded and store error so the user is informed
        this.sensors = [];
        this._availableSensorCount = 0;
        this._forecastEvent = null;
        this._isLoaded = true;
        this._error = "card.error_location_not_found";
        this.requestUpdate();
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
      this._isLoaded = false; // Forecast request is in progress.
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
        })
        .catch((err) => {
          console.error("[Card] Error fetching SILAM forecast:", err);
          if (this.debug) console.debug("[Card] SILAM fetch error:", err);
          this._isLoaded = true; // Avoid endless loading on failure.
          this.requestUpdate();
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
      _error: { type: String, state: true },
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
      // PEU no longer scales values, the circle max level is four.
      scaled = raw;
      max = 4;
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
    
    // Normalize integration name to handle case sensitivity and whitespace
    if (integration && typeof integration === "string") {
      integration = integration.trim().toLowerCase();
      // Note: Don't modify the original config object as it may be read-only
    }
    
    let stub;
    if (integration === "pp") stub = stubConfigPP;
    else if (integration === "peu") stub = stubConfigPEU;
    else if (integration === "dwd") stub = stubConfigDWD;
    else if (integration === "silam") stub = stubConfigSILAM;
    else if (integration === "kleenex") stub = stubConfigKleenex;
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
    const kleenexStates = Object.keys(hass.states).filter(
      (id) => typeof id === "string" && id.startsWith("sensor.kleenex_pollen_radar_"),
    );

    if (this.debug) {
      console.debug("Sensor states detected:");
      console.debug("PP:", ppStates);
      console.debug("DWD:", dwdStates);
      console.debug("PEU:", peuStates);
      console.debug("SILAM:", silamStates);
      console.debug("KLEENEX:", kleenexStates);
    }

    // Bestäm integration (PEU går före DWD)
    let integration = this._userConfig.integration;
    
    // Normalize integration name to handle case sensitivity and whitespace
    if (integration && typeof integration === "string") {
      integration = integration.trim().toLowerCase();
    }
    
    if (!explicit) {
      if (ppStates.length) integration = "pp";
      else if (peuStates.length) integration = "peu";
      else if (dwdStates.length) integration = "dwd";
      else if (silamStates.length) integration = "silam";
      else if (kleenexStates.length) integration = "kleenex";
    }

    // Plocka rätt stub
    let baseStub;
    if (integration === "dwd") baseStub = stubConfigDWD;
    else if (integration === "peu") baseStub = stubConfigPEU;
    else if (integration === "pp") baseStub = stubConfigPP;
    else if (integration === "silam") baseStub = stubConfigSILAM;
    else if (integration === "kleenex") baseStub = stubConfigKleenex;
    else {
      console.error("Unknown integration:", integration, "- falling back to PP");
      integration = "pp"; // Fallback to prevent further errors
      baseStub = stubConfigPP;
    }

    // Sätt config rätt — utan allergens
    const { allergens, ...userConfigWithoutAllergens } = this._userConfig;
    const cfg = {
      ...baseStub,
      ...userConfigWithoutAllergens,
      integration, // Use the normalized integration value
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
      else if (integration === "kleenex")
        cfg.allergens = stubConfigKleenex.allergens;
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

    // Automatic region/city/location detection unless manual mode is selected
    if (integration === "dwd" && cfg.region_id !== "manual" && !cfg.region_id && dwdStates.length) {
      cfg.region_id = Array.from(
        new Set(dwdStates.map((id) => id.split("_").pop())),
      ).sort((a, b) => Number(a) - Number(b))[0];
      if (this.debug) console.debug("[Card] Auto-set region_id:", cfg.region_id);
    } else if (integration === "pp" && cfg.city !== "manual" && !cfg.city && ppStates.length) {
      cfg.city = ppStates[0]
        .slice("sensor.pollen_".length)
        .replace(/_[^_]+$/, "");
      if (this.debug) console.debug("[Card] Auto-set city:", cfg.city);
    } else if (integration === "peu" && cfg.location !== "manual" && !cfg.location && peuStates.length) {
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
    } else if (integration === "silam" && cfg.location !== "manual" && !cfg.location && silamStates.length) {
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
    } else if (integration === "kleenex" && cfg.location !== "manual" && !cfg.location && kleenexStates.length) {
      // Look specifically for *_date sensors to extract location
      const kleenexDateSensors = Object.keys(hass.states).filter(
        (id) => typeof id === "string" && id.match(/^sensor\.kleenex_pollen_radar_.+_date$/)
      );
      
      const kleenexLocations = Array.from(
        new Set(
          kleenexDateSensors
            .map((eid) => {
              // sensor.kleenex_pollen_radar_<location>_date
              const m = eid.match(/^sensor\.kleenex_pollen_radar_(.+)_date$/);
              return m ? m[1] : null;
            })
            .filter(Boolean),
        ),
      );
      cfg.location = kleenexLocations[0] || null;
      if (this.debug)
        console.debug(
          "[Card][KLEENEX] Auto-set location:",
          cfg.location,
          kleenexLocations,
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
        loc =
          cfg.region_id && cfg.region_id !== "manual"
            ? DWD_REGIONS[cfg.region_id] || cfg.region_id
            : "";
      } else if (integration === "peu") {
        // Collect all PEU entities to determine location automatically.
        const peuEntities = Object.values(hass.states).filter(
          (s) =>
            s &&
            typeof s === "object" &&
            typeof s.entity_id === "string" &&
            s.entity_id.startsWith("sensor.polleninformation_"),
        );
        const wantedSlug =
          cfg.location && cfg.location !== "manual"
            ? slugify(cfg.location)
            : "";
        let title = "";
        let match = null;
        if (wantedSlug) {
          // Find entity matching the configured location slug.
          match = peuEntities.find((s) => {
            const attr = s.attributes || {};
            const slug =
              attr.location_slug ||
              s.entity_id
                .replace("sensor.polleninformation_", "")
                .replace(/_[^_]+$/, "");
            return slugify(slug) === wantedSlug;
          });
        } else {
          // No location configured – determine if all sensors belong to one place.
          const locations = Array.from(
            new Set(
              peuEntities.map((s) => {
                const attr = s.attributes || {};
                const slug =
                  attr.location_slug ||
                  s.entity_id
                    .replace("sensor.polleninformation_", "")
                    .replace(/_[^_]+$/, "");
                return slugify(slug);
              }),
            ),
          );
          if (locations.length === 1) {
            match = peuEntities.find((s) => {
              const attr = s.attributes || {};
              const slug =
                attr.location_slug ||
                s.entity_id
                  .replace("sensor.polleninformation_", "")
                  .replace(/_[^_]+$/, "");
              return slugify(slug) === locations[0];
            });
          }
        }
        if (match) {
          const attr = match.attributes || {};
          title =
            attr.location_title ||
            attr.friendly_name?.match(/\((.*?)\)/)?.[1] ||
            "";
        }
        loc = wantedSlug ? title || cfg.location || "" : title;
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
        const wantedSlug =
          cfg.location && cfg.location !== "manual"
            ? slugify(cfg.location)
            : "";

        // Hitta första entity med samma slugificerade location
        const match = wantedSlug
          ? silamEntities.find((s) => {
              const eid = s.entity_id.replace("sensor.silam_pollen_", "");
              const locPart = eid
                .replace(/_[^_]+$/, "")
                .replace(/^[-\s]+/, "");
              return slugify(locPart) === wantedSlug;
            })
          : null;

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

        loc = wantedSlug ? title || cfg.location || "" : title;
      } else if (integration === "kleenex") {
        // Kleenex pollen radar: extract location from sensor attributes
        const kleenexEntities = Object.values(hass.states).filter((s) => {
          if (
            !s ||
            typeof s !== "object" ||
            typeof s.entity_id !== "string" ||
            !s.entity_id.startsWith("sensor.kleenex_pollen_radar_")
          )
            return false;
          return s.entity_id.match(/^sensor\.kleenex_pollen_radar_.+_.+$/);
        });

        const wantedLocation =
          cfg.location && cfg.location !== "manual"
            ? cfg.location.toLowerCase().replace(/[^a-z0-9]/g, "_")
            : "";

        // Find first entity with matching location
        const match = wantedLocation
          ? kleenexEntities.find((s) => {
              const eid = s.entity_id.replace("sensor.kleenex_pollen_radar_", "");
              const locPart = eid.replace(/_[^_]+$/, "");
              return locPart === wantedLocation;
            })
          : kleenexEntities[0];

        let title = "";
        if (match) {
          const attr = match.attributes;
          title =
            attr.location_name ||
            attr.friendly_name
              ?.replace(/^Kleenex Pollen Radar\s*[\(\-]?\s*/i, "")
              .replace(/[\)\s]+\w+.*$/u, "")
              .trim() ||
            cfg.location;
        }

        loc = title || cfg.location || "";
      } else {
        // Pollenprognos integration (PP): resolve city automatically when unset.
        const matchCity = (slug) =>
          PP_POSSIBLE_CITIES.find((n) => slugify(n) === slug) || slug;
        if (cfg.city && cfg.city !== "manual") {
          loc = matchCity(cfg.city);
        } else {
          const ppStates = Object.keys(hass.states).filter((id) =>
            /^sensor\.pollen_(.+)_[^_]+$/.test(id),
          );
          const cities = Array.from(
            new Set(
              ppStates.map((id) =>
                id.replace("sensor.pollen_", "").replace(/_[^_]+$/, ""),
              ),
            ),
          );
          if (cities.length === 1) {
            loc = matchCity(cities[0]);
          } else {
            loc = "";
          }
        }
      }
      this.header = loc
        ? `${this._t("card.header_prefix")} ${loc}`
        : this._t("card.header_prefix");
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
      this._isLoaded = false; // Forecast request is in progress.
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
          this._isLoaded = true; // Avoid endless loading on failure.
          this.requestUpdate();
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
            // Use display_state when available, falling back to the normalized state.
            const num = sensor.day0?.display_state ?? sensor.day0?.state ?? "";
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
                  style="${this.config.link_to_sensors !== false &&
                  sensor.entity_id
                    ? "cursor: pointer;"
                    : ""}"
                  @click=${(e) => {
                    if (
                      this.config.link_to_sensors !== false &&
                      sensor.entity_id
                    ) {
                      e.stopPropagation();
                      this._openEntity(sensor.entity_id);
                    }
                  }}
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
    // Safety check to prevent rendering before sensors are properly initialized
    if (!this.sensors || this.sensors.length === 0 || !this.sensors[0]?.days) {
      if (this.debug) {
        console.debug("[Card] _renderNormalHtml: sensors not ready, returning empty");
        console.debug(`[Card] _renderNormalHtml: sensors=${!!this.sensors}, length=${this.sensors?.length}, first_has_days=${!!this.sensors?.[0]?.days}, first_days_length=${this.sensors?.[0]?.days?.length}`);
      }
      return html``;
    }

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
                          ${this.sensors?.[0]?.days?.[i]?.day || ""}
                        </span>
                        ${this.config.mode === "twice_daily" &&
                        this.sensors?.[0]?.days?.[i]?.icon
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
                      style="${this.config.link_to_sensors !== false &&
                      sensor.entity_id
                        ? "cursor: pointer;"
                        : ""}"
                      @click=${(e) => {
                        if (
                          this.config.link_to_sensors !== false &&
                          sensor.entity_id
                        ) {
                          e.stopPropagation();
                          this._openEntity(sensor.entity_id);
                        }
                      }}
                    />
                  </td>
                  ${cols.map(
                    (i) => html`
                      <td>
                        ${(() => {
                          const normalized = Number(sensor.days[i]?.state) || 0;
                          // Value to display inside the circle; defaults to normalized.
                          const displayVal = Number(
                            sensor.days[i]?.display_state ?? normalized,
                          );
                          let levelVal = normalized;
                          if (this.config.integration === "dwd") {
                            levelVal = normalized * 2; // scale 0–3 to 0–6
                          } else if (this.config.integration === "peu") {
                            // PEU levels already span 0–4.
                            levelVal = normalized;
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
                            displayVal,
                            sensor.entity_id,
                            this.config.link_to_sensors !== false,
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
                          // Prefer display_state when available to show raw values.
                          const num =
                            sensor.days[i]?.display_state ??
                            sensor.days[i]?.state;
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
      if (this._error) {
        errorMsg = this._t(this._error);
      } else if (this._availableSensorCount === 0) {
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
    // Use sun.sun as a fallback, since it always exists in Home Assistant.
    let entity = this.tapAction.entity || "sun.sun";
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
