// src/pollenprognos-card.ts
import { LitElement, html, css, nothing } from "lit";
import type { TemplateResult, PropertyValues } from "lit";
import type { PrimitiveType } from "intl-messageformat";
import { slugify } from "./utils/slugify.js";
import { t, detectLang } from "./i18n.js";
import { getAdapter, getStubConfig, getAutodetect } from "./adapter-registry.js";
import { findAvailableSensors } from "./utils/sensors.js";
import { cleanDeviceLabel } from "./utils/device-label.js";
import {
  filterSensorsPostFetch,
  resolveLocationByKey,
  normalizeManualPrefix,
  selectDisplaySensors,
  coerceBool,
  computeDisplayDays,
  scaleRingLevel,
  resolveNumericValue,
  hasValidPollenData,
  type DeviceDiscovery,
  type DiscoveredLocation,
} from "./utils/adapter-helpers.js";
import {
  COSMETIC_FIELDS,
  GOOGLE_MAPS_TEXT,
  GOOGLE_POLLEN_SOURCE_TEXT,
} from "./constants.js";
// Sensor detection / integration pick / location auto-select are shared with
// the card editor and the badge via src/utils/autodetect.js. The adapter
// imports kept below are the ones still used by the header label-resolution
// block in set hass() (slug extractors + location resolvers).
import { findAtmoLocationBySlug } from "./adapters/atmo.js";
import { extractCitySlugFromEntityId as extractPpCitySlugFromEntityId } from "./adapters/pp.js";
import { extractPeuLocationSlugFromEntityId } from "./adapters/peu.js";
import { extractIrmkmiLocationSlugFromEntityId } from "./adapters/irmkmi.js";
import { LEVELS_DEFAULTS } from "./utils/levels-defaults.js";
import {
  findSilamWeatherEntity,
  resolveDiscoveredLocation,
} from "./utils/silam.js";
import { deepEqual } from "./utils/confcompare.js";
import {
  normalizeCardConfig,
  mergeCardConfig,
  finalizeCardConfig,
  cardAllowedFields,
  resolveIconSize,
} from "./utils/config-normalize.js";
import { computeGridOptions } from "./utils/grid-options.js";
import {
  detectIntegrationStates,
  pickIntegration,
  autoSelectLocation,
} from "./utils/autodetect.js";
import { DWD_REGIONS, PP_POSSIBLE_CITIES } from "./constants.js";
import silamAllergenMap from "./adapters/silam_allergen_map.json";
import {
  LevelCircleMixin,
  resolveTapActionType,
  iconMoreInfoEnabled,
} from "./rendering/level-circle-mixin.js";
import { ringIconStyles } from "./rendering/ring-icon-styles.js";
import type { HomeAssistant, UnsubscribeFunc } from "./types/home-assistant.js";
import type { CardConfig, RawCardConfig } from "./types/config.js";
import type { PollenSensor } from "./types/sensor.js";
import type { ForecastEvent } from "./types/adapter.js";

class PollenPrognosCard extends LevelCircleMixin(LitElement) {
  // Unsubscribe handle: the subscribeMessage promise while pending, then the
  // resolved unsubscribe fn; null when not subscribed.
  _forecastUnsub: Promise<UnsubscribeFunc> | UnsubscribeFunc | null = null;
  _forecastEvent: ForecastEvent | null = null; // Forecast-event (ex. hourly forecast från subscribe)

  _versionLogged = false;
  _error: string | null = null; // Holds error translation key when something goes wrong
  _skipIntegrations = new Set<string>(); // Integrations that failed during autodetect

  // Narrow the mixin's optional `config` to non-optional: the card guards
  // `if (!this.config) return` in render and otherwise reads `this.config.x`
  // directly, matching the original JS. `declare` keeps Lit's reactive accessor.
  declare config: CardConfig;
  // tap_action is loosely-typed YAML; the mixin's own TapActionConfig type is
  // not exported, and the card stores `null` (not undefined) when unset, which
  // that optional type disallows. `any` is the only redeclaration compatible
  // with the mixin's optional property (null-vs-undefined). Reads go through
  // resolveTapActionType (unknown-tolerant) / _hasTapAction.
  declare tapAction: any;

  // Reactive state and plain instance fields set in the constructor / set hass.
  declare sensors: PollenSensor[];
  declare days_to_show: number;
  declare displayCols: number[];
  declare header: string;
  declare _isLoaded?: boolean;
  declare _noPollenData: boolean;
  declare _initDone: boolean;
  declare _userConfig: RawCardConfig;
  declare _integrationExplicit: boolean;
  declare _availableSensorCount?: number;
  declare _explicitLocationNoSensors?: boolean;
  declare _forecastSubEntity: string | null;
  declare _forecastSubType: string | null;
  declare _fetchSeq?: number;
  // Cached SILAM discovery from set hass. Bridges two structurally different
  // discovery shapes: the assignment source is the driver's AutodetectDiscovery
  // (adapter.ts), while the consumer (findSilamWeatherEntity) expects silam.ts's
  // private SilamDiscovery. Reconciling the two Map value types is a tracked
  // follow-up; `any` keeps the bridge until then.
  declare _silamDiscovery?: any;
  // Debug-only snapshots, assigned when this.debug is on.
  declare d_sensors?: PollenSensor[];
  declare d_availableSensors?: string[];

  override updated(changedProps: PropertyValues) {
    // Handle forecast subscription.
    // The config check covers initial setup and editor changes.
    // The fallback covers the race where the first update cycle (from
    // setConfig) fires before set hass() has run — in that case
    // _subscribeForecastIfNeeded returns early (no hass), and the
    // subsequent hass-triggered update cycle no longer has "config" in
    // changedProps.  Re-check on every cycle until subscribed.
    if (
      changedProps.has("config") ||
      (this.config?.integration === "silam" &&
        !this._forecastUnsub &&
        (!this._error || this._error === "card.error_entity_unavailable") &&
        this._hass)
    ) {
      this._subscribeForecastIfNeeded();
    }

    super.updated(changedProps);
  }

  override connectedCallback() {
    super.connectedCallback();
  }

  // Clean up forecast subscription when component is disconnected.
  override disconnectedCallback() {
    // Clean up forecast subscription
    if (this._forecastUnsub) {
      Promise.resolve(this._forecastUnsub).then((fn) => {
        if (typeof fn === "function") fn();
      });
      this._forecastUnsub = null;
      this._forecastSubEntity = null;
      this._forecastSubType = null;
    }

    super.disconnectedCallback();
  }

  _updateSensorsAndColumns(
    filtered: PollenSensor[],
    availableSensors: string[],
    cfg: CardConfig,
  ) {
    if (this.debug) {
      this.d_sensors = filtered;
      this.d_availableSensors = availableSensors;
      console.debug(
        "[Card] _updateSensorsAndColumns called with",
        availableSensors.length,
        "available sensors",
      );
    }
    const daysCount = computeDisplayDays(filtered, cfg);
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
      console.debug(
        `[Card] Final sensors for display (${filtered.length}):`,
        filtered.map((s) => ({
          name: s.allergenCapitalized,
          allergen: s.allergenReplaced,
          has_days: !!s.days,
          days_length: s.days?.length,
          entity_id: s.entity_id,
          day0_state: s.days?.[0]?.state,
        })),
      );
    }
    this.requestUpdate();
  }

  _getStaleStatus() {
    if (this.config?.integration !== "peu") {
      return { hasStale: false, allStale: false, staleSince: null };
    }

    if (this.sensors && this.sensors.length > 0) {
      const staleSensors = this.sensors.filter((s) => s.stale === true);
      const allStale = staleSensors.length === this.sensors.length;
      const hasStale = staleSensors.length > 0;
      const staleSince = staleSensors[0]?.staleSince || null;
      return { hasStale, allStale, staleSince };
    }

    if (!this._hass) {
      return { hasStale: false, allStale: false, staleSince: null };
    }

    const peuStates = Object.keys(this._hass.states).filter((id) =>
      id.startsWith("sensor.polleninformation_"),
    );

    if (!peuStates.length) {
      return { hasStale: false, allStale: false, staleSince: null };
    }

    let targetLocation =
      this.config.location === "manual" ? "" : this.config.location;
    if (!targetLocation && this.config.location !== "manual") {
      const match = peuStates[0]!.match(
        /^sensor\.polleninformation_(.+)_[^_]+$/,
      );
      targetLocation = match?.[1] ?? "";
    }

    if (!targetLocation) {
      return { hasStale: false, allStale: false, staleSince: null };
    }

    let staleCount = 0;
    let totalCount = 0;
    let staleSince = null;

    for (const entityId of peuStates) {
      const entity = this._hass.states[entityId];
      const sensorLocation = entity?.attributes?.location_slug;

      if (sensorLocation !== targetLocation) {
        continue;
      }

      totalCount++;
      if (entity?.attributes?.data_stale === true) {
        staleCount++;
        if (!staleSince) {
          staleSince = entity?.attributes?.stale_since || null;
        }
      }
    }

    return {
      hasStale: staleCount > 0,
      allStale: totalCount > 0 && staleCount === totalCount,
      staleSince,
    };
  }

  _subscribeForecastIfNeeded() {
    if (!this.config || !this._hass) return;

    // Cancel stale subscription when switching away from SILAM
    if (this.config.integration !== "silam" && this._forecastUnsub) {
      Promise.resolve(this._forecastUnsub)
        .then((fn) => {
          if (typeof fn === "function") fn();
        })
        .catch(() => {});
      this._forecastUnsub = null;
      this._forecastSubEntity = null;
      this._forecastSubType = null;
      this._forecastEvent = null;
      return;
    }

    if (this.config.integration === "silam") {
      const isManual = this.config.location === "manual";
      // Mirror silam.js fetchForecast: in manual mode use entity_prefix as a
      // discovery hint so the subscription targets the same weather entity
      // the adapter renders from. Without this, an empty configLocation lets
      // discovery pick the first available weather entity, which can differ
      // from the prefix-matched one used for sensor resolution.
      // Strip a leading "silam_pollen_" if present: users with default
      // naming enter entity_prefix="silam_pollen_<loc>_", which would
      // otherwise double up against findSilamWeatherEntity's own
      // weather.silam_pollen_${loc}_${suffix} template.
      let configLocation: string;
      if (isManual && this.config.entity_prefix) {
        configLocation = normalizeManualPrefix(this.config.entity_prefix)
          .replace(/_$/, "")
          .replace(/^silam_pollen_/, "");
      } else if (isManual) {
        configLocation = "";
      } else {
        configLocation = (this.config.location as string) || "";
      }
      const lang =
        (this.config?.date_locale as string | undefined)?.split("-")[0] || "en";
      if (this.debug) {
        console.debug("[Card][Debug] SILAM location:", configLocation);
      }
      // Manual mode with entity_weather override (#231): subscribe directly
      // to the user-supplied weather entity instead of trying to discover one
      // from configLocation. Mirror the adapter's fetchForecast normalization
      // exactly so the card and adapter never disagree about which path
      // they're on:
      //   1. Coerce non-string entity_weather to null (YAML can surface this
      //      as a number/object on misconfiguration). The adapter treats
      //      this case as "no override" and falls back to discovery; the
      //      card must do the same or hourly/twice_daily modes get stale
      //      because the card never subscribes for forecast events.
      //   2. With a real string override, require weather.* domain (the HA
      //      weather/subscribe_forecast service only accepts weather
      //      entities) AND presence in hass.states. When set-but-invalid,
      //      leave entityId null so no subscription is created. The
      //      downstream null-entityId branch surfaces this as the standard
      //      "location not found" error box, while the adapter
      //      independently warns + returns []. Both agree there's no usable
      //      weather entity, which is what the user needs to fix.
      const rawEW = isManual ? this.config.entity_weather : null;
      const entityWeather =
        typeof rawEW === "string" && rawEW.length > 0 ? rawEW : null;
      let entityId;
      if (entityWeather !== null) {
        if (
          entityWeather.startsWith("weather.") &&
          this._hass.states[entityWeather]
        ) {
          entityId = entityWeather;
        } else {
          if (this.debug) {
            console.warn(
              "[Card][subscribeForecast] entity_weather is set but invalid " +
                "(must be weather.* domain and present in hass.states):",
              entityWeather,
            );
          }
          entityId = null;
        }
      } else {
        entityId = findSilamWeatherEntity(
          this._hass,
          configLocation,
          lang,
          this.debug,
          this._silamDiscovery,
        );
      }
      let forecastType = "daily";
      if (this.config && this.config.mode === "twice_daily") {
        forecastType = "twice_daily";
      } else if (this.config && this.config.mode === "hourly") {
        forecastType = "hourly";
      }

      // Already subscribed to the same entity+type — nothing to do
      if (
        entityId &&
        this._forecastUnsub &&
        this._forecastSubEntity === entityId &&
        this._forecastSubType === forecastType
      ) {
        return;
      }

      // Cancel previous subscription
      if (this._forecastUnsub) {
        Promise.resolve(this._forecastUnsub)
          .then((fn) => {
            if (typeof fn === "function") fn();
          })
          .catch(() => {});
        this._forecastUnsub = null;
        this._forecastSubEntity = null;
        this._forecastSubType = null;
      }

      if (entityId) {
        // Check entity state — don't subscribe to unavailable/unknown entities
        const entityState = this._hass.states[entityId];
        if (
          !entityState ||
          entityState.state === "unavailable" ||
          entityState.state === "unknown"
        ) {
          if (this.debug) {
            console.debug(
              "[Card][subscribeForecast] Entity unavailable/unknown, skipping:",
              entityId,
            );
          }
          this._forecastEvent = null;
          const alreadyShowingError =
            this._error === "card.error_entity_unavailable";
          // Only assign reactive properties when values actually change,
          // otherwise each assignment triggers requestUpdate() -> updated()
          // -> _subscribeForecastIfNeeded() in an infinite microtask loop.
          if (this.sensors?.length !== 0) this.sensors = [];
          if (this._availableSensorCount !== 0) this._availableSensorCount = 0;
          if (!this._isLoaded) this._isLoaded = true;
          if (!alreadyShowingError) {
            this._error = "card.error_entity_unavailable";
            this.requestUpdate();
          }
          return;
        }

        this._error = null; // Clear errors when entity is found and available

        this._forecastSubEntity = entityId;
        this._forecastSubType = forecastType;

        const subPromise =
          this._hass.connection.subscribeMessage<ForecastEvent>(
            (event) => {
              if (this.debug) {
                console.debug(
                  "[Card][subscribeForecast] forecastEvent RECEIVED:",
                  event,
                );
              }
              this._forecastEvent = event;
              this._updateSensorsAfterForecastEvent();
            },
            {
              type: "weather/subscribe_forecast",
              entity_id: entityId,
              forecast_type: forecastType,
            },
          );
        subPromise.catch((err) => {
          console.warn(
            "[Card][subscribeForecast] Subscription failed for",
            entityId,
            err,
          );
          this._forecastUnsub = null;
          this._forecastSubEntity = null;
          this._forecastSubType = null;
          this._forecastEvent = null;
          if (!this._integrationExplicit) {
            // Autodetect: skip this integration and re-run detection
            this._skipIntegrations.add(this.config.integration!);
            if (this.debug) {
              console.debug(
                "[Card] Autodetect: skipping",
                this.config.integration,
                "- will try next integration",
              );
            }
            // Force re-evaluation by bypassing the reference equality check.
            // The null seed is intentional (defeats set hass's === guard); cast
            // for the field's HomeAssistant | undefined type.
            const hass = this._hass;
            this._hass = null as unknown as HomeAssistant | undefined;
            this.hass = hass as HomeAssistant;
          } else {
            if (this.sensors?.length !== 0) this.sensors = [];
            if (this._availableSensorCount !== 0)
              this._availableSensorCount = 0;
            if (!this._isLoaded) this._isLoaded = true;
            if (this._error !== "card.error_location_not_found") {
              this._error = "card.error_location_not_found";
              this.requestUpdate();
            }
          }
        });
        this._forecastUnsub = subPromise;
        if (this.debug) {
          console.debug(
            "[Card][subscribeForecast] Subscribed for",
            entityId,
            "forecast_type:",
            forecastType,
          );
        }
      } else {
        if (this.debug) {
          console.debug(
            "[Card] Hittar ingen weather-entity för location",
            configLocation,
          );
        }
        // Mark as loaded and store error so the user is informed
        if (this.sensors?.length !== 0) this.sensors = [];
        if (this._availableSensorCount !== 0) this._availableSensorCount = 0;
        if (this._forecastEvent != null) this._forecastEvent = null;
        if (!this._isLoaded) this._isLoaded = true;
        if (this._error !== "card.error_location_not_found") {
          this._error = "card.error_location_not_found";
          this.requestUpdate();
        }
      }
    }
  }

  _updateSensorsAfterForecastEvent() {
    if (
      this.config &&
      this.config.integration === "silam" &&
      this._forecastEvent
    ) {
      const adapter = (getAdapter(this.config.integration) ||
        getAdapter("pp"))!;
      // The subscribe callback that calls this method only runs once hass is set.
      const hass = this._hass!;
      // Out-of-order guard shared with the main fetch (see set hass): only the
      // latest fetch may apply, so a slow SILAM event fetch cannot clobber a
      // newer result with stale sensors.
      const fetchId = (this._fetchSeq = (this._fetchSeq || 0) + 1);
      adapter
        .fetchForecast(hass, this.config, this._forecastEvent)
        .then(async (sensors) => {
          const availableSensors = findAvailableSensors(
            this.config,
            hass,
            this.debug,
          );
          const filtered = filterSensorsPostFetch(
            sensors,
            this.config,
            availableSensors,
            Object.keys(hass.states),
            silamAllergenMap.mapping,
          );
          // Recompute the no-pollen-vs-no-data classification here too: a live
          // SILAM forecast event refetches without going through set hass, so a
          // stale _noPollenData would otherwise pick the wrong empty-state
          // branch (no-information vs no-allergens) until the next full fetch.
          const noPollenData =
            filtered.length === 0 && availableSensors.length > 0
              ? await hasValidPollenData(
                  adapter,
                  hass,
                  this.config,
                  this._forecastEvent,
                )
              : false;
          if (fetchId !== this._fetchSeq) return;
          this._noPollenData = noPollenData;
          this._updateSensorsAndColumns(
            filtered,
            availableSensors,
            this.config,
          );
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

  // The mixin declares `debug` as a (declare) property so it can read it; the
  // concrete card implements it as a computed getter. TS flags the
  // property→accessor shape mismatch (TS2611), inherent to this split and not
  // resolvable without changing the mixin. Suppress the single shape error; the
  // runtime contract (mixin reads this.debug) is unchanged.
  // @ts-expect-error property-in-base vs accessor-in-derived (see above)
  override get debug(): boolean {
    // return true;
    return Boolean(this.config && this.config.debug);
  }

  get _lang(): string {
    return detectLang(
      this._hass,
      this.config?.date_locale as string | undefined,
    );
  }

  _t(key: string, vars: Record<string, PrimitiveType> = {}): string {
    return t(key, this._lang, vars);
  }

  _hasTapAction(): boolean {
    const ta = this.tapAction;
    return ta && ta.type && ta.type !== "none";
  }

  static override get properties() {
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
      _noPollenData: { type: Boolean, state: true },
    };
  }

  /**
   * _renderAllergenSvg is inherited from LevelCircleMixin.
   */

  constructor() {
    super();
    this.days_to_show = 4;
    this.displayCols = [];
    this.header = "";
    this._initDone = false;
    this._userConfig = {};
    this.sensors = [];
    this.tapAction = null;
    this._forecastSubEntity = null;
    this._forecastSubType = null;
    this._noPollenData = false;
  }

  static async getConfigElement(): Promise<HTMLElement> {
    await customElements.whenDefined("pollenprognos-card-editor");
    return document.createElement("pollenprognos-card-editor");
  }

  setConfig(config: RawCardConfig): void {
    // Skip update if config is unchanged
    if (deepEqual(this._userConfig, config)) return;

    // Explicit integration
    this._integrationExplicit = Object.hasOwn(config, "integration");
    this._skipIntegrations.clear();
    this.tapAction = config.tap_action || null;

    // Select relevant stub for integration
    let integration = config.integration as string | undefined;

    // Normalize integration name to handle case sensitivity and whitespace
    if (integration && typeof integration === "string") {
      integration = integration.trim().toLowerCase();
      // Note: Don't modify the original config object as it may be read-only
    }

    const stub = (getStubConfig(integration) || getStubConfig("pp"))!;
    // Default to stub's integration when user didn't set one, so
    // this.config.integration is never undefined.
    if (!integration) integration = stub.integration as string | undefined;

    // Single validation/coercion boundary: keep allowed fields, merge onto the
    // stub, coerce known-typed YAML fields, freeze (see config-normalize.ts).
    const nextConfig = normalizeCardConfig(config, stub, {
      integration,
      filter: true,
    });

    // --- Detect cosmetic-only updates (e.g. icon_size, text_size_ratio) ---
    // Compare the *coerced* next values against the (also coerced) current
    // config over exactly the user-provided allowed fields, so a value that
    // only re-canonicalises (e.g. "4" -> 4) is not mistaken for a change.
    const prevConfig = this.config || {};
    const userKeys = cardAllowedFields(stub).filter((k) => k in config);
    const changedKeys = userKeys.filter(
      (k) => !deepEqual(nextConfig[k], prevConfig[k]),
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
  set hass(hass: HomeAssistant) {
    if (this._hass === hass) return;
    this._hass = hass;
    const explicit = !!this._integrationExplicit;
    if (this.debug)
      console.debug("[Card] set hass called; explicit:", explicit);

    // Sensordetektion — shared autodetect (see src/utils/autodetect.ts).
    // Destructure local aliases with the same names the header block below
    // already uses, so only the scan/pick/location logic moves to the shared
    // module while the rest of set hass() is untouched. The lazy discovery
    // getters preserve the per-tick discovery call count on large installs.
    const detection = detectIntegrationStates(hass, {
      debug: this.debug,
    });
    // The discovery objects/getters below are consumed by the header
    // label-resolution block further down; the per-integration state lists
    // used only for the pick/location are handled inside the shared module,
    // so they are not destructured here.
    const {
      discovery: {
        silam: silamDiscovery,
        atmo: atmoDiscovery,
        gp: gpDiscovery,
        kleenex: kleenexDiscovery,
      },
      getPpDiscovery,
      getDwdDiscovery,
      getPeuDiscovery,
      getGplDiscovery,
      getMswDiscovery,
      getIrmkmiDiscovery,
    } = detection;
    this._silamDiscovery = silamDiscovery;

    // Bestäm integration (shared priority pick honouring explicit + skip set).
    let integration = pickIntegration(detection, {
      explicit,
      userIntegration: this._userConfig.integration,
      skip: this._skipIntegrations,
    });
    // Nothing detected and no prior choice: default to pp so the
    // unknown-integration error below stays reserved for genuinely invalid ids
    // (a user-typed bad value), not noisy on every no-sensors install.
    if (!integration) integration = "pp";

    // Plocka rätt stub
    let baseStub = getStubConfig(integration);
    if (!baseStub) {
      console.error(
        "Unknown integration:",
        integration,
        "- falling back to PP",
      );
      integration = "pp";
      baseStub = getStubConfig("pp");
    }

    // Build config mutation-free through the shared boundary. set hass keeps
    // the historical full-spread merge (filter:false) — unlike setConfig it does
    // NOT strip unknown keys — then layers the hass-driven derivations
    // (PLU location stripping, allergens, date_locale, autodetected location) by
    // constructing new objects, never mutating in place. The coerce+freeze tail
    // is shared via finalizeCardConfig, so the final cfg is frozen like
    // setConfig's nextConfig.
    const { allergens, ...userConfigWithoutAllergens } = this._userConfig;
    let assembled = mergeCardConfig(userConfigWithoutAllergens, baseStub!, {
      integration,
      filter: false,
    });

    if (integration === "plu") {
      // PLU always reports Luxembourg: drop city/region_id so they can't leak
      // into the adapter. location is preserved ("manual" is a meaningful value
      // that signals the adapter's manual-mode branch, entity_prefix lookup);
      // dropping it silently disabled PLU manual mode entirely.
      assembled = Object.fromEntries(
        Object.entries(assembled).filter(
          ([k]) => k !== "city" && k !== "region_id",
        ),
      );
    }

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
      assembled = { ...assembled, allergens };
    } else {
      if (this.debug) {
        console.debug(
          "[Card] Using stub allergens for integration:",
          integration,
        );
      }
      // Om integrationen INTE är explicit (autodetect): använd stubben
      assembled = {
        ...assembled,
        allergens: (getStubConfig(integration) || getStubConfig("pp"))!
          .allergens,
      };
    }

    // Fyll date_locale. Every stub carries a date_locale key (value undefined),
    // so this branch is inert today; kept faithful in case a stub ever omits it.
    if (!Object.prototype.hasOwnProperty.call(assembled, "date_locale")) {
      const detectedLangCode = detectLang(hass, null as unknown as string);
      const localeTag =
        this._hass?.locale?.language ||
        this._hass?.language ||
        `${detectedLangCode}-${detectedLangCode.toUpperCase()}`;
      assembled = { ...assembled, date_locale: localeTag };
      if (this.debug) {
        console.debug(
          "[Card] auto-filling date_locale:",
          assembled.date_locale,
        );
      }
    }

    // Automatic region/city/location detection unless manual mode is selected.
    // Shared autoSelectLocation() returns { key, value } for the integration;
    // the "manual"/already-set guard stays here so PLU's earlier city/region
    // stripping and explicit "manual" mode keep their meaning. (The card element
    // now also auto-selects GP/MSW locations, matching the editor.)
    const autoLoc = autoSelectLocation(integration, assembled, hass, detection);
    if (
      autoLoc &&
      assembled[autoLoc.key] !== "manual" &&
      !assembled[autoLoc.key]
    ) {
      assembled = { ...assembled, [autoLoc.key]: autoLoc.value };
      if (this.debug)
        console.debug(`[Card] Auto-set ${autoLoc.key}:`, autoLoc.value);
    }

    // Coerce known-typed fields and freeze (shared boundary tail).
    const cfg = finalizeCardConfig(assembled, baseStub!);

    // Only update reactive properties when values actually changed.
    // Lit's auto-generated accessor triggers requestUpdate on every
    // assignment (new object ref ≠ old ref), which causes a full render
    // cycle with DOM mutations on every HA state change — the root cause
    // of iOS scroll position jumps.
    if (!deepEqual(this.config, cfg)) {
      this.config = cfg;
    }
    const nextTapAction = cfg.tap_action || this.tapAction || null;
    if (this.tapAction !== nextTapAction) {
      this.tapAction = nextTapAction;
    }

    if (this.debug) {
      console.debug("[Card][Debug] Active integration:", integration);
      console.debug("[Card][Debug] Allergens in config:", cfg.allergens);
    }

    // Compute header into a local variable, only assign if changed.
    let nextHeader;
    if (
      cfg.title === "false" ||
      cfg.title === false ||
      (typeof cfg.title === "string" && cfg.title.trim() === "")
    ) {
      nextHeader = "";
    } else if (
      typeof cfg.title === "string" &&
      cfg.title.trim() !== "" &&
      cfg.title !== "true"
    ) {
      nextHeader = cfg.title;
    } else {
      let loc = "";
      if (integration === "dwd") {
        // Resolve title via shared discovery so config_entry_id keys, legacy
        // numeric region_id slugs and user-customized device names all render
        // the friendly location name instead of the raw config value. Reuses
        // the cached discovery from set hass() to avoid a second registry scan.
        const dwdDiscovery = getDwdDiscovery() as DeviceDiscovery;
        const wantedLocation =
          cfg.region_id && cfg.region_id !== "manual" ? cfg.region_id : "";
        const match = resolveLocationByKey(dwdDiscovery, wantedLocation, {
          slugExtractor: (eid) => {
            const m = eid.match(/_(\d+)$/);
            return m ? m[1] : null;
          },
        });
        if (match) {
          loc = match[1].label;
        } else if (wantedLocation) {
          loc = DWD_REGIONS[wantedLocation] || wantedLocation;
        }
      } else if (integration === "peu") {
        // Primary: resolve via shared discovery so config_entry_id keys and
        // legacy lowercase slugs both produce the friendly location name.
        // Reuses cached discovery from set hass() to avoid a second scan.
        const peuDiscovery = getPeuDiscovery() as DeviceDiscovery;
        const wantedLocation =
          cfg.location && cfg.location !== "manual" ? cfg.location : "";
        const peuMatch = resolveLocationByKey(peuDiscovery, wantedLocation, {
          slugExtractor: extractPeuLocationSlugFromEntityId,
        });
        if (peuMatch) {
          loc = peuMatch[1].label;
        } else if (cfg.location !== "manual") {
          // Fallback: entity-state slug scan (for very old PEU integrations
          // without device/entity registry entries).
          const peuEntities = Object.values(hass.states).filter(
            (s) =>
              s &&
              typeof s === "object" &&
              typeof s.entity_id === "string" &&
              s.entity_id.startsWith("sensor.polleninformation_"),
          );
          const wantedSlug =
            cfg.location && cfg.location !== "manual"
              ? slugify(cfg.location as string)
              : "";
          let title = "";
          let match = null;
          if (wantedSlug) {
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
        }
      } else if (integration === "silam") {
        // Primärt: discovery-baserad title
        let title = "";
        const configLocation =
          cfg.location === "manual" ? "" : cfg.location || "";
        if (cfg.location !== "manual") {
          const discoveredLoc = resolveDiscoveredLocation(
            silamDiscovery as Parameters<typeof resolveDiscoveredLocation>[0],
            configLocation,
            this.debug,
          );
          if (discoveredLoc) {
            title = discoveredLoc.label
              .replace(/^SILAM Pollen\s*-?\s*/i, "")
              .trim();
          }
        }

        // Fallback: regex-baserad title
        if (!title && cfg.location && cfg.location !== "manual") {
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
                .filter(([, engAllergen]) =>
                  pollenAllergens.includes(engAllergen),
                )
                .map(([localSlug]) => localSlug),
            ),
          );
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
            return SilamValidAllergenSlugs.has(match[2] ?? "");
          });
          const wantedSlug = slugify(cfg.location as string);
          const match = wantedSlug
            ? silamEntities.find((s) => {
                const eid = s.entity_id.replace("sensor.silam_pollen_", "");
                const locPart = eid
                  .replace(/_[^_]+$/, "")
                  .replace(/^[-\s]+/, "");
                return slugify(locPart) === wantedSlug;
              })
            : null;
          if (match) {
            const attr = match.attributes;
            title =
              attr.location_title ||
              attr.friendly_name
                ?.replace(/^SILAM Pollen\s*-?\s*/i, "")
                .replace(/\s+\p{L}+$/u, "")
                .trim() ||
              (cfg.location as string);
            title = title.replace(/^[-\s]+/, "");
          }
        }

        loc =
          cfg.location && cfg.location !== "manual"
            ? title || cfg.location || ""
            : title;
      } else if (integration === "kleenex") {
        // Kleenex pollen radar: registry discovery first, because a renamed
        // device leaves entity IDs without the location slug the attribute
        // scraping below relies on (issue #309). The scraping stays as the
        // fallback for registry-less installs and as the only path in manual
        // mode.
        const kleenexAutodetect = getAutodetect("kleenex");
        const kleenexWanted =
          cfg.location && cfg.location !== "manual"
            ? (cfg.location as string)
            : "";
        // One call into the adapter's own resolution rather than a candidate
        // chain rebuilt here, so a location-based config resolves to the same
        // place the card renders data for. Manual mode has no location to
        // resolve; there the two are kept in step by the shared
        // scopeManualEntities call further down instead.
        const kleenexResolved = kleenexWanted
          ? kleenexAutodetect?.resolveLocation?.(
              hass,
              kleenexDiscovery,
              kleenexWanted,
            ) ?? null
          : null;
        // More than one location answers to the configured value, so naming
        // either would be a guess: derive no label and let the header fall
        // back to the raw config value.
        const kleenexAmbiguous = kleenexResolved === "ambiguous";
        const kleenexMatch = kleenexAmbiguous ? null : kleenexResolved;
        let title = kleenexMatch ? kleenexMatch[1].label : "";

        if (!title && !kleenexAmbiguous) {
          const isKleenexState = (s: unknown): s is { entity_id: string; attributes: Record<string, any> } =>
            !!s && typeof s === "object" && typeof (s as { entity_id?: unknown }).entity_id === "string";

          let match = null;
          if (cfg.location === "manual") {
            // Manual mode: the user-supplied entity_prefix is the whole naming
            // contract and need not contain the legacy `kleenex_pollen_radar_`
            // slug, so match it against every sensor rather than prefiltering
            // on the legacy prefix first (same rationale as fetchForecast).
            const prefix = normalizeManualPrefix(cfg.entity_prefix);
            if (prefix) {
              // entity_suffix is part of the naming contract: an install can
              // hold both `..._birch` and `..._birch_v2`, and a prefix-only
              // collection would let state order decide which one names the
              // header. fetchForecast filters its own collection the same way.
              const entitySuffix =
                typeof cfg.entity_suffix === "string" ? cfg.entity_suffix : "";
              let prefixed = Object.values(hass.states)
                .filter(isKleenexState)
                .filter(
                  (s) =>
                    s.entity_id.startsWith(`sensor.${prefix}`) &&
                    (!entitySuffix || s.entity_id.endsWith(entitySuffix)),
                );
              // The prefix can also match another config entry's entities
              // (`kleenex_pollen_` matches `kleenex_pollen_radar_utrecht_*`).
              // The adapter narrows its own collection to one location; the
              // header goes through the same function so it can never name a
              // location other than the one the card renders.
              const scope = kleenexAutodetect?.scopeManualEntities?.(
                hass,
                prefixed.map((s) => s.entity_id),
                {
                  prefix,
                  suffix: entitySuffix,
                  discovery: kleenexDiscovery,
                  debug: this.debug,
                },
              );
              if (scope && scope.entityIds.length !== prefixed.length) {
                const keep = new Set(scope.entityIds);
                prefixed = prefixed.filter((s) => keep.has(s.entity_id));
              }
              // A narrowed match resolved a device, so its label is a better
              // header than anything scraped out of a friendly name.
              if (scope?.label) title = scope.label;
              // The prefix also matches the diagnostic siblings (`..._date`,
              // `..._last_updated`), whose friendly names would yield a header
              // like "Kleenex pollen Date". Prefer an entity the adapter
              // classifies as renderable, whatever order hass.states has.
              //
              // The suffix is stripped before classifying: the classifier reads
              // the trailing token, so `..._trees_v2` would otherwise look as
              // unrenderable as `..._date_v2`. Suffix handling belongs to the
              // caller here, since it is card config the adapter's entity-ID
              // predicate knows nothing about.
              const stripSuffix = (entityId: string): string =>
                entitySuffix && entityId.endsWith(entitySuffix)
                  ? entityId.slice(0, -entitySuffix.length)
                  : entityId;
              const isRenderable = kleenexAutodetect?.isRenderableEntity;
              match =
                (isRenderable
                  ? prefixed.find((s) => isRenderable(stripSuffix(s.entity_id)))
                  : undefined) ??
                prefixed[0] ??
                null;
            }
          } else {
            const kleenexEntities = Object.values(hass.states)
              .filter(isKleenexState)
              .filter((s) =>
                /^sensor\.kleenex_pollen_radar_.+_.+$/.test(s.entity_id),
              );

            const wantedLocation = cfg.location
              ? slugify(cfg.location as string)
              : "";

            // Find first entity with matching location
            if (wantedLocation) {
              match =
                kleenexEntities.find((s) => {
                  const eid = s.entity_id.replace(
                    "sensor.kleenex_pollen_radar_",
                    "",
                  );
                  const locPart = eid.replace(/_[^_]+$/, "");
                  return locPart === wantedLocation;
                }) ?? null;
            } else {
              match = kleenexEntities[0] ?? null;
            }
          }

          if (match && !title) {
            const attr = match.attributes;
            title =
              attr.location_name ||
              attr.friendly_name?.match(/\(([^)]+)\)/)?.[1] ||
              attr.friendly_name
                ?.replace(/^Kleenex Pollen Radar\s*[(-]?\s*/i, "")
                .replace(
                  /[)\s]+(?:Trees|Grass|Weeds|Bomen|Gras|Kruiden|Onkruid|Arbres|Gramin[eé]+s?|Herbac[eé]+s?|Alberi|Graminacee|Erbacee).*$/i,
                  "",
                )
                .replace(
                  /^(?:Trees|Grass|Weeds|Bomen|Gras|Kruiden|Onkruid|Arbres|Gramin[eé]+s?|Herbac[eé]+s?|Alberi|Graminacee|Erbacee)(?:\s.*)?$/i,
                  "",
                )
                .trim() ||
              (cfg.location
                ? cfg.location.charAt(0).toUpperCase() +
                  (cfg.location as string).slice(1)
                : "");
          }
        }

        loc = title || cfg.location || "";
      } else if (integration === "atmo") {
        // Atmo France: reuse the discovery result computed earlier in set hass()
        // for sensor detection, to avoid a second registry/regex scan.
        const wantedLocation =
          cfg.location && cfg.location !== "manual" ? cfg.location : "";

        let title = "";
        if (wantedLocation) {
          if (atmoDiscovery.locations.has(wantedLocation)) {
            title = atmoDiscovery.locations.get(wantedLocation)!.label;
          } else {
            // Legacy slug configs ("nice"): map slug -> config_entry_id via discovery
            const entryId = findAtmoLocationBySlug(
              atmoDiscovery as Parameters<typeof findAtmoLocationBySlug>[0],
              wantedLocation,
            );
            if (entryId) title = atmoDiscovery.locations.get(entryId)!.label;
          }
        } else if (atmoDiscovery.locations.size) {
          // No explicit location: pick first discovered
          title = atmoDiscovery.locations.values().next().value!.label;
        }

        if (title) {
          title = title.charAt(0).toUpperCase() + title.slice(1);
        }

        loc = title || cfg.location || "";
      } else if (integration === "gpl") {
        // Google Pollen Levels: resolve via shared discovery so config_entry_id
        // keys and legacy label slugs both produce the friendly location name.
        // Reuses cached discovery from set hass() to avoid a second scan.
        const gplDiscovery = getGplDiscovery() as DeviceDiscovery;
        let gplMatch: [string, DiscoveredLocation] | null = null;
        if (cfg.location === "manual" && cfg.entity_prefix) {
          // Manual mode: entity resolution filters by prefix AND suffix
          // (gpl/discovery.js:resolveEntityId). Title resolution has to
          // follow the same filters or it picks a location that the
          // adapter would discard, mislabeling the rendered data.
          const rawPrefix = String(cfg.entity_prefix).replace(/^sensor\./, "");
          const wantedPrefix = `sensor.${rawPrefix}`;
          const wantedSuffix = cfg.entity_suffix || "";
          for (const [key, loc2] of gplDiscovery?.locations || []) {
            const entities = loc2?.entities;
            if (!entities) continue;
            let hit = false;
            for (const entityId of entities.values()) {
              if (typeof entityId !== "string") continue;
              if (!entityId.startsWith(wantedPrefix)) continue;
              if (wantedSuffix && !entityId.endsWith(wantedSuffix)) continue;
              hit = true;
              break;
            }
            if (hit) {
              gplMatch = [key, loc2];
              break;
            }
          }
        }
        if (!gplMatch) {
          // Non-manual (or manual with no prefix / no match): fall back to
          // key-based lookup. Empty key picks first deterministically.
          const wantedLocation =
            cfg.location && cfg.location !== "manual" ? cfg.location : "";
          gplMatch = resolveLocationByKey(gplDiscovery, wantedLocation);
        }
        // Defensive: discovery already calls cleanDeviceLabel, but apply again
        // here so a future discovery refactor that drops the call doesn't leak
        // the integration's "- <category> (<coords>)" suffix into the title.
        let title = gplMatch ? cleanDeviceLabel(gplMatch[1].label) : "";
        if (title) title = title.charAt(0).toUpperCase() + title.slice(1);

        loc = title || cfg.location || "";
      } else if (integration === "gp") {
        // Google Pollen (svenove): resolve via shared discovery so
        // config_entry_id keys and legacy label slugs both produce the
        // friendly location name. Reuses gpDiscovery computed in set hass().
        const wantedLocation =
          cfg.location && cfg.location !== "manual" ? cfg.location : "";
        const gpMatch = resolveLocationByKey(gpDiscovery as DeviceDiscovery, wantedLocation);
        // Defensive: same rationale as the GPL branch above.
        const title = gpMatch ? cleanDeviceLabel(gpMatch[1].label) : "";

        loc = title || cfg.location || "";
      } else if (integration === "msw") {
        // MeteoSwiss / hass-swissweather: resolve via shared device discovery
        // so config_entry_id keys, friendly device names, and renamed devices
        // (name_by_user) all surface the right station label in the header.
        const mswDiscovery = getMswDiscovery() as DeviceDiscovery;
        const wantedLocation =
          cfg.location && cfg.location !== "manual" ? cfg.location : "";
        const mswMatch = resolveLocationByKey(mswDiscovery, wantedLocation);
        const title = mswMatch ? mswMatch[1].label : "";
        loc = title || cfg.location || "";
      } else if (integration === "irmkmi") {
        // IRM KMI / meteo.be: resolve via shared device discovery so
        // config_entry_id keys, device names (the location), and renamed
        // devices (name_by_user) all surface the right location label.
        const irmkmiDiscovery = getIrmkmiDiscovery() as DeviceDiscovery;
        const wantedLocation =
          cfg.location && cfg.location !== "manual" ? cfg.location : "";
        const irmkmiMatch = resolveLocationByKey(
          irmkmiDiscovery,
          wantedLocation,
          {
            slugExtractor: extractIrmkmiLocationSlugFromEntityId,
          },
        );
        const title = irmkmiMatch ? irmkmiMatch[1].label : "";
        loc = title || cfg.location || "";
      } else if (integration === "plu") {
        // Pollen.lu always reports Luxembourg as its location
        const translated = this._t("card.location.plu");
        loc = translated === "card.location.plu" ? "Luxembourg" : translated;
      } else {
        // Pollenprognos integration (PP): resolve city via shared discovery so
        // config_entry_id keys, legacy city slugs and user-customized device
        // names all render the friendly location name. Reuses cached discovery
        // from set hass() to avoid a second scan.
        const ppDiscovery = getPpDiscovery() as DeviceDiscovery;
        const wantedLocation =
          cfg.city && cfg.city !== "manual" ? cfg.city : "";
        const ppMatch = resolveLocationByKey(ppDiscovery, wantedLocation, {
          slugExtractor: extractPpCitySlugFromEntityId,
        });
        if (ppMatch) {
          loc = ppMatch[1].label;
        } else if (wantedLocation) {
          // Fallback: legacy slug → canonical city name lookup.
          const matchCity = (slug: string) =>
            PP_POSSIBLE_CITIES.find((n) => slugify(n) === slug) || slug;
          loc = matchCity(wantedLocation);
        } else {
          // No city configured and no discovery: legacy state-scan fallback.
          // Use the allergen-suffix whitelist so multi-word slugs like
          // "salg_och_viden" don't truncate the city.
          const matchCity = (slug: string) =>
            PP_POSSIBLE_CITIES.find((n) => slugify(n) === slug) || slug;
          const cities = Array.from(
            new Set(
              Object.keys(hass.states)
                .map((id) => extractPpCitySlugFromEntityId(id))
                .filter(Boolean),
            ),
          );
          loc = cities.length === 1 ? matchCity(cities[0] as string) : "";
        }
      }
      nextHeader = loc
        ? `${this._t("card.header_prefix")} ${loc}`
        : this._t("card.header_no_location");
      if (this.debug) console.debug("[Card] header set to:", nextHeader);
    }
    if (this.header !== nextHeader) {
      this.header = nextHeader;
    }

    // Hämta prognos via rätt adapter
    const adapter = (getAdapter(cfg.integration) || getAdapter("pp"))!;
    // Out-of-order guard (shared with the SILAM forecast-event fetch): only the
    // latest fetch may apply its result, so a slower earlier fetch cannot
    // overwrite newer sensors with stale data on rapid config/hass changes.
    const fetchId = (this._fetchSeq = (this._fetchSeq || 0) + 1);
    let fetchPromise: Promise<PollenSensor[]> | null;
    if (cfg.integration === "silam") {
      // Pass forecastEvent when available; fetchForecast falls back to
      // entity.attributes.forecast when forecastEvent is null (daily mode
      // or before the subscription delivers its first event).
      fetchPromise = adapter.fetchForecast(hass, cfg, this._forecastEvent);
    } else {
      fetchPromise = adapter.fetchForecast(hass, cfg);
    }
    if (fetchPromise) {
      // A setter cannot return a value; the returned promise was never used by
      // callers. `void` keeps the fire-and-forget chain (order/throws intact).
      void fetchPromise
        .then(async (sensors) => {
          if (this.debug) {
            console.debug("[Card][Debug] Sensors before filtering:", sensors);
            console.debug(
              `[Card][Debug] Adapter returned ${sensors.length} sensors:`,
              sensors.map((s) => ({
                allergen: s.allergenReplaced,
                entity_id: s.entity_id,
                has_days: !!s.days,
                days_length: s.days?.length,
                day0_state: s.days?.[0]?.state,
                day0_value: s.days?.[0]?.value,
              })),
            );
            console.debug(
              "[Card][Debug] Förväntade allergener från config:",
              cfg.allergens,
            );
          }

          if (this.debug) {
            // console.debug(
            //   "[Card][Debug] All available hass.states:",
            //   Object.keys(hass.states),
            // );
            console.debug("[Card] User selected city:", cfg.city);
            console.debug("[Card] User selected allergens:", cfg.allergens);
            console.debug("[Card] User selected location:", cfg.location);
          }

          const availableSensors = findAvailableSensors(cfg, hass, this.debug);
          const availableSensorCount = availableSensors.length;

          // Filter adapter sensors against availableSensors and allergen config
          const isSilamDaily =
            cfg.integration === "silam" && (!cfg.mode || cfg.mode === "daily");
          const filtered = filterSensorsPostFetch(
            sensors,
            cfg,
            availableSensors,
            isSilamDaily ? Object.keys(hass.states) : [],
            isSilamDaily ? silamAllergenMap.mapping : {},
          );

          if (this.debug) {
            console.debug(
              `[Card][Debug] After filtering: ${filtered.length} sensors remain:`,
              filtered.map((s) => ({
                allergen: s.allergenReplaced,
                entity_id: s.entity_id,
                has_days: !!s.days,
                days_length: s.days?.length,
                day0_state: s.days?.[0]?.state,
              })),
            );
          }

          // When the filtered set is empty but entities are available,
          // distinguish genuine no-pollen (data exists, all below threshold)
          // from a data problem (entities exist but no usable forecast), so the
          // breezy no_allergens image is shown only for the former.
          const noPollenData =
            filtered.length === 0 && availableSensorCount > 0
              ? await hasValidPollenData(
                  adapter,
                  hass,
                  cfg,
                  this._forecastEvent,
                )
              : false;

          // Drop a superseded fetch before mutating any state.
          if (fetchId !== this._fetchSeq) return;
          this._noPollenData = noPollenData;

          const explicitLocation = this._integrationExplicit && !!cfg.location;
          const noAvailableSensors = availableSensorCount === 0;

          if (explicitLocation && noAvailableSensors) {
            this._explicitLocationNoSensors = true;
            this._updateSensorsAndColumns([], [], cfg);
            if (this.debug) {
              console.warn(
                `[Card] No sensor found for explicitly selected location: '${cfg.location}'`,
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

  _renderNoAllergensHtml() {
    return html`
      ${this.header ? html`<div class="card-header">${this.header}</div>` : ""}
      <div class="card-content">
        <div class="no-allergens-container">
          ${this._renderAllergenSvg("no_allergens", 0)}
          <span class="no-allergens-text">${this._t("card.no_allergens")}</span>
        </div>
      </div>
    `;
  }

  _renderNoInformationHtml() {
    // Entities exist but carry no usable forecast data. Reuse the no_allergens
    // silhouette, but rendered through the no-data path (level -1) so it shows
    // the noise pattern rather than the level-0 "no pollen" colour, paired with
    // the "(No information)" label. Distinct from the breezy no-pollen state.
    return html`
      ${this.header ? html`<div class="card-header">${this.header}</div>` : ""}
      <div class="card-content">
        <div class="no-allergens-container">
          ${this._renderAllergenSvg("no_allergens", -1)}
          <span class="no-allergens-text"
            >${this._t("card.no_information")}</span
          >
        </div>
      </div>
    `;
  }

  _renderStaleDataHtml() {
    return html`
      ${this.header ? html`<div class="card-header">${this.header}</div>` : ""}
      <div class="card-content">
        <div class="stale-data-container">
          ${this._renderAllergenSvg("no_allergens", 0, { stale: true })}
          <span class="stale-data-text">${this._t("card.stale_data")}</span>
          <span class="stale-data-subtitle"
            >${this._t("card.stale_data_subtitle")}</span
          >
        </div>
      </div>
    `;
  }

  _renderMinimalHtml(): TemplateResult {
    const textSizeRatio = this.config?.text_size_ratio ?? 1;
    const iconInRing = this.config?.icon_in_ring === true;
    const ringConfig = iconInRing ? this._buildLevelRingConfig() : null;
    const ringIconRatio =
      Number(this.config?.icon_in_ring_size_ratio) ||
      LEVELS_DEFAULTS.icon_in_ring_size_ratio;
    const iconSize = resolveIconSize(this.config?.icon_size);
    // A configured element-level tap_action takes precedence over per-icon
    // more-info unless link_to_sensors is explicitly true (#279).
    const hasTap = resolveTapActionType(this.tapAction) !== null;

    return html`
      ${this.header ? html`<div class="card-header">${this.header}</div>` : ""}
      <div class="card-content">
        <div
          class="flex-container"
          style="gap: ${this.config?.minimal_gap ?? 35}px;"
        >
          ${selectDisplaySensors(this.sensors, this.config).map((sensor) => {
            if (sensor.stale) {
              const staleLabel = this.config?.show_text_allergen
                ? (this.config?.allergens_abbreviated
                    ? (sensor.allergenShort ?? "")
                    : (sensor.allergenCapitalized ?? "")) +
                  ": " +
                  this._t("card.stale_allergen")
                : this._t("card.stale_allergen");
              return html`
                <div class="sensor minimal stale">
                  ${this._renderAllergenSvg(
                    this._getSvgKey(sensor.allergenReplaced),
                    0,
                    { stale: true },
                  )}
                  <span
                    class="short-text stale-allergen-text"
                    style="font-size: ${1.0 * textSizeRatio}em;"
                  >
                    ${staleLabel}
                  </span>
                </div>
              `;
            }
            const txt = sensor.days?.[0]?.state_text ?? "";
            const rawNum = resolveNumericValue(sensor.days?.[0], this.config);
            // rawNum may be a numeric string; `>= 0` relies on JS coercion.
            const num = rawNum != null && (rawNum as number) >= 0 ? rawNum : "";
            let label = "";
            if (this.config?.show_text_allergen) {
              label += this.config?.allergens_abbreviated
                ? (sensor.allergenShort ?? "")
                : (sensor.allergenCapitalized ?? "");
            }
            if (
              this.config?.show_value_text &&
              this.config?.show_value_numeric
            ) {
              if (label) label += ": ";
              label += num !== "" ? `${txt} (${num})` : txt;
            } else if (this.config?.show_value_text) {
              if (label) label += ": ";
              label += txt;
            } else if (this.config?.show_value_numeric) {
              if (num !== "") {
                if (label) label += " ";
                label += `(${num})`;
              }
            }
            const levelForColor =
              this.config.integration === "plu"
                ? (sensor.days?.[0]?.state ?? 0)
                : (sensor.days?.[0]?.display_state ??
                  sensor.days?.[0]?.state ??
                  0);
            // For ring rendering, use the *normalized* state (not
            // display_state), so PEU's numeric_state_raw_risk doesn't
            // saturate the ring at high raw-risk values. Mirrors what
            // _renderNormalHtml does per-cell.
            const normalizedLevel = Number(sensor.days?.[0]?.state) || 0;
            const ringLevel = scaleRingLevel(
              this.config.integration,
              normalizedLevel,
            );
            const clickable =
              iconMoreInfoEnabled(this.config.link_to_sensors, hasTap) &&
              !!sensor.entity_id;
            const onClickEntity = (e: Event) => {
              if (clickable) {
                e.stopPropagation();
                this._openEntity(sensor.entity_id);
              }
            };
            const allergenSvgKey = this._getSvgKey(sensor.allergenReplaced);
            const visual = iconInRing
              ? this._renderLevelCircle(
                  ringLevel,
                  {
                    ...ringConfig,
                    size: iconSize,
                    iconKey: this._getEffectiveSvgKey(
                      allergenSvgKey as string,
                      ringLevel,
                    ),
                    iconColor: this._iconInRingColor(
                      ringLevel,
                      sensor.allergenReplaced,
                    ),
                    iconSizeRatio: ringIconRatio,
                  },
                  sensor.allergenReplaced,
                  0,
                  (rawNum !== "" ? rawNum : levelForColor) as number,
                  sensor.entity_id,
                  clickable,
                )
              : this._renderAllergenSvg(
                  allergenSvgKey,
                  levelForColor as number,
                  {
                    clickable,
                    onClick: onClickEntity,
                  },
                );
            return html`
              <div class="sensor minimal">
                ${visual}
                ${
                  label
                    ? html`<span
                        class="short-text"
                        style="font-size: ${1.0 * textSizeRatio}em;"
                        >${label}</span
                      >`
                    : ""
                }
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  _renderNormalHtml(): TemplateResult {
    // Safety check to prevent rendering before sensors are properly initialized
    if (!this.sensors || this.sensors.length === 0) {
      if (this.debug) {
        console.debug(
          "[Card] _renderNormalHtml: no sensors available, returning empty",
        );
        console.debug(
          `[Card] _renderNormalHtml: sensors=${!!this.sensors}, length=${this.sensors?.length}`,
        );
      }
      return html``;
    }

    // Summary block (issue #222): the aggregate renders as an ordinary row,
    // pinned first, via selectDisplaySensors. When the standalone summary is
    // requested (show_summary_block on, show_summary_row off) the list is just
    // the aggregate; otherwise it is the aggregate followed by the detail rows.
    // Block off returns the sensors unchanged.
    const rowSensors = selectDisplaySensors(this.sensors, this.config);

    const sensorsWithDays = rowSensors.filter(
      (s) => s.days && s.days.length > 0,
    );
    const staleSensors = rowSensors.filter((s) => s.stale === true);

    if (sensorsWithDays.length === 0 && staleSensors.length === 0) {
      if (this.debug) {
        console.debug(
          "[Card] _renderNormalHtml: no sensors have days arrays, returning empty",
        );
        console.debug(
          `[Card] _renderNormalHtml: sensors with days=${sensorsWithDays.length}, total sensors=${this.sensors.length}`,
        );
        this.sensors.forEach((sensor, i) => {
          console.debug(
            `[Card] _renderNormalHtml: sensor[${i}] ${sensor.allergenReplaced}: has_days=${!!sensor.days}, days_length=${sensor.days?.length}, day0_state=${sensor.days?.[0]?.state}`,
          );
        });
      }
      return html``;
    }

    if (this.debug) {
      console.debug(
        `[Card] _renderNormalHtml: rendering ${this.sensors.length} sensors, ${sensorsWithDays.length} with days`,
      );
    }

    const textSizeRatio = this.config?.text_size_ratio ?? 1;
    const daysBold = Boolean(this.config.days_boldfaced);
    // Compute column count from the displayed row set, not the full sensor list.
    // When standalone summary mode is active (show_summary_block on,
    // show_summary_row off), rowSensors contains only the aggregate which has
    // no future days; using this.displayCols (derived from the full list) would
    // add empty future columns. When the block is off rowSensors === this.sensors
    // so the result is identical to the old this.displayCols path.
    const cols = Array.from(
      { length: computeDisplayDays(rowSensors, this.config) },
      (_, i) => i,
    );

    // Ring geometry/colors come from the shared mixin helper
    // (_buildLevelRingConfig): segment count per integration (PEU/Kleenex/MSW
    // 4, GPL/GP 5, PLU 3, others 6), the level-color array, empty/gap colors,
    // thickness and gap. Same derivation minimal mode and the badge use.
    const { colors, emptyColor, gapColor, thickness, gap } =
      this._buildLevelRingConfig();
    const iconSize = resolveIconSize(this.config.icon_size);
    const iconRatio = Number(this.config.levels_icon_ratio) || 1;
    const size = Math.min(100, Math.max(1, iconSize * iconRatio));

    // Icon-in-ring (#227) state for the daily cells.
    const iconInRing = this.config?.icon_in_ring === true;
    const showAllergenColumn = this.config?.show_allergen_column !== false;
    const ringIconRatio =
      Number(this.config?.icon_in_ring_size_ratio) ||
      LEVELS_DEFAULTS.icon_in_ring_size_ratio;
    // A configured element-level tap_action takes precedence over per-icon
    // more-info unless link_to_sensors is explicitly true (#279).
    const hasTap = resolveTapActionType(this.tapAction) !== null;
    const iconMoreInfo = iconMoreInfoEnabled(
      this.config?.link_to_sensors,
      hasTap,
    );

    // Degenerate config: no day columns at all (e.g. every sensor
    // stale plus show_empty_days=false). The forecast table can't
    // anchor stale rows without producing a colgroup/colspan
    // mismatch, so fall back to a flat list of stale sensors —
    // each row is just the allergen icon next to its stale text.
    if (cols.length === 0) {
      const staleOnly = rowSensors.filter((s) => s.stale === true);
      if (staleOnly.length === 0) return html``;
      return html`
        ${
          this.header ? html`<div class="card-header">${this.header}</div>` : ""
        }
        <div class="card-content">
          <div class="stale-only-list">
            ${staleOnly.map(
              (sensor) => html`
                <div class="sensor minimal stale">
                  ${this._renderAllergenSvg(
                    this._getSvgKey(sensor.allergenReplaced),
                    0,
                    { stale: true },
                  )}
                  <span
                    class="short-text stale-allergen-text"
                    style="font-size: ${1.0 * textSizeRatio}em;"
                  >
                    ${
                      this.config.allergens_abbreviated
                        ? sensor.allergenShort
                        : sensor.allergenCapitalized
                    }:
                    ${this._t("card.stale_allergen")}
                  </span>
                </div>
              `,
            )}
          </div>
        </div>
      `;
    }
    const totalCols = cols.length + (showAllergenColumn ? 1 : 0);

    if (this.debug) {
      console.debug("Display columns:", cols);
    }

    return html`
      ${this.header ? html`<div class="card-header">${this.header}</div>` : ""}
      <div class="card-content">
        <div class="forecast-content">
          <table class="forecast">
            <colgroup>
              ${(showAllergenColumn ? [0, ...cols] : cols).map(
                () => html`<col style="width: ${100 / totalCols}%;" />`,
              )}
            </colgroup>
            <thead>
              <tr>
                ${showAllergenColumn ? html`<th></th>` : ""}
                ${cols.map(
                  (i) => html`
                    <th
                      style="font-weight: ${
                        daysBold ? "bold" : "normal"
                      }; text-align: center;"
                    >
                      <div
                        style="display: flex; flex-direction: column; align-items: center;"
                      >
                        <span
                          class="day-header"
                          style="font-size: ${1.0 * textSizeRatio}em;"
                        >
                          ${rowSensors?.[0]?.days?.[i]?.day || ""}
                        </span>
                        ${
                          this.config.mode === "twice_daily" &&
                          rowSensors?.[0]?.days?.[i]?.icon
                            ? html`<ha-icon
                                icon="${rowSensors[0].days[i].icon}"
                                style="margin-top: 2px;"
                              ></ha-icon>`
                            : ""
                        }
                      </div>
                    </th>
                  `,
                )}
              </tr>
            </thead>
            ${rowSensors.flatMap((sensor, sIdx) => {
              const separator =
                this.config.show_block_separator &&
                sIdx > 0 &&
                sensor.group &&
                rowSensors[sIdx - 1]?.group &&
                sensor.group !== rowSensors[sIdx - 1]?.group
                  ? html`<tr class="block-separator-row">
                      <td colspan="${totalCols}">
                        <hr class="block-separator" />
                      </td>
                    </tr>`
                  : "";
              // Cells hoisted out of the row template: deeply-nested
              // `${... ? html`<td>...` : ""}` interpolations formatted
              // non-idempotently under Prettier. Whitespace between/inside table
              // cells is insignificant to lit, so this is formatting-only.
              const staleIconCell = showAllergenColumn
                ? html`<td>
                    ${this._renderAllergenSvg(
                      this._getSvgKey(sensor.allergenReplaced),
                      0,
                      { stale: true },
                    )}
                  </td>`
                : "";
              const staleText = showAllergenColumn
                ? this._t("card.stale_allergen")
                : `${
                    this.config.allergens_abbreviated
                      ? sensor.allergenShort
                      : sensor.allergenCapitalized
                  }: ${this._t("card.stale_allergen")}`;
              const staleNameCell = showAllergenColumn
                ? html`<td>
                    <span
                      class="stale-allergen-name"
                      style="font-size: ${1.0 * textSizeRatio}em;"
                    >
                      ${
                        this.config.allergens_abbreviated
                          ? sensor.allergenShort
                          : sensor.allergenCapitalized
                      }
                    </span>
                  </td>`
                : "";
              const staleTextRow = this.config.show_text_allergen
                ? html`<tr class="allergen-text-row allergen-stale-row">
                    ${staleNameCell}
                    <td colspan="${cols.length}"></td>
                  </tr>`
                : "";
              const normalLevel = (
                this.config.integration === "plu"
                  ? (sensor.days[0]?.state ?? 0)
                  : (sensor.days[0]?.display_state ??
                    sensor.days[0]?.state ??
                    0)
              ) as number;
              const normalIconCell = showAllergenColumn
                ? html`<td>
                    ${this._renderAllergenSvg(
                      this._getSvgKey(sensor.allergenReplaced),
                      normalLevel,
                      {
                        clickable: iconMoreInfo && !!sensor.entity_id,
                        onClick: (e: Event) => {
                          if (iconMoreInfo && sensor.entity_id) {
                            e.stopPropagation();
                            this._openEntity(sensor.entity_id);
                          }
                        },
                      },
                    )}
                  </td>`
                : "";
              const dayCells = cols.map((i) => {
                // Summary aggregate is today-only (its sensor carries no
                // forecast), so suppress the no-data future cells rather than
                // showing no-data circles next to the multi-day detail rows
                // (issue #222). Render an empty cell instead.
                if (sensor.isSummary) {
                  const st = sensor.days[i]?.state;
                  if (st == null || Number(st) < 0) return html`<td></td>`;
                }
                const normalized = Number(sensor.days[i]?.state) || 0;
                const displayVal = Number(
                  resolveNumericValue(sensor.days[i], this.config) ??
                    normalized,
                );
                const levelVal = scaleRingLevel(
                  this.config.integration,
                  normalized,
                );
                const ringOpts: {
                  colors: string[];
                  emptyColor: string;
                  gapColor: string;
                  thickness: number;
                  gap: number;
                  size: number;
                  iconKey?: string;
                  iconColor?: string;
                  iconSizeRatio?: number;
                } = { colors, emptyColor, gapColor, thickness, gap, size };
                if (iconInRing) {
                  ringOpts.iconKey = this._getEffectiveSvgKey(
                    this._getSvgKey(sensor.allergenReplaced) as string,
                    levelVal,
                  );
                  ringOpts.iconColor = this._iconInRingColor(
                    levelVal,
                    sensor.allergenReplaced,
                  );
                  ringOpts.iconSizeRatio = ringIconRatio;
                }
                const circle = this._renderLevelCircle(
                  levelVal,
                  ringOpts,
                  sensor.allergenReplaced,
                  i,
                  displayVal,
                  sensor.entity_id,
                  iconMoreInfo,
                );
                return html`<td>${circle}</td>`;
              });
              const normalNameCell = showAllergenColumn
                ? html`<td>
                    <span style="font-size: ${1.0 * textSizeRatio}em;">
                      ${
                        this.config.show_text_allergen
                          ? this.config.allergens_abbreviated
                            ? sensor.allergenShort
                            : sensor.allergenCapitalized
                          : ""
                      }
                    </span>
                  </td>`
                : "";
              const textCells = cols.map((i) => {
                // Suppress the summary aggregate's no-data future cells
                // (today-only), matching the icon row above.
                if (sensor.isSummary) {
                  const st = sensor.days[i]?.state;
                  if (st == null || Number(st) < 0) return html`<td></td>`;
                }
                const txt = sensor.days[i]?.state_text || "";
                const rawNum = resolveNumericValue(sensor.days[i], this.config);
                const num =
                  rawNum != null && (rawNum as number) >= 0 ? rawNum : "";
                let content = "";
                if (
                  this.config.show_value_text &&
                  this.config.show_value_numeric
                ) {
                  content = num !== "" ? `${txt} (${num})` : txt;
                } else if (this.config.show_value_text) {
                  content = txt;
                } else if (this.config.show_value_numeric) {
                  content = num !== "" ? String(num) : "";
                }
                return html`<td>
                  <span style="font-size: ${1.0 * textSizeRatio}em;"
                    >${content}</span
                  >
                </td>`;
              });
              const normalTextRow =
                this.config.show_text_allergen ||
                this.config.show_value_text ||
                this.config.show_value_numeric
                  ? html`<tr class="allergen-text-row">
                      ${normalNameCell}${textCells}
                    </tr>`
                  : "";
              const row = sensor.stale
                ? html`
                    <tr
                      class="allergen-icon-row allergen-stale-row"
                      valign="top"
                    >
                      ${staleIconCell}
                      <td colspan="${cols.length}" class="stale-cell">
                        <span class="stale-allergen-text"> ${staleText} </span>
                      </td>
                    </tr>
                    ${staleTextRow}
                  `
                : html`
                    <tr class="allergen-icon-row" valign="top">
                      ${normalIconCell}${dayCells}
                    </tr>
                    ${normalTextRow}
                  `;
              // Divider between the summary group (aggregate + its extras)
              // and the detail rows below, shown only when both are present
              // (issue #222) and not disabled via show_summary_separator
              // (default on). Reuses the block-separator style.
              const summarySeparator =
                coerceBool(this.config.show_summary_block) &&
                sIdx > 0 &&
                rowSensors[sIdx - 1]?.isSummary &&
                !sensor.isSummary &&
                this.config.show_summary_separator !== false
                  ? html`<tr class="block-separator-row">
                      <td colspan="${totalCols}">
                        <hr class="block-separator" />
                      </td>
                    </tr>`
                  : "";
              const extras = sensor.isSummary
                ? this._renderSummaryExtrasRows(
                    sensor,
                    totalCols,
                    textSizeRatio,
                    showAllergenColumn,
                  )
                : [];
              return [separator, summarySeparator, row, ...extras];
            })}
          </table>
        </div>
      </div>
    `;
  }

  /**
   * GPL summary qualifiers (issue #222): two text rows directly beneath the
   * aggregate — the day's top pollen types ("Top") and the plants in season
   * ("In season") — each a localized label in the allergen column and the
   * localized name list as plain text to the right. The aggregate row above
   * carries the colour/level; these rows only qualify it, so no icons, no
   * colours, no count. Each row is behind its own toggle and null-safe, so
   * SILAM/Atmo (which never set these fields) render nothing. Returns an array
   * of <tr> so the caller can spread into flatMap.
   */
  _renderSummaryExtrasRows(
    sensor: PollenSensor,
    totalCols: number,
    textSizeRatio: number,
    showAllergenColumn: boolean,
  ): TemplateResult[] {
    if (!coerceBool(this.config.show_summary_block)) return [];
    const rows: TemplateResult[] = [];
    const valueColspan = showAllergenColumn ? totalCols - 1 : totalCols;
    // Match the regular allergen text rows (same size/colour), not a dimmed
    // footnote — the product owner wants these to look like the other rows.
    const fs = `font-size: ${1.0 * textSizeRatio}em;`;

    const makeRow = (label: string, list: string) =>
      showAllergenColumn
        ? html`
            <tr class="allergen-text-row summary-qualifier-row">
              <td>
                <span class="summary-q-label" style="${fs}">${label}</span>
              </td>
              <td colspan="${valueColspan}" style="text-align: left;">
                <span class="summary-q-list" style="${fs}">${list}</span>
              </td>
            </tr>
          `
        : html`
            <tr class="allergen-text-row summary-qualifier-row">
              <td colspan="${totalCols}" style="text-align: left;">
                <span class="summary-q-label" style="${fs}">${label}:</span>
                <span class="summary-q-list" style="${fs}">${list}</span>
              </td>
            </tr>
          `;

    if (
      this.config.show_summary_top_types !== false &&
      Array.isArray(sensor.topPollen) &&
      sensor.topPollen.length > 0
    ) {
      rows.push(
        makeRow(this._t("card.summary.top_label"), sensor.topPollen.join(", ")),
      );
    }

    if (
      this.config.show_summary_plants_in_season !== false &&
      Array.isArray(sensor.plantsInSeasonList) &&
      sensor.plantsInSeasonList.length > 0
    ) {
      rows.push(
        makeRow(
          this._t("card.summary.in_season_label"),
          sensor.plantsInSeasonList.join(", "),
        ),
      );
    }

    return rows;
  }

  /**
   * Google attribution footer (issue #338). The Google Pollen API attribution
   * policy requires the "Google Maps" wordmark and the source line to be shown
   * verbatim and always visible wherever the data is displayed, so the strings
   * are never localized and never hidden behind a tooltip. Only the
   * Google-backed adapters render it; every other integration gets no extra
   * DOM node at all.
   */
  _renderGoogleAttribution(): TemplateResult | typeof nothing {
    const integration = this.config.integration;
    if (
      (integration !== "gpl" && integration !== "gp") ||
      this.config.show_google_attribution === false
    ) {
      return nothing;
    }
    return html`<div class="google-attribution">
      <span class="google-attribution-maps">${GOOGLE_MAPS_TEXT}</span
      ><span> — ${GOOGLE_POLLEN_SOURCE_TEXT}</span>
    </div>`;
  }

  override render(): TemplateResult {
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
      let errorMsg: string;
      if (this._error) {
        errorMsg = this._t(this._error);
        return html`
          <ha-card>
            <div class="card-error">${errorMsg} (${name})</div>
          </ha-card>
        `;
      } else if (this._availableSensorCount === 0) {
        const staleStatus = this._getStaleStatus();
        if (staleStatus.hasStale) {
          return html` <ha-card> ${this._renderStaleDataHtml()} </ha-card> `;
        }
        errorMsg = this._t("card.error_no_sensors");
        return html`
          <ha-card>
            <div class="card-error">${errorMsg} (${name})</div>
          </ha-card>
        `;
      } else if (this._noPollenData) {
        // Entities exist and at least one has a real reading, all below
        // threshold: genuine no pollen.
        return html` <ha-card> ${this._renderNoAllergensHtml()} </ha-card> `;
      } else {
        // Entities exist but none have usable forecast data: a data problem,
        // not "no pollen". Show the no-info visual (the no_allergens silhouette
        // filled with the no-data noise pattern) instead of the breezy image.
        if (this.debug) {
          console.debug(
            `[PollenPrognosCard] no usable forecast data (${name})`,
          );
        }
        return html` <ha-card> ${this._renderNoInformationHtml()} </ha-card> `;
      }
    }

    const staleStatus = this._getStaleStatus();
    if (staleStatus.allStale) {
      return html` <ha-card> ${this._renderStaleDataHtml()} </ha-card> `;
    }

    // Every remaining sensor is no-data (e.g. a threshold-0 config where each
    // configured allergen has a missing/invalid reading): computeDisplayDays
    // yields zero forecast columns, so the normal layout would render blank.
    // Surface the no-information state instead. Mixed data/no-data keeps
    // rendering normally (the no-data rows show the noise pattern).
    if (this.sensors.length && this.days_to_show === 0) {
      return html` <ha-card> ${this._renderNoInformationHtml()} </ha-card> `;
    }

    const cardContent = this.config.minimal
      ? this._renderMinimalHtml()
      : this._renderNormalHtml();

    // Bind only when the action resolves to a supported type, so an inert
    // tap_action doesn't make the card clickable-but-dead (predicate shared
    // with the badge in LevelCircleMixin).
    const hasTap = resolveTapActionType(this.config.tap_action) !== null;
    const bg = (this.config.background_color as string | undefined)?.trim?.();
    const bgStyle = bg ? `background-color: ${bg};` : "";
    const cursorStyle = hasTap ? "pointer" : "auto";
    const imgSize = resolveIconSize(this.config.icon_size);
    const cardStyle = `
    ${bgStyle}
    cursor: ${cursorStyle};
    --pollen-icon-size: ${imgSize}px;
  `;

    return html`
      <ha-card
        style="${cardStyle}"
        @click="${hasTap ? this._handleTapAction : null}"
      >
        ${cardContent} ${this._renderGoogleAttribution()}
      </ha-card>
    `;
  }
  getCardSize() {
    return this.sensors.length + 1;
  }

  getGridOptions() {
    return computeGridOptions(this.config);
  }

  // _handleTapAction is inherited from LevelCircleMixin (shared with the badge).
  // It resolves the action from this.tapAction, which setConfig keeps in sync.

  _fire(type: string, detail: unknown, options?: EventInit): Event {
    const event: Event & { detail?: unknown } = new Event(type, {
      bubbles: true,
      cancelable: false,
      composed: true,
      ...options,
    });
    event.detail = detail;
    this.dispatchEvent(event);
    return event;
  }

  static override get styles() {
    return css`
      ${ringIconStyles}
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

      /* SVG icon styles */
      .pp-icon {
        display: block;
        width: var(--pollen-icon-size, 48px);
        height: var(--pollen-icon-size, 48px);
        max-width: var(--pollen-icon-size, 48px);
        max-height: var(--pollen-icon-size, 48px);
        min-width: 0;
        min-height: 0;
        margin: 0 auto 6px auto;
        color: var(--pp-icon-color, var(--primary-text-color));
      }

      /* .pp-icon svg, .pp-icon svg g and .pp-icon-no-data live in the shared
         ringIconStyles fragment (identical in card and badge). */

      .pp-icon-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.1);
        border-radius: 50%;
      }

      .pp-icon-loading {
        width: 24px;
        height: 24px;
        border: 2px solid currentColor;
        border-radius: 50%;
        border-top-color: transparent;
        animation: pp-spin 1s linear infinite;
      }

      .pp-icon-error {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--pollen-icon-size, 48px);
        height: var(--pollen-icon-size, 48px);
        max-width: var(--pollen-icon-size, 48px);
        max-height: var(--pollen-icon-size, 48px);
        min-width: 0;
        min-height: 0;
        margin: 0 auto 6px auto;
      }

      @keyframes pp-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .level-circle {
        width: var(--pollen-icon-size, 48px);
        max-width: var(--pollen-icon-size, 48px);
        min-width: 0;
        height: auto;
        margin: 0 auto 6px auto;
      }

      /* Summary qualifiers (issue #222): GPL's top types and plants-in-season,
         two text rows under the aggregate. The aggregate carries the colour;
         these only qualify it — a secondary-colour label in the allergen column
         and the name list as primary-colour text to the right. */
      .summary-qualifier-row td {
        vertical-align: middle;
        padding-top: 0;
      }

      .summary-q-label,
      .summary-q-list {
        color: var(--primary-text-color);
      }

      /* .ring-icon and .ring-icon svg live in the shared ringIconStyles
         fragment (identical in card and badge). */

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

      .block-separator-row td {
        padding: 0;
      }
      .block-separator {
        border: none;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        margin: 6px 0;
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
      /* Stale-only fallback layout — used when normal-mode render has
         no day columns to anchor a table (e.g. every sensor stale and
         show_empty_days=false). Lays sensors out vertically like the
         minimal-mode stale rows. */
      .stale-only-list {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 4px;
      }
      .stale-only-list .sensor.minimal.stale {
        flex-direction: row;
        justify-content: flex-start;
        align-items: center;
        gap: 10px;
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
      /* .level-value-text lives in the shared ringIconStyles fragment. */

      /* No allergens display */
      .no-allergens-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        width: 100%;
        padding: 2em 1em;
        box-sizing: border-box;
      }

      .no-allergens-text {
        color: var(--primary-text-color);
      }

      /* Stale data display */
      .stale-data-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        width: 100%;
        padding: 2em 1em;
        box-sizing: border-box;
      }

      .stale-data-text {
        color: #b38600;
        font-weight: 500;
        margin-top: 0.5em;
      }

      .stale-data-subtitle {
        color: var(--secondary-text-color);
        font-size: 0.85em;
        margin-top: 0.25em;
      }

      /* Google attribution footer (#338). Font, the 12px floor and the two
         colours are dictated by the Google Pollen API attribution policy
         (developers.google.com/maps/documentation/pollen/policies): never
         scale the text below 12px, never recolour it, never localize the
         strings and never move them behind a tooltip. */
      .google-attribution {
        font-family: Roboto, sans-serif;
        font-weight: 400;
        font-size: 12px;
        line-height: 1.3;
        padding: 4px 16px 8px;
        text-align: center;
        color: light-dark(#5e5e5e, #ffffff);
      }

      .google-attribution-maps {
        white-space: nowrap;
      }

      /* Per-allergen stale indicator */
      .allergen-stale-row {
        opacity: 0.7;
      }

      .stale-cell {
        text-align: center;
        vertical-align: middle;
      }

      .stale-allergen-text {
        color: #b38600;
        font-style: italic;
      }

      .stale-allergen-name {
        color: var(--secondary-text-color);
      }

      .sensor.minimal.stale {
        opacity: 0.7;
      }
    `;
  }
}

customElements.define("pollenprognos-card", PollenPrognosCard);
export default PollenPrognosCard;
