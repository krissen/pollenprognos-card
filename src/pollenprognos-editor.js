// src/pollenprognos-editor.js
import { LitElement, html, css } from "lit";
import { t, detectLang, SUPPORTED_LOCALES } from "./i18n.js";
import { normalize } from "./utils/normalize.js";
import { slugify } from "./utils/slugify.js";

// Stub-config från adaptrar (så att editorn vet vilka fält som finns)
import { stubConfigPP } from "./adapters/pp.js";
import { stubConfigDWD } from "./adapters/dwd.js";
import { stubConfigPEU } from "./adapters/peu.js";
import { stubConfigSILAM } from "./adapters/silam.js";

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

  _resetAll() {
    if (this.debug) console.debug("[Editor] resetAll");
    this._userConfig = {};
    this.setConfig({ integration: this._config.integration });
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
        if (all.some((id) => id.startsWith("sensor.pollen_"))) {
          integration = "pp";
        } else if (
          all.some((id) => id.startsWith("sensor.polleninformation_"))
        ) {
          integration = "peu";
        } else if (all.some((id) => id.startsWith("sensor.pollenflug_"))) {
          integration = "dwd";
        } else if (all.some((id) => id.startsWith("sensor.silam_pollen_"))) {
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
              .filter((id) => id.startsWith("sensor.pollenflug_"))
              .map((id) => id.split("_").pop()),
          ),
        ).sort((a, b) => Number(a) - Number(b));
        const ppKeys = new Set(
          all
            .filter(
              (id) =>
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

      // 19. Dispatch’a så att HA-editorn ritar om formuläret med nya värden
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._config },
          bubbles: true,
          composed: true,
        }),
      );
      this.requestUpdate();
      this._prevIntegration = incomingInt;
      this._initDone = true;
    } catch (e) {
      console.error("pollenprognos-card-editor: Fel i setConfig:", e, config);
      throw e;
    }
  }

  set hass(hass) {
    this._hass = hass;
    const explicit = this._integrationExplicit;

    // Hitta alla sensor-ID för PP, DWD, PEU och SILAM
    const ppStates = Object.keys(hass.states).filter(
      (id) =>
        id.startsWith("sensor.pollen_") && !id.startsWith("sensor.pollenflug_"),
    );
    const dwdStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.pollenflug_"),
    );
    const peuStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.polleninformation_"),
    );
    const silamStates = Object.keys(hass.states).filter((id) =>
      id.startsWith("sensor.silam_pollen_"),
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
          .filter((s) => s.entity_id.startsWith("sensor.polleninformation_"))
          .map((s) => {
            const locationSlug =
              s.attributes.location_slug ||
              s.entity_id
                .replace("sensor.polleninformation_", "")
                .replace(/_[^_]+$/, "");
            const title =
              s.attributes.location_title ||
              s.attributes.friendly_name?.match(/\((.*?)\)/)?.[1] ||
              locationSlug;
            // DEBUG:
            // console.log("[PEU] entity_id:", s.entity_id, "| location_slug:", s.attributes.location_slug, "| selected locationSlug:", locationSlug, "| title:", title);
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
      for (const [lang, langMap] of Object.entries(silamAllergenMap.mapping)) {
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
            if (!s.entity_id.startsWith("sensor.silam_pollen_")) return false;
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
            const match = s.entity_id.match(
              /^sensor\.silam_pollen_(.*)_([^_]+)$/,
            );
            const rawLocation = match ? match[1].replace(/^[-\s]+/, "") : "";
            const locationSlug = slugify(rawLocation);

            let title =
              s.attributes.location_title ||
              (s.attributes.friendly_name
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
    this._initDone = true;

    // 5) Dispatch’a så att HA:r-editorn ritar om formuläret med nya värden
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }),
    );

    this.requestUpdate();
  }

  _onAllergenToggle(allergen, checked) {
    const set = new Set(this._config.allergens);
    checked ? set.add(allergen) : set.delete(allergen);
    this._updateConfig("allergens", [...set]);
  }

  _updateConfig(prop, value) {
    if (this.debug)
      console.debug("[Editor] _updateConfig – prop:", prop, "value:", value);
    const newUser = { ...this._userConfig };
    let cfg;

    if (prop === "integration") {
      const newInt = value;
      const oldInt = this._config.integration;
      if (newInt !== oldInt) {
        delete newUser[newInt === "dwd" ? "city" : "region_id"];
        delete newUser.allergens;
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
        if (value === "hourly" || value === "twice daily") {
          cfg.days_to_show = 8;
        } else if (value === "daily") {
          cfg.days_to_show = 2;
        }
      }
    }
    cfg.type = this._config.type;
    this._config = cfg;
    if (this.debug) console.debug("[Editor] updated _config:", this._config);
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }),
    );
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

    return html`
      <div class="card-config">
        <!-- Återställ-knapp -->
        <div class="preset-buttons">
          <mwc-button @click=${() => this._resetAll()}>
            ${this._t("preset_reset_all")}
          </mwc-button>
        </div>

        <!-- Integration -->
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

        <!-- Stad (PP, PEU) eller Region (DWD) eller plats (SILAM) -->
        ${c.integration === "pp"
          ? html`
              <ha-formfield label="${this._t("city")}">
                <ha-select
                  .value=${c.city || ""}
                  @selected=${(e) => this._updateConfig("city", e.target.value)}
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
                        (id) => html`
                          <mwc-list-item .value=${id}>
                            ${id} — ${DWD_REGIONS[id] || id}
                          </mwc-list-item>
                        `,
                      )}
                    </ha-select>
                  </ha-formfield>
                `}
        <!-- Title toggles -->
        <div style="display:flex; gap:8px; align-items:center;">
          <!-- Hide -->
          <ha-formfield label="${this._t("title_hide")}">
            <ha-checkbox
              .checked=${c.title === false}
              @change=${(e) => {
                if (e.target.checked) {
                  // Sätt HIDE, rensa övrigt
                  this._updateConfig("title", false);
                } else {
                  // Om man avbockar, gå till auto
                  this._updateConfig("title", true);
                }
              }}
            ></ha-checkbox>
          </ha-formfield>
          <!-- Automatic -->
          <ha-formfield label="${this._t("title_automatic")}">
            <ha-checkbox
              .checked=${c.title === true || c.title === undefined}
              @change=${(e) => {
                if (e.target.checked) {
                  this._updateConfig("title", true);
                } else {
                  // Om man avbockar, gå till manual
                  // (töm textruta)
                  this._updateConfig("title", "");
                }
              }}
            ></ha-checkbox>
          </ha-formfield>
        </div>

        <!-- Titel (manuellt) -->
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
              // Om tom: gå till auto
              if (val.trim() === "") {
                this._updateConfig("title", true);
              } else {
                // Spara som string
                this._updateConfig("title", val);
              }
            }}
          ></ha-textfield>
        </ha-formfield>
        <!-- Bakgrundsfärg -->
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
        <!-- Layout-switchar -->
        ${c.integration === "silam"
          ? html`
              <ha-formfield label="${this._t("mode")}">
                <ha-select
                  .value=${c.mode || "daily"}
                  @selected=${(e) => this._updateConfig("mode", e.target.value)}
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
        <ha-formfield label="${this._t("minimal")}">
          <ha-switch
            .checked=${c.minimal}
            @change=${(e) => this._updateConfig("minimal", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="${this._t("allergens_abbreviated")}">
          <ha-switch
            .checked=${c.allergens_abbreviated}
            @change=${(e) =>
              this._updateConfig("allergens_abbreviated", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <!-- Nya switchar för text och värde -->
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

        <!-- Dag-inställningar -->
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

        <!-- Antal dagar / kolumner / timmar -->
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
            max="${c.integration === "silam" && c.mode === "hourly" ? 8 : 6}"
            step="1"
            .value=${c.days_to_show}
            @input=${(e) =>
              this._updateConfig("days_to_show", Number(e.target.value))}
          ></ha-slider>
        </div>

        <!-- Tröskel -->
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

        <!-- Sortering -->
        <ha-formfield label="${this._t("sort")}">
          <ha-select
            .value=${c.sort}
            @selected=${(e) => this._updateConfig("sort", e.target.value)}
            @closed=${(e) => e.stopPropagation()}
          >
            ${[
              "value_ascending",
              "value_descending",
              "name_ascending",
              "name_descending",
            ].map(
              (o) =>
                html`<mwc-list-item .value=${o}
                  >${o.replace("_", " ")}</mwc-list-item
                >`,
            )}
          </ha-select>
        </ha-formfield>

        <!-- Språk-inställning -->
        <ha-formfield label="${this._t("locale")}">
          <ha-textfield
            .value=${c.date_locale}
            @input=${(e) => this._updateConfig("date_locale", e.target.value)}
          ></ha-textfield>
        </ha-formfield>

        <!-- Allergener (detaljerad) -->
        <details>
          <summary>${this._t("allergens")}</summary>
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
        </details>
        <!-- Fraser -->
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

        <!-- Tap Action -->
        <h3>Tap Action</h3>
        <ha-formfield label="Enable tap action">
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

        <!-- Debug -->
        <ha-formfield label="${this._t("debug")}">
          <ha-switch
            .checked=${c.debug}
            @change=${(e) => this._updateConfig("debug", e.target.checked)}
          ></ha-switch>
        </ha-formfield>
      </div>
    `;
  }

  static get styles() {
    return css`
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
      }
      ha-formfield,
      details {
        margin-bottom: 8px;
      }
      .allergens-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      details summary {
        cursor: pointer;
        font-weight: bold;
        margin: 8px 0;
      }
      ha-slider {
        width: 100%;
      }
      ha-select {
        width: 100%;
        --mdc-theme-primary: var(--primary-color);
      }
      .preset-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }
      .slider-row {
        display: grid;
        grid-template-columns: auto 3ch 1fr;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .slider-text {
        /* etikett, naturlig bredd */
      }
      .slider-value {
        /* värdet får alltid 3 teckenplats (t.ex. "0,5" / "1  ") */
        font-family: monospace;
        text-align: right;
        width: 3ch;
      }
      .slider-row ha-slider {
        width: 100%;
      }
    `;
  }
}

customElements.define("pollenprognos-card-editor", PollenPrognosCardEditor);
