// src/pollenprognos-editor.js
import { LitElement, html, css } from "lit";
import { t, detectLang, SUPPORTED_LOCALES } from "./i18n.js";
import { normalize } from "./utils/normalize.js";
import { slugify } from "./utils/slugify.js";
import { deepEqual } from "./utils/confcompare.js";
import { LEVELS_DEFAULTS } from "./utils/levels-defaults.js";
import { COSMETIC_FIELDS } from "./constants.js";

// Stub-config från adaptrar (så att editorn vet vilka fält som finns)
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";
import { stubConfigPEU } from "./adapters/peu.js";
import { stubConfigSILAM } from "./adapters/silam.js";
import { findSilamWeatherEntity } from "./utils/silam.js";

import {
  PP_POSSIBLE_CITIES,
  DWD_REGIONS,
  ALLERGEN_TRANSLATION,
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

const getStubConfig = (integration) =>
  integration === "dwd"
    ? stubConfigDWD
    : integration === "peu"
      ? stubConfigPEU
      : integration === "silam"
        ? stubConfigSILAM
        : stubConfigPP;

class PollenPrognosCardEditor extends LitElement {
  get debug() {
    // return true;
    return Boolean(this._config.debug);
  }

  _hasSilamWeatherEntity(location) {
    if (
      !this._hass ||
      !this._hass.states ||
      typeof this._hass.states !== "object"
    )
      return false;
    if (!location) {
      // Fallback: Hitta alla möjliga platser (unika, sorterade)
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
      if (candidates.length > 0) {
        if (this.debug)
          console.debug(
            "[Editor] _hasSilamWeatherEntity: using fallback location",
            candidates[0],
          );
        return true;
      }
      if (this.debug)
        console.debug("[Editor] _hasSilamWeatherEntity: no candidates");
      return false;
    }
    const lang = this._config?.date_locale?.split("-")[0] || "en";
    const suffixes =
      silamAllergenMap.weather_suffixes?.[lang] ||
      silamAllergenMap.weather_suffixes?.en ||
      [];
    const loc = location.toLowerCase();
    for (const suffix of suffixes) {
      const entityId = `weather.silam_pollen_${loc}_${suffix}`;
      if (entityId in this._hass.states) return true;
    }
    // Fallback: om det finns något weather.silam_pollen_{loc}_*
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
    const rawKeys =
      this._config.integration === "dwd"
        ? stubConfigDWD.allergens
        : this._config.integration === "peu"
          ? stubConfigPEU.allergens
          : this._config.integration === "silam"
            ? stubConfigSILAM.allergens
            : stubConfigPP.allergens;

    // Börja bygga nytt phrases-objekt
    const full = {};
    const short = {};

    // Använd canonical nyckel för lookup i locale-filerna
    rawKeys.forEach((raw) => {
      const normKey = normalize(raw); // ex 'alm' eller 'erle'
      const canonKey = ALLERGEN_TRANSLATION[normKey] || normKey; // t.ex. 'alder'
      full[raw] = t(`editor.phrases_full.${canonKey}`, lang);
      short[raw] = t(`editor.phrases_short.${canonKey}`, lang);
    });

    // Levels och days hämtas precis som tidigare
    const numLevels =
      this._config.integration === "dwd"
        ? 4
        : this._config.integration === "peu"
          ? 5
          : this._config.integration === "silam"
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

  get _lang() {
    return detectLang(this._hass, this._config.date_locale);
  }

  _t(key) {
    return t(`editor.${key}`, this._lang);
  }

  constructor() {
    super();
    // Sätt ALLT till neutrala värden, oavsett state på this._hass eller this._config
    this._userConfig = {};
    this._integrationExplicit = false;
    this._thresholdExplicit = false;
    // this._config = stubConfigPP;
    this._config = {}; // Tomt – blir ändå satt av setConfig eller set hass
    this.installedCities = [];
    this.installedPeuLocations = [];
    this.installedSilamLocations = [];
    this._prevIntegration = undefined;
    this.installedRegionIds = [];
    this._initDone = false;
    // Säkra att _selectedPhraseLang alltid får fallback om ingen hass eller locale finns
    this._selectedPhraseLang = "sv";
    this._allergensExplicit = false;
    this._origAllergensSet = false;
    this._userAllergens = null;
    this._tapType = "none";
    this._tapEntity = "";
    this._tapNavigation = "";
    this._tapService = "";
    this._tapServiceData = "";
  }

  setConfig(config) {
    try {
      if (this.debug) console.debug("[Editor] ▶️ setConfig INCOMING:", config);
      if (config.phrases) this._userConfig.phrases = config.phrases;

      // 1. Identifiera stub-längd och skapa kopia av inkommande config
      const stubLen =
        config.integration === "dwd"
          ? stubConfigDWD.allergens.length
          : config.integration === "peu"
            ? stubConfigPEU.allergens.length
            : config.integration === "silam"
              ? stubConfigSILAM.allergens.length
              : stubConfigPP.allergens.length;
      const incoming = { ...config };

      // Insert default for levels_* if missing
      Object.entries(LEVELS_DEFAULTS).forEach(([key, val]) => {
        if (!(key in incoming)) {
          incoming[key] = val;
        }
      });

      // 2. Om användaren tidigare valt färre allergener än stub, spara undan dessa
      if (
        Array.isArray(config.allergens) &&
        config.allergens.length < stubLen
      ) {
        this._userConfig.allergens = [...config.allergens];
        this._allergensExplicit = true;
        if (this.debug)
          console.debug(
            "[Editor] saved user-chosen allergens:",
            this._userConfig.allergens,
          );
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
      const stubThresh = (
        incoming.integration === "dwd"
          ? stubConfigDWD
          : incoming.integration === "peu"
            ? stubConfigPEU
            : incoming.integration === "silam"
              ? stubConfigSILAM
              : stubConfigPP
      ).pollen_threshold;
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
      const stubLocale = (
        incoming.integration === "dwd"
          ? stubConfigDWD
          : incoming.integration === "peu"
            ? stubConfigPEU
            : incoming.integration === "silam"
              ? stubConfigSILAM
              : stubConfigPP
      ).date_locale;
      if (!this._localeExplicit && incoming.date_locale === stubLocale) {
        if (this.debug) console.debug("[Editor] dropped stub date_locale");
        delete incoming.date_locale;
      }

      // 7. Slå ihop userConfig med nya inkommande värden EN gång (alltid userConfig = det senaste)
      this._userConfig = deepMerge(this._userConfig, incoming);

      // 8. Sätt explicit-flaggor
      this._thresholdExplicit =
        this._userConfig.hasOwnProperty("pollen_threshold");
      this._allergensExplicit = this._userConfig.hasOwnProperty("allergens");
      this._integrationExplicit =
        this._userConfig.hasOwnProperty("integration");
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
          all.some(
            (id) =>
              typeof id === "string" && id.startsWith("sensor.silam_pollen_"),
          )
        ) {
          integration = "silam";
        }
        this._userConfig.integration = integration;
        if (this.debug)
          console.debug("[Editor] auto-detected integration:", integration);
      }

      // 9.1 Sätt default mode för silam om inte satt
      if (integration === "silam" && !this._userConfig.mode) {
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
      merged.allergens = Array.isArray(this._userConfig.allergens)
        ? this._userConfig.allergens
        : baseStub.allergens;
      //
      // 13. Lägg till typ och integration
      merged.integration = integration;
      merged.type = "custom:pollenprognos-card";
      this._config = merged;
      this._prevIntegration = integration;

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
    } catch (e) {
      console.error("pollenprognos-card-editor: Fel i setConfig:", e, config);
      throw e;
    }
  }

  set hass(hass) {
    if (this._hass === hass) return; // Avoid unnecessary work
    this._hass = hass;
    const explicit = this._integrationExplicit;

    // Hitta alla sensor-ID för PP, DWD, PEU och SILAM
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
    // 1) Autodetektera integration om användaren inte valt själv
    let integration = this._userConfig.integration;
    if (!explicit) {
      if (ppStates.length) integration = "pp";
      else if (peuStates.length) integration = "peu";
      else if (dwdStates.length) integration = "dwd";
      else if (silamStates.length) integration = "silam";
      this._userConfig.integration = integration;
    }

    // 1.1) Sätt default mode för silam om inte satt
    if (integration === "silam" && !this._userConfig.mode) {
      this._userConfig.mode = "daily";
    }

    // 2) Slå ihop stub + användar-config
    const base =
      integration === "dwd"
        ? stubConfigDWD
        : integration === "peu"
          ? stubConfigPEU
          : integration === "silam"
            ? stubConfigSILAM
            : stubConfigPP;

    // Bygg merged-objekt (det är denna rad som saknas)
    let merged = deepMerge(base, this._userConfig);

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
    if (!deepEqual(this._config, merged)) {
      this._config = merged;

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
      const lang =
        (this.config &&
          this.config.date_locale &&
          this.config.date_locale.slice(0, 2)) ||
        (this._hass && this._hass.language) ||
        "en";

      const pollenAllergens = [
        "alder",
        "birch",
        "grass",
        "hazel",
        "mugwort",
        "olive",
        "ragweed",
      ];

      if (this.debug) {
        // Logga mapping för samtliga språk
        console.debug("[SilamAllergenMap.mapping]", silamAllergenMap.mapping);

        // Logga vilka engelska allergener som används för filtrering
        console.debug("[pollenAllergens]", pollenAllergens);

        // Bygg upp och logga ALLA möjliga allergen-slugs per språk/allergen
        for (const [lang, langMap] of Object.entries(
          silamAllergenMap.mapping,
        )) {
          for (const [localSlug, engAllergen] of Object.entries(langMap)) {
            console.debug(`[Mapping] ${lang}: ${localSlug} → ${engAllergen}`);
          }
        }

        // Logga vilka slugs som räknas som giltiga för denna omgång
        const debugSlugs = Object.values(silamAllergenMap.mapping).flatMap(
          (langMap) =>
            Object.entries(langMap)
              .filter(([localSlug, engAllergen]) =>
                pollenAllergens.includes(engAllergen),
              )
              .map(([localSlug]) => localSlug),
        );
        console.debug("[SilamValidAllergenSlugs]", debugSlugs);
      }

      const SilamValidAllergenSlugs = new Set(
        Object.values(silamAllergenMap.mapping).flatMap((langMap) =>
          Object.entries(langMap)
            .filter(([localSlug, engAllergen]) =>
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
              if (!match) {
                if (this.debug) {
                  console.debug("[Filter] Skip (no match):", s.entity_id);
                }
                return false;
              }
              const rawLocation = match[1];
              const allergenSlug = match[2];

              if (this.debug) {
                console.debug(
                  "[Filter] entity_id:",
                  s.entity_id,
                  "| rawLocation:",
                  rawLocation,
                  "| allergenSlug:",
                  allergenSlug,
                  "| validAllergen:",
                  SilamValidAllergenSlugs.has(allergenSlug),
                );
              }

              return SilamValidAllergenSlugs.has(allergenSlug);
            })
            .map((s) => {
              const match =
                typeof s.entity_id === "string"
                  ? s.entity_id.match(/^sensor\.silam_pollen_(.*)_([^_]+)$/)
                  : null;
              const rawLocation = match ? match[1].replace(/^[-\s]+/, "") : "";
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

              if (this.debug) {
                console.debug(
                  "[Map] entity_id:",
                  s.entity_id,
                  "| rawLocation:",
                  rawLocation,
                  "| slugified locationSlug:",
                  locationSlug,
                  "| title:",
                  title,
                );
              }

              return [locationSlug, title];
            }),
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
      }

      // 5) Dispatch’a så att HA:r-editorn ritar om formuläret med nya värden
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._config },
          bubbles: true,
          composed: true,
        }),
      );
    }

    this.requestUpdate();
    this._initDone = true;
  }

  _onAllergenToggle(allergen, checked) {
    const set = new Set(this._config.allergens);
    checked ? set.add(allergen) : set.delete(allergen);
    this._updateConfig("allergens", [...set]);
  }

  _updateConfig(prop, value) {
    if (this.debug)
      console.debug("[Editor] _updateConfig – prop:", prop, "value:", value);

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
        delete newUser.mode;
        delete newUser.allergens;
        delete newUser.days_to_show;
        delete newUser.pollen_threshold;
        this._allergensExplicit = false;
      }
      const base =
        newInt === "dwd"
          ? stubConfigDWD
          : newInt === "peu"
            ? stubConfigPEU
            : newInt === "silam"
              ? stubConfigSILAM
              : stubConfigPP;

      cfg = deepMerge(base, newUser);
      cfg.integration = newInt;
    } else {
      cfg = { ...this._config, [prop]: value };
      // Om vi just bytte mode för silam, och days_to_show ska justeras, inkludera det också:
      if (this._config.integration === "silam" && prop === "mode") {
        if (value === "hourly" || value === "twice_daily") {
          cfg.days_to_show = 8;
          cfg.show_empty_days = false;
          // cfg.show_empty_days = false;
        } else if (value === "daily") {
          cfg.days_to_show = 5;
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
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._config },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this._config = cfg;
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
          ? stubConfigPEU.allergens
          : c.integration === "silam"
            ? stubConfigSILAM.allergens
            : stubConfigPP.allergens;

    const numLevels =
      c.integration === "dwd" ? 4 : c.integration === "peu" ? 5 : 7;

    // dynamiska parametrar för pollen_threshold-slider
    const thresholdParams =
      c.integration === "dwd"
        ? { min: 0, max: 3, step: 0.5 }
        : c.integration === "peu"
          ? { min: 0, max: 4, step: 1 }
          : { min: 0, max: 6, step: 1 };

    const SORT_VALUES = [
      "value_ascending",
      "value_descending",
      "name_ascending",
      "name_descending",
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
        <div class="preset-buttons">
          <mwc-button @click=${() => this._resetAll()}>
            ${this._t("preset_reset_all")}
          </mwc-button>
        </div>

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
                    ${this.installedCities.map(
                      (city) =>
                        html`<mwc-list-item .value=${city}
                          >${city}</mwc-list-item
                        >`,
                    )}
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
                      ${this.installedPeuLocations.map(
                        ([slug, title]) =>
                          html`<mwc-list-item .value=${slug}
                            >${title}</mwc-list-item
                          >`,
                      )}
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
                        ${this.installedSilamLocations.map(
                          ([slug, title]) =>
                            html`<mwc-list-item .value=${slug}
                              >${title}</mwc-list-item
                            >`,
                        )}
                      </ha-select>
                    </ha-formfield>
                  `
                : html`
                    <ha-formfield label="${this._t("region_id")}">
                      <ha-select
                        .value=${c.region_id || ""}
                        @selected=${(e) =>
                          this._updateConfig("region_id", e.target.value)}
                        @closed=${(e) => e.stopPropagation()}
                      >
                        ${this.installedRegionIds.map(
                          (id) =>
                            html`<mwc-list-item .value=${id}>
                              ${id} — ${DWD_REGIONS[id] || id}
                            </mwc-list-item>`,
                        )}
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
            <details>
              <summary>${this._t("levels_header")}</summary>
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
                          placeholder="${this._t("levels_colors_placeholder")}"
                          @input=${(e) => {
                            const newColors = [...c.levels_colors];
                            newColors[i] = e.target.value;
                            this._updateConfig("levels_colors", newColors);
                          }}
                          style="width: 100px;"
                        ></ha-textfield>
                        <mwc-button
                          dense
                          outlined
                          title="${this._t("levels_reset")}"
                          @click=${() => {
                            const newColors = [...c.levels_colors];
                            newColors[i] = LEVELS_DEFAULTS.levels_colors[i];
                            this._updateConfig("levels_colors", newColors);
                          }}
                          style="margin-left: 8px;"
                          >↺</mwc-button
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
                    .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                      c.levels_empty_color,
                    )
                      ? c.levels_empty_color
                      : "#cccccc"}
                    @input=${(e) =>
                      this._updateConfig("levels_empty_color", e.target.value)}
                    style="width: 28px; height: 28px; border: none; background: none;"
                  />
                  <ha-textfield
                    .value=${c.levels_empty_color}
                    placeholder="${this._t("levels_colors_placeholder")}"
                    @input=${(e) =>
                      this._updateConfig("levels_empty_color", e.target.value)}
                    style="width: 100px;"
                  ></ha-textfield>
                  <mwc-button
                    dense
                    outlined
                    title="${this._t("levels_reset")}"
                    @click=${() =>
                      this._updateConfig(
                        "levels_empty_color",
                        LEVELS_DEFAULTS.levels_empty_color,
                      )}
                    style="margin-left: 8px;"
                    >↺</mwc-button
                  >
                </div>
              </ha-formfield>

              <ha-formfield label="${this._t("levels_gap_color")}">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <input
                    type="color"
                    .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                      c.levels_gap_color,
                    )
                      ? c.levels_gap_color
                      : "#ffffff"}
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
                  <mwc-button
                    dense
                    outlined
                    title="${this._t("levels_reset")}"
                    @click=${() =>
                      this._updateConfig(
                        "levels_gap_color",
                        LEVELS_DEFAULTS.levels_gap_color,
                      )}
                    style="margin-left: 8px;"
                    >↺</mwc-button
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
                <mwc-button
                  dense
                  outlined
                  title="${this._t("levels_reset")}"
                  @click=${() =>
                    this._updateConfig(
                      "levels_thickness",
                      LEVELS_DEFAULTS.levels_thickness,
                    )}
                  style="margin-left: 8px;"
                  >↺</mwc-button
                >
              </ha-formfield>

              <ha-formfield label="${this._t("levels_gap")}">
                <ha-slider
                  min="0"
                  max="20"
                  step="1"
                  .value=${c.levels_gap}
                  @input=${(e) =>
                    this._updateConfig("levels_gap", Number(e.target.value))}
                  style="width: 120px;"
                ></ha-slider>
                <ha-textfield
                  type="number"
                  .value=${c.levels_gap}
                  @input=${(e) =>
                    this._updateConfig("levels_gap", Number(e.target.value))}
                  style="width: 80px;"
                ></ha-textfield>
                <mwc-button
                  dense
                  outlined
                  title="${this._t("levels_reset")}"
                  @click=${() =>
                    this._updateConfig(
                      "levels_gap",
                      LEVELS_DEFAULTS.levels_gap,
                    )}
                  style="margin-left: 8px;"
                  >↺</mwc-button
                >
              </ha-formfield>

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
                ${c.integration === "silam" && c.mode === "twice_daily"
                  ? this._t("to_show_columns")
                  : c.integration === "silam" && c.mode === "hourly"
                    ? this._t("to_show_hours")
                    : this._t("to_show_days")}
              </div>
              <div class="slider-value">${c.days_to_show}</div>
              <ha-slider
                min="0"
                max="${c.integration === "silam" &&
                (c.mode === "hourly" || c.mode === "twice_daily")
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
          <div class="allergens-group">
            ${allergens.map(
              (key) => html`
                <ha-formfield .label=${key}>
                  <ha-checkbox
                    .checked=${c.allergens.includes(key)}
                    @change=${(e) =>
                      this._onAllergenToggle(key, e.target.checked)}
                  ></ha-checkbox>
                </ha-formfield>
              `,
            )}
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
            <mwc-button
              @click=${() => this._resetPhrases(this._selectedPhraseLang)}
            >
              ${this._t("phrases_apply")}
            </mwc-button>
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
