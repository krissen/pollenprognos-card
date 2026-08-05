// src/pollenprognos-badge-editor.js
//
// Visual editor for the pollenprognos-badge element.
// Extends PollenEditorBase to share integration/location and allergen sections.

import { html, css, type TemplateResult, type PropertyDeclarations } from "lit";
import { getStubConfig, getAutodetect } from "./adapter-registry.js";
import {
  PollenEditorBase,
  deepMerge,
  sectionResetStyles,
  editorControlStyles,
} from "./editor/base.js";
import { coerceBool } from "./utils/adapter-helpers.js";
import { coerceBadgeLabelContent } from "./utils/badge-label.js";
import { deepEqual } from "./utils/confcompare.js";
import {
  detectIntegrationStates,
  pickIntegration,
  detectedIntegrationIds,
  autoSelectLocation,
} from "./utils/autodetect.js";
import { extractCitySlugFromEntityId as extractPpCitySlugFromEntityId } from "./adapters/pp.js";
import type { HomeAssistant } from "./types/home-assistant.js";
import type { CardConfig, RawCardConfig } from "./types/config.js";
import type { InstalledLocation } from "./editor/types.js";
import type { DetectionResult } from "./utils/autodetect.js";

class PollenPrognosBadgeEditor extends PollenEditorBase {
  // ------------------------------------------------------------------ //
  // Reactive properties                                                  //
  // ------------------------------------------------------------------ //

  static override get properties(): PropertyDeclarations {
    return {
      _config: { type: Object },
      hass: { type: Object },
      _selectedPhraseLang: { state: true },
    };
  }

  // ------------------------------------------------------------------ //
  // HA editor protocol                                                   //
  // ------------------------------------------------------------------ //

  /**
   * Called by HA when the badge is first opened in the editor and whenever
   * the user's config changes externally. Mirrors the badge element's own
   * setConfig so the editor always starts from a well-formed config.
   *
   * @param {object} config
   */
  override setConfig = (config: RawCardConfig): void => {
    // Normalize integration (trim + lowercase) to match badge element behaviour.
    let integration: unknown = config.integration;
    if (integration && typeof integration === "string") {
      integration = integration.trim().toLowerCase();
    }

    const stub =
      getStubConfig(typeof integration === "string" ? integration : undefined) ||
      getStubConfig("pp");
    if (!integration) integration = stub?.integration;

    // Defensive type-guards (repo policy) on badge-specific fields.
    const badgeContent =
      typeof config.badge_content === "string" ? config.badge_content : "worst";
    const badgeSingleAllergen =
      typeof config.badge_single_allergen === "string"
        ? config.badge_single_allergen
        : undefined;
    const badgeShowLabel = coerceBool(config.badge_show_label);
    const badgeVisual =
      typeof config.badge_visual === "string" ? config.badge_visual : undefined;
    const badgeScale =
      typeof config.badge_scale === "number" ? config.badge_scale : undefined;
    const badgeLabelPosition =
      typeof config.badge_label_position === "string"
        ? config.badge_label_position
        : undefined;
    const badgeLabelContent =
      typeof config.badge_label_content === "string"
        ? config.badge_label_content
        : undefined;

    // The pre-spread badge_content/badge_show_label defaults the JS version set
    // before `...config` are unconditionally re-set after the spread (badgeContent
    // always resolves to a string, badgeShowLabel to a boolean), so they are
    // dropped here to avoid a duplicate-key literal; the result is identical.
    this._config = {
      ...stub,
      icon_in_ring: true,
      ...config,
      integration: integration as string,
      badge_content: badgeContent,
      badge_show_label: badgeShowLabel,
      ...(badgeSingleAllergen !== undefined
        ? { badge_single_allergen: badgeSingleAllergen }
        : {}),
      ...(badgeVisual !== undefined ? { badge_visual: badgeVisual } : {}),
      ...(badgeScale !== undefined ? { badge_scale: badgeScale } : {}),
      ...(badgeLabelPosition !== undefined
        ? { badge_label_position: badgeLabelPosition }
        : {}),
      ...(badgeLabelContent !== undefined
        ? { badge_label_content: badgeLabelContent }
        : {}),
    } as unknown as CardConfig;

    // Persist only what the user actually set. _config above is the stub-merged
    // view used for rendering the editor; _userConfig is the raw incoming
    // config (user-origin keys) that we dispatch back, so stub defaults are
    // never baked into the saved YAML. Mirrors the card editor.
    this._userConfig = { ...config };

    // Seed the editor's tap_action working state (shared with the card editor).
    this._initInteractionState();

    // HA sets `hass` before `setConfig` for the badge editor, so the set hass()
    // autodetect was skipped while _config was still unset. Now that _config is
    // initialized, run it here so a freshly added badge prefills the installed
    // integration + first location and the dropdowns are populated.
    if (this._hass) this._runAutodetect();

    // Prefill the locale field from the current HA locale (display-only),
    // matching the card. The helper no-ops without hass, so whichever of
    // hass/setConfig arrives last triggers the prefill. _selectedPhraseLang is
    // intentionally NOT seeded; the shared phrases section derives the shown
    // language at render time.
    this._autofillDateLocale();
  };

  // ------------------------------------------------------------------ //
  // hass setter                                                          //
  // ------------------------------------------------------------------ //

  /**
   * Store hass and run the same autodetection the card editor does, so the
   * integration dropdown marks installed integrations, the location dropdown
   * is populated, and a freshly added badge prefills the integration + first
   * location of whatever is actually installed (issue #235). Detection is
   * shared with the card via src/utils/autodetect.js.
   *
   * @param {object} hass
   */
  set hass(hass: HomeAssistant | undefined) {
    const changed = this._hass !== hass;
    this._hass = hass;

    // Only when _config is already initialized; if hass arrives first (the
    // ordering HA uses for the badge editor), setConfig runs detection once it
    // sets _config — see the _runAutodetect() call there.
    if (this._config && changed) this._runAutodetect();

    // Prefill the locale field from the current HA locale (display-only),
    // matching the card editor, so it isn't left blank. _selectedPhraseLang
    // holds only the user's explicit dropdown pick; the shared phrases section
    // derives the shown language at render time, so it is not seeded here.
    this._autofillDateLocale();
    this.requestUpdate();
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  /**
   * Run the shared autodetection: mark installed integrations for the dropdown
   * sort, populate the location dropdown lists, and prefill integration + first
   * location. Called from both set hass() and setConfig() because HA can set
   * either first; needs both _hass and _config.
   */
  _runAutodetect() {
    if (!this._hass || !this._config) return;
    const detection = detectIntegrationStates(this._hass);
    this._detectedIntegrations = detectedIntegrationIds(detection);
    this._populateInstalledLocations(detection, this._hass);
    this._maybeAutofill(detection, this._hass);
  }

  // Integration -> the config key its location is stored under.
  static get _LOCATION_KEYS() {
    return { pp: "city", dwd: "region_id" };
  }

  _locationKeyFor(integration: string | undefined): string {
    const keys = PollenPrognosBadgeEditor._LOCATION_KEYS as Record<
      string,
      string
    >;
    return keys[integration ?? ""] || "location";
  }

  /**
   * Build the installed-location lists the shared integration section reads
   * (installedPpLocations, installedDwdLocations, ...). Discovery-first, with
   * per-integration entity-ID fallbacks; Kleenex additionally keeps the card
   * editor's legacy-slug compatibility entry, since badges saved before
   * registry discovery store the slug. Lists are [key, label] pairs; the
   * dropdown shows label, stores key.
   *
   * @param {ReturnType<typeof detectIntegrationStates>} detection
   * @param {object} hass
   */
  _populateInstalledLocations(detection: DetectionResult, hass: HomeAssistant): void {
    const toList = (discovery: {
      locations: Map<string, { label: string }>;
    }): InstalledLocation[] =>
      Array.from(discovery.locations.entries()).map(
        ([key, loc]) => [key, loc.label] as InstalledLocation,
      );

    // PP / DWD / PEU via memoized discovery getters.
    const ppDiscovery = detection.getPpDiscovery();
    this.installedPpLocations = ppDiscovery.locations.size
      ? toList(ppDiscovery)
      : Array.from(
          new Set(
            (detection.states.pp ?? [])
              .map((id: string) => extractPpCitySlugFromEntityId(id))
              .filter(Boolean),
          ),
        ).map((slug) => [slug, slug] as InstalledLocation);

    const dwdDiscovery = detection.getDwdDiscovery();
    this.installedDwdLocations = dwdDiscovery.locations.size
      ? toList(dwdDiscovery)
      : Array.from(
          new Set((detection.states.dwd ?? []).map((id: string) => id.split("_").pop())),
        )
          .sort((a, b) => Number(a) - Number(b))
          .map((id) => [id, id] as InstalledLocation);

    const peuDiscovery = detection.getPeuDiscovery();
    this.installedPeuLocations = peuDiscovery.locations.size
      ? toList(peuDiscovery)
      : Array.from(
          new Set(
            (detection.states.peu ?? [])
              .map(
                (eid: string) =>
                  hass.states[eid]?.attributes?.location_slug || null,
              )
              .filter(Boolean),
          ),
        ).map((slug) => [slug, slug] as InstalledLocation);

    // SILAM / Atmo / GP via eager discovery; GPL / MSW via memoized getters.
    this.installedSilamLocations = toList(detection.discovery.silam);
    this.installedAtmoLocations = toList(detection.discovery.atmo);
    this.installedGpLocations = toList(detection.discovery.gp);
    this.installedGplLocations = toList(detection.getGplDiscovery());
    this.installedMswLocations = toList(detection.getMswDiscovery());
    this.installedIrmkmiLocations = toList(detection.getIrmkmiDiscovery());

    // Kleenex via eager discovery; the *_date slug derivation stays as the
    // fallback for installs without registry metadata. Discovery is required
    // for renamed devices, whose entity IDs carry no location slug (issue #309).
    const kleenexDiscovery = detection.discovery.kleenex;
    this.installedKleenexLocations = kleenexDiscovery.locations.size
      ? toList(kleenexDiscovery)
      : Array.from(
          new Set(
            detection.stateIds
              .map((id: string) => {
                const m =
                  typeof id === "string" &&
                  id.match(/^sensor\.kleenex_pollen_radar_(.+)_date$/);
                return m ? m[1] : null;
              })
              .filter(Boolean),
          ),
        ).map((slug) => [slug, slug] as InstalledLocation);

    // Compatibility: a badge can hold a location value that is not a discovery
    // key (a device without a usable identifier, or a legacy slug whose device
    // was renamed). Without a matching entry the selector shows nothing
    // selected even though the badge still resolves. Same candidate order as
    // the card editor -- rename-stable device identifier before generic slug
    // matching -- and the same re-key rather than append, so the list never
    // holds two identically-labelled options.
    const kleenexCfgLoc = this._config?.location as string | undefined;
    if (
      kleenexCfgLoc &&
      kleenexCfgLoc !== "manual" &&
      !kleenexDiscovery.locations.has(kleenexCfgLoc)
    ) {
      const kleenexAutodetect = getAutodetect("kleenex");
      // Same single resolution as the card editor and the adapter; see the
      // comment there. "ambiguous" yields no entry rather than a guess.
      const kleenexResolved =
        kleenexAutodetect?.resolveLocation?.(
          hass,
          kleenexDiscovery,
          kleenexCfgLoc,
        ) ?? null;
      const kleenexMatch =
        kleenexResolved === "ambiguous" ? null : kleenexResolved;
      if (kleenexMatch) {
        const entry = [
          kleenexCfgLoc,
          kleenexMatch[1].label,
        ] as InstalledLocation;
        const idx = this.installedKleenexLocations.findIndex(
          ([key]) => key === kleenexMatch[0],
        );
        if (idx >= 0) this.installedKleenexLocations[idx] = entry;
        else this.installedKleenexLocations.push(entry);
      }
    }
  }

  /**
   * Prefill the integration (when the user hasn't pinned one) and the first
   * available location for the active integration (when none is set and not in
   * manual mode), then dispatch config-changed once if anything changed. The
   * diff-before-dispatch guard prevents an HA update loop on every hass tick.
   *
   * @param {ReturnType<typeof detectIntegrationStates>} detection
   * @param {object} hass
   */
  _maybeAutofill(detection: DetectionResult, hass: HomeAssistant): void {
    const userSetIntegration = Object.prototype.hasOwnProperty.call(
      this._userConfig || {},
      "integration",
    );

    const next = { ...this._config } as CardConfig;

    if (!userSetIntegration) {
      const picked = pickIntegration(detection, { explicit: false });
      if (picked && picked !== next.integration) {
        next.integration = picked;
      }
    }

    const integration = next.integration;
    const locKey = this._locationKeyFor(integration);
    const userSetLocation = Object.prototype.hasOwnProperty.call(
      this._userConfig || {},
      locKey,
    );
    if (!userSetLocation && next[locKey] !== "manual" && !next[locKey]) {
      const sel = autoSelectLocation(integration as string, next, hass, detection);
      if (sel) next[sel.key] = sel.value;
    }

    if (!deepEqual(this._config, next)) {
      this._config = next;
      this._userConfig = { ...this._userConfig };
      if (!userSetIntegration) this._userConfig.integration = next.integration;
      if (next[locKey] != null) this._userConfig[locKey] = next[locKey];
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._userConfig },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  // ------------------------------------------------------------------ //
  // Config update                                                        //
  // ------------------------------------------------------------------ //

  /**
   * Config update: applies shared visual side-effects (via the base helper)
   * then deep-merges the new prop/value into _config and fires config-changed.
   * For visual properties (icon_in_ring, levels_inherit_mode, allergen_colors,
   * allergen_stroke_width, levels_*, allergen_color_mode) the shared helper
   * may produce a fully-mutated config; handled=true means dispatch and return.
   *
   * @param {string} prop
   * @param {*} value
   */
  override _updateConfig = (prop: string, value: unknown): void => {
    if (!this._config) return;

    // Integration change: drop the previous integration's location and
    // allergen keys so the new adapter's stub defaults take over. Without this
    // the stale user keys (e.g. PP allergen names) would override the new
    // integration and the badge would render empty. Mirrors the card editor.
    if (prop === "integration" && value !== this._config.integration) {
      const INTEGRATION_SCOPED = [
        "city", "region_id", "location",
        "entity_prefix", "entity_suffix", "entity_weather",
        "mode", "allergens", "badge_single_allergen",
        // Threshold ranges are integration-specific (DWD 0-3, PP 0-6, ...), so
        // a stale high threshold can suppress every allergen on the new
        // integration and render an empty badge. Pin-to-top flags are likewise
        // integration-specific. Clear them too, matching the card editor.
        "pollen_threshold", "allergy_risk_top", "index_top",
      ];
      this._userConfig = this._userConfig || {};
      for (const k of INTEGRATION_SCOPED) delete this._userConfig[k];
      this._userConfig.integration = value;
      const stub =
        getStubConfig(value as string | undefined) || getStubConfig("pp");
      this._config = deepMerge(
        (stub ?? {}) as Record<string, unknown>,
        this._userConfig,
      ) as CardConfig;
      // In single mode the cleared badge_single_allergen would leave the badge
      // with no named allergen on the new integration, so the preview falls back
      // to "worst" while the picker shows the new integration's first allergen.
      // Re-default it to that first allergen (what the picker displays) so the
      // preview and picker stay in sync, mirroring the switch-to-single default.
      if (this._config.badge_content === "single") {
        const first = this._currentAllergens()[0];
        if (first) {
          this._userConfig.badge_single_allergen = first;
          this._config = deepMerge(this._config, {
            badge_single_allergen: first,
          }) as CardConfig;
        }
      }
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._userConfig },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    const before = this._config;

    // Apply shared visual side-effects (may set several related keys at once,
    // e.g. levels_inherit_mode resetting the level colours/gap).
    const result = this._applyVisualConfigSideEffects(prop, value, {
      ...before,
    });
    if (result.thicknessAutoShifted !== null) {
      this._thicknessAutoShifted = result.thicknessAutoShifted;
    }
    const after = (
      result.handled
        ? result.config
        : deepMerge(before, { [prop]: value })
    ) as CardConfig;

    // Persist only user-origin keys: the edited prop plus any key the
    // side-effects actually changed (diffed against the pre-edit config). This
    // keeps stub defaults out of the saved YAML so the badge element can treat
    // a present value as a deliberate choice. Mirrors the card editor.
    this._userConfig = this._userConfig || {};
    for (const k of Object.keys(after)) {
      if (!deepEqual(after[k], before[k])) {
        this._userConfig[k] = after[k];
      }
    }
    this._userConfig[prop] = value;

    this._config = after;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._userConfig },
        bubbles: true,
        composed: true,
      }),
    );
  };

  // A badge has no ha-card chrome and shows today's value only, so the shared
  // Integration/Location section must not offer the card-only Title controls or
  // the forecast-mode selector (the badge element forces mode to "daily").
  override _showTitleSection(): boolean {
    return false;
  }

  override _showModeSelector(): boolean {
    return false;
  }

  // The numeric-value-in-circle switch is driven by badge_visual (ring_value)
  // on the badge, so the §7 toggle would be a false affordance — hide it.
  override _showNumericInCircleToggle(): boolean {
    return false;
  }

  // badge_visual (in the Badge content section) is the single source of truth
  // for whether the icon sits in the ring, so the §8 on/off checkbox would be
  // a false affordance here — hide it. The ring sub-fields (size ratio, colour)
  // remain available for tuning the icon_in_ring visual mode.
  override _showIconInRingToggle(): boolean {
    return false;
  }

  // The badge shows the allergen name only (no level text, no day columns), so
  // hide the level-name and day-label customization. The badge label uses
  // allergenShort, which equals the full name UNLESS allergens_abbreviated is
  // set; the badge editor has no abbreviated toggle, but a YAML config can set
  // it, in which case the short names DO show -- so expose the short-name fields
  // only when allergens_abbreviated is enabled.
  override _showPhraseShort(): boolean {
    return this._editorConfig()?.allergens_abbreviated === true;
  }

  // Level names are normally irrelevant to a badge, but badge_label_content
  // level/allergen_level put days[0].state_text straight into the label, so the
  // strings the badge shows would otherwise be uneditable. Gate on the label
  // being visible too: with badge_show_label off nothing renders the level
  // text, so the default badge editor surface is unchanged.
  override _showPhraseLevels(): boolean {
    const c = this._editorConfig();
    if (c?.badge_show_label !== true) return false;
    const content = coerceBadgeLabelContent(c.badge_label_content);
    return content === "level" || content === "allergen_level";
  }

  override _showPhraseDays(): boolean {
    return false;
  }

  // ------------------------------------------------------------------ //
  // Allergen toggle helpers (required by _renderAllergensSection)        //
  // ------------------------------------------------------------------ //

  override _onAllergenToggle = (allergen: string, checked: boolean): void => {
    const set = new Set((this._config?.allergens as string[]) || []);
    if (checked) set.add(allergen);
    else set.delete(allergen);
    this._updateConfig("allergens", [...set]);
  };

  override _toggleSelectAllAllergens = (allergens: string[]): void => {
    const current = new Set((this._config?.allergens as string[]) || []);
    const allSelected = allergens.every((a) => current.has(a));
    this._updateConfig("allergens", allSelected ? [] : [...allergens]);
  };

  override _toggleAllergenSubset = (subset: string[]): void => {
    const current = new Set((this._config?.allergens as string[]) || []);
    const allSelected = subset.every((a) => current.has(a));
    if (allSelected) {
      subset.forEach((a) => current.delete(a));
    } else {
      subset.forEach((a) => current.add(a));
    }
    this._updateConfig("allergens", [...current]);
  };

  // ------------------------------------------------------------------ //
  // Badge content section (badge-editor only — not shared)              //
  // ------------------------------------------------------------------ //

  _renderBadgeContentSection(): TemplateResult {
    const c = this._editorConfig();
    const allergens = this._currentAllergens();

    return html`
      <details open>
        <summary>
          ${this._t("summary_badge_content")}
          ${this._renderSectionReset([
            "badge_visual",
            "badge_content",
            "badge_single_allergen",
          ])}
        </summary>
        <div class="section-helper">${this._t("helper_badge_content")}</div>

        <!-- badge_visual: what kind of badge (the section header + helper say
             "Badge content / What the badge shows", so no extra field label). -->
        <ha-formfield>
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: [
                  { value: "icon_in_ring", label: this._t("badge_visual_icon_in_ring") },
                  { value: "ring_value", label: this._t("badge_visual_ring_value") },
                  { value: "ring_empty", label: this._t("badge_visual_ring_empty") },
                  { value: "icon_only", label: this._t("badge_visual_icon_only") },
                ],
              },
            }}
            .value=${typeof c.badge_visual === "string" ? c.badge_visual : "icon_in_ring"}
            @value-changed=${(e: CustomEvent) => {
              const v = e.detail?.value;
              if (v !== undefined) this._updateConfig("badge_visual", v);
            }}
          ></ha-selector>
        </ha-formfield>

        <!-- badge_content: which allergen(s) the badge concerns -->
        <ha-formfield>
          <ha-selector
            .hass=${this._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: [
                  { value: "worst", label: this._t("badge_content_worst") },
                  { value: "aggregate", label: this._t("badge_content_aggregate") },
                  { value: "single", label: this._t("badge_content_single") },
                  { value: "row", label: this._t("badge_content_row") },
                ],
              },
            }}
            .value=${c.badge_content || "worst"}
            @value-changed=${(e: CustomEvent) => {
              const v = e.detail?.value;
              if (v === undefined) return;
              // Switching to "single" commits the default allergen the dropdown
              // already shows (allergens[0]) when the user hasn't picked one, so
              // the preview renders that allergen immediately instead of an
              // unnamed single badge (which falls back to no-pollen/worst).
              if (
                v === "single" &&
                !this._userConfig?.badge_single_allergen &&
                allergens.length
              ) {
                this._updateConfig("badge_single_allergen", allergens[0]);
              }
              this._updateConfig("badge_content", v);
            }}
          ></ha-selector>
        </ha-formfield>

        ${c.badge_content === "single"
          ? html`
              <ha-formfield label="${this._t("badge_single_allergen")}">
                <ha-selector
                  .hass=${this._hass}
                  .selector=${{
                    select: {
                      mode: "dropdown",
                      options: allergens.map((key) => ({
                        value: key,
                        label: this._getAllergenDisplayName(key),
                      })),
                    },
                  }}
                  .value=${c.badge_single_allergen || allergens[0] || ""}
                  @value-changed=${(e: CustomEvent) => {
                    const v = e.detail?.value;
                    if (v !== undefined)
                      this._updateConfig("badge_single_allergen", v);
                  }}
                ></ha-selector>
              </ha-formfield>
            `
          : ""}
      </details>
    `;
  }

  // Hide the card-only size controls (icon_size / text_size_ratio) in the
  // shared Card appearance section; the badge uses badge_scale instead.
  override _showCardSizeControls(): boolean {
    return false;
  }

  // A badge is not a card: rename the shared appearance section accordingly.
  // The size controls (badge_scale, badge_icon_scale) stay here, so the helper
  // mentions size rather than just background/label.
  override _appearanceSectionTitle(): string {
    return this._t("summary_badge_appearance");
  }
  override _appearanceSectionHelper(): string {
    return this._t("helper_badge_appearance");
  }

  // The Advanced section's version string should read "Badge", not "Card".
  override _versionLabel(): string {
    return this._t("badge_version");
  }

  // A badge is not a card: override the shared interactions section title and
  // helper with badge-specific keys so both speak of tapping the badge.
  override _interactivitySectionTitle(): string {
    return this._t("summary_badge_interactivity");
  }
  override _interactivitySectionHelper(): string {
    return this._t("helper_badge_interactivity");
  }

  // The Badge appearance reset also clears the badge size/label keys, which
  // live in this section via _renderAppearanceExtras. Includes badge_icon_scale
  // (rendered in every visual mode), so resetting the section clears every
  // control it shows.
  override _appearanceResetKeys(): string[] {
    return [
      ...super._appearanceResetKeys(),
      "badge_scale",
      "badge_icon_scale",
      "badge_show_label",
      "badge_label_position",
      "badge_label_content",
    ];
  }

  // Badge size + label controls, rendered inside the shared Card appearance
  // section so badge size lives where card size lives (recognisable to users
  // of the card editor).
  override _renderAppearanceExtras() {
    const c = this._editorConfig();
    return html`
      <!-- badge_scale: overall badge size multiplier -->
      <ha-formfield label="${this._t("badge_scale")}">
        <ha-slider
          min="0.5"
          max="3"
          step="0.1"
          .value=${typeof c.badge_scale === "number" ? c.badge_scale : 1}
          @input=${(e: Event) =>
            this._updateConfig(
              "badge_scale",
              Number((e.target as HTMLInputElement).value),
            )}
          style="width: 120px;"
        ></ha-slider>
        ${this._renderNumberField({
          value: typeof c.badge_scale === "number" ? c.badge_scale : 1,
          min: 0.5,
          max: 3,
          step: 0.1,
          onValue: (n) => this._updateConfig("badge_scale", n),
        })}
      </ha-formfield>

      <!-- badge_icon_scale: scale the allergen visual as a whole — the ring
           (and whatever it centres) in the ring modes, the bare icon in
           icon_only — without touching the label text or the pill box. Shown
           in every visual mode. -->
      <ha-formfield label="${this._t("badge_icon_scale")}">
        <ha-slider
          min="0.3"
          max="3"
          step="0.05"
          .value=${typeof c.badge_icon_scale === "number"
            ? c.badge_icon_scale
            : 1}
          @input=${(e: Event) =>
            this._updateConfig(
              "badge_icon_scale",
              Number((e.target as HTMLInputElement).value),
            )}
          style="width: 120px;"
        ></ha-slider>
        ${this._renderNumberField({
          value: typeof c.badge_icon_scale === "number" ? c.badge_icon_scale : 1,
          min: 0.3,
          max: 3,
          step: 0.05,
          onValue: (n) => this._updateConfig("badge_icon_scale", n),
        })}
      </ha-formfield>

      <!-- badge_show_label / badge_label_position -->
      <ha-formfield label="${this._t("badge_show_label")}">
        <ha-switch
          .checked=${c.badge_show_label === true}
          @change=${(e: Event) =>
            this._updateConfig(
              "badge_show_label",
              (e.target as HTMLInputElement).checked,
            )}
        ></ha-switch>
      </ha-formfield>

      ${c.badge_show_label
        ? html`
            <ha-formfield label="${this._t("badge_label_position")}">
              <ha-selector
                .hass=${this._hass}
                .selector=${{
                  select: {
                    mode: "dropdown",
                    options: [
                      { value: "right", label: this._t("badge_label_position_right") },
                      { value: "below", label: this._t("badge_label_position_below") },
                    ],
                  },
                }}
                .value=${typeof c.badge_label_position === "string" ? c.badge_label_position : "right"}
                @value-changed=${(e: CustomEvent) => {
                  const v = e.detail?.value;
                  if (v !== undefined) this._updateConfig("badge_label_position", v);
                }}
              ></ha-selector>
            </ha-formfield>

            <!-- badge_label_content: allergen name (default), today's
                 translated level text, or both (issue #63). -->
            <ha-formfield label="${this._t("badge_label_content")}">
              <ha-selector
                .hass=${this._hass}
                .selector=${{
                  select: {
                    mode: "dropdown",
                    options: [
                      { value: "allergen", label: this._t("badge_label_content_allergen") },
                      { value: "level", label: this._t("badge_label_content_level") },
                      { value: "allergen_level", label: this._t("badge_label_content_allergen_level") },
                    ],
                  },
                }}
                .value=${coerceBadgeLabelContent(c.badge_label_content)}
                @value-changed=${(e: CustomEvent) => {
                  const v = e.detail?.value;
                  if (v !== undefined) this._updateConfig("badge_label_content", v);
                }}
              ></ha-selector>
            </ha-formfield>
          `
        : ""}
    `;
  }

  // ------------------------------------------------------------------ //
  // Render                                                               //
  // ------------------------------------------------------------------ //

  override render(): TemplateResult {
    if (!this._config) return html``;

    return html`
      <div class="card-config">
        <!-- Reset button (inherited from PollenEditorBase) -->
        ${this._renderTextButton({
          label: this._t("preset_reset_all"),
          onClick: () => this._resetAll(),
        })}

        ${this._renderIntegrationSection()}
        ${this._renderBadgeContentSection()}
        ${this._renderAllergensSection()}
        ${this._renderAppearanceSection()}
        ${this._renderAllergenIconsSection()}
        ${this._renderLevelCirclesSection()}
        ${this._renderIconInRingSection()}
        ${this._renderPhrasesSection()}
        ${this._renderInteractionSection()}
        ${this._renderAdvancedSection()}
      </div>
    `;
  }

  // ------------------------------------------------------------------ //
  // Styles                                                               //
  // ------------------------------------------------------------------ //

  static override get styles() {
    return css`
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
      }

      .version-info {
        font-size: 0.9em;
        color: var(--secondary-text-color);
        margin-top: 4px;
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

      .allergen-section {
        margin-bottom: 12px;
      }

      .allergen-section h4 {
        margin: 8px 0 4px 0;
        font-size: 0.9em;
        color: var(--secondary-text-color);
        font-weight: 500;
      }

      details summary {
        cursor: pointer;
        font-weight: bold;
        margin: 8px 0;
      }

      ha-slider {
        width: 100%;
      }

      ha-selector {
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

      .slider-value {
        font-family: monospace;
        text-align: right;
        width: 3ch;
      }

      .slider-row ha-slider {
        width: 100%;
      }

      details {
        margin-bottom: 16px;
        border-radius: 6px;
        padding: 8px 0 0 0;
      }

      details > *:not(summary):not(details) {
        margin-left: 24px;
        margin-right: 24px;
      }

      details summary {
        font-weight: bold;
        cursor: pointer;
        background: var(--card-background-color, #f6f6f6);
        border-radius: 6px;
        padding: 10px 16px;
        border: 1px solid var(--divider-color, #ddd);
        color: var(--primary-text-color, #222);
        margin-bottom: 4px;
      }

      /* Per-section ↺ reset button styles (shared with the card editor). */
      ${sectionResetStyles}

      /* Own form controls (input/button) replacing HA's removed components. */
      ${editorControlStyles}

      details details {
        margin-left: 24px;
        margin-right: 24px;
        background: var(--secondary-background-color, #f9f9f9);
        border-left: 2px solid var(--primary-color, #bcd);
        padding: 8px 0 8px 8px;
      }

      details details summary {
        background: var(--card-background-color, #f0f7fc);
        border: 1px solid var(--ha-card-border-color, #cde);
        color: var(--primary-text-color, #222);
        margin-bottom: 4px;
        padding: 8px 12px;
        border-radius: 5px;
      }

      ha-formfield > ha-switch,
      ha-formfield > .mdc-form-field > ha-switch {
        margin: 0;
        padding: 0;
        width: auto;
        min-width: 0;
        box-sizing: content-box;
      }

      ha-formfield {
        padding: 0;
        margin: 0;
        box-sizing: border-box;
      }

      ha-switch {
        vertical-align: middle;
        width: 36px;
        height: 20px;
        background: none;
        border: none;
        box-sizing: border-box;
      }

      ha-formfield label,
      ha-formfield .mdc-label {
        vertical-align: middle;
        margin-left: 8px;
        margin-right: 0;
        padding: 0;
      }

      /* Section helper text below summary */
      .section-helper {
        font-size: 12px;
        color: var(--secondary-text-color);
        padding: 0 0 8px;
        margin-left: 24px;
        margin-right: 24px;
      }

      /* Inline caveat under a field whose current value cannot take effect. */
      .field-warning {
        font-size: 12px;
        color: var(--warning-color, #ff9800);
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

      /* Numeric input box sizing lives in editorControlStyles (.pp-input.num-field). */
    `;
  }
}

if (!customElements.get("pollenprognos-badge-editor")) {
  customElements.define("pollenprognos-badge-editor", PollenPrognosBadgeEditor);
}

export default PollenPrognosBadgeEditor;
