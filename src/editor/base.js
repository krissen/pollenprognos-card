// src/editor/base.js
//
// Shared base class for pollenprognos editors (card + badge).
//
// Provides:
//   - deepMerge utility (re-exported)
//   - get debug(), get _lang(), _t()
//   - _buildIntegrationOptions()
//   - _getAllergenDisplayName()
//   - _hasSilamWeatherEntity()
//   - _editorConfig(), _currentAllergens(), _currentNumLevels(), _thresholdParams()
//   - _inheritState() — computed inherit/gap locals for §6/§7
//   - _renderIntegrationSection() — §1 Integration & Location
//   - _renderAllergensSection()   — §2 Allergens
//   - _renderAppearanceSection()  — §5 Card appearance
//   - _renderAllergenIconsSection() — §6 Allergen icons
//   - _renderLevelCirclesSection()  — §7 Level circles
//   - _renderIconInRingSection()    — §8 Icon in ring
//   - _applyVisualConfigSideEffects(prop, value, config) — shared visual side-effects
//   - _resetAll() — reset to stub defaults while preserving location keys
//
// Both editors extend this class. Section methods read from this._config
// and call this._updateConfig / this._hass — both editors must expose those.
//
// _applyVisualConfigSideEffects CONTRACT:
//   - Receives (prop, value, config) where config is a shallow copy of the
//     current _config.
//   - Returns { config, handled } where config is the (possibly mutated) config
//     and handled=true means the caller should dispatch config-changed immediately
//     and return (skipping the normal merge path).
//   - The caller is responsible for writing config back to this._config,
//     updating this._userConfig (if used), and dispatching config-changed.
//   - The method does NOT touch this._config or this._userConfig directly.
//     It operates purely on the passed-in config object and returns it.
//   - The icon_in_ring branch needs the session flag this._thicknessAutoShifted;
//     the caller must maintain that flag based on the returned state.

import { LitElement, html } from "lit";
import { t, detectLang } from "../i18n.js";
import { slugify } from "../utils/slugify.js";
import {
  LEVELS_DEFAULTS,
  convertStrokeWidthToGap,
  NORMAL_DEFAULT_THICKNESS,
  ICON_IN_RING_DEFAULT_THICKNESS,
} from "../utils/levels-defaults.js";
import { getAllAdapterIds } from "../adapter-registry.js";
import {
  discoverSilamSensors,
  resolveDiscoveredLocation,
} from "../utils/silam.js";
import { resolveAllergenPhrase } from "../utils/allergen-label.js";
import { numLevelsForIntegration } from "../utils/level-counts.js";
import { allergenListForIntegration } from "./integration-allergens.js";
import {
  APPEARANCE_RESET_KEYS,
  ALLERGEN_ICONS_RESET_KEYS,
  LEVEL_CIRCLES_RESET_KEYS,
  ICON_IN_RING_RESET_KEYS,
  INTEGRATION_RESET_KEYS,
  ALLERGENS_RESET_KEYS,
  PHRASES_RESET_KEYS,
} from "./reset-registry.js";
import { toCanonicalAllergenKey } from "../constants.js";

import silamAllergenMap from "../adapters/silam_allergen_map.json";
import { renderIntegrationSection } from "./sections/integration.js";
import { renderAllergensSection } from "./sections/allergens.js";
import { renderAppearanceSection } from "./sections/appearance.js";
import { renderAllergenIconsSection } from "./sections/allergen-icons.js";
import { renderLevelCirclesSection } from "./sections/level-circles.js";
import { renderIconInRingSection } from "./sections/icon-in-ring.js";
import { renderPhrasesSection, resetPhrases } from "./sections/phrases.js";
import { renderAdvancedSection } from "./sections/advanced.js";
import { renderInteractionSection } from "./sections/interactions.js";
import {
  renderNumberField,
  renderTextField,
  renderResetButton,
  renderTextButton,
} from "./field-renderers.js";

// deepMerge and the shared style blocks live in ./utils.js; re-exported here so
// the subclasses' `import { deepMerge, sectionResetStyles, editorControlStyles }
// from "./editor/base.js"` keeps working unchanged.
export {
  deepMerge,
  sectionResetStyles,
  editorControlStyles,
} from "./utils.js";

// ------------------------------------------------------------------ //
// Base class                                                           //
// ------------------------------------------------------------------ //

/**
 * Shared base for the card editor and the badge editor.
 *
 * Subclass contract — every subclass MUST provide:
 *   - reactive `_config` and `_hass` (plus a `hass` setter)
 *   - `_updateConfig(prop, value)` that merges into `_config` and dispatches
 *     the `config-changed` event
 *   - the allergen-list mutators the Allergens section calls:
 *     `_onAllergenToggle(allergen, checked)`,
 *     `_toggleSelectAllAllergens(allergens)`, `_toggleAllergenSubset(subset)`
 *
 * Subclasses MAY override `_showTitleSection()` / `_showModeSelector()` to drop
 * card-only controls (the badge editor returns false for both).
 */
export class PollenEditorBase extends LitElement {
  // ------------------------------------------------------------------
  // Presentation hooks (overridable by subclasses)
  // ------------------------------------------------------------------

  // Whether the Integration/Location section shows the Title sub-group.
  // Cards render a title inside their ha-card; the badge editor overrides
  // this to false (a chrome-less badge has no title).
  _showTitleSection() {
    return true;
  }

  // Whether the Integration/Location section shows the forecast-mode selector
  // (SILAM/PEU daily / twice_daily / hourly...). The badge renders today's
  // value only, so the badge editor overrides this to false.
  _showModeSelector() {
    return true;
  }

  // ------------------------------------------------------------------
  // Simple accessors (shared)
  // ------------------------------------------------------------------

  get debug() {
    // return true;
    return Boolean(this._config?.debug);
  }

  // Editor translations always follow the Home Assistant language.
  get _lang() {
    return detectLang(this._hass);
  }

  _t(key) {
    return t(`editor.${key}`, this._lang);
  }

  // ------------------------------------------------------------------
  // Integration detection helper (SILAM weather entity check)
  // ------------------------------------------------------------------

  _hasSilamWeatherEntity(location, entityWeather = null) {
    if (
      !this._hass ||
      !this._hass.states ||
      typeof this._hass.states !== "object"
    )
      return false;

    // Manual override short-circuit: when the user supplied an explicit
    // entity_weather, it exists in hass.states, AND it's in the weather.*
    // domain, treat it as the weather entity even though discovery wouldn't
    // find one for location="manual". Unblocks the mode selector
    // (daily/twice_daily/hourly) for manual mode. Without the weather.*
    // guard, a stray sensor.* entity could silently enable a mode selector
    // that fails at runtime when the forecast subscription is attempted.
    if (
      location === "manual" &&
      entityWeather &&
      typeof entityWeather === "string" &&
      entityWeather.startsWith("weather.") &&
      this._hass.states[entityWeather]
    ) {
      return true;
    }

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

  // ------------------------------------------------------------------
  // Integration dropdown builder
  // ------------------------------------------------------------------

  /**
   * Build the integration dropdown options as a single visible list with two
   * alphabetically-sorted segments: detected/installed integrations first,
   * non-detected after. With ten supported integrations the legacy fixed
   * order is hard to scan; sorting plus prioritizing the user's actual
   * installs cuts down on bouncing.
   *
   * Detection comes from this._detectedIntegrations, populated by
   * `set hass()`. When hass has not been set yet the set is empty and the
   * dropdown falls back to a single alphabetically-sorted list of all
   * registered adapters.
   */
  _buildIntegrationOptions() {
    const detected = this._detectedIntegrations || new Set();
    const ids = getAllAdapterIds();
    const labelOf = (id) => this._t(`integration.${id}`);
    const byLabel = (a, b) => labelOf(a).localeCompare(labelOf(b), this._lang);
    const installed = ids.filter((id) => detected.has(id)).sort(byLabel);
    const rest = ids.filter((id) => !detected.has(id)).sort(byLabel);
    return [...installed, ...rest].map((id) => ({
      value: id,
      label: labelOf(id),
    }));
  }

  // ------------------------------------------------------------------
  // Allergen display name helper
  // ------------------------------------------------------------------

  /**
   * Resolve a human label for an allergen, never leaking a raw i18n key.
   * Thin wrapper that defaults the locale to the editor language; the chain
   * (editor.phrases -> card.allergen -> humanized fallback) lives in the pure,
   * unit-tested `resolveAllergenPhrase` util. Issue #262 follow-up.
   */
  _resolveAllergenPhrase(canonical, raw, { short = false, lang = this._lang } = {}) {
    return resolveAllergenPhrase(canonical, raw, { short, lang });
  }

  _getAllergenDisplayName(allergenKey) {
    if (allergenKey === undefined || allergenKey === null) return "";
    const raw = typeof allergenKey === "string" ? allergenKey : String(allergenKey);
    const slug = slugify(raw);
    const canonical = toCanonicalAllergenKey(slug);
    return this._resolveAllergenPhrase(canonical, raw);
  }

  // ------------------------------------------------------------------
  // Per-render computed helpers (used by section methods)
  // ------------------------------------------------------------------

  /**
   * Returns the merged "c" config object that section templates read from.
   * Equivalent to the render()-local `c` variable in the card editor.
   */
  _editorConfig() {
    return {
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
  }

  /**
   * Prefill date_locale in the rendered config from the current HA locale when
   * the user hasn't set one, so the editor's locale field shows the active
   * locale instead of being blank (matching the card editor). Display-only: it
   * mutates the render config, not _userConfig, so an untouched value is not
   * baked into the saved YAML. Call from a subclass `set hass`.
   */
  _autofillDateLocale() {
    // Require hass (detectLang needs it; without it we'd lock to "en"), require
    // a built _config, and only fill when date_locale is genuinely unset
    // (undefined/null) -- an explicit "" is user intent (autodetect) and is
    // left alone. Safe to call from both setConfig and set hass, in any order.
    if (!this._hass || !this._config || this._config.date_locale != null) {
      return;
    }
    // Prefer HA's full locale tag (e.g. "sv-SE"); fall back to the bare
    // detected language code ("sv"), which is a valid tag -- not a fabricated
    // `${lang}-${LANG}` ("en-EN") that no locale actually uses.
    this._config = {
      ...this._config,
      date_locale: this._hass?.locale?.language || detectLang(this._hass, null),
    };
  }

  /**
   * Returns the allergen list for the current integration.
   * Equivalent to the render()-local `allergens` variable in the card editor.
   */
  _currentAllergens() {
    const c = this._editorConfig();
    return allergenListForIntegration(c.integration, {
      installedGplPlants: this.installedGplPlants || [],
      installedGpPlants: this.installedGpPlants || [],
    });
  }

  /**
   * Returns the number of pollen levels for the current integration.
   * Equivalent to the render()-local `numLevels` variable in the card editor.
   */
  _currentNumLevels() {
    const c = this._editorConfig();
    return numLevelsForIntegration(c.integration);
  }

  /**
   * Whether the current integration exposes a raw measurement (concentration /
   * index) distinct from the calculated level, so the numeric_value_raw
   * level-vs-raw toggle is meaningful. PP/DWD/Atmo/GPL/GP/MSW have no distinct
   * raw value. Mirrors the resolveNumericValue contract.
   */
  _integrationHasRawValue(integration) {
    return ["plu", "peu", "silam", "kleenex"].includes(integration);
  }

  /**
   * Returns the slider parameters for the pollen_threshold control.
   * Equivalent to the render()-local `thresholdParams` variable in the card editor.
   */
  _thresholdParams() {
    const c = this._editorConfig();
    return c.integration === "dwd"
      ? { min: 0, max: 3, step: 0.5 }
      : c.integration === "peu" ||
          c.integration === "msw" ||
          c.integration === "irmkmi"
        ? { min: 0, max: 4, step: 1 }
        : c.integration === "gpl" || c.integration === "gp"
          ? { min: 0, max: 5, step: 1 }
          : c.integration === "plu"
            ? { min: 0, max: 3, step: 1 }
            : { min: 0, max: 6, step: 1 };
  }

  _renderNumberField(opts) {
    return renderNumberField(this, opts);
  }

  _renderTextField(opts) {
    return renderTextField(opts);
  }

  _renderResetButton(opts) {
    return renderResetButton(opts);
  }

  _renderTextButton(opts) {
    return renderTextButton(opts);
  }

  // ------------------------------------------------------------------
  // §1 Integration & Location section
  // ------------------------------------------------------------------

  _renderIntegrationSection() {
    return renderIntegrationSection(this);
  }

  // ------------------------------------------------------------------
  // §2 Allergens section
  // ------------------------------------------------------------------

  _renderAllergensSection() {
    return renderAllergensSection(this);
  }

  // ------------------------------------------------------------------
  // Inherit-state helper (used by §6 and §7 section methods)
  // ------------------------------------------------------------------

  /**
   * Computes the three locals that §6 and §7 templates depend on.
   * Keeps the computation in one place so both sections stay in sync.
   *
   * @returns {{ inheritMode: string, gapSynced: boolean, gapDisabled: boolean }}
   */
  _inheritState() {
    const c = this._editorConfig();
    const inheritMode = c.levels_inherit_mode || "inherit_allergen";
    const gapSynced = c.allergen_levels_gap_synced ?? true;
    const gapDisabled = inheritMode === "inherit_allergen" && gapSynced;
    return { inheritMode, gapSynced, gapDisabled };
  }

  // ------------------------------------------------------------------
  // §5 Card appearance section
  // ------------------------------------------------------------------

  _renderAppearanceSection() {
    return renderAppearanceSection(this);
  }

  // Whether the Card appearance section shows the card-only size controls
  // (icon_size, text_size_ratio). The badge editor overrides this to false
  // because badge_scale governs the whole badge size instead.
  _showCardSizeControls() {
    return true;
  }

  // Extra controls appended inside the Card appearance section. Empty on the
  // base; the badge editor overrides it to add badge_scale and the label
  // controls, so badge size lives in "Card appearance" like the card's size.
  _renderAppearanceExtras() {
    return html``;
  }

  // Title and helper for the appearance section (§5). The badge editor
  // overrides these to "Badge appearance" because a badge is not a card.
  _appearanceSectionTitle() {
    return this._t("summary_card_appearance");
  }
  _appearanceSectionHelper() {
    return this._t("helper_card_appearance");
  }

  // ------------------------------------------------------------------
  // §6 Allergen icons section
  // ------------------------------------------------------------------

  _renderAllergenIconsSection() {
    return renderAllergenIconsSection(this);
  }

  // ------------------------------------------------------------------
  // §7 Level circles section
  // ------------------------------------------------------------------

  // Whether the Level circles section shows the numeric-value-in-circle toggle.
  // The card editor uses it; the badge editor hides it because badge_visual
  // (ring_value) is the single source of truth there — the switch would be a
  // false affordance (the element re-derives show_value_numeric_in_circle).
  _showNumericInCircleToggle() {
    return true;
  }

  _renderLevelCirclesSection() {
    return renderLevelCirclesSection(this);
  }

  // ------------------------------------------------------------------
  // §8 Icon in ring section
  // ------------------------------------------------------------------

  // Whether the icon-in-ring on/off checkbox is shown. The card editor uses it
  // to toggle icon_in_ring; the badge editor hides it because badge_visual is
  // the single source of truth there — a checkbox would be a false affordance
  // (the element re-derives icon_in_ring) and its side effect could silently
  // clobber a user-set levels_thickness.
  _showIconInRingToggle() {
    return true;
  }

  _renderIconInRingSection() {
    return renderIconInRingSection(this);
  }

  // Presentation hooks for the phrases section: subclasses that do not display
  // level names or day labels (e.g. the badge) override these to false.
  _showPhraseShort() {
    return true;
  }

  _showPhraseLevels() {
    return true;
  }

  _showPhraseDays() {
    return true;
  }

  _resetPhrases(lang) {
    return resetPhrases(this, lang);
  }

  /**
   * The "Translations & strings" section (locale override + custom phrases),
   * shared by the card and badge editors. Level-name and day-label subsections
   * are gated by _showPhraseLevels() / _showPhraseDays() so the badge (which
   * renders neither) can hide them. Null-safe on config.phrases.
   */
  _renderPhrasesSection() {
    return renderPhrasesSection(this);
  }

  // ------------------------------------------------------------------
  // Advanced section (debug, show version, version string)
  // ------------------------------------------------------------------

  _renderAdvancedSection() {
    return renderAdvancedSection(this);
  }

  // Label for the version string in the Advanced section. The badge editor
  // overrides this to "Pollenprognos Badge version" so it doesn't read "Card".
  _versionLabel() {
    return this._t("card_version");
  }

  // ------------------------------------------------------------------
  // §10 Interactions section (link_to_sensors + tap_action)
  // ------------------------------------------------------------------

  // Title and helper for the interactions section. The badge editor overrides
  // these so the heading and helper speak of a badge instead of a card.
  _interactivitySectionTitle() {
    return this._t("summary_card_interactivity");
  }
  _interactivitySectionHelper() {
    return this._t("helper_card_interactivity");
  }

  /**
   * Seed the editor's tap_action working state from the current _config.
   * Both editors call this from setConfig once _config is assembled, so the
   * tap_action sub-form opens reflecting the saved action (or "none").
   */
  _initInteractionState() {
    const ta = this._config?.tap_action;
    if (ta && typeof ta === "object" && !Array.isArray(ta)) {
      // Honour both the Lovelace-standard `action` key and this card's `type`
      // key; map HA's renamed "perform-action" back to our "call-service".
      const raw = ta.action || ta.type || "more-info";
      const mapped = raw === "perform-action" ? "call-service" : raw;
      // Coerce an unknown keyword (e.g. a YAML typo) to "none" so the enable
      // switch and the type dropdown stay consistent: the dropdown only offers
      // the three supported types, so an unrecognised value would otherwise
      // leave the switch on with a blank dropdown.
      this._tapType = ["more-info", "navigate", "call-service"].includes(mapped)
        ? mapped
        : "none";
      this._tapEntity = ta.entity || "";
      this._tapNavigation = ta.navigation_path || "";
      this._tapService = ta.service || ta.perform_action || "";
      this._tapServiceData = JSON.stringify(
        ta.service_data || ta.data || {},
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
  }

  /**
   * Shared interactions section, used by both the card and the badge editor.
   *
   * link_to_sensors (default on) gives the effective default behavior: tapping
   * an allergen opens its more-info dialog. tap_action is the opt-in customize
   * control (off until enabled) for an element-level more-info / navigate /
   * call-service action. The runtime handler lives in LevelCircleMixin.
   */
  _renderInteractionSection() {
    return renderInteractionSection(this);
  }

  // ------------------------------------------------------------------
  // Shared visual config side-effects
  // ------------------------------------------------------------------

  /**
   * Applies visual config side-effects shared between the card editor and
   * the badge editor. Operates on a passed-in config object (shallow copy
   * of _config) and returns the (possibly mutated) config plus a `handled`
   * flag.
   *
   * When handled=true, the caller MUST dispatch config-changed immediately
   * and return (skip normal merge). The caller owns _config, _userConfig,
   * and this._thicknessAutoShifted — this method does not touch them.
   *
   * @param {string} prop
   * @param {*} value
   * @param {object} config  Shallow copy of current _config to mutate
   * @returns {{ config: object, handled: boolean, thicknessAutoShifted: boolean|null }}
   *   thicknessAutoShifted is non-null only when the icon_in_ring branch fires;
   *   null means leave this._thicknessAutoShifted unchanged.
   */
  _applyVisualConfigSideEffects(prop, value, config) {
    // icon_in_ring auto-toggle for levels_thickness.
    if (prop === "icon_in_ring") {
      const prev = config.icon_in_ring === true;
      const next = value === true;
      if (prev !== next) {
        const currentThickness =
          config.levels_thickness ?? LEVELS_DEFAULTS.levels_thickness;
        const newConfig = { ...config, icon_in_ring: next };
        let thicknessAutoShifted = this._thicknessAutoShifted || false;
        if (next && currentThickness === NORMAL_DEFAULT_THICKNESS) {
          newConfig.levels_thickness = ICON_IN_RING_DEFAULT_THICKNESS;
          thicknessAutoShifted = true;
        } else if (
          !next &&
          thicknessAutoShifted &&
          currentThickness === ICON_IN_RING_DEFAULT_THICKNESS
        ) {
          newConfig.levels_thickness = NORMAL_DEFAULT_THICKNESS;
          thicknessAutoShifted = false;
        }
        return { config: newConfig, handled: true, thicknessAutoShifted };
      }
    }

    // levels_inherit_mode: reset/sync related color properties.
    if (prop === "levels_inherit_mode") {
      if (value === "custom" && config.levels_inherit_mode !== "custom") {
        const newConfig = {
          ...config,
          levels_inherit_mode: value,
          levels_gap: LEVELS_DEFAULTS.levels_gap,
          levels_colors: LEVELS_DEFAULTS.levels_colors,
          levels_empty_color: LEVELS_DEFAULTS.levels_empty_color,
          levels_gap_color: LEVELS_DEFAULTS.levels_gap_color,
        };
        return { config: newConfig, handled: true, thicknessAutoShifted: null };
      } else if (
        value === "inherit_allergen" &&
        config.levels_inherit_mode === "custom"
      ) {
        const currentStrokeWidth =
          config.allergen_stroke_width || LEVELS_DEFAULTS.allergen_stroke_width;
        const syncedGap = convertStrokeWidthToGap(currentStrokeWidth);
        const currentAllergenColors =
          config.allergen_colors || LEVELS_DEFAULTS.allergen_colors;
        const syncedEmptyColor =
          currentAllergenColors[0] || LEVELS_DEFAULTS.levels_empty_color;
        const newConfig = {
          ...config,
          levels_inherit_mode: value,
          levels_gap: syncedGap,
          levels_empty_color: syncedEmptyColor,
          allergen_levels_gap_synced: true,
        };
        return { config: newConfig, handled: true, thicknessAutoShifted: null };
      }
    }

    // allergen_colors: sync levels_empty_color when in inherit mode.
    if (prop === "allergen_colors" && Array.isArray(value)) {
      const newConfig = { ...config, allergen_colors: value };
      if (
        (config.levels_inherit_mode || "inherit_allergen") === "inherit_allergen"
      ) {
        if (value[0]) {
          newConfig.levels_empty_color = value[0];
        }
      }
      return { config: newConfig, handled: true, thicknessAutoShifted: null };
    }

    // allergen_stroke_width reset: sync levels_gap.
    if (
      prop === "allergen_stroke_width" &&
      value === LEVELS_DEFAULTS.allergen_stroke_width
    ) {
      const newConfig = { ...config, allergen_stroke_width: value };
      if (
        (config.levels_inherit_mode || "inherit_allergen") ===
          "inherit_allergen" &&
        (config.allergen_levels_gap_synced ?? true)
      ) {
        const levelGap = convertStrokeWidthToGap(value);
        newConfig.levels_gap = levelGap;
      }
      return { config: newConfig, handled: true, thicknessAutoShifted: null };
    }

    // Level visual property resets: ensure chart re-rendering.
    if (
      (prop === "levels_thickness" ||
        prop === "levels_gap" ||
        prop === "levels_colors" ||
        prop === "levels_empty_color" ||
        prop === "levels_gap_color") &&
      value === LEVELS_DEFAULTS[prop]
    ) {
      const newConfig = { ...config, [prop]: value };
      return { config: newConfig, handled: true, thicknessAutoShifted: null };
    }

    // allergen_color_mode reset to default_colors.
    if (
      prop === "allergen_color_mode" &&
      value === "default_colors" &&
      config.allergen_color_mode === "custom"
    ) {
      const newConfig = {
        ...config,
        allergen_color_mode: value,
        allergen_colors: LEVELS_DEFAULTS.allergen_colors,
        allergen_outline_color: LEVELS_DEFAULTS.levels_gap_color,
        no_allergens_color: LEVELS_DEFAULTS.no_allergens_color,
      };
      return { config: newConfig, handled: true, thicknessAutoShifted: null };
    }

    // levels_thickness manual edit after auto-shift: signal caller to clear the flag.
    if (prop === "levels_thickness" && this._thicknessAutoShifted) {
      return { config, handled: false, thicknessAutoShifted: false };
    }

    return { config, handled: false, thicknessAutoShifted: null };
  }

  // ------------------------------------------------------------------
  // Reset to stub defaults
  // ------------------------------------------------------------------

  /**
   * Resets the card/badge config to stub defaults while preserving location
   * identity keys (city, location, region_id, entity_prefix, entity_suffix,
   * entity_weather, type). Both editors inherit this; the badge editor works
   * correctly because badge_* keys are absent from the stub and will revert
   * to undefined (the badge element re-applies its own defaults on setConfig).
   */
  _resetAll() {
    const KEEP = [
      "city", "location", "region_id",
      "entity_prefix", "entity_suffix", "entity_weather",
      "type",
    ];
    const integration = this._config?.integration ?? "pp";
    const preserved = {};
    for (const k of KEEP) {
      if (this._config?.[k] !== undefined) preserved[k] = this._config[k];
    }
    // Reset = keep only the identity/location keys plus integration; drop every
    // other key so defaults take over. Build the persisted config from the
    // preserved keys ONLY (no stub spread) — baking stub defaults back in would
    // re-bloat the saved YAML and, for the badge, defeat the user-set-only
    // persistence that lets a present value count as deliberate.
    const fresh = { ...preserved, integration };
    // setConfig (subclass) normalises and re-seeds its own state for rendering.
    this.setConfig(fresh);
    // Dispatch the clean reset config (identity keys only), not the stub-merged
    // _config used for rendering.
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: fresh },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ------------------------------------------------------------------
  // Per-section reset
  // ------------------------------------------------------------------

  /**
   * Reset one section's options to their defaults: drop the listed keys from
   * the user-origin config so the stub / element defaults take over, then
   * re-seed via setConfig and dispatch. Scoped sibling of _resetAll; works for
   * both editors because _userConfig is the user-origin view both editors
   * maintain and which serves as the reset base (it is not necessarily what
   * gets dispatched in config-changed).
   *
   * @param {string[]} keys
   */
  _resetSection(keys) {
    if (!Array.isArray(keys) || !keys.length) return;
    const base = { ...(this._userConfig || {}) };
    for (const k of keys) delete base[k];
    // Preserve the HA `type` key (as _resetAll does): _userConfig may lack it
    // even when _config carries it, and dispatching a config without `type`
    // can break HA card persistence.
    if (base.type === undefined && this._config?.type !== undefined) {
      base.type = this._config.type;
    }
    // Clear _userConfig BEFORE re-seeding: the card editor's setConfig
    // deep-merges its argument into the existing _userConfig, which would
    // reintroduce the just-deleted keys. (The card editor's _resetAll override
    // clears _userConfig for the same reason before delegating to the base.)
    // setConfig(base) then restores the kept keys while the section keys stay
    // gone.
    this._userConfig = {};
    this.setConfig(base);
    // setConfig re-derives _config for rendering and (card editor) injects
    // LEVELS_DEFAULTS into _userConfig. Restore the clean `base` as the
    // user-origin view so a subsequent section reset doesn't start from a
    // defaults-polluted base and persist level defaults as if user settings.
    this._userConfig = { ...base };
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: base },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Small reset button for a section header. Resets the given keys via
   * _resetSection. Rendered inside the <summary>; stops propagation and
   * prevents default so clicking it doesn't toggle the <details>.
   *
   * @param {string[]} keys
   * @returns {import("lit").TemplateResult}
   */
  _renderSectionReset(keys) {
    const label = this._t("preset_reset_section") || "Reset section";
    // Compact icon button absolutely positioned + vertically centred in the
    // section header (.section-reset CSS lives in each editor's styles). A
    // plain <button> instead of <ha-button> keeps it small and avoids the
    // chunky Material button height that overflowed the summary bar.
    return html`
      <button
        type="button"
        class="section-reset"
        title="${label}"
        aria-label="${label}"
        @click=${(e) => {
          e.preventDefault();
          e.stopPropagation();
          this._resetSection(keys);
        }}
      >
        ↺
      </button>
    `;
  }

  // Keys reset by the Card appearance (§5) section button. The badge editor
  // overrides this to add its badge_* size/label keys.
  _appearanceResetKeys() {
    return [...APPEARANCE_RESET_KEYS];
  }

  // Keys reset by the Allergen icons (§6) section button. levels_gap is
  // included ONLY when it is actually derived from allergen_stroke_width, i.e.
  // inherit_allergen mode with the gap synced (gapDisabled). When the user has
  // unsynced the gap or picked custom mode, levels_gap is owned by the §7 Level
  // circles section and an icon reset must not clear it.
  _allergenIconsResetKeys() {
    const keys = [...ALLERGEN_ICONS_RESET_KEYS];
    const { inheritMode, gapDisabled } = this._inheritState();
    // In inherit_allergen mode the allergen settings DERIVE level keys via
    // _applyVisualConfigSideEffects: allergen_stroke_width -> levels_gap (when
    // synced) and allergen_colors[0] -> levels_empty_color. Clear those derived
    // keys too, else the reset leaves the ring's gap/empty-color customized.
    if (gapDisabled) keys.push("levels_gap");
    if (inheritMode === "inherit_allergen") keys.push("levels_empty_color");
    return keys;
  }

  // Keys reset by the Level circles (§7) section button.
  _levelCirclesResetKeys() {
    return [...LEVEL_CIRCLES_RESET_KEYS];
  }

  // Keys reset by the Icon in ring (§8) section button. levels_thickness is
  // included only when it was auto-thinned by enabling icon_in_ring (tracked by
  // _thicknessAutoShifted) and never user-customized; otherwise turning the
  // feature off via reset would leave the rings unexpectedly thin. A
  // user-customized thickness is owned by §7 and left untouched.
  _iconInRingResetKeys() {
    const keys = [...ICON_IN_RING_RESET_KEYS];
    if (this._thicknessAutoShifted) keys.push("levels_thickness");
    return keys;
  }

  // Keys reset by the Integration & Location (§1) section button. Resets the
  // place/title WITHIN the chosen integration but keeps `integration` itself —
  // switching integration is the global "Reset all"'s job, not a section reset.
  // After the reset the location re-autodetects. For SILAM/PEU the forecast
  // `mode` selector is rendered in this section; clear it AND its hard-coupled
  // day-display side effects (changing mode auto-writes days_to_show /
  // show_empty_days), so the reset returns the whole mode-related config to
  // defaults. Other integrations have no mode control here, so those keys are
  // left to the Day display (§4) reset.
  _integrationResetKeys() {
    const keys = [...INTEGRATION_RESET_KEYS];
    const integration = this._config?.integration;
    if (integration === "silam" || integration === "peu") {
      keys.push("mode", "days_to_show", "show_empty_days");
    }
    return keys;
  }

  // Keys reset by the Allergens (§2) section button: selection, threshold,
  // sort, pin-to-top, and the summary/pollution-block toggles.
  _allergensResetKeys() {
    return [...ALLERGENS_RESET_KEYS];
  }

  // Keys reset by the Translations & strings (§9) section button: custom
  // allergen/level/day phrase overrides and the date locale (which re-autofills
  // from the HA locale afterwards).
  _phrasesResetKeys() {
    return [...PHRASES_RESET_KEYS];
  }
}
