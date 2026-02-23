// src/pollenprognos-editor.js
import { LitElement, html, css } from "lit";
import { t, detectLang, SUPPORTED_LOCALES } from "./i18n.js";
import { normalize } from "./utils/normalize.js";
import { slugify } from "./utils/slugify.js";
import { deepEqual } from "./utils/confcompare.js";
import {
  LEVELS_DEFAULTS,
  convertStrokeWidthToGap,
} from "./utils/levels-defaults.js";
import { COSMETIC_FIELDS } from "./constants.js";

// Adapter registry (stub config lookup) + direct adapter imports for constants
import { getStubConfig } from "./adapter-registry.js";
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";
import { PEU_ALLERGENS } from "./adapters/peu.js";
import { SILAM_ALLERGENS } from "./adapters/silam.js";
import { stubConfigKleenex } from "./adapters/kleenex/index.js";
import { stubConfigPLU, PLU_ALIAS_MAP } from "./adapters/plu.js";
import { ATMO_ALLERGENS, ATMO_ALLERGEN_MAP } from "./adapters/atmo.js";
import { GPL_BASE_ALLERGENS, GPL_ATTRIBUTION, discoverGplSensors, discoverGplAllergens } from "./adapters/gpl/index.js";
import {
  discoverSilamSensors,
  resolveDiscoveredLocation,
  isConfigEntryId,
} from "./utils/silam.js";

import {
  PP_POSSIBLE_CITIES,
  DWD_REGIONS,
  toCanonicalAllergenKey,
} from "./constants.js";

import silamAllergenMap from "./adapters/silam_allergen_map.json" assert { type: "json" };

// Recursive merge utility
const deepMerge = (target, source) => {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof target[key] === "object" &&
      target[key] !== null
    ) {
      out[key] = deepMerge(target[key], val);
    } else {
      out[key] = val;
    }
  }
  return out;
};

class PollenPrognosCardEditor extends LitElement {
  get debug() {
    // return true;
    return Boolean(this._config?.debug);
  }

  _hasSilamWeatherEntity(location) {
    if (
      !this._hass ||
      !this._hass.states ||
      typeof this._hass.states !== "object"
    )
      return false;

    // Primärt: discovery-baserad check
    const discovery = discoverSilamSensors(this._hass, this.debug);
    if (discovery.locations.size > 0) {
      const resolved = resolveDiscoveredLocation(discovery, location || "", this.debug);
      if (resolved) return !!resolved.weatherEntity;
      // Discovery had data but location didn't match — still try regex fallback
    }

    // Fallback: regex-baserad check
    if (!location) {
      const candidates = Object.keys(this._hass.states)
        .filter(
          (id) =>
            typeof id === "string" && id.startsWith("weather.silam_pollen_"),
        )
        .map((id) =>
          id.replace(/^weather\.silam_pollen_/, "").replace(/_.+$/, ""),
        )
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort();
      if (this.debug) {
        console.debug(
          "[Editor] _hasSilamWeatherEntity: found locations:",
          candidates,
        );
      }
      return candidates.length > 0;
    }
    const lang = detectLang(this._hass);
    const suffixes =
      silamAllergenMap.weather_suffixes?.[lang] ||
      silamAllergenMap.weather_suffixes?.en ||
      [];
    const loc = location.toLowerCase();
    for (const suffix of suffixes) {
      const entityId = `weather.silam_pollen_${loc}_${suffix}`;
      if (entityId in this._hass.states) return true;
    }
    const prefix = `weather.silam_pollen_${loc}_`;
    return Object.keys(this._hass.states).some(
      (id) => typeof id === "string" && id.startsWith(prefix),
    );
  }

  _resetAll() {
    if (this.debug) console.debug("[Editor] resetAll");
    this._userConfig = {};
    // Sätt integration och type explicit
    const integration = this._config?.integration ?? "pp";
    this.setConfig({ integration, type: "custom:pollenprognos-card" });
  }

  _resetPhrases(lang) {
    if (this.debug) console.debug("[Editor] resetPhrases – lang:", lang);

    // Sätt alltid date_locale precis efter valt språk
    this._updateConfig("date_locale", lang);

    // Välj rätt lista med raw-allergener
    // Discover GPL allergens if applicable
    let gplDiscoveredPlants = [];
    if (this._config.integration === "gpl" && this._hass) {
      gplDiscoveredPlants = discoverGplAllergens(this._hass, this._config.location, false);
      // Remove base allergens since they're added separately via GPL_BASE_ALLERGENS
      gplDiscoveredPlants = gplDiscoveredPlants.filter((k) => !GPL_BASE_ALLERGENS.includes(k));
    }

    const rawKeys =
      this._config.integration === "dwd"
        ? stubConfigDWD.allergens
        : this._config.integration === "peu"
          ? PEU_ALLERGENS
          : this._config.integration === "silam"
            ? SILAM_ALLERGENS
            : this._config.integration === "kleenex"
              ? stubConfigKleenex.allergens
              : this._config.integration === "atmo"
                ? ATMO_ALLERGENS
                : this._config.integration === "gpl"
                  ? [...GPL_BASE_ALLERGENS, ...gplDiscoveredPlants]
                  : stubConfigPP.allergens;

    // Börja bygga nytt phrases-objekt
    const full = {};
    const short = {};

    // Använd canonical nyckel för lookup i locale-filerna
    rawKeys.forEach((raw) => {
      const normKey = normalize(raw); // ex 'alm' eller 'erle'
      const canonKey = toCanonicalAllergenKey(normKey); // t.ex. 'alder'
      // Use the SILAM-specific name 'index' instead of 'allergy_risk'
      const transKey = normKey === "index" ? "index" : canonKey;
      full[raw] = t(`editor.phrases_full.${transKey}`, lang);
      short[raw] = t(`editor.phrases_short.${transKey}`, lang);
    });

    // Levels och days hämtas precis som tidigare
    const numLevels =
      this._config.integration === "dwd"
        ? 4
        : this._config.integration === "peu"
          ? 5
          : this._config.integration === "gpl"
            ? 6
            : this._config.integration === "silam"
              ? 7
              : this._config.integration === "atmo"
                ? 7
                : 7;

    const levels = Array.from({ length: numLevels }, (_, i) =>
      t(`editor.phrases_levels.${i}`, lang),
    );

    const days = {
      0: t(`editor.phrases_days.0`, lang),
      1: t(`editor.phrases_days.1`, lang),
      2: t(`editor.phrases_days.2`, lang),
    };
    const noInformation = t("editor.no_information", lang);

    // Tillämpa allt på config
    this._updateConfig("phrases", {
      full,
      short,
      levels,
      days,
      no_information: noInformation,
    });
  }

  static get properties() {
    return {
      _config: { type: Object },
      hass: { type: Object },
      installedCities: { type: Array },
      installedRegionIds: { type: Array },
      _initDone: { type: Boolean },
      _selectedPhraseLang: { state: true },
      _tapType: { type: String },
      _tapEntity: { type: String },
      _tapNavigation: { type: String },
      _tapService: { type: String },
      _tapServiceData: { type: String },
    };
  }

  // Editor translations always follow the Home Assistant language.
  get _lang() {
    return detectLang(this._hass);
  }

  _t(key) {
    return t(`editor.${key}`, this._lang);
  }

  _getAllergenDisplayName(allergenKey) {
    if (allergenKey === undefined || allergenKey === null) return "";
    const raw = typeof allergenKey === "string" ? allergenKey : String(allergenKey);
    const slug = slugify(raw);
    const canonical = toCanonicalAllergenKey(slug);
    const translationKey = `phrases_full.${canonical}`;
    const translated = this._t(translationKey);
    if (translated && translated !== translationKey) {
      return translated;
    }
    if (raw) {
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
    return canonical ? canonical.charAt(0).toUpperCase() + canonical.slice(1) : "";
  }

  constructor() {
    super();
    if (this.debug) console.log("[ALLERGEN-DEBUG] ========== Constructor called ==========");
    // Sätt ALLT till neutrala värden, oavsett state på this._hass eller this._config
    this._userConfig = {};
    this._integrationExplicit = false;
    this._thresholdExplicit = false;
    // this._config = stubConfigPP;
    this._config = {}; // Tomt – blir ändå satt av setConfig eller set hass
    this.installedCities = [];
    this.installedPeuLocations = [];
    this.installedSilamLocations = [];
    this.installedKleenexLocations = [];
    this.installedAtmoLocations = [];
    this._prevIntegration = undefined;
    this.installedRegionIds = [];
    this._initDone = false;
    // Ensure phrase language defaults to a sensible locale
    this._selectedPhraseLang = detectLang();
    this._allergensExplicit = false;
    this._origAllergensSet = false;
    this._userAllergens = null;
    this._tapType = "none";
    this._tapEntity = "";
    this._tapNavigation = "";
    this._tapService = "";
    this._tapServiceData = "";
    if (this.debug) console.log("[ALLERGEN-DEBUG] Constructor complete - _allergensExplicit:", this._allergensExplicit);
  }

  setConfig(config) {
    try {
      if (this.debug) console.log("[ALLERGEN-DEBUG] ========== setConfig() called ==========");
      if (this.debug) console.log("[ALLERGEN-DEBUG] Incoming config.allergens:", config.allergens);
      if (this.debug) console.log("[ALLERGEN-DEBUG] Current _userConfig.allergens:", this._userConfig?.allergens);
      if (this.debug) console.log("[ALLERGEN-DEBUG] Current _allergensExplicit:", this._allergensExplicit);
      
      if (this.debug) console.debug("[Editor] ▶️ setConfig INCOMING:", config);
      if (config.phrases) this._userConfig.phrases = config.phrases;
      // Default language for phrases uses locale or falls back to Home Assistant
      this._selectedPhraseLang = detectLang(this._hass, config.date_locale);

      // 1. Identify stub values and clone incoming config
      const baseDefaults = getStubConfig(config.integration || "pp");
      const stubAllergens = baseDefaults.allergens;
      const incoming = { ...config };
      
      if (this.debug) console.log("[ALLERGEN-DEBUG] Stub allergens for integration:", config.integration || "pp", stubAllergens);

      // Insert default for levels_* if missing
      Object.entries(LEVELS_DEFAULTS).forEach(([key, val]) => {
        if (!(key in incoming)) {
          incoming[key] = val;
        }
      });

      // 2. Save user-provided allergens if they differ from defaults  
      // OR if allergens were previously explicit (user made changes)
      if (this.debug) console.log("[ALLERGEN-DEBUG] Checking if allergens differ from stub...");
      if (this.debug) console.log("[ALLERGEN-DEBUG] config.allergens is array:", Array.isArray(config.allergens));
      if (this.debug) console.log("[ALLERGEN-DEBUG] deepEqual result:", deepEqual(config.allergens, stubAllergens));
      if (this.debug) console.log("[ALLERGEN-DEBUG] _allergensExplicit was:", this._allergensExplicit);
      
      if (
        Array.isArray(config.allergens) &&
        (!deepEqual(config.allergens, stubAllergens) || this._allergensExplicit)
      ) {
        this._userConfig.allergens = [...config.allergens];
        this._allergensExplicit = true;
        if (this.debug) console.log("[ALLERGEN-DEBUG] ✓ Saved user-chosen allergens to _userConfig:", this._userConfig.allergens);
        if (this.debug) console.log("[ALLERGEN-DEBUG] ✓ Set _allergensExplicit = true");
        if (this.debug)
          console.debug(
            "[Editor] saved user-chosen allergens:",
            this._userConfig.allergens,
          );
      } else {
        if (this.debug) console.log("[ALLERGEN-DEBUG] ✗ Allergens match stub AND not explicit, NOT saving");
      }

      // 3. Släpp aldrig in stub-allergener (alltid med när editorn öppnas)
      // if (
      //   Array.isArray(incoming.allergens) &&
      //   incoming.allergens.length === stubLen
      // ) {
      //   if (this.debug)
      //     console.debug(
      //       "[Editor] dropping incoming stub-allergens (length matches stub)",
      //     );
      //   delete incoming.allergens;
      // }

      // 4. Släpp aldrig in stub-pollen_threshold
      const stubThresh = (getStubConfig(incoming.integration) || getStubConfig("pp")).pollen_threshold;
      if (
        incoming.hasOwnProperty("pollen_threshold") &&
        !this._thresholdExplicit &&
        incoming.pollen_threshold === stubThresh
      ) {
        if (this.debug)
          console.debug(
            "[Editor] dropping incoming stub-threshold (matches stub):",
            stubThresh,
          );
        delete incoming.pollen_threshold;
      }

      // 5. Om integration byts, nollställ allergens/relaterade explicit-val
      const incomingInt = config.integration;
      if (
        this._prevIntegration !== undefined &&
        incomingInt !== this._prevIntegration
      ) {
        delete this._userConfig.allergens;
        this._allergensExplicit = false;
        if (this.debug)
          console.debug("[Editor] integration changed → wipe allergens");
      }

      // 6. Rensa stub-värden på integration, days_to_show, date_locale (om de inte är explicita)
      if (
        !this._integrationExplicit &&
        incoming.integration === stubConfigPP.integration
      ) {
        if (this.debug) console.debug("[Editor] dropped stub integration");
        delete incoming.integration;
      }
      if (
        !this._daysExplicit &&
        incoming.days_to_show === stubConfigPP.days_to_show
      ) {
        if (this.debug) console.debug("[Editor] dropped stub days_to_show");
        delete incoming.days_to_show;
      }
      const stubLocale = (getStubConfig(incoming.integration) || getStubConfig("pp")).date_locale;
      if (!this._localeExplicit && incoming.date_locale === stubLocale) {
        if (this.debug) console.debug("[Editor] dropped stub date_locale");
        delete incoming.date_locale;
      }

      // 6.1. Don't overwrite explicit user allergens with incoming allergens
      // If we already have user allergens saved, only overwrite if incoming is explicitly different
      if (this.debug) console.log("[ALLERGEN-DEBUG] Checking whether to drop incoming allergens...");
      if (this.debug) console.log("[ALLERGEN-DEBUG] _userConfig.allergens exists:", !!this._userConfig.allergens);
      if (this.debug) console.log("[ALLERGEN-DEBUG] incoming.allergens exists:", !!incoming.allergens);
      if (this.debug) console.log("[ALLERGEN-DEBUG] _allergensExplicit:", this._allergensExplicit);
      
      if (
        this._userConfig.allergens &&
        incoming.allergens &&
        deepEqual(incoming.allergens, this._userConfig.allergens)
      ) {
        // Incoming allergens are same as what we have, drop them to avoid unnecessary updates
        if (this.debug) console.log("[ALLERGEN-DEBUG] → Dropping incoming (same as saved)");
        if (this.debug)
          console.debug(
            "[Editor] dropping incoming allergens (same as saved)",
          );
        delete incoming.allergens;
      } else if (this._allergensExplicit && incoming.allergens) {
        // We have explicit allergens and incoming is different/exists
        // Only overwrite if incoming explicitly differs from stub (is a user choice)
        const stubAllergens = getStubConfig(
          incoming.integration || this._config.integration || "pp",
        ).allergens;
        if (this.debug) console.log("[ALLERGEN-DEBUG] Checking if incoming matches stub...");
        if (this.debug) console.log("[ALLERGEN-DEBUG] incoming.allergens:", incoming.allergens);
        if (this.debug) console.log("[ALLERGEN-DEBUG] stubAllergens:", stubAllergens);
        if (this.debug) console.log("[ALLERGEN-DEBUG] deepEqual:", deepEqual(incoming.allergens, stubAllergens));
        
        if (deepEqual(incoming.allergens, stubAllergens)) {
          // Incoming matches stub, so it's not a user choice - keep our explicit allergens
          if (this.debug) console.log("[ALLERGEN-DEBUG] → Dropping incoming (matches stub, keeping explicit)");
          if (this.debug)
            console.debug(
              "[Editor] dropping incoming allergens (matches stub, keeping explicit)",
            );
          delete incoming.allergens;
        } else {
          if (this.debug) console.log("[ALLERGEN-DEBUG] → Keeping incoming (different from stub)");
        }
      } else {
        if (this.debug) console.log("[ALLERGEN-DEBUG] → No action taken on incoming allergens");
      }

      // 7. Slå ihop userConfig med nya inkommande värden EN gång (alltid userConfig = det senaste)
      if (this.debug) console.log("[ALLERGEN-DEBUG] Before merge - _userConfig.allergens:", this._userConfig.allergens);
      if (this.debug) console.log("[ALLERGEN-DEBUG] Before merge - incoming.allergens:", incoming.allergens);
      
      this._userConfig = deepMerge(this._userConfig, incoming);
      
      if (this.debug) console.log("[ALLERGEN-DEBUG] After merge - _userConfig.allergens:", this._userConfig.allergens);

      // 8. Sätt explicit-flaggor
      this._thresholdExplicit =
        this._userConfig.hasOwnProperty("pollen_threshold");
      this._allergensExplicit = this._userConfig.hasOwnProperty("allergens");
      this._integrationExplicit =
        this._userConfig.hasOwnProperty("integration");
      
      if (this.debug) console.log("[ALLERGEN-DEBUG] After setting flags - _allergensExplicit:", this._allergensExplicit);
      this._daysExplicit = this._userConfig.hasOwnProperty("days_to_show");
      this._localeExplicit = this._userConfig.hasOwnProperty("date_locale");

      // 9. Bestäm integration (userConfig > tidigare config > autodetect)
      let integration =
        this._userConfig.integration !== undefined
          ? this._userConfig.integration
          : this._config.integration;

      if (!this._integrationExplicit && this._hass) {
        const all = Object.keys(this._hass.states);
        if (
          all.some(
            (id) => typeof id === "string" && id.startsWith("sensor.pollen_"),
          )
        ) {
          integration = "pp";
        } else if (
          all.some(
            (id) =>
              typeof id === "string" &&
              id.startsWith("sensor.polleninformation_"),
          )
        ) {
          integration = "peu";
        } else if (
          all.some(
            (id) =>
              typeof id === "string" && id.startsWith("sensor.pollenflug_"),
          )
        ) {
          integration = "dwd";
        } else if (
          // Primary: hass.entities platform check
          (this._hass?.entities && Object.values(this._hass.entities).some(
            (e) => e.platform === "silam_pollen" && !e.entity_category
          )) ||
          // Fallback: regex
          all.some(
            (id) =>
              typeof id === "string" && id.startsWith("sensor.silam_pollen_"),
          )
        ) {
          integration = "silam";
        } else if (
          all.some(
            (id) =>
              typeof id === "string" &&
              id.startsWith("sensor.kleenex_pollen_radar_"),
          )
        ) {
          integration = "kleenex";
        } else if (
          all.some(
            (id) =>
              typeof id === "string" &&
              /^sensor\.niveau_(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)_/.test(id),
          )
        ) {
          integration = "atmo";
        } else if (
          this._hass && (
            // Primary: check hass.entities for pollenlevels platform
            (this._hass.entities && Object.values(this._hass.entities).some(
              (e) => e.platform === "pollenlevels" && !e.entity_category
            )) ||
            // Fallback: check attribution
            all.some((id) => {
              const s = this._hass.states[id];
              return s?.attributes?.attribution === GPL_ATTRIBUTION
                && s.attributes?.device_class !== "date"
                && s.attributes?.device_class !== "timestamp";
            })
          )
        ) {
          integration = "gpl";
        }
        this._userConfig.integration = integration;
        if (this.debug)
          console.debug("[Editor] auto-detected integration:", integration);
      }

      // 9.1 Set default mode for SILAM and PEU if not specified
      if (
        (integration === "silam" || integration === "peu") &&
        !this._userConfig.mode
      ) {
        this._userConfig.mode = "daily";
      }

      // 10. Bygg config från stub + userConfig (bara EN gång!)
      const baseStub = getStubConfig(integration);
      let merged = deepMerge(baseStub, this._userConfig);

      // Default for levels_* if not set
      Object.entries(LEVELS_DEFAULTS).forEach(([key, val]) => {
        if (!(key in merged)) {
          merged[key] = val;
        }
      });

      // 11. Only write to config if not default (editor logic)
      Object.entries(LEVELS_DEFAULTS).forEach(([key, val]) => {
        if (merged[key] === val) {
          delete merged[key];
        }
      });

      // 11. Om användaren inte explicit satt pollen_threshold, ta stub-värdet
      if (!this._userConfig.hasOwnProperty("pollen_threshold")) {
        merged.pollen_threshold = baseStub.pollen_threshold;
        if (this.debug)
          console.debug(
            "[Editor] reset pollen_threshold to stub:",
            baseStub.pollen_threshold,
          );
      }

      // 12. Alltid använd explicit userConfig.allergens om det finns, annars stub
      if (this.debug) console.log("[ALLERGEN-DEBUG] Final allergen assignment:");
      if (this.debug) console.log("[ALLERGEN-DEBUG] _userConfig.allergens:", this._userConfig.allergens);
      if (this.debug) console.log("[ALLERGEN-DEBUG] baseStub.allergens:", baseStub.allergens);
      if (this.debug) console.log("[ALLERGEN-DEBUG] Using:", Array.isArray(this._userConfig.allergens) ? "_userConfig" : "baseStub");
      
      merged.allergens = Array.isArray(this._userConfig.allergens)
        ? this._userConfig.allergens
        : baseStub.allergens;
      //
      // 13. Lägg till typ och integration
      merged.integration = integration;
      merged.type = "custom:pollenprognos-card";
      this._config = merged;
      this._prevIntegration = integration;

      if (this.debug) console.log("[ALLERGEN-DEBUG] Final _config.allergens:", this._config.allergens);
      if (this.debug) console.log("[ALLERGEN-DEBUG] ========== setConfig() complete ==========");

      if (this.debug)
        console.debug(
          "[Editor][F] slutgiltigt this._config.allergens:",
          this._config.allergens,
        );

      // 14. Återställ days_to_show om inte explicit
      if (!this._daysExplicit) {
        this._config.days_to_show = baseStub.days_to_show;
        if (this.debug)
          console.debug(
            "[Editor] reset days_to_show to stub:",
            baseStub.days_to_show,
          );
      }

      // 15. Autofyll date_locale om inte explicit, baserat på HA language
      if (!this._localeExplicit) {
        const detected = detectLang(this._hass, null);
        const locale =
          this._hass?.locale?.language ||
          `${detected}-${detected.toUpperCase()}`;
        this._config.date_locale = locale;
        if (this.debug)
          console.debug(
            "[Editor] autofilled date_locale:",
            locale,
            "(HA language was:",
            detected,
            ")",
          );
      }

      this._initDone = false;

      // 16. Uppdatera listor för cities/regions om hass finns
      if (this._hass) {
        const all = Object.keys(this._hass.states);

        this.installedRegionIds = Array.from(
          new Set(
            all
              .filter(
                (id) =>
                  typeof id === "string" && id.startsWith("sensor.pollenflug_"),
              )
              .map((id) => id.split("_").pop()),
          ),
        ).sort((a, b) => Number(a) - Number(b));

        const ppKeys = new Set(
          all
            .filter(
              (id) =>
                typeof id === "string" &&
                id.startsWith("sensor.pollen_") &&
                !id.startsWith("sensor.pollenflug_"),
            )
            .map((id) =>
              id.slice("sensor.pollen_".length).replace(/_[^_]+$/, ""),
            ),
        );

        this.installedCities = PP_POSSIBLE_CITIES.filter((c) =>
          ppKeys.has(
            c
              .toLowerCase()
              .replace(/[åä]/g, "a")
              .replace(/ö/g, "o")
              .replace(/[-\s]/g, "_"),
          ),
        ).sort();
      }
      // 17. Auto-välj city/region om inte explicit
      if (!this._integrationExplicit) {
        if (
          integration === "dwd" &&
          !this._userConfig.region_id &&
          this.installedRegionIds.length
        ) {
          this._config.region_id = this.installedRegionIds[0];
        }
        if (
          integration === "pp" &&
          !this._userConfig.city &&
          this.installedCities.length
        ) {
          this._config.city = this.installedCities[0];
        }
        if (
          integration === "silam" &&
          !this._userConfig.location &&
          this.installedLocations.length
        ) {
          this._config.location = this.installedLocations[0];
        }
      }

      if (this.debug)
        console.debug("[Editor] färdig _config innan dispatch:", this._config);

      // 18. Hantera tap_action för editorn
      if (this._config.tap_action) {
        this._tapType = this._config.tap_action.type || "more-info";
        this._tapEntity = this._config.tap_action.entity || "";
        this._tapNavigation = this._config.tap_action.navigation_path || "";
        this._tapService = this._config.tap_action.service || "";
        this._tapServiceData = JSON.stringify(
          this._config.tap_action.service_data || {},
          null,
          2,
        );
      } else {
        this._tapType = "none";
        this._tapEntity = "";
        this._tapNavigation = "";
        this._tapService = "";
        this._tapServiceData = "";
      }

      // Only dispatch config-changed if config has actually changed
      // This avoids unnecessary reloads or loading blink on cosmetic-only changes.
      const prevConfig = this._config || {};
      // Calculate which keys actually changed
      const changedKeys = Object.keys(merged).filter(
        (k) => !deepEqual(merged[k], prevConfig[k]),
      );
      // If only cosmetic fields changed, do NOT dispatch config-changed (avoids loading blink)
      const onlyCosmetic =
        changedKeys.length > 0 &&
        changedKeys.every((k) => COSMETIC_FIELDS.includes(k));
      if (!onlyCosmetic && !deepEqual(prevConfig, merged)) {
        this._config = merged;
        if (this.debug) console.log("[ALLERGEN-DEBUG] [DISPATCH-1-setConfig] Dispatching from setConfig() end");
        if (this.debug) console.log("[ALLERGEN-DEBUG] Config allergens:", this._config.allergens);
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          }),
        );
      } else {
        this._config = merged;
      }
      this.requestUpdate();
      this._prevIntegration = incomingInt;
      this._initDone = true;

      // GPL discovery: run here too because set hass() may fire before setConfig()
      // and auto-detect the wrong integration (e.g., SILAM) if multiple integrations are installed.
      if (this._config.integration === "gpl" && this._hass) {
        const gplDiscovery = discoverGplSensors(this._hass, false);
        this.installedGplLocations = Array.from(gplDiscovery.locations.entries())
          .map(([configEntryId, loc]) => [configEntryId, loc.label]);
        const gplConfigEntryId = this._config.location || (this.installedGplLocations.length ? this.installedGplLocations[0][0] : null);
        const allGplAllergens = discoverGplAllergens(this._hass, gplConfigEntryId, false);
        this.installedGplPlants = allGplAllergens.filter((k) => !GPL_BASE_ALLERGENS.includes(k));
      }

      // SILAM discovery: run here too for same reason as GPL above
      if (this._config.integration === "silam" && this._hass) {
        const sd = discoverSilamSensors(this._hass, false);
        if (sd.locations.size > 0) {
          this.installedSilamLocations = Array.from(sd.locations.entries())
            .map(([configEntryId, loc]) => [configEntryId, loc.label]);
        }
      }
    } catch (e) {
      console.error("pollenprognos-card-editor: Fel i setConfig:", e, config);
      throw e;
    }
  }

  set hass(hass) {
    if (this.debug) console.log("[ALLERGEN-DEBUG] ========== set hass() called ==========");
    if (this.debug) console.log("[ALLERGEN-DEBUG] _initDone:", this._initDone);
    if (this.debug) console.log("[ALLERGEN-DEBUG] Current _userConfig.allergens:", this._userConfig?.allergens);
    
    if (this._hass === hass) return; // Avoid unnecessary work
    this._hass = hass;
    const explicit = this._integrationExplicit;
    if (!this._initDone) {
      // Default dropdown language mirrors locale or Home Assistant setting
      this._selectedPhraseLang = detectLang(hass, this._config.date_locale);
    }

    // Hitta alla sensor-ID för PP, DWD, PEU, SILAM, PLU
    // Build set of PLU allergen slugs for more specific detection
    const pluAllergenSlugs = new Set(
      Object.values(PLU_ALIAS_MAP).flat()
    );

    const ppStates = Object.keys(hass.states).filter(
      (id) => {
        if (typeof id !== "string") return false;
        if (!id.startsWith("sensor.pollen_")) return false;
        if (id.startsWith("sensor.pollenflug_")) return false;

        // Match both manual mode (sensor.pollen_<allergen>) and city mode (sensor.pollen_<allergen>_<city>)
        const match = /^sensor\.pollen_([^_]+)(_.*)?$/.exec(id);
        if (!match) return false;

        const allergenSlug = match[1];
        // Exclude known PLU allergens to avoid misclassification
        // PLU uses sensor.pollen_<allergen> pattern with specific allergen list
        // PP manual mode also uses sensor.pollen_<allergen> but with different allergens
        if (!match[2] && pluAllergenSlugs.has(allergenSlug)) {
          // Single underscore AND known PLU allergen → likely PLU, not PP
          return false;
        }

        return true;
      },
    );

    const dwdStates = Object.keys(hass.states).filter(
      (id) => typeof id === "string" && id.startsWith("sensor.pollenflug_"),
    );

    const peuStates = Object.keys(hass.states).filter(
      (id) =>
        typeof id === "string" && id.startsWith("sensor.polleninformation_"),
    );

    // SILAM: primary via hass.entities, fallback via regex
    const silamDiscovery = discoverSilamSensors(hass, false);
    let silamStates = [];
    if (silamDiscovery.locations.size > 0) {
      for (const [, loc] of silamDiscovery.locations) {
        for (const eid of loc.sensors.values()) {
          silamStates.push(eid);
        }
      }
    }
    if (!silamStates.length) {
      silamStates = Object.keys(hass.states).filter(
        (id) => typeof id === "string" && id.startsWith("sensor.silam_pollen_"),
      );
    }
    const pluStates = Object.keys(hass.states).filter(
      (id) => {
        if (typeof id !== "string") return false;
        const match = /^sensor\.pollen_([^_]+)$/.exec(id);
        if (!match) return false;
        const allergenSlug = match[1];
        // Only match if it's a known PLU allergen
        return pluAllergenSlugs.has(allergenSlug);
      },
    );
    const atmoStates = Object.keys(hass.states).filter(
      (id) =>
        typeof id === "string" &&
        /^sensor\.(?:niveau_(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)|(?:pm25|pm10|ozone|dioxyde_d_azote|dioxyde_de_soufre)|qualite_globale(?:_pollen)?)_/.test(id) &&
        !/_j_\d+$/.test(id),
    );
    // GPL: use hass.entities (primary) or attribution (fallback)
    let gplStates = [];
    if (hass.entities) {
      gplStates = Object.entries(hass.entities)
        .filter(([, entry]) => entry.platform === "pollenlevels" && !entry.entity_category)
        .map(([eid]) => eid);
    }
    if (!gplStates.length) {
      gplStates = Object.keys(hass.states).filter((id) => {
        const s = hass.states[id];
        return s?.attributes?.attribution === GPL_ATTRIBUTION
          && s.attributes.device_class !== "date"
          && s.attributes.device_class !== "timestamp";
      });
    }

    // 1) Autodetektera integration om användaren inte valt själv
    let integration = this._userConfig.integration;
    if (!explicit) {
      if (ppStates.length) integration = "pp";
      else if (pluStates.length) integration = "plu";
      else if (peuStates.length) integration = "peu";
      else if (dwdStates.length) integration = "dwd";
      else if (silamStates.length) integration = "silam";
      else if (atmoStates.length) integration = "atmo";
      else if (gplStates.length) integration = "gpl";
      this._userConfig.integration = integration;
    }

    // 1.1) GPL discovery — always run so render() and auto-select have data
    const gplDiscovery = discoverGplSensors(hass, false);
    this.installedGplLocations = Array.from(gplDiscovery.locations.entries())
      .map(([configEntryId, loc]) => [configEntryId, loc.label]);

    if (integration === "gpl") {
      const gplConfigEntryId = this._config.location || (this.installedGplLocations.length ? this.installedGplLocations[0][0] : null);
      const allGplAllergens = discoverGplAllergens(hass, gplConfigEntryId, false);
      this.installedGplPlants = allGplAllergens.filter((k) => !GPL_BASE_ALLERGENS.includes(k));
    } else {
      this.installedGplPlants = [];
    }

    // 1.2) Set default mode for SILAM and PEU if not specified
    if (
      (integration === "silam" || integration === "peu") &&
      !this._userConfig.mode
    ) {
      this._userConfig.mode = "daily";
    }

    // 2) Slå ihop stub + användar-config
    const base = getStubConfig(integration) || getStubConfig("pp");

    // Bygg merged-objekt (det är denna rad som saknas)
    if (this.debug) console.log("[ALLERGEN-DEBUG] set hass() building merged config");
    if (this.debug) console.log("[ALLERGEN-DEBUG] base (stub) allergens:", base.allergens?.slice(0, 5), "... (", base.allergens?.length, "total)");
    if (this.debug) console.log("[ALLERGEN-DEBUG] _userConfig.allergens:", this._userConfig.allergens?.slice(0, 5), "... (", this._userConfig.allergens?.length, "total)");
    
    let merged = deepMerge(base, this._userConfig);
    
    if (this.debug) console.log("[ALLERGEN-DEBUG] After deepMerge - merged.allergens:", merged.allergens?.slice(0, 5), "... (", merged.allergens?.length, "total)");

    // --- återställ pollen_threshold om användaren inte explicit satt det ---
    if (!this._userConfig.hasOwnProperty("pollen_threshold")) {
      merged.pollen_threshold = base.pollen_threshold;
      if (this.debug)
        console.debug(
          "[Editor][hass] reset pollen_threshold to stub:",
          base.pollen_threshold,
        );
    }

    merged.sort = merged.sort || "value_ascending";

    // Only dispatch if config actually changed, to avoid UI blinking/loops
    if (this.debug) console.log("[ALLERGEN-DEBUG] set hass() checking if config changed");
    if (this.debug) console.log("[ALLERGEN-DEBUG] Current _config.allergens:", this._config.allergens?.slice(0, 5), "... (", this._config.allergens?.length, "total)");
    if (this.debug) console.log("[ALLERGEN-DEBUG] New merged.allergens:", merged.allergens?.slice(0, 5), "... (", merged.allergens?.length, "total)");
    if (this.debug) console.log("[ALLERGEN-DEBUG] deepEqual result:", deepEqual(this._config, merged));
    
    if (!deepEqual(this._config, merged)) {
      this._config = merged;
      if (this.debug) console.log("[ALLERGEN-DEBUG] Config changed! Updated _config.allergens");
      if (this.debug) console.log("[ALLERGEN-DEBUG] ========== set hass() complete (config changed) ==========");


      // 3) Fyll installerade regioner/städer
      this.installedRegionIds = Array.from(
        new Set(dwdStates.map((id) => id.split("_").pop())),
      ).sort((a, b) => Number(a) - Number(b));

      const uniqKeys = Array.from(
        new Set(
          ppStates.map((id) =>
            id.slice("sensor.pollen_".length).replace(/_[^_]+$/, ""),
          ),
        ),
      );
      this.installedCities = PP_POSSIBLE_CITIES.filter((city) =>
        uniqKeys.includes(
          city
            .toLowerCase()
            .replace(/[åä]/g, "a")
            .replace(/ö/g, "o")
            .replace(/[-\s]/g, "_"),
        ),
      ).sort((a, b) => a.localeCompare(b));

      this.installedPeuLocations = Array.from(
        new Map(
          Object.values(hass.states)
            .filter(
              (s) =>
                s &&
                typeof s === "object" &&
                typeof s.entity_id === "string" &&
                s.entity_id.startsWith("sensor.polleninformation_"),
            )
            .map((s) => {
              const locationSlug =
                s.attributes?.location_slug ||
                s.entity_id
                  .replace("sensor.polleninformation_", "")
                  .replace(/_[^_]+$/, "");
              const title =
                s.attributes?.location_title ||
                (typeof s.attributes?.friendly_name === "string"
                  ? s.attributes.friendly_name.match(/\((.*?)\)/)?.[1]
                  : undefined) ||
                locationSlug;
              return [locationSlug, title];
            }),
        ),
      );
      // Primärt: discovery-baserad SILAM location list
      if (silamDiscovery.locations.size > 0) {
        this.installedSilamLocations = Array.from(
          silamDiscovery.locations.entries(),
        ).map(([configEntryId, loc]) => [configEntryId, loc.label]);

        if (this.debug) {
          console.debug(
            "[Editor][SILAM] Discovery-based locations:",
            this.installedSilamLocations,
          );
        }
      } else {
        // Fallback: regex-baserad location detection
        const pollenAllergens = [
          "allergy_risk",
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

        this.installedSilamLocations = Array.from(
          new Map(
            Object.values(hass.states)
              .filter((s) => {
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
              })
              .map((s) => {
                const match = s.entity_id.match(
                  /^sensor\.silam_pollen_(.*)_([^_]+)$/,
                );
                const rawLocation = match
                  ? match[1].replace(/^[-\s]+/, "")
                  : "";
                const locationSlug = slugify(rawLocation);

                let title =
                  s.attributes?.location_title ||
                  (typeof s.attributes?.friendly_name === "string"
                    ? s.attributes.friendly_name
                        .replace(/^SILAM Pollen\s*-?\s*/i, "")
                        .replace(/\s+\p{L}+$/u, "")
                        .trim()
                    : "") ||
                  rawLocation;

                title = title.replace(/^[-\s]+/, "");
                title = title.charAt(0).toUpperCase() + title.slice(1);

                return [locationSlug, title];
              }),
          ),
        );
      }

      // Collect kleenex locations
      this.installedKleenexLocations = Array.from(
        new Map(
          Object.values(hass.states)
            .filter(
              (s) =>
                s &&
                typeof s === "object" &&
                typeof s.entity_id === "string" &&
                s.entity_id.startsWith("sensor.kleenex_pollen_radar_"),
            )
            .map((s) => {
              // Extract location from entity_id pattern: sensor.kleenex_pollen_radar_<location>_<allergen>
              // Match all localized category names: English (trees/grass/weeds), Dutch (bomen/gras/kruiden/onkruid),
              // French (arbres/graminees/herbacees), Italian (alberi/graminacee/erbacee)
              const match = s.entity_id.match(
                /^sensor\.kleenex_pollen_radar_(.*)_(?:tree|bomen|arbre|alber|grass|gras|graminee|graminace|weed|kruid|onkruid|herbacee|erbace)/,
              );
              if (!match) return null;

              const locationSlug = match[1];
              let title = s.attributes?.friendly_name || locationSlug;

              // Clean up the title to show only the location
              title = title
                .replace(/^Kleenex Pollen Radar\s*[\(\-]?\s*/i, "")
                .replace(/[\)\s]+(?:Trees|Grass|Weeds|Bomen|Gras|Kruiden|Onkruid|Arbres|Graminées|Herbacées|Alberi|Graminacee|Erbacee).*$/i, "")
                .trim();

              // Fallback to locationSlug if cleaning resulted in empty string
              if (!title) {
                title =
                  locationSlug.charAt(0).toUpperCase() + locationSlug.slice(1);
              }

              return [locationSlug, title];
            })
            .filter((entry) => entry !== null),
        ),
      );

      // Collect Atmo France locations (pollen + pollution entities)
      const atmoLocationRe = /^sensor\.(?:niveau_(?:ambroisie|armoise|aulne|bouleau|gramine|olivier)|(?:pm25|pm10|ozone|dioxyde_d_azote|dioxyde_de_soufre)|qualite_globale(?:_pollen)?)_(.+?)(?:_j_\d+)?$/;
      this.installedAtmoLocations = Array.from(
        new Map(
          atmoStates
            .map((id) => {
              const m = id.match(atmoLocationRe);
              if (!m) return null;
              const locationSlug = m[1];
              const entity = hass.states[id];
              const title =
                entity?.attributes?.["Nom de la zone"] ||
                locationSlug.charAt(0).toUpperCase() +
                  locationSlug.slice(1).replace(/_/g, " ");
              return [locationSlug, title];
            })
            .filter((entry) => entry !== null),
        ),
      );

      // 4) Auto-välj första region/stad om användaren inte satt något
      if (!this._initDone) {
        if (
          integration === "dwd" &&
          !this._userConfig.region_id &&
          this.installedRegionIds.length
        ) {
          this._config.region_id = this.installedRegionIds[0];
        }
        if (
          integration === "pp" &&
          !this._userConfig.city &&
          this.installedCities.length
        ) {
          this._config.city = this.installedCities[0];
        }
        if (
          integration === "silam" &&
          !this._userConfig.location &&
          this.installedSilamLocations.length
        ) {
          this._config.location = this.installedSilamLocations[0][0];
        }
        if (
          integration === "kleenex" &&
          !this._userConfig.location &&
          this.installedKleenexLocations.length
        ) {
          this._config.location = this.installedKleenexLocations[0][0];
        }
        if (
          integration === "atmo" &&
          !this._userConfig.location &&
          this.installedAtmoLocations.length
        ) {
          this._config.location = this.installedAtmoLocations[0][0];
        }
        if (
          integration === "gpl" &&
          !this._userConfig.location &&
          this.installedGplLocations.length
        ) {
          this._config.location = this.installedGplLocations[0][0];
        }
      }

      // 5) Dispatch'a så att HA:r-editorn ritar om formuläret med nya värden
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._config },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      if (this.debug) console.log("[ALLERGEN-DEBUG] Config unchanged in set hass(), NOT dispatching");
      if (this.debug) console.log("[ALLERGEN-DEBUG] ========== set hass() complete (no change) ==========");
    }

    this.requestUpdate();
    this._initDone = true;
    if (this.debug) console.log("[ALLERGEN-DEBUG] set hass() final - _initDone set to true");
  }

  _onAllergenToggle(allergen, checked) {
    if (this.debug) console.log("[ALLERGEN-DEBUG] ========== _onAllergenToggle called ==========");
    if (this.debug) console.log("[ALLERGEN-DEBUG] Allergen:", allergen, "Checked:", checked);
    if (this.debug) console.log("[ALLERGEN-DEBUG] Current _config.allergens:", this._config.allergens);
    
    if (
      this._config.integration === "peu" &&
      this._config.mode !== "daily" &&
      allergen !== "allergy_risk" &&
      checked
    ) {
      this._updateConfig("mode", "daily");
    }
    const set = new Set(this._config.allergens);
    checked ? set.add(allergen) : set.delete(allergen);
    
    if (this.debug) console.log("[ALLERGEN-DEBUG] New allergen set:", [...set]);
    this._updateConfig("allergens", [...set]);
  }

  _toggleSelectAllAllergens(allergens) {
    const current = new Set(this._config.allergens);
    const allSelected = allergens.every((a) => current.has(a));
    if (
      this._config.integration === "peu" &&
      this._config.mode !== "daily" &&
      !allSelected
    ) {
      this._updateConfig("mode", "daily");
    }
    const newSet = allSelected ? [] : allergens;
    this._updateConfig("allergens", [...newSet]);
  }

  /**
   * Toggle a subset of allergens without affecting other selections.
   * If all subset items are selected → remove only those.
   * Otherwise → add all subset items (keeping existing selections).
   */
  _toggleAllergenSubset(subset) {
    const current = new Set(this._config.allergens);
    const allSelected = subset.every((a) => current.has(a));
    if (allSelected) {
      subset.forEach((a) => current.delete(a));
    } else {
      subset.forEach((a) => current.add(a));
    }
    this._updateConfig("allergens", [...current]);
  }

  _updateConfig(prop, value) {
    if (this.debug)
      console.debug("[Editor] _updateConfig – prop:", prop, "value:", value);

    // Handle sort changes - uncheck special sort options when sort is set to 'none'
    if (prop === "sort" && value === "none") {
      const newConfig = { ...this._config, sort: value };

      // Uncheck incompatible special sort options
      if (
        (this._config.integration === "kleenex" || this._config.integration === "gpl") &&
        this._config.sort_category_allergens_first
      ) {
        newConfig.sort_category_allergens_first = false;
        delete this._userConfig.sort_category_allergens_first;
      }
      if ((this._config.integration === "peu" || this._config.integration === "atmo") && this._config.allergy_risk_top) {
        newConfig.allergy_risk_top = false;
        delete this._userConfig.allergy_risk_top;
      }
      if (this._config.integration === "atmo" && this._config.sort_pollution_block) {
        newConfig.sort_pollution_block = false;
        delete this._userConfig.sort_pollution_block;
      }
      if (this._config.integration === "silam" && this._config.index_top) {
        newConfig.index_top = false;
        delete this._userConfig.index_top;
      }

      this._config = newConfig;
      this._userConfig.sort = value;

      if (this.debug) console.log("[ALLERGEN-DEBUG] [DISPATCH-3-sort-none] Dispatching from sort=none handler");
      if (this.debug) console.log("[ALLERGEN-DEBUG] Config allergens:", this._config.allergens);
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: newConfig },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    // Handle levels_inherit_mode changes - reset gap and sync when needed
    if (prop === "levels_inherit_mode") {
      if (value === "custom" && this._config.levels_inherit_mode !== "custom") {
        // Switching to custom - reset gap to default
        const newConfig = {
          ...this._config,
          levels_inherit_mode: value,
          levels_gap: LEVELS_DEFAULTS.levels_gap,
          levels_colors: LEVELS_DEFAULTS.levels_colors,
          levels_empty_color: LEVELS_DEFAULTS.levels_empty_color,
          levels_gap_color: LEVELS_DEFAULTS.levels_gap_color,
        };
        this._config = newConfig;
        this._userConfig.levels_inherit_mode = value;
        delete this._userConfig.levels_gap;
        delete this._userConfig.levels_colors;
        delete this._userConfig.levels_empty_color;
        delete this._userConfig.levels_gap_color;

        if (this.debug) console.log("[ALLERGEN-DEBUG] [DISPATCH-4-levels-inherit-custom] Dispatching from levels_inherit_mode=custom");
        if (this.debug) console.log("[ALLERGEN-DEBUG] Config allergens:", newConfig.allergens);
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: newConfig },
            bubbles: true,
            composed: true,
          }),
        );
        return;
      } else if (
        value === "inherit_allergen" &&
        this._config.levels_inherit_mode === "custom"
      ) {
        // Switching back to inherit - sync gap with current stroke width and empty color
        const currentStrokeWidth =
          this._config.allergen_stroke_width ||
          LEVELS_DEFAULTS.allergen_stroke_width;
        const syncedGap = convertStrokeWidthToGap(currentStrokeWidth);

        // Also sync empty color from allergen colors[0]
        const currentAllergenColors =
          this._config.allergen_colors || LEVELS_DEFAULTS.allergen_colors;
        const syncedEmptyColor =
          currentAllergenColors[0] || LEVELS_DEFAULTS.levels_empty_color;

        const newConfig = {
          ...this._config,
          levels_inherit_mode: value,
          levels_gap: syncedGap,
          levels_empty_color: syncedEmptyColor,
          allergen_levels_gap_synced: true, // Enable sync when switching to inherit mode
        };
        this._config = newConfig;
        this._userConfig.levels_inherit_mode = value;
        this._userConfig.levels_gap = syncedGap;
        this._userConfig.levels_empty_color = syncedEmptyColor;
        this._userConfig.allergen_levels_gap_synced = true;

        if (this.debug) console.log("[ALLERGEN-DEBUG] [DISPATCH-5-levels-inherit-sync] Dispatching from levels_inherit_mode!=custom");
        if (this.debug) console.log("[ALLERGEN-DEBUG] Config allergens:", newConfig.allergens);
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: newConfig },
            bubbles: true,
            composed: true,
          }),
        );
        return;
      }
    }

    // Handle allergen colors changes - sync with levels empty color if inheriting
    if (prop === "allergen_colors" && Array.isArray(value)) {
      const newConfig = { ...this._config, allergen_colors: value };
      this._userConfig.allergen_colors = value;

      // Sync level 0 (empty) color with levels_empty_color if levels inherit from allergen
      if (
        (this._config.levels_inherit_mode || "inherit_allergen") ===
        "inherit_allergen"
      ) {
        // allergen_colors[0] is the empty/level 0 color
        if (value[0]) {
          newConfig.levels_empty_color = value[0];
          this._userConfig.levels_empty_color = value[0];
        }
      }

      this._config = newConfig;

      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: newConfig },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    // Handle allergen stroke width reset - sync with levels gap if inheriting and synced
    if (
      prop === "allergen_stroke_width" &&
      value === LEVELS_DEFAULTS.allergen_stroke_width
    ) {
      const newConfig = { ...this._config, allergen_stroke_width: value };
      this._userConfig.allergen_stroke_width = value;

      // Sync with level circle gap only if levels inherit from allergen AND gap sync is enabled
      if (
        (this._config.levels_inherit_mode || "inherit_allergen") ===
          "inherit_allergen" &&
        (this._config.allergen_levels_gap_synced ?? true)
      ) {
        const levelGap = convertStrokeWidthToGap(value);
        newConfig.levels_gap = levelGap;
        this._userConfig.levels_gap = levelGap;
      }

      this._config = newConfig;

      if (this.debug) console.log("[ALLERGEN-DEBUG] [DISPATCH-7-levels-stroke] Dispatching from levels_stroke_width change");
      if (this.debug) console.log("[ALLERGEN-DEBUG] Config allergens:", newConfig.allergens);
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: newConfig },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    // Handle level settings resets - ensure chart sync for visual properties
    if (
      (prop === "levels_thickness" ||
        prop === "levels_gap" ||
        prop === "levels_colors" ||
        prop === "levels_empty_color" ||
        prop === "levels_gap_color") &&
      value === LEVELS_DEFAULTS[prop]
    ) {
      // For level visual properties, create a config change event to ensure chart re-rendering
      const newConfig = { ...this._config, [prop]: value };
      this._config = newConfig;
      this._userConfig[prop] = value;

      if (this.debug) console.log("[ALLERGEN-DEBUG] [DISPATCH-8-levels-visual] Dispatching from levels visual prop change");
      if (this.debug) console.log("[ALLERGEN-DEBUG] Config allergens:", newConfig.allergens);
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: newConfig },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    // Handle allergen color mode changes - reset colors when switching to default
    if (
      prop === "allergen_color_mode" &&
      value === "default_colors" &&
      this._config.allergen_color_mode === "custom"
    ) {
      const newConfig = {
        ...this._config,
        allergen_color_mode: value,
        allergen_colors: LEVELS_DEFAULTS.allergen_colors,
        allergen_outline_color: LEVELS_DEFAULTS.levels_gap_color,
        no_allergens_color: LEVELS_DEFAULTS.no_allergens_color,
      };
      this._config = newConfig;
      this._userConfig.allergen_color_mode = value;
      delete this._userConfig.allergen_colors;
      delete this._userConfig.allergen_outline_color;
      delete this._userConfig.no_allergens_color;

      if (this.debug) console.log("[ALLERGEN-DEBUG] [DISPATCH-9-allergen-color-mode] Dispatching from allergen_color_mode change");
      if (this.debug) console.log("[ALLERGEN-DEBUG] Config allergens:", newConfig.allergens);
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: newConfig },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    // Specialfall: språkbyte – tvinga sort-dropdown att ritas om
    if (prop === "date_locale") {
      // Spara aktuella värden
      const prevSort = this._config.sort;
      const prevMode = this._config.mode;

      // Sätt nytt språk och nollställ sort och mode tillfälligt för att trigga omritning
      this._config = {
        ...this._config,
        date_locale: value,
        sort: "",
        mode: "",
      };
      this.requestUpdate();

      setTimeout(() => {
        this._config = {
          ...this._config,
          sort: prevSort,
          mode: prevMode,
        };
        this.requestUpdate();
        if (this.debug) console.log("[ALLERGEN-DEBUG] [DISPATCH-11-locale-reset] Dispatching from date_locale setTimeout restore");
        if (this.debug) console.log("[ALLERGEN-DEBUG] Config allergens:", this._config.allergens);
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          }),
        );
      }, 0);

      // Hoppa över resten!
      return;
    }
    const newUser = { ...this._userConfig };
    let cfg;

    if (prop === "integration") {
      const newInt = value;
      const oldInt = this._config.integration;
      if (newInt !== oldInt) {
        delete newUser.city;
        delete newUser.region_id;
        delete newUser.location;
        delete newUser.entity_prefix;
        delete newUser.entity_suffix;
        delete newUser.mode;
        delete newUser.allergens;
        delete newUser.days_to_show;
        delete newUser.pollen_threshold;
        delete newUser.allergy_risk_top;
        delete newUser.index_top;
        this._allergensExplicit = false;
      }
      const base = getStubConfig(newInt) || getStubConfig("pp");

      cfg = deepMerge(base, newUser);
      cfg.integration = newInt;
    } else {
      cfg = { ...this._config, [prop]: value };

      // Track explicit allergen changes
      if (prop === "allergens") {
        if (this.debug) console.log("[ALLERGEN-DEBUG] _updateConfig called with allergens:", value);
        if (this.debug) console.log("[ALLERGEN-DEBUG] Before update - _userConfig.allergens:", this._userConfig.allergens);
        if (this.debug) console.log("[ALLERGEN-DEBUG] Before update - _allergensExplicit:", this._allergensExplicit);
        
        this._userConfig.allergens = value;
        this._allergensExplicit = true;
        
        if (this.debug) console.log("[ALLERGEN-DEBUG] After update - _userConfig.allergens:", this._userConfig.allergens);
        if (this.debug) console.log("[ALLERGEN-DEBUG] After update - _allergensExplicit:", this._allergensExplicit);
        
        if (this.debug)
          console.debug(
            "[Editor] allergens explicitly changed:",
            this._userConfig.allergens,
          );
      }
      
      // Reset custom prefix/suffix when switching away from manual mode
      if (["city", "region_id", "location"].includes(prop)) {
        if (value !== "manual") {
          cfg.entity_prefix = "";
          cfg.entity_suffix = "";
        }
      }
      // Adjust related settings when switching mode
      if (
        (this._config.integration === "silam" ||
          this._config.integration === "peu") &&
        prop === "mode"
      ) {
        if (value !== "daily") {
          cfg.days_to_show = 8;
          cfg.show_empty_days = false;
          if (this._config.integration === "peu") {
            cfg.allergens = ["allergy_risk"];
            this._userConfig.allergens = ["allergy_risk"];
            this._allergensExplicit = true;
          }
        } else {
          cfg.days_to_show = this._config.integration === "silam" ? 5 : 4;
          if (this._config.integration === "peu") {
            // Check if we're switching from non-daily mode (which only has allergy_risk)
            const currentAllergens = this._config.allergens || [];
            const isComingFromNonDaily = 
              currentAllergens.length === 1 && 
              currentAllergens[0] === "allergy_risk";
            
            // Reset allergens to defaults when:
            // 1. User hasn't explicitly set them, OR
            // 2. Coming from non-daily mode (only had allergy_risk)
            if (!this._allergensExplicit || isComingFromNonDaily) {
              // Re-select every allergen when returning to daily mode
              cfg.allergens = [...PEU_ALLERGENS];
              this._userConfig.allergens = [...PEU_ALLERGENS];
              this._allergensExplicit = true;
            }
            // Otherwise, keep user's explicit allergen selection
          }
        }
      }
      // Tvinga mode till daily om location saknar weather-entity
      if (this._config.integration === "silam" && prop === "location") {
        if (!this._hasSilamWeatherEntity(value)) {
          cfg.mode = "daily";
          cfg.days_to_show = 2;
        }
      }
    }
    cfg.type = this._config.type;

    if (!deepEqual(this._config, cfg)) {
      this._config = cfg;
      if (this.debug) console.debug("[Editor] updated _config:", this._config);
      
      if (this.debug) console.log("[ALLERGEN-DEBUG] Dispatching config-changed event");
      if (this.debug) console.log("[ALLERGEN-DEBUG] Config allergens being dispatched:", this._config.allergens);
      
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._config },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this._config = cfg;
      if (this.debug) console.log("[ALLERGEN-DEBUG] Config unchanged, NOT dispatching");
    }
  }

  render() {
    const c = {
      phrases: {
        full: {},
        short: {},
        levels: [],
        days: {},
        no_information: "",
      },
      ...LEVELS_DEFAULTS,
      ...this._config,
    };

    const allergens =
      c.integration === "dwd"
        ? stubConfigDWD.allergens
        : c.integration === "peu"
          ? PEU_ALLERGENS
          : c.integration === "silam"
            ? SILAM_ALLERGENS
            : c.integration === "kleenex"
              ? stubConfigKleenex.allergens
              : c.integration === "plu"
                ? stubConfigPLU.allergens
                : c.integration === "gpl"
                  ? [...GPL_BASE_ALLERGENS, ...(this.installedGplPlants || [])]
                  : c.integration === "atmo"
                    ? ATMO_ALLERGENS
                    : stubConfigPP.allergens;

    const numLevels =
      c.integration === "dwd"
        ? 4
        : c.integration === "peu"
          ? 5
          : c.integration === "gpl"
            ? 6
            : c.integration === "plu"
              ? 4
              : 7;

    // dynamiska parametrar för pollen_threshold-slider
    const thresholdParams =
      c.integration === "dwd"
        ? { min: 0, max: 3, step: 0.5 }
        : c.integration === "peu"
          ? { min: 0, max: 4, step: 1 }
          : c.integration === "gpl"
            ? { min: 0, max: 5, step: 1 }
            : c.integration === "plu"
              ? { min: 0, max: 3, step: 1 }
              : { min: 0, max: 6, step: 1 };

    const SORT_VALUES = [
      "value_ascending",
      "value_descending",
      "name_ascending",
      "name_descending",
      "none",
    ];

    const sortOptions = SORT_VALUES.map((opt) => ({
      value: opt,
      label: this._t(`sort_${opt}`),
    }));
    if (this.debug) {
      console.debug("Aktuellt språk (lang):", this._lang);
      console.debug("Sort label test:", this._t("sort_value_ascending"));
    }

    return html`
      <div class="card-config">
        <!-- Återställ-knapp -->
        <ha-button outlined @click=${() => this._resetAll()}>
          ${this._t("preset_reset_all")}
        </ha-button>

        <!-- Integration & Location -->
        <details open>
          <summary>${this._t("summary_integration_and_place")}</summary>
          <ha-formfield label="${this._t("integration")}">
            <ha-select
              .value=${c.integration}
              @selected=${(e) =>
                this._updateConfig("integration", e.target.value)}
              @closed=${(e) => e.stopPropagation()}
            >
              <mwc-list-item value="pp"
                >${this._t("integration.pp")}</mwc-list-item
              >
              <mwc-list-item value="peu"
                >${this._t("integration.peu")}</mwc-list-item
              >
              <mwc-list-item value="dwd"
                >${this._t("integration.dwd")}</mwc-list-item
              >
              <mwc-list-item value="silam"
                >${this._t("integration.silam")}</mwc-list-item
              >
              <mwc-list-item value="plu"
                >${this._t("integration.plu")}</mwc-list-item
              >
              <mwc-list-item value="kleenex"
                >${this._t("integration.kleenex")}</mwc-list-item
              >
              <mwc-list-item value="atmo"
                >${this._t("integration.atmo")}</mwc-list-item
              >
              <mwc-list-item value="gpl"
                >${this._t("integration.gpl")}</mwc-list-item
              >
            </ha-select>
          </ha-formfield>
          ${c.integration === "pp"
            ? html`
                <ha-formfield label="${this._t("city")}">
                  <ha-select
                    .value=${c.city || ""}
                    @selected=${(e) =>
                      this._updateConfig("city", e.target.value)}
                    @closed=${(e) => e.stopPropagation()}
                  >
                    <mwc-list-item value=""
                      >${this._t("location_autodetect")}</mwc-list-item
                    >
                    ${this.installedCities.map(
                      (city) =>
                        html`<mwc-list-item .value=${city}
                          >${city}</mwc-list-item
                        >`,
                    )}
                    <mwc-list-item value="manual"
                      >${this._t("location_manual")}</mwc-list-item
                    >
                  </ha-select>
                </ha-formfield>
              `
            : c.integration === "peu"
              ? html`
                  <ha-formfield label="${this._t("location")}">
                    <ha-select
                      .value=${c.location || ""}
                      @selected=${(e) =>
                        this._updateConfig("location", e.target.value)}
                      @closed=${(e) => e.stopPropagation()}
                    >
                      <mwc-list-item value=""
                        >${this._t("location_autodetect")}</mwc-list-item
                      >
                      ${this.installedPeuLocations.map(
                        ([slug, title]) =>
                          html`<mwc-list-item .value=${slug}
                            >${title}</mwc-list-item
                          >`,
                      )}
                      <mwc-list-item value="manual"
                        >${this._t("location_manual")}</mwc-list-item
                      >
                    </ha-select>
                  </ha-formfield>
                `
              : c.integration === "silam"
                ? html`
                    <ha-formfield label="${this._t("location")}">
                      <ha-select
                        .value=${c.location || ""}
                        @selected=${(e) =>
                          this._updateConfig("location", e.target.value)}
                        @closed=${(e) => e.stopPropagation()}
                      >
                        <mwc-list-item value=""
                          >${this._t("location_autodetect")}</mwc-list-item
                        >
                        ${this.installedSilamLocations.map(
                          ([slug, title]) =>
                            html`<mwc-list-item .value=${slug}
                              >${title}</mwc-list-item
                            >`,
                        )}
                        <mwc-list-item value="manual"
                          >${this._t("location_manual")}</mwc-list-item
                        >
                      </ha-select>
                    </ha-formfield>
                  `
                : c.integration === "kleenex"
                  ? html`
                      <ha-formfield label="${this._t("location")}">
                        <ha-select
                          .value=${c.location || ""}
                          @selected=${(e) =>
                            this._updateConfig("location", e.target.value)}
                          @closed=${(e) => e.stopPropagation()}
                        >
                          <mwc-list-item value=""
                            >${this._t("location_autodetect")}</mwc-list-item
                          >
                          ${this.installedKleenexLocations.map(
                            ([slug, title]) =>
                              html`<mwc-list-item .value=${slug}
                                >${title}</mwc-list-item
                              >`,
                          )}
                          <mwc-list-item value="manual"
                            >${this._t("location_manual")}</mwc-list-item
                          >
                        </ha-select>
                      </ha-formfield>
                    `
                  : c.integration === "atmo"
                    ? html`
                        <ha-formfield label="${this._t("location")}">
                          <ha-select
                            .value=${c.location || ""}
                            @selected=${(e) =>
                              this._updateConfig("location", e.target.value)}
                            @closed=${(e) => e.stopPropagation()}
                          >
                            <mwc-list-item value=""
                              >${this._t("location_autodetect")}</mwc-list-item
                            >
                            ${this.installedAtmoLocations.map(
                              ([slug, title]) =>
                                html`<mwc-list-item .value=${slug}
                                  >${title}</mwc-list-item
                                >`,
                            )}
                            <mwc-list-item value="manual"
                              >${this._t("location_manual")}</mwc-list-item
                            >
                          </ha-select>
                        </ha-formfield>
                      `
                  : c.integration === "gpl"
                    ? html`
                        <ha-formfield label="${this._t("location")}">
                          <ha-select
                            .value=${c.location || ""}
                            @selected=${(e) =>
                              this._updateConfig("location", e.target.value)}
                            @closed=${(e) => e.stopPropagation()}
                          >
                            <mwc-list-item value=""
                              >${this._t("location_autodetect")}</mwc-list-item
                            >
                            ${(this.installedGplLocations || []).map(
                              ([slug, title]) =>
                                html`<mwc-list-item .value=${slug}
                                  >${title}</mwc-list-item
                                >`,
                            )}
                            <mwc-list-item value="manual"
                              >${this._t("location_manual")}</mwc-list-item
                            >
                          </ha-select>
                        </ha-formfield>
                      `
                  : c.integration === "plu"
                    ? ""
                  : html`
                      <ha-formfield label="${this._t("region_id")}">
                        <ha-select
                          .value=${c.region_id || ""}
                          @selected=${(e) =>
                            this._updateConfig("region_id", e.target.value)}
                          @closed=${(e) => e.stopPropagation()}
                        >
                          <mwc-list-item value=""
                            >${this._t("location_autodetect")}</mwc-list-item
                          >
                          ${this.installedRegionIds.map(
                            (id) =>
                              html`<mwc-list-item .value=${id}>
                                ${id} — ${DWD_REGIONS[id] || id}
                              </mwc-list-item>`,
                          )}
                          <mwc-list-item value="manual"
                            >${this._t("location_manual")}</mwc-list-item
                          >
                        </ha-select>
                      </ha-formfield>
                    `}
          ${c.integration === "silam" && this._hasSilamWeatherEntity(c.location)
            ? html`
                <ha-formfield label="${this._t("mode")}">
                  <ha-select
                    .value=${c.mode || "daily"}
                    @selected=${(e) =>
                      this._updateConfig("mode", e.target.value)}
                    @closed=${(e) => e.stopPropagation()}
                  >
                    <mwc-list-item value="daily"
                      >${this._t("mode_daily")}</mwc-list-item
                    >
                    <mwc-list-item value="twice_daily"
                      >${this._t("mode_twice_daily")}</mwc-list-item
                    >
                    <mwc-list-item value="hourly"
                      >${this._t("mode_hourly")}</mwc-list-item
                    >
                  </ha-select>
                </ha-formfield>
              `
            : c.integration === "peu"
              ? html`
                  <ha-formfield label="${this._t("mode")}">
                    <ha-select
                      .value=${c.mode || "daily"}
                      @selected=${(e) =>
                        this._updateConfig("mode", e.target.value)}
                      @closed=${(e) => e.stopPropagation()}
                    >
                      <mwc-list-item value="daily"
                        >${this._t("mode_daily")}</mwc-list-item
                      >
                      <mwc-list-item value="twice_daily"
                        >${this._t("mode_twice_daily")}</mwc-list-item
                      >
                      <mwc-list-item value="hourly"
                        >${this._t("mode_hourly")}</mwc-list-item
                      >
                      <mwc-list-item value="hourly_second"
                        >${this._t("mode_hourly_second")}</mwc-list-item
                      >
                      <mwc-list-item value="hourly_third"
                        >${this._t("mode_hourly_third")}</mwc-list-item
                      >
                      <mwc-list-item value="hourly_fourth"
                        >${this._t("mode_hourly_fourth")}</mwc-list-item
                      >
                      <mwc-list-item value="hourly_sixth"
                        >${this._t("mode_hourly_sixth")}</mwc-list-item
                      >
                      <mwc-list-item value="hourly_eighth"
                        >${this._t("mode_hourly_eighth")}</mwc-list-item
                      >
                    </ha-select>
                  </ha-formfield>
                  <p>${this._t("peu_nondaily_expl")}</p>
                `
              : ""}
          ${(c.integration === "pp" && c.city === "manual") ||
          (c.integration === "dwd" && c.region_id === "manual") ||
          ((c.integration === "peu" || c.integration === "silam" || c.integration === "kleenex" || c.integration === "atmo" || c.integration === "gpl") &&
            c.location === "manual")
            ? html`
                <details>
                  <summary>${this._t("summary_entity_prefix_suffix")}</summary>
                  <ha-formfield label="${this._t("entity_prefix")}">
                    <ha-textfield
                      .value=${c.entity_prefix || ""}
                      placeholder="${this._t("entity_prefix_placeholder")}"
                      @input=${(e) =>
                        this._updateConfig("entity_prefix", e.target.value)}
                    ></ha-textfield>
                  </ha-formfield>
                  <ha-formfield label="${this._t("entity_suffix")}">
                    <ha-textfield
                      .value=${c.entity_suffix || ""}
                      placeholder="${this._t("entity_suffix_placeholder")}"
                      @input=${(e) =>
                        this._updateConfig("entity_suffix", e.target.value)}
                    ></ha-textfield>
                  </ha-formfield>
                </details>
              `
            : ""}
        </details>

        <details open>
          <summary>${this._t("summary_appearance_and_layout")}</summary>
          <!-- Title -->
          <details open>
            <summary>${this._t("summary_title_and_header")}</summary>
            <div style="display:flex; gap:8px; align-items:center;">
              <ha-formfield label="${this._t("title_hide")}">
                <ha-checkbox
                  .checked=${c.title === false}
                  @change=${(e) => {
                    if (e.target.checked) {
                      this._updateConfig("title", false);
                    } else {
                      this._updateConfig("title", true);
                    }
                  }}
                ></ha-checkbox>
              </ha-formfield>
              <ha-formfield label="${this._t("title_automatic")}">
                <ha-checkbox
                  .checked=${c.title === true || c.title === undefined}
                  @change=${(e) => {
                    if (e.target.checked) {
                      this._updateConfig("title", true);
                    } else {
                      this._updateConfig("title", "");
                    }
                  }}
                ></ha-checkbox>
              </ha-formfield>
            </div>
            <ha-formfield label="${this._t("title")}">
              <ha-textfield
                .value=${typeof c.title === "string"
                  ? c.title
                  : c.title === false
                    ? "(false)"
                    : ""}
                placeholder="${this._t("title_placeholder")}"
                .disabled=${c.title === false}
                @input=${(e) => {
                  const val = e.target.value;
                  if (val.trim() === "") {
                    this._updateConfig("title", true);
                  } else {
                    this._updateConfig("title", val);
                  }
                }}
              ></ha-textfield>
            </ha-formfield>
          </details>
          <details open>
            <summary>${this._t("summary_card_layout_and_colors")}</summary>
            <ha-formfield label="${this._t("background_color")}">
              <div style="display:flex; gap:8px; align-items:center;">
                <ha-textfield
                  .value=${c.background_color || ""}
                  placeholder="${this._t("background_color_placeholder") ||
                  "#ffffff"}"
                  @input=${(e) =>
                    this._updateConfig("background_color", e.target.value)}
                  style="width: 120px;"
                ></ha-textfield>
                <input
                  type="color"
                  .value=${c.background_color &&
                  /^#[0-9a-fA-F]{6}$/.test(c.background_color)
                    ? c.background_color
                    : "#ffffff"}
                  @input=${(e) =>
                    this._updateConfig("background_color", e.target.value)}
                  style="width: 36px; height: 32px; border: none; background: none; cursor: pointer;"
                  title="${this._t("background_color_picker") || "Pick color"}"
                />
              </div>
            </ha-formfield>
            <ha-formfield label="${this._t("icon_size")}">
              <ha-slider
                min="16"
                max="128"
                step="1"
                .value=${c.icon_size ?? 48}
                @input=${(e) =>
                  this._updateConfig("icon_size", Number(e.target.value))}
                style="width: 120px;"
              ></ha-slider>
              <ha-textfield
                .value=${c.icon_size ?? 48}
                type="number"
                min="16"
                max="128"
                step="1"
                @input=${(e) =>
                  this._updateConfig("icon_size", Number(e.target.value))}
                style="width: 80px;"
              ></ha-textfield>
            </ha-formfield>
            <ha-formfield label="${this._t("text_size_ratio")}">
              <ha-slider
                min="0.5"
                max="2"
                step="0.05"
                .value=${c.text_size_ratio ?? 1}
                @input=${(e) =>
                  this._updateConfig("text_size_ratio", Number(e.target.value))}
                style="width: 120px;"
              ></ha-slider>
              <ha-textfield
                type="number"
                .value=${c.text_size_ratio ?? 1}
                min="0.5"
                max="2"
                step="0.05"
                @input=${(e) =>
                  this._updateConfig("text_size_ratio", Number(e.target.value))}
                style="width: 80px;"
              ></ha-textfield>
            </ha-formfield>

            <!-- Allergen Colors Configuration -->
            <details>
              <summary>
                ${this._t("allergen_colors_header") || "Allergen Colors"}
              </summary>
              <ha-formfield
                label="${this._t("allergen_color_mode") ||
                "Allergen Color Mode"}"
              >
                <div style="display: flex; align-items: center; gap: 8px;">
                  <ha-select
                    .value=${c.allergen_color_mode || "default_colors"}
                    @selected=${(e) =>
                      this._updateConfig("allergen_color_mode", e.target.value)}
                    @closed=${(e) => e.stopPropagation()}
                    style="min-width: 140px;"
                  >
                    <mwc-list-item value="default_colors"
                      >${this._t("allergen_color_default_colors") ||
                      "Default Colors"}</mwc-list-item
                    >
                    <mwc-list-item value="custom"
                      >${this._t("allergen_color_custom") ||
                      "Custom Colors"}</mwc-list-item
                    >
                  </ha-select>
                </div>
              </ha-formfield>

              ${c.allergen_color_mode === "custom"
                ? html`
                    <ha-formfield
                      label="${this._t("allergen_colors") ||
                      "Allergen Colors (by Level)"}"
                    >
                      <div
                        style="display: flex; flex-direction: column; gap: 8px;"
                      >
                        ${(() => {
                          // Use centralized default allergen colors from LEVELS_DEFAULTS
                          const defaultAllergenColors =
                            LEVELS_DEFAULTS.allergen_colors;
                          const allergenColors =
                            c.allergen_colors || defaultAllergenColors;

                          return allergenColors.map(
                            (col, i) => html`
                              <div
                                style="display: flex; align-items: center; gap: 8px;"
                              >
                                <span style="min-width: 60px;"
                                  >Level ${i}:</span
                                >
                                <input
                                  type="color"
                                  .value=${(() => {
                                    // For level 0, use a gray color for the preview since HTML color input can't show rgba
                                    if (i === 0 && col.includes("rgba")) {
                                      return "#c8c8c8"; // Gray equivalent of rgba(200,200,200,0.15)
                                    }
                                    return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                                      col,
                                    )
                                      ? col
                                      : "#000000";
                                  })()}
                                  @input=${(e) => {
                                    const newColors = [...allergenColors];
                                    newColors[i] = e.target.value;
                                    this._updateConfig(
                                      "allergen_colors",
                                      newColors,
                                    );
                                  }}
                                  style="width: 28px; height: 28px; border: none; background: none;"
                                />
                                <ha-textfield
                                  .value=${col}
                                  placeholder="${i === 0
                                    ? this._t("allergen_empty_placeholder") ||
                                      "rgba(200,200,200,0.15)"
                                    : this._t("allergen_colors_placeholder") ||
                                      "#ffcc00"}"
                                  @input=${(e) => {
                                    const newColors = [...allergenColors];
                                    newColors[i] = e.target.value;
                                    this._updateConfig(
                                      "allergen_colors",
                                      newColors,
                                    );
                                  }}
                                  style="width: 120px;"
                                ></ha-textfield>
                                <ha-button
                                  outlined
                                  title="${this._t("allergen_colors_reset") ||
                                  "Reset"}"
                                  @click=${() => {
                                    const newColors = [...allergenColors];
                                    newColors[i] =
                                      LEVELS_DEFAULTS.allergen_colors[i];
                                    this._updateConfig(
                                      "allergen_colors",
                                      newColors,
                                    );
                                  }}
                                  style="margin-left: 8px;"
                                  >↺</ha-button
                                >
                              </div>
                            `,
                          );
                        })()}
                      </div>
                    </ha-formfield>

                    <ha-formfield
                      label="${this._t("allergen_outline_color") ||
                      "Outline Color"}"
                    >
                      <div
                        style="display: flex; align-items: center; gap: 8px;"
                      >
                        <input
                          type="color"
                          .value=${(() => {
                            const color =
                              c.allergen_outline_color ||
                              LEVELS_DEFAULTS.levels_gap_color;
                            // For rgba colors, show closest hex equivalent
                            if (color.includes("rgba")) {
                              return "#c8c8c8"; // Gray equivalent
                            }
                            return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color)
                              ? color
                              : "#c8c8c8";
                          })()}
                          @input=${(e) =>
                            this._updateConfig(
                              "allergen_outline_color",
                              e.target.value,
                            )}
                          style="width: 28px; height: 28px; border: none; background: none;"
                        />
                        <ha-textfield
                          .value=${c.allergen_outline_color ||
                          LEVELS_DEFAULTS.levels_gap_color}
                          placeholder="${this._t(
                            "allergen_outline_placeholder",
                          ) || "rgba(200,200,200,1)"}"
                          @input=${(e) =>
                            this._updateConfig(
                              "allergen_outline_color",
                              e.target.value,
                            )}
                          style="width: 100px;"
                        ></ha-textfield>
                        <ha-button
                          outlined
                          title="${this._t("allergen_outline_reset") ||
                          "Reset"}"
                          @click=${() =>
                            this._updateConfig(
                              "allergen_outline_color",
                              LEVELS_DEFAULTS.levels_gap_color,
                            )}
                          style="margin-left: 8px;"
                          >↺</ha-button
                        >
                      </div>
                    </ha-formfield>

                    <ha-formfield
                      label="${this._t("no_allergens_color") ||
                      "No Allergens Color"}"
                    >
                      <div
                        style="display: flex; align-items: center; gap: 8px;"
                      >
                        <input
                          type="color"
                          .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                            c.no_allergens_color ||
                              LEVELS_DEFAULTS.no_allergens_color,
                          )
                            ? c.no_allergens_color ||
                              LEVELS_DEFAULTS.no_allergens_color
                            : "#a9cfe0"}
                          @input=${(e) =>
                            this._updateConfig(
                              "no_allergens_color",
                              e.target.value,
                            )}
                          style="width: 28px; height: 28px; border: none; background: none;"
                        />
                        <ha-textfield
                          .value=${c.no_allergens_color ||
                          LEVELS_DEFAULTS.no_allergens_color}
                          placeholder="${this._t(
                            "no_allergens_color_placeholder",
                          ) || "#a9cfe0"}"
                          @input=${(e) =>
                            this._updateConfig(
                              "no_allergens_color",
                              e.target.value,
                            )}
                          style="width: 100px;"
                        ></ha-textfield>
                        <ha-button
                          outlined
                          title="${this._t("no_allergens_color_reset") ||
                          "Reset"}"
                          @click=${() =>
                            this._updateConfig(
                              "no_allergens_color",
                              LEVELS_DEFAULTS.no_allergens_color,
                            )}
                          style="margin-left: 8px;"
                          >↺</ha-button
                        >
                      </div>
                    </ha-formfield>
                  `
                : ""}
            </details>
            <!-- Stroke Width -->
            <ha-formfield
              label="${this._t("allergen_stroke_width") || "Stroke Width"}"
            >
              <ha-slider
                min="0"
                max="150"
                step="5"
                .value=${c.allergen_stroke_width ?? LEVELS_DEFAULTS.allergen_stroke_width}
                @input=${(e) => {
                  const value = Number(e.target.value);
                  this._updateConfig("allergen_stroke_width", value);
                  // Sync with level circle gap only if levels inherit from allergen AND gap sync is enabled
                  if (
                    (c.levels_inherit_mode || "inherit_allergen") ===
                      "inherit_allergen" &&
                    (c.allergen_levels_gap_synced ?? true)
                  ) {
                    const levelGap = convertStrokeWidthToGap(value);
                    this._updateConfig("levels_gap", levelGap);
                  }
                }}
                style="width: 120px;"
              ></ha-slider>
              <ha-textfield
                type="number"
                min="0"
                max="150"
                step="5"
                .value=${c.allergen_stroke_width ?? LEVELS_DEFAULTS.allergen_stroke_width}
                @input=${(e) => {
                  const value = e.target.value === '' ? LEVELS_DEFAULTS.allergen_stroke_width : Number(e.target.value);
                  this._updateConfig("allergen_stroke_width", value);
                  // Sync with level circle gap only if levels inherit from allergen AND gap sync is enabled
                  if (
                    (c.levels_inherit_mode || "inherit_allergen") ===
                      "inherit_allergen" &&
                    (c.allergen_levels_gap_synced ?? true)
                  ) {
                    const levelGap = convertStrokeWidthToGap(value);
                    this._updateConfig("levels_gap", levelGap);
                  }
                }}
                style="width: 80px;"
              ></ha-textfield>
              <ha-button
                outlined
                title="${this._t("allergen_stroke_width_reset") || "Reset"}"
                @click=${() =>
                  this._updateConfig(
                    "allergen_stroke_width",
                    LEVELS_DEFAULTS.allergen_stroke_width,
                  )}
                style="margin-left: 8px;"
                >↺</ha-button
              >
            </ha-formfield>

            <!-- Sync Stroke Color with Level -->
            <ha-formfield
              label="${this._t("allergen_stroke_color_synced") || "Sync stroke color with level"}"
            >
              <ha-checkbox
                .checked=${c.allergen_stroke_color_synced ?? true}
                @change=${(e) =>
                  this._updateConfig(
                    "allergen_stroke_color_synced",
                    e.target.checked,
                  )}
              ></ha-checkbox>
            </ha-formfield>

            <!-- Levels Configuration (moved above minimal) -->
            <details>
              <summary>${this._t("levels_header")}</summary>
              <ha-formfield
                label="${this._t("levels_inherit_mode") ||
                "Level Circle Color Mode"}"
              >
                <div style="display: flex; align-items: center; gap: 8px;">
                  <ha-select
                    .value=${c.levels_inherit_mode || "inherit_allergen"}
                    @selected=${(e) =>
                      this._updateConfig("levels_inherit_mode", e.target.value)}
                    @closed=${(e) => e.stopPropagation()}
                    style="min-width: 140px;"
                  >
                    <mwc-list-item value="inherit_allergen"
                      >${this._t("levels_inherit_allergen") ||
                      "Inherit from Allergen Colors"}</mwc-list-item
                    >
                    <mwc-list-item value="custom"
                      >${this._t("levels_custom") ||
                      "Use Custom Level Colors"}</mwc-list-item
                    >
                  </ha-select>
                </div>
              </ha-formfield>

              <!-- Sync Gap with Allergen Stroke Width - only shown when inheriting -->
              ${(c.levels_inherit_mode || "inherit_allergen") === "inherit_allergen"
                ? html`
                    <ha-formfield
                      label="${this._t("allergen_levels_gap_synced") || "Sync gap with allergen stroke width"}"
                    >
                      <ha-checkbox
                        .checked=${c.allergen_levels_gap_synced ?? true}
                        @change=${(e) =>
                          this._updateConfig(
                            "allergen_levels_gap_synced",
                            e.target.checked,
                          )}
                      ></ha-checkbox>
                    </ha-formfield>
                  `
                : ""}

              <!-- Colors Section - hidden when inheriting -->
              <div
                style="${c.levels_inherit_mode === "custom"
                  ? ""
                  : "display: none;"}"
              >
                <ha-formfield label="${this._t("levels_colors")}">
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${c.levels_colors.map(
                      (col, i) => html`
                        <div
                          style="display: flex; align-items: center; gap: 8px;"
                        >
                          <input
                            type="color"
                            .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(col)
                              ? col
                              : "#000000"}
                            @input=${(e) => {
                              const newColors = [...c.levels_colors];
                              newColors[i] = e.target.value;
                              this._updateConfig("levels_colors", newColors);
                            }}
                            style="width: 28px; height: 28px; border: none; background: none;"
                          />
                          <ha-textfield
                            .value=${col}
                            placeholder="${this._t(
                              "levels_colors_placeholder",
                            )}"
                            @input=${(e) => {
                              const newColors = [...c.levels_colors];
                              newColors[i] = e.target.value;
                              this._updateConfig("levels_colors", newColors);
                            }}
                            style="width: 100px;"
                          ></ha-textfield>
                          <ha-button
                            outlined
                            title="${this._t("levels_reset")}"
                            @click=${() => {
                              const newColors = [...c.levels_colors];
                              newColors[i] = LEVELS_DEFAULTS.levels_colors[i];
                              this._updateConfig("levels_colors", newColors);
                            }}
                            style="margin-left: 8px;"
                            >↺</ha-button
                          >
                        </div>
                      `,
                    )}
                  </div>
                </ha-formfield>

                <ha-formfield label="${this._t("levels_empty_color")}">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <input
                      type="color"
                      .value=${(() => {
                        const color =
                          c.levels_empty_color ||
                          LEVELS_DEFAULTS.levels_empty_color;
                        // For rgba colors, show closest hex equivalent
                        if (color.includes("rgba")) {
                          return "#c8c8c8"; // Gray equivalent of rgba(200,200,200,0.15)
                        }
                        return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color)
                          ? color
                          : "#c8c8c8";
                      })()}
                      @input=${(e) =>
                        this._updateConfig(
                          "levels_empty_color",
                          e.target.value,
                        )}
                      style="width: 28px; height: 28px; border: none; background: none;"
                    />
                    <ha-textfield
                      .value=${c.levels_empty_color}
                      placeholder="${this._t("levels_colors_placeholder")}"
                      @input=${(e) =>
                        this._updateConfig(
                          "levels_empty_color",
                          e.target.value,
                        )}
                      style="width: 100px;"
                    ></ha-textfield>
                    <ha-button
                      outlined
                      title="${this._t("levels_reset")}"
                      @click=${() =>
                        this._updateConfig(
                          "levels_empty_color",
                          LEVELS_DEFAULTS.levels_empty_color,
                        )}
                      style="margin-left: 8px;"
                      >↺</ha-button
                    >
                  </div>
                </ha-formfield>

                <ha-formfield label="${this._t("levels_gap_color")}">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <input
                      type="color"
                      .value=${(() => {
                        const color =
                          c.levels_gap_color ||
                          LEVELS_DEFAULTS.levels_gap_color;
                        // For rgba colors, show closest hex equivalent
                        if (color.includes("rgba")) {
                          return "#c8c8c8"; // Gray equivalent
                        }
                        return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color)
                          ? color
                          : "#c8c8c8";
                      })()}
                      @input=${(e) =>
                        this._updateConfig("levels_gap_color", e.target.value)}
                      style="width: 28px; height: 28px; border: none; background: none;"
                    />
                    <ha-textfield
                      .value=${c.levels_gap_color}
                      placeholder="${this._t("levels_colors_placeholder")}"
                      @input=${(e) =>
                        this._updateConfig("levels_gap_color", e.target.value)}
                      style="width: 100px;"
                    ></ha-textfield>
                    <ha-button
                      outlined
                      title="${this._t("levels_reset")}"
                      @click=${() =>
                        this._updateConfig(
                          "levels_gap_color",
                          LEVELS_DEFAULTS.levels_gap_color,
                        )}
                      style="margin-left: 8px;"
                      >↺</ha-button
                    >
                  </div>
                </ha-formfield>

                <ha-formfield label="${this._t("levels_thickness")}">
                  <ha-slider
                    min="10"
                    max="90"
                    step="1"
                    .value=${c.levels_thickness}
                    @input=${(e) =>
                      this._updateConfig(
                        "levels_thickness",
                        Number(e.target.value),
                      )}
                    style="width: 120px;"
                  ></ha-slider>
                  <ha-textfield
                    type="number"
                    .value=${c.levels_thickness}
                    @input=${(e) =>
                      this._updateConfig(
                        "levels_thickness",
                        Number(e.target.value),
                      )}
                    style="width: 80px;"
                  ></ha-textfield>
                  <ha-button
                    outlined
                    title="${this._t("levels_reset")}"
                    @click=${() =>
                      this._updateConfig(
                        "levels_thickness",
                        LEVELS_DEFAULTS.levels_thickness,
                      )}
                    style="margin-left: 8px;"
                    >↺</ha-button
                  >
                </ha-formfield>
              </div>

              <!-- Gap control - conditional on inheritance mode and sync setting -->
              ${(c.levels_inherit_mode || "inherit_allergen") === "custom" ||
              !(c.allergen_levels_gap_synced ?? true)
                ? html`
                    <ha-formfield label="${this._t("levels_gap")}">
                      <ha-slider
                        min="0"
                        max="20"
                        step="1"
                        .value=${c.levels_gap}
                        @input=${(e) =>
                          this._updateConfig(
                            "levels_gap",
                            Number(e.target.value),
                          )}
                        style="width: 120px;"
                      ></ha-slider>
                      <ha-textfield
                        type="number"
                        .value=${c.levels_gap}
                        @input=${(e) =>
                          this._updateConfig(
                            "levels_gap",
                            Number(e.target.value),
                          )}
                        style="width: 80px;"
                      ></ha-textfield>
                      <ha-button
                        outlined
                        title="${this._t("levels_reset")}"
                        @click=${() =>
                          this._updateConfig(
                            "levels_gap",
                            LEVELS_DEFAULTS.levels_gap,
                          )}
                        style="margin-left: 8px;"
                        >↺</ha-button
                      >
                    </ha-formfield>
                  `
                : html`
                    <ha-formfield label="${this._t("levels_gap_inherited")}">
                      <div
                        style="display: flex; align-items: center; gap: 8px; width: 120px; height: 30px;"
                      >
                        <span
                          style="color: var(--secondary-text-color); font-size: 14px; min-width: 30px"
                        >
                          ${convertStrokeWidthToGap(
                            c.allergen_stroke_width ||
                              LEVELS_DEFAULTS.allergen_stroke_width,
                          )}px
                        </span>
                      </div>
                    </ha-formfield>
                  `}

              <ha-formfield label="${this._t("levels_text_weight")}">
                <ha-select
                  .value=${c.levels_text_weight || "normal"}
                  @selected=${(e) =>
                    this._updateConfig("levels_text_weight", e.target.value)}
                  @closed=${(e) => e.stopPropagation()}
                >
                  <mwc-list-item value="normal">Normal</mwc-list-item>
                  <mwc-list-item value="500">Medium</mwc-list-item>
                  <mwc-list-item value="bold">Bold</mwc-list-item>
                </ha-select>
              </ha-formfield>

              <ha-formfield label="${this._t("levels_text_size")}">
                <ha-slider
                  min="0.1"
                  max="0.5"
                  step="0.05"
                  .value=${c.levels_text_size || 0.3}
                  @input=${(e) =>
                    this._updateConfig(
                      "levels_text_size",
                      Number(e.target.value),
                    )}
                  style="width: 120px;"
                ></ha-slider>
                <ha-textfield
                  type="number"
                  .value=${c.levels_text_size || 0.3}
                  @input=${(e) =>
                    this._updateConfig(
                      "levels_text_size",
                      Number(e.target.value),
                    )}
                  style="width: 80px;"
                ></ha-textfield>
              </ha-formfield>

              <ha-formfield label="${this._t("levels_icon_ratio")}">
                <ha-slider
                  min="0.1"
                  max="2"
                  step="0.05"
                  .value=${c.levels_icon_ratio || 1}
                  @input=${(e) =>
                    this._updateConfig(
                      "levels_icon_ratio",
                      Number(e.target.value),
                    )}
                  style="width: 120px;"
                ></ha-slider>
                <ha-textfield
                  type="number"
                  .value=${c.levels_icon_ratio || 1}
                  @input=${(e) =>
                    this._updateConfig(
                      "levels_icon_ratio",
                      Number(e.target.value),
                    )}
                  style="width: 80px;"
                ></ha-textfield>
              </ha-formfield>

              <ha-formfield label="${this._t("levels_text_color")}">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <input
                    type="color"
                    .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                      c.levels_text_color || "",
                    )
                      ? c.levels_text_color
                      : "#000000"}
                    @input=${(e) =>
                      this._updateConfig("levels_text_color", e.target.value)}
                    style="width: 28px; height: 28px; border: none; background: none;"
                  />
                  <ha-textfield
                    .value=${c.levels_text_color || ""}
                    placeholder="var(--primary-text-color)"
                    @input=${(e) =>
                      this._updateConfig("levels_text_color", e.target.value)}
                    style="width: 100px;"
                  ></ha-textfield>
                </div>
              </ha-formfield>
            </details>

            <details open>
              <summary>${this._t("summary_minimal")}</summary>
              <ha-formfield label="${this._t("minimal")}">
                <ha-switch
                  .checked=${c.minimal}
                  @change=${(e) =>
                    this._updateConfig("minimal", e.target.checked)}
                ></ha-switch>
              </ha-formfield>
              <ha-formfield label="${this._t("minimal_gap")}">
                <ha-slider
                  min="0"
                  max="100"
                  step="1"
                  .value=${c.minimal_gap ?? 35}
                  @input=${(e) =>
                    this._updateConfig("minimal_gap", Number(e.target.value))}
                  style="width: 120px;"
                ></ha-slider>
                <ha-textfield
                  type="number"
                  .value=${c.minimal_gap ?? 35}
                  min="0"
                  max="100"
                  step="1"
                  @input=${(e) =>
                    this._updateConfig("minimal_gap", Number(e.target.value))}
                  style="width: 80px;"
                ></ha-textfield>
              </ha-formfield>
            </details>
          </details>

          <!-- Display Switches -->
          <details open>
            <summary>${this._t("summary_data_view_settings")}</summary>
            <ha-formfield label="${this._t("allergens_abbreviated")}">
              <ha-switch
                .checked=${c.allergens_abbreviated}
                @change=${(e) =>
                  this._updateConfig("allergens_abbreviated", e.target.checked)}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield label="${this._t("show_text_allergen")}">
              <ha-switch
                .checked=${c.show_text_allergen}
                @change=${(e) =>
                  this._updateConfig("show_text_allergen", e.target.checked)}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield label="${this._t("show_value_text")}">
              <ha-switch
                .checked=${c.show_value_text}
                @change=${(e) =>
                  this._updateConfig("show_value_text", e.target.checked)}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield label="${this._t("show_value_numeric")}">
              <ha-switch
                .checked=${c.show_value_numeric}
                @change=${(e) =>
                  this._updateConfig("show_value_numeric", e.target.checked)}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield label="${this._t("show_value_numeric_in_circle")}">
              <ha-switch
                .checked=${c.show_value_numeric_in_circle}
                @change=${(e) =>
                  this._updateConfig(
                    "show_value_numeric_in_circle",
                    e.target.checked,
                  )}
              ></ha-switch>
            </ha-formfield>
            ${c.integration === "peu"
              ? html`
                  <ha-formfield label="${this._t("numeric_state_raw_risk")}">
                    <ha-switch
                      .checked=${c.numeric_state_raw_risk}
                      @change=${(e) =>
                        this._updateConfig(
                          "numeric_state_raw_risk",
                          e.target.checked,
                        )}
                    ></ha-switch>
                  </ha-formfield>
                `
              : ""}
            <ha-formfield label="${this._t("show_empty_days")}">
              <ha-switch
                .checked=${c.show_empty_days}
                @change=${(e) =>
                  this._updateConfig("show_empty_days", e.target.checked)}
              ></ha-switch>
            </ha-formfield>
          </details>

          <!-- Day Settings -->
          <details open>
            <summary>${this._t("summary_day_view_settings")}</summary>
            <ha-formfield label="${this._t("days_relative")}">
              <ha-switch
                .checked=${c.days_relative}
                @change=${(e) =>
                  this._updateConfig("days_relative", e.target.checked)}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield label="${this._t("days_abbreviated")}">
              <ha-switch
                .checked=${c.days_abbreviated}
                @change=${(e) =>
                  this._updateConfig("days_abbreviated", e.target.checked)}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield label="${this._t("days_uppercase")}">
              <ha-switch
                .checked=${c.days_uppercase}
                @change=${(e) =>
                  this._updateConfig("days_uppercase", e.target.checked)}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield label="${this._t("days_boldfaced")}">
              <ha-switch
                .checked=${c.days_boldfaced}
                @change=${(e) =>
                  this._updateConfig("days_boldfaced", e.target.checked)}
              ></ha-switch>
            </ha-formfield>

            <!-- Columns/Days/Threshold/Sort -->
            <div class="slider-row">
              <div class="slider-text">
                ${(c.integration === "silam" || c.integration === "peu") &&
                c.mode === "twice_daily"
                  ? this._t("to_show_columns")
                  : (c.integration === "silam" || c.integration === "peu") &&
                      c.mode !== "daily"
                    ? this._t("to_show_hours")
                    : this._t("to_show_days")}
              </div>
              <div class="slider-value">${c.days_to_show}</div>
              <ha-slider
                min="0"
                max="${(c.integration === "silam" || c.integration === "peu") &&
                c.mode !== "daily"
                  ? 8
                  : 6}"
                step="1"
                .value=${c.days_to_show}
                @input=${(e) =>
                  this._updateConfig("days_to_show", Number(e.target.value))}
              ></ha-slider>
            </div>
          </details>
        </details>

        <!-- Allergens -->
        <details>
          <summary>${this._t("summary_allergens")}</summary>
          ${c.integration === "kleenex" || c.integration === "gpl"
            ? html`
                <!-- Category allergens (controlled by checkbox) -->
                <div class="allergen-section">
                  <h4
                    style="margin: 8px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                  >
                    ${this._t("allergens_header_category")}
                  </h4>
                  <div class="allergens-group">
                    ${["trees_cat", "grass_cat", "weeds_cat"].map((key) => {
                      const displayName = this._getAllergenDisplayName(key);
                      return html`
                        <ha-formfield .label=${displayName}>
                          <ha-checkbox
                            .checked=${c.allergens.includes(key)}
                            @change=${(e) =>
                              this._onAllergenToggle(key, e.target.checked)}
                          ></ha-checkbox>
                        </ha-formfield>
                      `;
                    })}
                  </div>
                </div>

                <!-- Individual allergens -->
                <div class="allergen-section">
                  <h4
                    style="margin: 16px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                  >
                    ${this._t("allergens_header_specific")}
                  </h4>
                  <div class="allergens-group">
                    ${allergens
                      .filter(
                        (key) =>
                          !["trees_cat", "grass_cat", "weeds_cat"].includes(
                            key,
                          ),
                      )
                      .sort((a, b) => {
                        // Sort alphabetically by display name
                        const displayA = this._getAllergenDisplayName(a);
                        const displayB = this._getAllergenDisplayName(b);
                        return displayA.localeCompare(displayB);
                      })
                      .map((key) => {
                        const displayName = this._getAllergenDisplayName(key);
                        return html`
                          <ha-formfield .label=${displayName}>
                            <ha-checkbox
                              .checked=${c.allergens.includes(key)}
                              @change=${(e) =>
                                this._onAllergenToggle(key, e.target.checked)}
                            ></ha-checkbox>
                          </ha-formfield>
                        `;
                      })}
                  </div>
                </div>
              `
            : c.integration === "atmo"
              ? html`
                  <!-- Atmo France: Summary / Pollen / Pollution blocks -->
                  <div class="allergen-section">
                    <h4
                      style="margin: 8px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                    >
                      ${this._t("allergens_header_summary")}
                    </h4>
                    <div class="allergens-group">
                      ${["allergy_risk", "qualite_globale"]
                        .filter((key) => allergens.includes(key))
                        .map((key) => {
                          const displayName =
                            this._getAllergenDisplayName(key);
                          return html`
                            <ha-formfield .label=${displayName}>
                              <ha-checkbox
                                .checked=${c.allergens.includes(key)}
                                @change=${(e) =>
                                  this._onAllergenToggle(
                                    key,
                                    e.target.checked,
                                  )}
                              ></ha-checkbox>
                            </ha-formfield>
                          `;
                        })}
                    </div>
                  </div>
                  <div class="allergen-section">
                    <h4
                      style="margin: 16px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                    >
                      ${this._t("allergens_header_pollen")}
                    </h4>
                    <div class="allergens-group">
                      ${allergens
                        .filter(
                          (key) =>
                            !["allergy_risk", "qualite_globale", "pm25", "pm10", "ozone", "no2", "so2"].includes(key),
                        )
                        .sort((a, b) => {
                          const displayA = this._getAllergenDisplayName(a);
                          const displayB = this._getAllergenDisplayName(b);
                          return displayA.localeCompare(displayB);
                        })
                        .map((key) => {
                          const displayName =
                            this._getAllergenDisplayName(key);
                          return html`
                            <ha-formfield .label=${displayName}>
                              <ha-checkbox
                                .checked=${c.allergens.includes(key)}
                                @change=${(e) =>
                                  this._onAllergenToggle(
                                    key,
                                    e.target.checked,
                                  )}
                              ></ha-checkbox>
                            </ha-formfield>
                          `;
                        })}
                    </div>
                  </div>
                  <div class="allergen-section">
                    <h4
                      style="margin: 16px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                    >
                      ${this._t("allergens_header_pollution")}
                    </h4>
                    <div class="allergens-group">
                      ${["pm25", "pm10", "ozone", "no2", "so2"]
                        .filter((key) => allergens.includes(key))
                        .map((key) => {
                          const displayName =
                            this._getAllergenDisplayName(key);
                          return html`
                            <ha-formfield .label=${displayName}>
                              <ha-checkbox
                                .checked=${c.allergens.includes(key)}
                                @change=${(e) =>
                                  this._onAllergenToggle(
                                    key,
                                    e.target.checked,
                                  )}
                              ></ha-checkbox>
                            </ha-formfield>
                          `;
                        })}
                    </div>
                  </div>
                `
              : html`
                  <!-- Standard allergen display -->
                  <div class="allergens-group">
                    ${allergens.map((key) => {
                      const displayName = this._getAllergenDisplayName(key);
                      return html`
                        <ha-formfield .label=${displayName}>
                          <ha-checkbox
                            .checked=${c.allergens.includes(key)}
                            @change=${(e) =>
                              this._onAllergenToggle(key, e.target.checked)}
                          ></ha-checkbox>
                        </ha-formfield>
                      `;
                    })}
                  </div>
                `}
          <div class="preset-buttons">
            <ha-button
              @click=${() => {
                // For kleenex, include both individual allergens and category allergens
                const allAllergens =
                  c.integration === "kleenex"
                    ? [...allergens, "trees_cat", "grass_cat", "weeds_cat"]
                    : allergens;
                this._toggleSelectAllAllergens(allAllergens);
              }}
            >
              ${this._t("select_all_allergens")}
            </ha-button>
            ${c.integration === "atmo"
              ? html`
                  <ha-button
                    @click=${() => {
                      const pollenKeys = allergens.filter(
                        (k) =>
                          !["allergy_risk", "qualite_globale", "pm25", "pm10", "ozone", "no2", "so2"].includes(k),
                      );
                      this._toggleAllergenSubset(pollenKeys);
                    }}
                  >
                    ${this._t("select_all_pollen")}
                  </ha-button>
                  <ha-button
                    @click=${() => {
                      const pollutionKeys = ["pm25", "pm10", "ozone", "no2", "so2"].filter(
                        (k) => allergens.includes(k),
                      );
                      this._toggleAllergenSubset(pollutionKeys);
                    }}
                  >
                    ${this._t("select_all_pollution")}
                  </ha-button>
                `
              : ""}
          </div>
          <div class="slider-row">
            <div class="slider-text">${this._t("pollen_threshold")}</div>
            <div class="slider-value">${c.pollen_threshold}</div>
            <ha-slider
              min="${thresholdParams.min}"
              max="${thresholdParams.max}"
              step="${thresholdParams.step}"
              .value=${c.pollen_threshold}
              @input=${(e) =>
                this._updateConfig("pollen_threshold", Number(e.target.value))}
            ></ha-slider>
          </div>
          <ha-formfield label="${this._t("sort")}">
            <ha-select
              .value=${c.sort}
              @selected=${(e) => this._updateConfig("sort", e.target.value)}
              @closed=${(e) => e.stopPropagation()}
            >
              ${sortOptions.map(
                ({ value, label }) =>
                  html`<mwc-list-item .value=${value}>${label}</mwc-list-item>`,
              )}
            </ha-select>
          </ha-formfield>
          ${c.integration === "kleenex" || c.integration === "gpl"
            ? html`
                <ha-formfield
                  label="${this._t("sort_category_allergens_first")}"
                >
                  <ha-checkbox
                    .checked=${c.sort_category_allergens_first}
                    @change=${(e) =>
                      this._updateConfig(
                        "sort_category_allergens_first",
                        e.target.checked,
                      )}
                  ></ha-checkbox>
                </ha-formfield>
              `
            : ""}
          ${c.integration === "peu" || c.integration === "silam" || c.integration === "atmo"
            ? html`
                <ha-formfield
                  label="${c.integration === "silam"
                    ? this._t("index_top")
                    : this._t("allergy_risk_top")}"
                >
                  <ha-checkbox
                    .checked=${c.integration === "silam"
                      ? c.index_top
                      : c.allergy_risk_top}
                    @change=${(e) =>
                      this._updateConfig(
                        c.integration === "silam"
                          ? "index_top"
                          : "allergy_risk_top",
                        e.target.checked,
                      )}
                  ></ha-checkbox>
                </ha-formfield>
              `
            : ""}
          ${c.integration === "atmo"
            ? html`
                <ha-formfield
                  label="${this._t("sort_pollution_block")}"
                >
                  <ha-checkbox
                    .checked=${c.sort_pollution_block}
                    @change=${(e) =>
                      this._updateConfig(
                        "sort_pollution_block",
                        e.target.checked,
                      )}
                  ></ha-checkbox>
                </ha-formfield>
                ${c.sort_pollution_block
                  ? html`
                      <ha-formfield
                        label="${this._t("pollution_block_position")}"
                      >
                        <ha-select
                          .value=${c.pollution_block_position || "bottom"}
                          @selected=${(e) =>
                            this._updateConfig(
                              "pollution_block_position",
                              e.target.value,
                            )}
                          @closed=${(e) => e.stopPropagation()}
                        >
                          <mwc-list-item value="bottom"
                            >${this._t("pollution_block_bottom")}</mwc-list-item
                          >
                          <mwc-list-item value="top"
                            >${this._t("pollution_block_top")}</mwc-list-item
                          >
                        </ha-select>
                      </ha-formfield>
                      <ha-formfield
                        label="${this._t("show_block_separator")}"
                      >
                        <ha-checkbox
                          .checked=${c.show_block_separator}
                          @change=${(e) =>
                            this._updateConfig(
                              "show_block_separator",
                              e.target.checked,
                            )}
                        ></ha-checkbox>
                      </ha-formfield>
                    `
                  : ""}
              `
            : ""}
        </details>

        <!-- Översättningar och textsträngar -->
        <details>
          <summary>${this._t("summary_translation_and_strings")}</summary>
          <ha-formfield label="${this._t("locale")}">
            <ha-textfield
              .value=${c.date_locale}
              @input=${(e) => this._updateConfig("date_locale", e.target.value)}
            ></ha-textfield>
          </ha-formfield>
          <h3>${this._t("phrases")}</h3>
          <div class="preset-buttons">
            <ha-formfield label="${this._t("phrases_translate_all")}">
              <ha-select
                .value=${this._selectedPhraseLang}
                @selected=${(e) => (this._selectedPhraseLang = e.target.value)}
                @closed=${(e) => e.stopPropagation()}
              >
                ${SUPPORTED_LOCALES.map(
                  (code) => html`
                    <mwc-list-item .value=${code}>
                      ${new Intl.DisplayNames([this._lang], {
                        type: "language",
                      }).of(code) || code}
                    </mwc-list-item>
                  `,
                )}
              </ha-select>
            </ha-formfield>
            <!-- Use Home Assistant's button with outlined style for clarity -->
            <ha-button
              outlined
              @click=${() => this._resetPhrases(this._selectedPhraseLang)}
            >
              ${this._t("phrases_apply")}
            </ha-button>
          </div>
          <details>
            <summary>${this._t("phrases_full")}</summary>
            ${allergens.map(
              (a) => html`
                <ha-formfield .label=${a}>
                  <ha-textfield
                    .value=${c.phrases.full[a] || ""}
                    @input=${(e) => {
                      const p = {
                        ...c.phrases,
                        full: { ...c.phrases.full, [a]: e.target.value },
                      };
                      this._updateConfig("phrases", p);
                    }}
                  ></ha-textfield>
                </ha-formfield>
              `,
            )}
          </details>
          <details>
            <summary>${this._t("phrases_short")}</summary>
            ${allergens.map(
              (a) => html`
                <ha-formfield .label=${a}>
                  <ha-textfield
                    .value=${c.phrases.short[a] || ""}
                    @input=${(e) => {
                      const p = {
                        ...c.phrases,
                        short: { ...c.phrases.short, [a]: e.target.value },
                      };
                      this._updateConfig("phrases", p);
                    }}
                  ></ha-textfield>
                </ha-formfield>
              `,
            )}
          </details>
          <details>
            <summary>${this._t("phrases_levels")}</summary>
            ${Array.from({ length: numLevels }, (_, i) => i).map(
              (i) => html`
                <ha-formfield .label=${i}>
                  <ha-textfield
                    .value=${c.phrases.levels[i] || ""}
                    @input=${(e) => {
                      const lv = [...c.phrases.levels];
                      lv[i] = e.target.value;
                      const p = { ...c.phrases, levels: lv };
                      this._updateConfig("phrases", p);
                    }}
                  ></ha-textfield>
                </ha-formfield>
              `,
            )}
          </details>
          <details>
            <summary>${this._t("phrases_days")}</summary>
            ${[0, 1, 2].map(
              (i) => html`
                <ha-formfield .label=${i}>
                  <ha-textfield
                    .value=${c.phrases.days[i] || ""}
                    @input=${(e) => {
                      const dd = { ...c.phrases.days, [i]: e.target.value };
                      this._updateConfig("phrases", { ...c.phrases, days: dd });
                    }}
                  ></ha-textfield>
                </ha-formfield>
              `,
            )}
          </details>
          <ha-formfield label="${this._t("no_information")}">
            <ha-textfield
              .value=${c.phrases.no_information || ""}
              @input=${(e) =>
                this._updateConfig("phrases", {
                  ...c.phrases,
                  no_information: e.target.value,
                })}
            ></ha-textfield>
          </ha-formfield>
        </details>

        <!-- Tap Action -->
        <details>
          <summary>${this._t("summary_card_interactivity")}</summary>
          <h3>${this._t("tap_action")}</h3>
          <ha-formfield label="${this._t("link_to_sensors")}">
            <ha-switch
              .checked=${c.link_to_sensors !== false}
              @change=${(e) =>
                this._updateConfig("link_to_sensors", e.target.checked)}
            ></ha-switch>
          </ha-formfield>
          <ha-formfield label="${this._t("tap_action_enable")}">
            <ha-switch
              .checked=${this._tapType !== "none"}
              @change=${(e) => {
                if (e.target.checked) {
                  this._tapType = "more-info";
                  this._updateConfig("tap_action", {
                    ...this._config.tap_action,
                    type: "more-info",
                  });
                } else {
                  this._tapType = "none";
                  this._updateConfig("tap_action", {
                    ...this._config.tap_action,
                    type: "none",
                  });
                }
                this.requestUpdate();
              }}
            ></ha-switch>
          </ha-formfield>
          ${this._tapType !== "none"
            ? html`
                <div style="margin-top: 10px;">
                  <label>Action type</label>
                  <ha-select
                    .value=${this._tapType}
                    @selected=${(e) => {
                      this._tapType = e.target.value;
                      let tapAction = { type: this._tapType };
                      if (this._tapType === "more-info")
                        tapAction.entity = this._tapEntity;
                      if (this._tapType === "navigate")
                        tapAction.navigation_path = this._tapNavigation;
                      if (this._tapType === "call-service") {
                        tapAction.service = this._tapService;
                        try {
                          tapAction.service_data = JSON.parse(
                            this._tapServiceData || "{}",
                          );
                        } catch {
                          tapAction.service_data = {};
                        }
                      }
                      this._updateConfig("tap_action", tapAction);
                      this.requestUpdate();
                    }}
                    @closed=${(e) => e.stopPropagation()}
                  >
                    <mwc-list-item value="more-info">More Info</mwc-list-item>
                    <mwc-list-item value="navigate">Navigate</mwc-list-item>
                    <mwc-list-item value="call-service"
                      >Call Service</mwc-list-item
                    >
                  </ha-select>
                </div>
                ${this._tapType === "more-info"
                  ? html`
                      <ha-formfield label="Entity">
                        <ha-textfield
                          .value=${this._tapEntity}
                          @input=${(e) => {
                            this._tapEntity = e.target.value;
                            this._updateConfig("tap_action", {
                              type: "more-info",
                              entity: this._tapEntity,
                            });
                          }}
                        ></ha-textfield>
                      </ha-formfield>
                    `
                  : ""}
                ${this._tapType === "navigate"
                  ? html`
                      <ha-formfield label="Navigation path">
                        <ha-textfield
                          .value=${this._tapNavigation}
                          @input=${(e) => {
                            this._tapNavigation = e.target.value;
                            this._updateConfig("tap_action", {
                              type: "navigate",
                              navigation_path: this._tapNavigation,
                            });
                          }}
                        ></ha-textfield>
                      </ha-formfield>
                    `
                  : ""}
                ${this._tapType === "call-service"
                  ? html`
                      <ha-formfield label="Service (e.g. light.turn_on)">
                        <ha-textfield
                          .value=${this._tapService}
                          @input=${(e) => {
                            this._tapService = e.target.value;
                            let data = {};
                            try {
                              data = JSON.parse(this._tapServiceData || "{}");
                            } catch {}
                            this._updateConfig("tap_action", {
                              type: "call-service",
                              service: this._tapService,
                              service_data: data,
                            });
                          }}
                        ></ha-textfield>
                      </ha-formfield>
                      <ha-formfield label="Service data (JSON)">
                        <ha-textfield
                          .value=${this._tapServiceData}
                          @input=${(e) => {
                            this._tapServiceData = e.target.value;
                            let data = {};
                            try {
                              data = JSON.parse(this._tapServiceData || "{}");
                            } catch {}
                            this._updateConfig("tap_action", {
                              type: "call-service",
                              service: this._tapService,
                              service_data: data,
                            });
                          }}
                        ></ha-textfield>
                      </ha-formfield>
                    `
                  : ""}
              `
            : ""}
        </details>

        <!-- Debug -->
        <details>
          <summary>${this._t("summary_advanced")}</summary>
          <ha-formfield label="${this._t("debug")}">
            <ha-switch
              .checked=${c.debug}
              @change=${(e) => this._updateConfig("debug", e.target.checked)}
            ></ha-switch>
          </ha-formfield>
          <ha-formfield label="${this._t("show_version")}">
            <ha-switch
              .checked=${c.show_version !== false}
              @change=${(e) =>
                this._updateConfig("show_version", e.target.checked)}
            ></ha-switch>
          </ha-formfield>
          <div class="version-info">
            ${this._t("card_version")}: ${__VERSION__}
          </div>
        </details>
      </div>
    `;
  }

  static get styles() {
    return css`
      /* pollenprognos-card-editor styles */

      /* Main container for card config */
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
      }

      /* Formfield and details spacing */
      ha-formfield,
      details {
        margin-bottom: 8px;
      }

      /* Allergens group styling */
      .allergens-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      /* Allergen section styling for Kleenex grouped display */
      .allergen-section {
        margin-bottom: 12px;
      }

      .allergen-section h4 {
        margin: 8px 0 4px 0;
        font-size: 0.9em;
        color: var(--secondary-text-color);
        font-weight: 500;
      }

      /* Details summary styling */
      details summary {
        cursor: pointer;
        font-weight: bold;
        margin: 8px 0;
      }

      /* Slider styling */
      ha-slider {
        width: 100%;
      }

      /* Select styling */
      ha-select {
        width: 100%;
        --mdc-theme-primary: var(--primary-color);
      }

      /* Preset buttons styling */
      .preset-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }

      /* Slider row layout */
      .slider-row {
        display: grid;
        grid-template-columns: auto 3ch 1fr;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      /* Slider text label */
      .slider-text {
        /* label, natural width */
      }

      /* Slider value styling */
      .slider-value {
        /* always 3ch wide for value (e.g. "0,5" / "1  ") */
        font-family: monospace;
        text-align: right;
        width: 3ch;
      }

      /* Slider within slider-row */
      .slider-row ha-slider {
        width: 100%;
      }

      /* Details section spacing and background */
      details {
        margin-bottom: 16px; /* Increased for more space */
        border-radius: 6px; /* Slightly larger radius */
        padding: 8px 0 0 0; /* Add top padding for air */
      }

      /* Indent all direct children of details except summary and nested details */
      details > *:not(summary):not(details) {
        margin-left: 24px;
        margin-right: 24px;
      }

      /* Details summary style */
      details summary {
        font-weight: bold;
        cursor: pointer;
        background: var(--card-background-color, #f6f6f6);
        border-radius: 6px;
        padding: 10px 16px; /* More padding for air */
        border: 1px solid var(--divider-color, #ddd);
        color: var(--primary-text-color, #222);
        margin-bottom: 4px; /* Space below summary */
      }

      /* Nested details styling */
      details details {
        margin-left: 24px; /* More indent */
        margin-right: 24px; /* More indent */
        background: var(--secondary-background-color, #f9f9f9);
        border-left: 2px solid var(--primary-color, #bcd);
        padding: 8px 0 8px 8px; /* More padding inside nested details */
      }

      /* Nested details summary styling */
      details details summary {
        background: var(--card-background-color, #f0f7fc);
        border: 1px solid var(--ha-card-border-color, #cde);
        color: var(--primary-text-color, #222);
        margin-bottom: 4px;
        padding: 8px 12px;
        border-radius: 5px;
      }

      /* --- Toggle (ha-switch) and boolean control styles --- */

      /*
  This section ensures that the clickable area (hitbox) for boolean toggles (ha-switch)
  matches the visible toggle size and does not expand unnecessarily. 
  The goal is DRY/KISS: no excessive click area, and only the toggle and label are clickable.
*/

      /* Remove any default margin/padding around the switch inside ha-formfield */
      ha-formfield > ha-switch,
      ha-formfield > .mdc-form-field > ha-switch {
        margin: 0;
        padding: 0;
        width: auto;
        min-width: 0;
        box-sizing: content-box;
      }

      /* Remove extra padding/margin on ha-formfield itself */
      ha-formfield {
        padding: 0;
        margin: 0;
        box-sizing: border-box;
      }

      /* Minimize ripple/overlay area if present (Material Web ripple) */
      .mdc-form-field__ripple {
        width: auto !important;
        min-width: 0 !important;
        height: auto !important;
        min-height: 0 !important;
        border-radius: 16px !important;
        /* Only as large as the toggle itself */
      }

      /* Reduce spacing between toggles in settings group */
      details .ha-formfield {
        margin-bottom: 2px;
      }

      /* Display the current card version */
      .version-info {
        font-size: 0.9em;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }

      /* Remove extra background/overlay on focus/active */
      ha-switch:focus,
      ha-switch:active {
        box-shadow: none;
        outline: none;
      }

      /* Ensure toggles have standard size and spacing */
      ha-switch {
        vertical-align: middle;
        /* If needed, override width/height for consistent appearance */
        width: 36px;
        height: 20px;
        /* Remove any extra border or background */
        background: none;
        border: none;
        box-sizing: border-box;
      }

      /* Label alignment with switch */
      ha-formfield label,
      ha-formfield .mdc-label {
        vertical-align: middle;
        margin-left: 8px;
        margin-right: 0;
        padding: 0;
      }

      /* End of boolean control styles */
      /* --- Numeric input box width and padding fix for ha-textfield --- */

      /*
        Ensures that all ha-textfield elements used for numeric input
        (such as minimal_gap, icon size, text size, etc) display at least
        three digits clearly, without white space truncating the value.
        This patch sets width and internal padding. Applies to all number-type
        ha-textfield elements in the editor.
*/
      ha-textfield[type="number"] {
        /* Set a specific width to fit at least three digits and controls */
        width: 80px;
        min-width: 80px;
        max-width: 100px;
        /* Remove extra margin and padding */
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        /* Set font size for clarity */
        font-size: 1.1em;
      }

      /* Ensure the input itself inherits width and font size */
      ha-textfield[type="number"] input[type="number"] {
        width: 100%;
        min-width: 0;
        max-width: 100%;
        font-size: 1.1em;
        box-sizing: border-box;
        padding: 2px 8px;
        /* Remove border/background if needed */
        background: none;
        border: none;
      }

      /*
  Slider row input: force numeric box to be visible and aligned
  (applies to all numeric ha-textfield within .slider-row)
*/
      .slider-row ha-textfield[type="number"] {
        width: 80px;
        min-width: 80px;
        max-width: 100px;
        font-size: 1.1em;
        margin: 0;
        padding: 0;
      }
    `;
  }
}

customElements.define("pollenprognos-card-editor", PollenPrognosCardEditor);
