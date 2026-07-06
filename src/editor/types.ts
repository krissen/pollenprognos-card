// ------------------------------------------------------------------ //
// Structural editor type shared by the section renderers.             //
//                                                                     //
// The section modules (`sections/*.ts`) each take the editor instance //
// and read config / call helper methods on it. Rather than import the //
// concrete PollenEditorBase class (which would be circular — the base //
// imports the sections), they depend on this structural interface     //
// describing exactly the surface they touch. Both the card editor     //
// (PollenPrognosCardEditor) and the badge editor (via PollenEditorBase)//
// satisfy it. Genuinely dynamic config lives behind `_config` /       //
// `_editorConfig()`; callers cast at the access site, matching the    //
// rendering-layer convention (a full config key inventory lands in a  //
// later PR).                                                          //
// ------------------------------------------------------------------ //

import type { TemplateResult } from "lit";
import type { HomeAssistant } from "../types/home-assistant.js";
import type { CardConfig } from "../types/config.js";
import type {
  NumberFieldOptions,
  TextFieldOptions,
  ResetButtonOptions,
  TextButtonOptions,
} from "./field-renderers.js";

/** A single entry in the integration dropdown. */
export interface IntegrationOption {
  value: string;
  label: string;
}

/** Slider bounds for the pollen_threshold control, per integration. */
export interface ThresholdParams {
  min: number;
  max: number;
  step: number;
}

/** Computed inherit/gap locals shared by the §6 and §7 section templates. */
export interface InheritState {
  inheritMode: string;
  gapSynced: boolean;
  gapDisabled: boolean;
}

/** An installed-location option: `[configValue, displayLabel]`. */
export type InstalledLocation = [string, string];

/**
 * The subset of the editor instance that the section renderers and
 * field-renderers read. Kept as a standalone structural interface (not the
 * base class) to avoid a circular dependency: sections are imported *by*
 * PollenEditorBase, so they cannot import it back.
 */
export interface PollenEditorLike {
  // --- Reactive state / config ---
  _hass?: HomeAssistant;
  _config?: CardConfig;
  readonly _lang: string;
  readonly debug: boolean;
  _selectedPhraseLang?: string;

  // --- Interaction-editor local state (card editor only) ---
  _tapType?: string;
  _tapEntity?: string;
  _tapNavigation?: string;
  _tapService?: string;
  _tapServiceData?: string;

  // --- Installed-location lists (populated by `set hass`) ---
  installedPpLocations: InstalledLocation[];
  installedDwdLocations: InstalledLocation[];
  installedPeuLocations: InstalledLocation[];
  installedSilamLocations: InstalledLocation[];
  installedKleenexLocations: InstalledLocation[];
  installedAtmoLocations: InstalledLocation[];
  installedMswLocations: InstalledLocation[];
  installedIrmkmiLocations: InstalledLocation[];
  installedGplLocations: InstalledLocation[];
  installedGpLocations: InstalledLocation[];

  // --- Translation + computed helpers ---
  _t(key: string): string;
  _editorConfig(): CardConfig;
  _currentAllergens(): string[];
  _currentNumLevels(): number;
  _getAllergenDisplayName(allergenKey: unknown): string;
  _resolveAllergenPhrase(
    canonical: string,
    raw: unknown,
    opts?: { short?: boolean; lang?: string },
  ): string;
  _buildIntegrationOptions(): IntegrationOption[];
  _hasSilamWeatherEntity(
    location: string,
    entityWeather?: string | null,
  ): boolean;
  _integrationHasRawValue(integration: string | undefined): boolean;
  _inheritState(): InheritState;
  _thresholdParams(): ThresholdParams;
  _versionLabel(): string;

  // --- Section presence toggles / titles (overridden by the badge editor) ---
  _showTitleSection(): boolean;
  _showModeSelector(): boolean;
  _showCardSizeControls(): boolean;
  _showNumericInCircleToggle(): boolean;
  _showIconInRingToggle(): boolean;
  _showPhraseShort(): boolean;
  _showPhraseLevels(): boolean;
  _showPhraseDays(): boolean;
  _appearanceSectionTitle(): string;
  _appearanceSectionHelper(): string;
  _interactivitySectionTitle(): string;
  _interactivitySectionHelper(): string;

  // --- Per-section reset-key providers ---
  _appearanceResetKeys(): string[];
  _allergenIconsResetKeys(): string[];
  _levelCirclesResetKeys(): string[];
  _iconInRingResetKeys(): string[];
  _integrationResetKeys(): string[];
  _allergensResetKeys(): string[];
  _phrasesResetKeys(): string[];

  // --- Shared form-control render helpers ---
  _renderNumberField(opts: NumberFieldOptions): TemplateResult;
  _renderTextField(opts: TextFieldOptions): TemplateResult;
  _renderResetButton(opts: ResetButtonOptions): TemplateResult;
  _renderTextButton(opts: TextButtonOptions): TemplateResult;
  _renderSectionReset(keys: string[]): TemplateResult;
  _renderAppearanceExtras(): TemplateResult;

  // --- Config mutation + allergen toggles ---
  _updateConfig(prop: string, value: unknown): void;
  _onAllergenToggle(allergen: string, checked: boolean): void;
  _toggleSelectAllAllergens(allergens: string[]): void;
  _toggleAllergenSubset(subset: string[]): void;
  _resetPhrases(lang: string): void;

  requestUpdate(): void;
}
