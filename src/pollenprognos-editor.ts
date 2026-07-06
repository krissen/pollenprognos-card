// src/pollenprognos-editor.ts
import {
  html,
  css,
  type TemplateResult,
  type PropertyDeclarations,
} from "lit";
import { detectLang } from "./i18n.js";
import { deepEqual } from "./utils/confcompare.js";
import {
  LEVELS_DEFAULTS,
  ICON_IN_RING_DEFAULT_THICKNESS,
} from "./utils/levels-defaults.js";
import { COSMETIC_FIELDS } from "./constants.js";

// Shared editor base (deepMerge, section methods, helpers)
import {
  PollenEditorBase,
  deepMerge,
  sectionResetStyles,
  editorControlStyles,
} from "./editor/base.js";

// Adapter registry (stub config lookup) + direct adapter imports for constants
import { getStubConfig } from "./adapter-registry.js";
import { stubConfigPP, discoverPpSensors, extractCitySlugFromEntityId as extractPpCitySlugFromEntityId } from "./adapters/pp.js";
import { discoverDwdSensors, DWD_ENTITY_ID_RE } from "./adapters/dwd.js";
import { PEU_ALLERGENS, extractPeuLocationSlugFromEntityId } from "./adapters/peu.js";
import { findAtmoLocationBySlug } from "./adapters/atmo.js";
import { GPL_BASE_ALLERGENS, discoverGplSensors, discoverGplAllergens } from "./adapters/gpl/index.js";
import { GP_BASE_ALLERGENS, discoverGpSensors, discoverGpAllergens } from "./adapters/gp/index.js";
import { discoverMswSensors } from "./adapters/msw.js";
import { discoverIrmkmiSensors } from "./adapters/irmkmi.js";
import {
  discoverSilamSensors,
  resolveDiscoveredLocation,
} from "./utils/silam.js";
import {
  findLocationBySlug,
  type DeviceDiscovery,
} from "./utils/adapter-helpers.js";
import { slugify } from "./utils/slugify.js";
import { formatNumberForInput } from "./utils/number-format.js";
import {
  detectIntegrationStates,
  pickIntegration,
  detectedIntegrationIds,
} from "./utils/autodetect.js";

import {
  PP_POSSIBLE_CITIES,
  DWD_REGIONS,
} from "./constants.js";

import silamAllergenMap from "./adapters/silam_allergen_map.json";
import type { HomeAssistant } from "./types/home-assistant.js";
import type { CardConfig, RawCardConfig } from "./types/config.js";
import type { InstalledLocation } from "./editor/types.js";
import type { DetectionResult } from "./utils/autodetect.js";

/**
 * Map a discovery result's `locations` Map into the editor's `[key, label]`
 * installed-location list. Extracted so the (many) discovery blocks below share
 * one typed conversion instead of repeating an inline `.map` whose element type
 * is lost when the discovery object arrives from the still-untyped autodetect
 * module. Output is identical to the previous inline expression.
 */
function discoveryToLocations(discovery: {
  locations: Map<string, { label: string }>;
}): InstalledLocation[] {
  return Array.from(discovery.locations.entries()).map(
    ([key, loc]) => [key, loc.label] as InstalledLocation,
  );
}

class PollenPrognosCardEditor extends PollenEditorBase {
  // The base declares `_config`/`_userConfig` as optional (subclasses provide
  // them). The card editor initializes both in its constructor and treats them
  // as always-present, so narrow them to required here to match that invariant
  // and avoid threading `?.`/`!` through the (very config-heavy) methods.
  override _config!: CardConfig;
  override _userConfig!: Record<string, unknown>;

  // Card-editor-only reactive/working state. Fields the base already owns
  // (hass/_tapType/installed*Locations/...) are NOT re-declared here; only this
  // subclass's own members are.
  declare installedCities: string[];
  declare installedRegionIds: string[];
  // NOTE: `installedLocations` is read once in setConfig's SILAM auto-select
  // branch but is never assigned anywhere (a latent bug preserved verbatim in
  // this conversion). Declared optional so the read type-checks; the access
  // site keeps the original throw-on-undefined behaviour via a non-null
  // assertion.
  declare installedLocations?: InstalledLocation[];
  declare _integrationExplicit: boolean;
  declare _thresholdExplicit: boolean;
  declare _prevIntegration?: string;
  declare _initDone: boolean;
  declare _allergensExplicit: boolean;
  declare _origAllergensSet: boolean;
  declare _userAllergens: string[] | null;
  declare _daysExplicit?: boolean;
  declare _localeExplicit?: boolean;

  // _resetAll is inherited from PollenEditorBase. The card editor overrides
  // to also clear _userConfig before delegating to the base implementation.
  override _resetAll(): void {
    if (this.debug) console.debug("[Editor] resetAll");
    this._userConfig = {};
    super._resetAll();
  }


  static override get properties(): PropertyDeclarations {
    return {
      _config: { type: Object },
      hass: { type: Object },
      installedCities: { type: Array },
      installedRegionIds: { type: Array },
      installedPpLocations: { type: Array },
      installedDwdLocations: { type: Array },
      _initDone: { type: Boolean },
      _selectedPhraseLang: { state: true },
      _tapType: { type: String },
      _tapEntity: { type: String },
      _tapNavigation: { type: String },
      _tapService: { type: String },
      _tapServiceData: { type: String },
    };
  }

  constructor() {
    super();
    // Sätt ALLT till neutrala värden, oavsett state på this._hass eller this._config
    this._userConfig = {};
    this._integrationExplicit = false;
    this._thresholdExplicit = false;
    // Tracks whether this editor session auto-shifted levels_thickness
    // due to icon_in_ring toggle. Lets the reverse toggle restore the
    // user's pre-shift value safely, without snapping a value the user
    // happened to set manually to match a default.
    this._thicknessAutoShifted = false;
    this._config = {} as CardConfig; // Tomt – blir ändå satt av setConfig eller set hass
    this.installedCities = [];
    this.installedPeuLocations = [];
    this.installedSilamLocations = [];
    this.installedKleenexLocations = [];
    this.installedAtmoLocations = [];
    this.installedMswLocations = [];
    this.installedIrmkmiLocations = [];
    this._prevIntegration = undefined;
    this.installedRegionIds = [];
    this.installedPpLocations = [];
    this.installedDwdLocations = [];
    this._initDone = false;
    // _selectedPhraseLang holds only the user's explicit dropdown choice; the
    // displayed/applied language is derived at render time from it or from
    // detectLang(hass, date_locale), so it is never auto-seeded here.
    this._allergensExplicit = false;
    this._origAllergensSet = false;
    this._userAllergens = null;
    this._tapType = "none";
    this._tapEntity = "";
    this._tapNavigation = "";
    this._tapService = "";
    this._tapServiceData = "";
  }

  override setConfig = (config: RawCardConfig): void => {
    try {

      if (this.debug) console.debug("[Editor] ▶️ setConfig INCOMING:", config);
      // Bootstrap the icon-in-ring auto-shift flag from the incoming
      // config so the disable-time restore works across editor
      // sessions. Heuristic: a config landing with icon_in_ring=true
      // and levels_thickness at (or unset and defaulting to) the
      // icon-in-ring default looks like the result of a prior
      // auto-shift, so the next disable should swap back to the
      // normal default. The opposite (user explicitly chose the
      // icon-in-ring default value) is rare enough that this is a
      // sensible default. Manual edits to thickness later in the
      // session still clear the flag via _updateConfig.
      const incomingThickness =
        config.levels_thickness ?? LEVELS_DEFAULTS.levels_thickness;
      this._thicknessAutoShifted =
        config.icon_in_ring === true &&
        incomingThickness === ICON_IN_RING_DEFAULT_THICKNESS;
      if (config.phrases) this._userConfig.phrases = config.phrases;

      // 1. Identify stub values and clone incoming config
      // Normalize integration to lowercase (user may type "SILAM" in YAML)
      const incoming = { ...config } as CardConfig;
      if (typeof incoming.integration === "string") {
        incoming.integration = incoming.integration.toLowerCase();
      }
      const baseDefaults = getStubConfig(incoming.integration || "pp") || getStubConfig("pp")!;
      const stubAllergens = baseDefaults.allergens;
      

      // Insert default for levels_* if missing
      Object.entries(LEVELS_DEFAULTS).forEach(([key, val]) => {
        if (!(key in incoming)) {
          incoming[key] = val;
        }
      });

      // 2. Save user-provided allergens if they differ from defaults  
      // OR if allergens were previously explicit (user made changes)
      
      if (
        Array.isArray(config.allergens) &&
        (!deepEqual(config.allergens, stubAllergens) || this._allergensExplicit)
      ) {
        this._userConfig.allergens = [...config.allergens];
        this._allergensExplicit = true;
        if (this.debug)
          console.debug(
            "[Editor] saved user-chosen allergens:",
            this._userConfig.allergens,
          );
      } else {
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
      const stubThresh = (getStubConfig(incoming.integration) || getStubConfig("pp")!).pollen_threshold;
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
      const incomingInt = config.integration as string | undefined;
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
      const stubLocale = (getStubConfig(incoming.integration) || getStubConfig("pp")!).date_locale;
      if (!this._localeExplicit && incoming.date_locale === stubLocale) {
        if (this.debug) console.debug("[Editor] dropped stub date_locale");
        delete incoming.date_locale;
      }

      // 6.1. Don't overwrite explicit user allergens with incoming allergens
      // If we already have user allergens saved, only overwrite if incoming is explicitly different
      
      if (
        this._userConfig.allergens &&
        incoming.allergens &&
        deepEqual(incoming.allergens, this._userConfig.allergens)
      ) {
        // Incoming allergens are same as what we have, drop them to avoid unnecessary updates
        if (this.debug)
          console.debug(
            "[Editor] dropping incoming allergens (same as saved)",
          );
        delete incoming.allergens;
      } else if (this._allergensExplicit && incoming.allergens) {
        // We have explicit allergens and incoming is different/exists
        // Only overwrite if incoming explicitly differs from stub (is a user choice)
        const stubAllergens = (getStubConfig(
          incoming.integration || this._config.integration || "pp",
        ) || getStubConfig("pp")!).allergens;
        
        if (deepEqual(incoming.allergens, stubAllergens)) {
          // Incoming matches stub, so it's not a user choice - keep our explicit allergens
          if (this.debug)
            console.debug(
              "[Editor] dropping incoming allergens (matches stub, keeping explicit)",
            );
          delete incoming.allergens;
        } else {
        }
      } else {
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

      // 9. Bestäm integration (userConfig > tidigare config > autodetect).
      // Autodetect uses the shared module (src/utils/autodetect.js), so this
      // path now matches the card and detects PLU + Kleenex too (it previously
      // missed PLU).
      let integration: string | undefined =
        this._userConfig.integration !== undefined
          ? (this._userConfig.integration as string)
          : this._config.integration;

      if (!this._integrationExplicit && this._hass) {
        const detection: DetectionResult = detectIntegrationStates(this._hass, {
          debug: this.debug,
        });
        const picked = pickIntegration(detection, { explicit: false });
        // pickIntegration yields undefined when nothing is detected and no
        // prior integration is set; fall back to "pp" so we never persist an
        // undefined integration that could override the stub during merges.
        integration = picked || integration || "pp";
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
      const baseStub = getStubConfig(integration) || getStubConfig("pp")!;
      const merged = deepMerge(baseStub, this._userConfig) as CardConfig;

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
        merged.pollen_threshold = baseStub.pollen_threshold as number;
        if (this.debug)
          console.debug(
            "[Editor] reset pollen_threshold to stub:",
            baseStub.pollen_threshold,
          );
      }

      // 12. Alltid använd explicit userConfig.allergens om det finns, annars stub
      
      merged.allergens = (
        Array.isArray(this._userConfig.allergens)
          ? this._userConfig.allergens
          : baseStub.allergens
      ) as string[];
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
        this._config.days_to_show = baseStub.days_to_show as number;
        if (this.debug)
          console.debug(
            "[Editor] reset days_to_show to stub:",
            baseStub.days_to_show,
          );
      }

      // 15. Autofyll date_locale om inte explicit, baserat på HA language
      if (!this._localeExplicit) {
        const detected = detectLang(this._hass, undefined);
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
        // PP: use discovery helper, fall back to PP_POSSIBLE_CITIES filter.
        // Sort by label alphabetically so the dropdown order is stable across
        // HA restarts (Map iteration order tracks hass-registry insertion).
        const ppDiscovery = discoverPpSensors(this._hass, false);
        if (ppDiscovery.locations.size > 0) {
          this.installedPpLocations = Array.from(ppDiscovery.locations.entries())
            .map(([key, loc]) => [key, loc.label] as InstalledLocation)
            .sort(([, a], [, b]) =>
              String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
            );
          this.installedCities = this.installedPpLocations.map(([, label]) => label);
        } else {
          const all = Object.keys(this._hass.states);
          // Use the allergen-suffix whitelist from pp.js so multi-word slugs
          // like "salg_och_viden" don't truncate the city.
          const ppKeys = new Set(
            all
              .map((id) =>
                typeof id === "string" ? extractPpCitySlugFromEntityId(id) : null,
              )
              .filter(Boolean),
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
          this.installedPpLocations = this.installedCities.map((city) => [city, city]);
        }

        // DWD: use discovery helper, fall back to regex-based region IDs.
        // Sort numerically for region-ID keys (legacy tier 3) and by label
        // for config_entry_id keys (tier 1/2), so the dropdown is stable.
        const dwdDiscovery = discoverDwdSensors(this._hass, false);
        if (dwdDiscovery.locations.size > 0) {
          const entries = Array.from(dwdDiscovery.locations.entries())
            .map(([key, loc]) => [key, loc.label] as InstalledLocation);
          const allNumeric = entries.every(([k]) => /^\d+$/.test(String(k)));
          this.installedDwdLocations = allNumeric
            ? entries.sort(([a], [b]) => Number(a) - Number(b))
            : entries.sort(([, a], [, b]) =>
                String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
              );
          this.installedRegionIds = this.installedDwdLocations.map(([key]) => key);
        } else {
          const all = Object.keys(this._hass.states);
          // Pull the trailing region ID from any DWD entity, accepting both
          // bare and HA-device-prefixed shapes (#217). The regex's second
          // capture group is always the numeric region ID, so use it
          // directly instead of splitting on underscores (which would pick
          // up a stray ID from a device-name slug like "_92" mid-string).
          this.installedRegionIds = Array.from(
            new Set(
              all
                .map((id) =>
                  typeof id === "string"
                    ? id.match(DWD_ENTITY_ID_RE)?.[2]
                    : null,
                )
                .filter((v): v is string => Boolean(v)),
            ),
          ).sort((a, b) => Number(a) - Number(b));
          this.installedDwdLocations = this.installedRegionIds.map(
            (id) => [id, `${id} — ${DWD_REGIONS[id] || id}`] as InstalledLocation,
          );
        }
      }
      // 17. Auto-välj city/region om inte explicit
      if (!this._integrationExplicit) {
        if (
          integration === "dwd" &&
          !this._userConfig.region_id &&
          this.installedDwdLocations.length
        ) {
          this._config.region_id = this.installedDwdLocations[0][0];
        }
        if (
          integration === "pp" &&
          !this._userConfig.city &&
          this.installedPpLocations.length
        ) {
          this._config.city = this.installedPpLocations[0][0];
        }
        if (
          integration === "silam" &&
          !this._userConfig.location &&
          this.installedLocations!.length
        ) {
          // installedLocations is declared [string, string][] but the SILAM
          // branch stores the location value; preserve the runtime assignment.
          this._config.location = this.installedLocations![0] as unknown as string;
        }
      }

      if (this.debug)
        console.debug("[Editor] Final _config before dispatch:", this._config);

      // 18. Seed the editor's tap_action working state (shared with the badge).
      this._initInteractionState();

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

      // GPL discovery: run here too because set hass() may fire before setConfig()
      // and auto-detect the wrong integration (e.g., SILAM) if multiple integrations are installed.
      if (this._config.integration === "gpl" && this._hass) {
        const gplDiscovery = discoverGplSensors(this._hass, false);
        this.installedGplLocations = discoveryToLocations(gplDiscovery);
        const gplConfigEntryId = this._config.location || (this.installedGplLocations.length ? this.installedGplLocations[0][0] : null);
        const allGplAllergens = discoverGplAllergens(this._hass, gplConfigEntryId as string, false);
        this.installedGplPlants = allGplAllergens.filter((k: string) => !GPL_BASE_ALLERGENS.includes(k));
      }
      // GP discovery
      if (this._config.integration === "gp" && this._hass) {
        const gpDiscovery = discoverGpSensors(this._hass, false);
        this.installedGpLocations = discoveryToLocations(gpDiscovery);
        const gpConfigEntryId = this._config.location || (this.installedGpLocations.length ? this.installedGpLocations[0][0] : null);
        const allGpAllergens = discoverGpAllergens(this._hass, gpConfigEntryId as string, false);
        this.installedGpPlants = allGpAllergens.filter((k: string) => !GP_BASE_ALLERGENS.includes(k));
      }
      // MSW discovery (same rationale as GPL/GP).
      if (this._config.integration === "msw" && this._hass) {
        const md = discoverMswSensors(this._hass, false);
        this.installedMswLocations = discoveryToLocations(md);
      }

      // IRM KMI discovery (same rationale as GPL/GP/MSW).
      if (this._config.integration === "irmkmi" && this._hass) {
        const id = discoverIrmkmiSensors(this._hass, false);
        this.installedIrmkmiLocations = discoveryToLocations(id);
      }

      // SILAM discovery: run here too for same reason as GPL above
      if (this._config.integration === "silam" && this._hass) {
        const sd = discoverSilamSensors(this._hass, false);
        if (sd.locations.size > 0) {
          this.installedSilamLocations = discoveryToLocations(sd);
        }
      }
    } catch (e) {
      console.error("pollenprognos-card-editor: Fel i setConfig:", e, config);
      throw e;
    }
  };

  set hass(hass: HomeAssistant) {

    if (this._hass === hass) return; // Avoid unnecessary work
    this._hass = hass;
    const explicit = this._integrationExplicit;

    // Shared autodetect (see src/utils/autodetect.js) — the same module the
    // card element and badge use. Destructure local aliases the rest of
    // set hass() already references; the lazy getters feed the installed-
    // location lists below without re-scanning the registry.
    const detection: DetectionResult = detectIntegrationStates(hass, {
      debug: this.debug,
    });
    // ppStates/dwdStates feed the regex fallbacks for the PP/DWD location
    // lists; the discovery objects/getters feed the installed-location lists.
    // Other per-integration state lists are only needed for the pick, which is
    // handled inside the shared module.
    const {
      states: { pp: ppStates, dwd: dwdStates },
      discovery: {
        silam: silamDiscovery,
        atmo: atmoDiscovery,
        gp: gpDiscovery,
      },
      getPpDiscovery,
      getDwdDiscovery,
      getPeuDiscovery,
      getGplDiscovery,
      getMswDiscovery,
      getIrmkmiDiscovery,
    } = detection;

    // Set of integrations that have at least one sensor in this hass. Drives
    // the integration dropdown's two-segment sort order in render(). Now
    // includes PLU and Kleenex — the editor previously diverged from the card
    // and missed them; the shared module unifies every path.
    this._detectedIntegrations = detectedIntegrationIds(detection);

    // 1) Autodetektera integration om användaren inte valt själv.
    // Fall back to "pp" so a no-sensors hass never yields an undefined
    // integration (which would override the stub during merges and leave an
    // invalid id).
    const integration =
      pickIntegration(detection, {
        explicit,
        userIntegration: this._userConfig.integration,
      }) || "pp";
    if (!explicit) {
      this._userConfig.integration = integration;
      if (this.debug)
        console.debug("[Editor] autodetect chosen:", integration);
    }

    // 1.1) GPL discovery — always run so render() and auto-select have data
    // (memoized via the shared detection result; no extra registry scan).
    const gplDiscovery = getGplDiscovery();
    this.installedGplLocations = discoveryToLocations(gplDiscovery);

    if (integration === "gpl") {
      const gplConfigEntryId = this._config.location || (this.installedGplLocations.length ? this.installedGplLocations[0][0] : null);
      const allGplAllergens = discoverGplAllergens(hass, gplConfigEntryId as string, false);
      this.installedGplPlants = allGplAllergens.filter((k: string) => !GPL_BASE_ALLERGENS.includes(k));
    } else {
      this.installedGplPlants = [];
    }

    // 1.2) GP discovery (gpDiscovery already resolved eagerly by the shared
    // detection above and destructured into scope).
    this.installedGpLocations = discoveryToLocations(gpDiscovery);

    if (integration === "gp") {
      const gpConfigEntryId = this._config.location || (this.installedGpLocations.length ? this.installedGpLocations[0][0] : null);
      const allGpAllergens = discoverGpAllergens(hass, gpConfigEntryId as string, false);
      this.installedGpPlants = allGpAllergens.filter((k: string) => !GP_BASE_ALLERGENS.includes(k));
    } else {
      this.installedGpPlants = [];
    }

    // 1.3) MSW discovery (always run so the editor dropdown is populated even
    // when MSW is not the active integration, mirroring GPL/GP).
    const mswDiscovery = getMswDiscovery();
    this.installedMswLocations = discoveryToLocations(mswDiscovery);

    // 1.3b) IRM KMI discovery (always run, same rationale as MSW). Without this,
    // when setConfig() runs before hass is assigned the location dropdown stays
    // empty and the auto-select branch never picks the detected location.
    const irmkmiDiscovery = getIrmkmiDiscovery();
    this.installedIrmkmiLocations = discoveryToLocations(irmkmiDiscovery);

    // 1.2) Set default mode for SILAM and PEU if not specified
    if (
      (integration === "silam" || integration === "peu") &&
      !this._userConfig.mode
    ) {
      this._userConfig.mode = "daily";
    }

    // 2) Slå ihop stub + användar-config
    const base = getStubConfig(integration) || getStubConfig("pp")!;

    // Bygg merged-objekt (det är denna rad som saknas)
    
    const merged = deepMerge(base, this._userConfig) as CardConfig;


    // --- återställ pollen_threshold om användaren inte explicit satt det ---
    if (!this._userConfig.hasOwnProperty("pollen_threshold")) {
      merged.pollen_threshold = base.pollen_threshold as number;
      if (this.debug)
        console.debug(
          "[Editor][hass] reset pollen_threshold to stub:",
          base.pollen_threshold,
        );
    }

    merged.sort = merged.sort || "value_ascending";

    // Strip default LEVELS_DEFAULTS keys so comparison matches setConfig() output
    Object.entries(LEVELS_DEFAULTS).forEach(([key, val]) => {
      if (merged[key] === val) {
        delete merged[key];
      }
    });

    // Only dispatch if config actually changed, to avoid UI blinking/loops
    
    if (!deepEqual(this._config, merged)) {
      this._config = merged;
      // 3) Fyll installerade regioner/städer via discovery helpers

      // PP: device-based discovery with legacy slug fallback (memoized).
      const ppDiscovery = getPpDiscovery() as DeviceDiscovery;
      if (ppDiscovery.locations.size > 0) {
        this.installedPpLocations = discoveryToLocations(ppDiscovery);
        // Legacy compatibility: if config.city is a slug not present as a key,
        // check if it matches via slug extractor and expose it as an extra entry.
        const cfgCity = this._config?.city as string | undefined;
        if (cfgCity && cfgCity !== "manual" && !ppDiscovery.locations.has(cfgCity)) {
          const match = findLocationBySlug(ppDiscovery, cfgCity, {
            slugExtractor: extractPpCitySlugFromEntityId,
          });
          if (match) {
            const [, loc] = match;
            this.installedPpLocations.push([cfgCity, loc.label] as InstalledLocation);
          }
        }
        // Sort by label so dropdown order stays stable across HA restarts
        // (Map iteration order tracks hass-registry insertion).
        this.installedPpLocations.sort(([, a], [, b]) =>
          String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
        );
        // Keep installedCities in sync (used by setConfig legacy path)
        this.installedCities = this.installedPpLocations.map(([, label]) => label);
      } else {
        // Fallback to PP_POSSIBLE_CITIES when discovery yields nothing.
        // Use the allergen-suffix whitelist so multi-word slugs like
        // "salg_och_viden" don't truncate the city.
        const uniqKeys = Array.from(
          new Set(
            ppStates
              .map((id: string) => extractPpCitySlugFromEntityId(id))
              .filter(Boolean),
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
        this.installedPpLocations = this.installedCities.map((city) => [city, city]);
      }

      // DWD: device-based discovery with legacy region_id fallback (memoized).
      const dwdDiscovery = getDwdDiscovery() as DeviceDiscovery;
      if (dwdDiscovery.locations.size > 0) {
        this.installedDwdLocations = discoveryToLocations(dwdDiscovery);
        // Legacy compatibility: if config.region_id is a numeric ID not present as a key,
        // expose it as an extra entry so the saved config remains visible.
        const cfgRegion = this._config?.region_id as string | undefined;
        if (cfgRegion && cfgRegion !== "manual" && !dwdDiscovery.locations.has(cfgRegion)) {
          const match = findLocationBySlug(dwdDiscovery, cfgRegion, {
            slugExtractor: (eid: string) => eid.match(/_(\d+)$/)?.[1] || null,
          });
          if (match) {
            const [, loc] = match;
            this.installedDwdLocations.push([cfgRegion, loc.label] as InstalledLocation);
          }
        }
        // Sort numerically when all keys are digit strings (legacy region IDs),
        // otherwise by label, so dropdown order stays stable across HA restarts.
        const allNumeric = this.installedDwdLocations.every(([k]) =>
          /^\d+$/.test(String(k)),
        );
        this.installedDwdLocations.sort(
          allNumeric
            ? ([a], [b]) => Number(a) - Number(b)
            : ([, a], [, b]) =>
                String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
        );
        // Keep installedRegionIds in sync (used by setConfig legacy path)
        this.installedRegionIds = this.installedDwdLocations.map(([key]) => key);
      } else {
        // Fallback to regex-based region ID extraction
        this.installedRegionIds = Array.from(
          new Set(dwdStates.map((id: string) => id.split("_").pop())),
        ).sort((a, b) => Number(a) - Number(b)) as string[];
        this.installedDwdLocations = this.installedRegionIds.map(
          (id) => [id, `${id} — ${DWD_REGIONS[id] || id}`] as InstalledLocation,
        );
      }

      // PEU: device-based discovery with legacy location slug fallback.
      // Sort by label so the dropdown stays stable across HA restarts (memoized).
      const peuDiscovery = getPeuDiscovery() as DeviceDiscovery;
      if (peuDiscovery.locations.size > 0) {
        this.installedPeuLocations = discoveryToLocations(peuDiscovery).sort(
          ([, a], [, b]) =>
            String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
        );
        // Legacy compatibility: if config.location is a slug not present as a key,
        // expose it as an extra entry so the saved config remains visible.
        const cfgPeuLoc = this._config?.location as string | undefined;
        if (
          cfgPeuLoc &&
          cfgPeuLoc !== "manual" &&
          !peuDiscovery.locations.has(cfgPeuLoc) &&
          integration === "peu"
        ) {
          const match = findLocationBySlug(peuDiscovery, cfgPeuLoc, {
            slugExtractor: extractPeuLocationSlugFromEntityId,
          });
          if (match) {
            const [, loc] = match;
            this.installedPeuLocations.push([cfgPeuLoc, loc.label] as InstalledLocation);
          }
        }
      } else {
        // Fallback to state-based location detection
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
      }
      // Primärt: discovery-baserad SILAM location list
      if (silamDiscovery.locations.size > 0) {
        this.installedSilamLocations = discoveryToLocations(silamDiscovery);

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

                return [locationSlug, title] as InstalledLocation;
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
                .replace(/[\)\s]+(?:Trees|Grass|Weeds|Bomen|Gras|Kruiden|Onkruid|Arbres|Gramin[eé]+s?|Herbac[eé]+s?|Alberi|Graminacee|Erbacee).*$/i, "")
                .replace(/^(?:Trees|Grass|Weeds|Bomen|Gras|Kruiden|Onkruid|Arbres|Gramin[eé]+s?|Herbac[eé]+s?|Alberi|Graminacee|Erbacee)(?:\s.*)?$/i, "")
                .trim();

              // Fallback to locationSlug if cleaning resulted in empty string
              if (!title) {
                title =
                  locationSlug.charAt(0).toUpperCase() + locationSlug.slice(1);
              }

              return [locationSlug, title] as InstalledLocation;
            })
            .filter((entry): entry is InstalledLocation => entry !== null),
        ),
      );

      // Collect Atmo France locations (reuse discovery from autodetect above)
      this.installedAtmoLocations = discoveryToLocations(atmoDiscovery);

      // Compatibility: if the config carries a legacy slug location
      // (e.g. "nice") that matches a discovered instance, expose the slug
      // as an extra dropdown entry so existing configs stay visible and
      // editable. Users can re-select the config_entry_id option to migrate.
      const cfgLoc = this._config?.location as string | undefined;
      if (
        cfgLoc &&
        cfgLoc !== "manual" &&
        !atmoDiscovery.locations.has(cfgLoc)
      ) {
        const matchEntryId = findAtmoLocationBySlug(
          atmoDiscovery as Parameters<typeof findAtmoLocationBySlug>[0],
          cfgLoc,
        );
        if (matchEntryId) {
          const label = atmoDiscovery.locations.get(matchEntryId)!.label;
          this.installedAtmoLocations.push([cfgLoc, label] as InstalledLocation);
        }
      }

      // 4) Auto-välj första region/stad om användaren inte satt något
      if (!this._initDone) {
        if (
          integration === "dwd" &&
          !this._userConfig.region_id &&
          this.installedDwdLocations.length
        ) {
          this._config.region_id = this.installedDwdLocations[0][0];
        }
        if (
          integration === "pp" &&
          !this._userConfig.city &&
          this.installedPpLocations.length
        ) {
          this._config.city = this.installedPpLocations[0][0];
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
        if (
          integration === "gp" &&
          !this._userConfig.location &&
          this.installedGpLocations?.length
        ) {
          this._config.location = this.installedGpLocations[0][0];
        }
        if (
          integration === "msw" &&
          !this._userConfig.location &&
          this.installedMswLocations?.length
        ) {
          this._config.location = this.installedMswLocations[0][0];
        }
        if (
          integration === "irmkmi" &&
          !this._userConfig.location &&
          this.installedIrmkmiLocations?.length
        ) {
          this._config.location = this.installedIrmkmiLocations[0][0];
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
    }

    this.requestUpdate();
    this._initDone = true;
  }

  override _onAllergenToggle = (allergen: string, checked: boolean): void => {

    if (
      this._config?.integration === "peu" &&
      this._config?.mode !== "daily" &&
      allergen !== "allergy_risk" &&
      checked
    ) {
      this._updateConfig("mode", "daily");
    }
    const set = new Set(this._config?.allergens as string[]);
    checked ? set.add(allergen) : set.delete(allergen);

    this._updateConfig("allergens", [...set]);
  };

  override _toggleSelectAllAllergens = (allergens: string[]): void => {
    const current = new Set(this._config?.allergens as string[]);
    const allSelected = allergens.every((a) => current.has(a));
    if (
      this._config?.integration === "peu" &&
      this._config?.mode !== "daily" &&
      !allSelected
    ) {
      this._updateConfig("mode", "daily");
    }
    const newSet = allSelected ? [] : allergens;
    this._updateConfig("allergens", [...newSet]);
  };

  /**
   * Toggle a subset of allergens without affecting other selections.
   * If all subset items are selected → remove only those.
   * Otherwise → add all subset items (keeping existing selections).
   */
  override _toggleAllergenSubset = (subset: string[]): void => {
    const current = new Set(this._config?.allergens as string[]);
    const allSelected = subset.every((a) => current.has(a));
    if (allSelected) {
      subset.forEach((a) => current.delete(a));
    } else {
      subset.forEach((a) => current.add(a));
    }
    this._updateConfig("allergens", [...current]);
  };

  override _updateConfig = (prop: string, value: unknown): void => {
    if (this.debug)
      console.debug("[Editor] _updateConfig – prop:", prop, "value:", value);

    // Handle sort changes - uncheck special sort options when sort is set to 'none'
    if (prop === "sort" && value === "none") {
      const newConfig: CardConfig = { ...this._config, sort: value };

      // Uncheck incompatible special sort options
      if (
        (this._config.integration === "kleenex" || this._config.integration === "gpl" || this._config.integration === "gp") &&
        this._config.sort_category_allergens_first
      ) {
        newConfig.sort_category_allergens_first = false;
        delete this._userConfig.sort_category_allergens_first;
      }
      if (
        (this._config.integration === "peu" ||
          this._config.integration === "atmo" ||
          this._config.integration === "gpl") &&
        this._config.allergy_risk_top
      ) {
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

      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: newConfig },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    // Delegate visual side-effects to the shared base helper. The helper
    // returns handled=true when it has built the final config and the caller
    // should dispatch immediately; it also returns thicknessAutoShifted so
    // the card editor can maintain that session flag.
    {
      const result = this._applyVisualConfigSideEffects(
        prop, value, { ...this._config }
      );
      if (result.thicknessAutoShifted !== null) {
        this._thicknessAutoShifted = result.thicknessAutoShifted;
      }
      if (result.handled) {
        // Sync _userConfig for all mutated keys so set hass() round-trips
        // don't lose the changes.
        const prev = this._config;
        this._config = result.config;
        for (const k of Object.keys(result.config)) {
          if (result.config[k] !== prev[k]) {
            this._userConfig[k] = result.config[k];
          }
        }
        // allergen_color_mode reset clears related userConfig keys
        if (prop === "allergen_color_mode" && value === "default_colors") {
          delete this._userConfig.allergen_colors;
          delete this._userConfig.allergen_outline_color;
          delete this._userConfig.no_allergens_color;
        }
        // levels_inherit_mode→custom clears color overrides from userConfig
        if (prop === "levels_inherit_mode" && value === "custom") {
          delete this._userConfig.levels_gap;
          delete this._userConfig.levels_colors;
          delete this._userConfig.levels_empty_color;
          delete this._userConfig.levels_gap_color;
        }
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: result.config },
            bubbles: true,
            composed: true,
          }),
        );
        return;
      }
    }

    // Specialfall: språkbyte – tvinga sort-dropdown att ritas om
    if (prop === "date_locale") {
      // Spara aktuella värden
      const prevSort = this._config.sort;
      const prevMode = this._config.mode;

      // Sätt nytt språk och nollställ sort och mode tillfälligt för att trigga omritning
      this._config = {
        ...this._config,
        date_locale: value as string,
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
    let cfg: CardConfig;

    if (prop === "integration") {
      const newInt = value as string | undefined;
      const oldInt = this._config.integration;
      if (newInt !== oldInt) {
        delete newUser.city;
        delete newUser.region_id;
        delete newUser.location;
        delete newUser.entity_prefix;
        delete newUser.entity_suffix;
        // entity_weather is SILAM-only; carrying it across an integration
        // switch (or back to SILAM via a different prefix) can silently
        // override the new prefix with a stale weather entity from the
        // previous setup. Reset it alongside the other location fields.
        delete newUser.entity_weather;
        delete newUser.mode;
        delete newUser.allergens;
        delete newUser.days_to_show;
        delete newUser.pollen_threshold;
        delete newUser.allergy_risk_top;
        delete newUser.index_top;
        // Summary block keys (issue #222) are integration-specific; drop them
        // so a switch to a non-supporting integration starts from its stub.
        delete newUser.show_summary_block;
        delete newUser.show_summary_row;
        delete newUser.show_summary_separator;
        delete newUser.show_summary_top_types;
        delete newUser.show_summary_plants_in_season;
        this._allergensExplicit = false;
      }
      const base = getStubConfig(newInt) || getStubConfig("pp")!;

      cfg = deepMerge(base, newUser) as CardConfig;
      cfg.integration = newInt;

      // _userConfig becomes the pruned user-origin config (location/allergen
      // keys for the old integration removed) + the new integration. Assigning
      // newUser keeps _userConfig clean — the generic per-key sync below is
      // skipped for integration changes, since diffing cfg (full new-integration
      // stub) against the old _config would mark stub defaults as user-set.
      newUser.integration = newInt;
      this._userConfig = newUser;
      this._integrationExplicit = true;
    } else {
      cfg = { ...this._config, [prop]: value } as CardConfig;

      // _userConfig is synced to the full set of changed keys below (after all
      // side-effects are applied), so it stays a faithful user-origin view even
      // for generic fields and side-effect keys (entity_prefix/suffix on leaving
      // manual mode, mode->days_to_show, ...). That keeps per-section resets,
      // which derive their payload from _userConfig, from losing or resurrecting
      // stale values before HA's setConfig round-trip.

      // Track explicit allergen changes
      if (prop === "allergens") {
        
        this._userConfig.allergens = value;
        this._allergensExplicit = true;
        
        
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
            const currentAllergens = (this._config.allergens as string[]) || [];
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
      // Clear stale entity_weather when leaving SILAM manual mode. The field
      // is only meaningful in manual mode; left dangling, it can silently
      // re-apply when the user re-enters manual mode (possibly with a
      // different entity_prefix), pulling forecast data from the wrong
      // location. User can re-enter the value next time they need it.
      if (
        this._config.integration === "silam" &&
        prop === "location" &&
        this._config.location === "manual" &&
        value !== "manual" &&
        cfg.entity_weather
      ) {
        cfg.entity_weather = "";
      }
      // Tvinga mode till daily om location saknar weather-entity
      if (this._config.integration === "silam" && prop === "location") {
        if (
          !this._hasSilamWeatherEntity(
            value as string,
            cfg.entity_weather as string,
          )
        ) {
          cfg.mode = "daily";
          cfg.days_to_show = 2;
        }
      }
    }
    cfg.type = this._config.type;

    // Sync _userConfig with every key this edit changed (the edited prop plus
    // any side-effect keys written above), diffed against the pre-edit config.
    // Mirrors the visual-side-effects branch; keeps _userConfig a faithful
    // user-origin view so per-section resets derive correct payloads. Skipped
    // for integration changes: cfg there is the new integration's full stub, so
    // diffing it against the old _config would mark stub defaults as user-set —
    // that branch already set _userConfig to the pruned newUser.
    if (prop !== "integration") {
      for (const k of Object.keys(cfg)) {
        if (!deepEqual(cfg[k], this._config[k])) this._userConfig[k] = cfg[k];
      }
    }

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
  };

  override render(): TemplateResult {
    // Compute locals needed by the inline sections (§3, §4, §7, §8, §9, §10, §11).
    // Sections §1, §2, §5 are rendered via inherited base methods.
    const c = this._editorConfig();
    const allergens = this._currentAllergens();
    const numLevels = this._currentNumLevels();

    if (this.debug) {
      console.debug("[Editor] Current language (lang):", this._lang);
      console.debug("Sort label test:", this._t("sort_value_ascending"));
    }

    return html`
      <div class="card-config">
        <!-- Reset button -->
        ${this._renderTextButton({
          label: this._t("preset_reset_all"),
          onClick: () => this._resetAll(),
        })}

        <!-- §1 Integration & Location -->
        ${this._renderIntegrationSection()}

        <!-- §2 Allergens -->
        ${this._renderAllergensSection()}

        <!-- §3 Card layout (open by default) -->
        <details open>
          <summary>
            ${this._t("summary_card_layout")}
            ${this._renderSectionReset([
              "minimal",
              "minimal_gap",
              "allergens_abbreviated",
              "show_allergen_column",
              "show_text_allergen",
            ])}
          </summary>
          <div class="section-helper">${this._t("helper_card_layout")}</div>
          <ha-formfield label="${this._t("minimal")}">
            <ha-switch
              .checked=${c.minimal}
              @change=${(e: Event) =>
                this._updateConfig("minimal", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
          <div class="field-helper">${this._t("helper_minimal")}</div>
          ${c.minimal === true
            ? html`
                <ha-formfield label="${this._t("minimal_gap")}">
                  <ha-slider
                    min="0"
                    max="100"
                    step="1"
                    .value=${c.minimal_gap ?? 35}
                    @input=${(e: Event) =>
                      this._updateConfig("minimal_gap", Number((e.target as HTMLInputElement).value))}
                    style="width: 120px;"
                  ></ha-slider>
                  ${this._renderNumberField({
                    value: (c.minimal_gap as number) ?? 35,
                    min: 0,
                    max: 100,
                    step: 1,
                    onValue: (n) => this._updateConfig("minimal_gap", n),
                  })}
                </ha-formfield>
                <div class="field-helper">${this._t("helper_minimal_gap")}</div>
              `
            : ""}
          <ha-formfield
            label="${this._t("show_allergen_column")}"
          >
            <ha-checkbox
              .checked=${c.show_allergen_column !== false}
              @change=${(e: Event) =>
                this._updateConfig(
                  "show_allergen_column",
                  (e.target as HTMLInputElement).checked,
                )}
            ></ha-checkbox>
          </ha-formfield>
          <div class="field-helper">${this._t("helper_show_allergen_column")}</div>
          <ha-formfield label="${this._t("show_text_allergen")}">
            <ha-switch
              .checked=${c.show_text_allergen}
              @change=${(e: Event) =>
                this._updateConfig("show_text_allergen", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
          <ha-formfield label="${this._t("allergens_abbreviated")}">
            <ha-switch
              .checked=${c.allergens_abbreviated}
              @change=${(e: Event) =>
                this._updateConfig("allergens_abbreviated", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
        </details>

        <!-- §4 Day display -->
        <details>
          <summary>
            ${this._t("summary_day_display")}
            ${this._renderSectionReset([
              "days_to_show",
              "days_abbreviated",
              "days_boldfaced",
              "days_relative",
              "days_uppercase",
              "show_empty_days",
              "show_no_data_distinct",
              "show_value_numeric",
              "show_value_text",
            ])}
          </summary>
          <div class="section-helper">${this._t("helper_day_display")}</div>

          <div class="subgroup-header">${this._t("subgroup_values")}</div>
          <ha-formfield label="${this._t("show_value_text")}">
            <ha-switch
              .checked=${c.show_value_text}
              @change=${(e: Event) =>
                this._updateConfig("show_value_text", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
          <ha-formfield label="${this._t("show_value_numeric")}">
            <ha-switch
              .checked=${c.show_value_numeric}
              @change=${(e: Event) =>
                this._updateConfig("show_value_numeric", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
          <ha-formfield label="${this._t("show_empty_days")}">
            <ha-switch
              .checked=${c.show_empty_days}
              @change=${(e: Event) =>
                this._updateConfig("show_empty_days", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
          <ha-formfield label="${this._t("show_no_data_distinct")}">
            <ha-switch
              .checked=${c.show_no_data_distinct !== false}
              @change=${(e: Event) =>
                this._updateConfig("show_no_data_distinct", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
          <!-- The level/raw numeric toggle (numeric_value_raw) lives in the
               shared Level circles section now, gated to integrations with a
               raw value (PLU/PEU/SILAM/Kleenex). PEU's legacy
               numeric_state_raw_risk config still works via resolveNumericValue. -->

          <div class="subgroup-header">${this._t("subgroup_day_labels")}</div>
          <ha-formfield label="${this._t("days_relative")}">
            <ha-switch
              .checked=${c.days_relative}
              @change=${(e: Event) =>
                this._updateConfig("days_relative", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
          <ha-formfield label="${this._t("days_abbreviated")}">
            <ha-switch
              .checked=${c.days_abbreviated}
              @change=${(e: Event) =>
                this._updateConfig("days_abbreviated", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
          <ha-formfield label="${this._t("days_uppercase")}">
            <ha-switch
              .checked=${c.days_uppercase}
              @change=${(e: Event) =>
                this._updateConfig("days_uppercase", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
          <ha-formfield label="${this._t("days_boldfaced")}">
            <ha-switch
              .checked=${c.days_boldfaced}
              @change=${(e: Event) =>
                this._updateConfig("days_boldfaced", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </ha-formfield>
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
            <div class="slider-value">${formatNumberForInput(c.days_to_show as number, this._hass)}</div>
            <ha-slider
              min="0"
              max="${(c.integration === "silam" || c.integration === "peu") &&
              c.mode !== "daily"
                ? 8
                : 6}"
              step="1"
              .value=${c.days_to_show}
              @input=${(e: Event) =>
                this._updateConfig("days_to_show", Number((e.target as HTMLInputElement).value))}
            ></ha-slider>
          </div>
        </details>

        <!-- §5 Card appearance -->
        ${this._renderAppearanceSection()}

        <!-- §6 Allergen icons -->
        ${this._renderAllergenIconsSection()}
        <!-- §7 Level circles -->
        ${this._renderLevelCirclesSection()}
        <!-- §8 Icon in ring -->
        ${this._renderIconInRingSection()}

        ${this._renderPhrasesSection()}

        <!-- §10 Interactions -->
        ${this._renderInteractionSection()}

        <!-- §11 Advanced -->
        ${this._renderAdvancedSection()}
      </div>
    `;
  }

  static override get styles() {
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
      ha-selector {
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

      /* Per-section ↺ reset button styles (shared with the badge editor). */
      ${sectionResetStyles}

      /* Own form controls (input/button) replacing HA's removed components. */
      ${editorControlStyles}

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

      /* Section helper text below summary */
      .section-helper {
        font-size: 12px;
        color: var(--secondary-text-color);
        padding: 0 0 8px;
        margin-left: 24px;
        margin-right: 24px;
      }

      /* Subgroup header (uppercase divider inside a section) */
      .subgroup-header {
        text-transform: uppercase;
        font-size: 11px;
        font-weight: 600;
        color: var(--secondary-text-color);
        padding-top: 10px;
        border-top: 1px dashed var(--divider-color, #ccc);
        margin-top: 8px;
        margin-bottom: 4px;
        margin-left: 24px;
        margin-right: 24px;
      }

      /* Inline helper text below a specific field */
      .field-helper {
        font-size: 11px;
        color: var(--secondary-text-color);
        padding: 2px 0 6px;
        margin-left: 24px;
        margin-right: 24px;
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
      /* Numeric input box sizing lives in editorControlStyles (.pp-input.num-field). */
    `;
  }
}

customElements.define("pollenprognos-card-editor", PollenPrognosCardEditor);
