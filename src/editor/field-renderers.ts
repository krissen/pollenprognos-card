// ------------------------------------------------------------------ //
// Shared form-control renderers for the editor.                       //
//                                                                     //
// Native <input>/<button> replacements for HA's removed/migrated      //
// ha-textfield / ha-button (HA 2026.6+), styled via editorControlStyles //
// (.pp-input / .pp-button / .pp-icon-button). Extracted verbatim from  //
// PollenEditorBase; the base keeps thin delegations so the section     //
// code and subclasses call editor._renderNumberField(...) unchanged.  //
// ------------------------------------------------------------------ //

import { html, type TemplateResult } from "lit";
import {
  formatNumberForInput,
  parseLocaleNumber,
} from "../utils/number-format.js";
import type { HomeAssistant } from "../types/home-assistant.js";

/** Options for {@link renderNumberField}. */
export interface NumberFieldOptions {
  value: number | string | null | undefined;
  min?: number;
  max?: number;
  step?: number;
  onValue: (n: number) => void;
  width?: string;
  disabled?: boolean;
}

/** Options for {@link renderTextField}. */
export interface TextFieldOptions {
  value?: string | null;
  onInput: (value: string) => void;
  placeholder?: string;
  width?: string;
  type?: string;
  disabled?: boolean;
}

/** Options for {@link renderResetButton}. */
export interface ResetButtonOptions {
  title?: string;
  onClick: (e: Event) => void;
  style?: string;
  disabled?: boolean;
}

/** Options for {@link renderTextButton}. */
export interface TextButtonOptions {
  label: unknown;
  onClick: (e: Event) => void;
  style?: string;
  disabled?: boolean;
}

/**
 * Render a locale-aware numeric input. Uses our own native `<input>` (HA
 * removed `ha-textfield` in 2026.6) styled via `.pp-input`. Honours the HA
 * profile's number_format instead of the browser/OS locale and accepts either
 * decimal separator. Commits on `change` (blur/enter) so a config-driven
 * re-render doesn't reset the box mid-typing; the paired `<ha-slider>` keeps
 * live preview while dragging.
 */
export function renderNumberField(
  editor: { _hass?: HomeAssistant },
  {
    value,
    min,
    max,
    step,
    onValue,
    width = "80px",
    disabled = false,
  }: NumberFieldOptions,
): TemplateResult {
  const isInt = Number.isInteger(step ?? 1);
  return html`
    <input
      class="pp-input num-field"
      type="text"
      inputmode=${isInt ? "numeric" : "decimal"}
      .value=${formatNumberForInput(value, editor._hass)}
      ?disabled=${disabled}
      style="width: ${width};"
      @change=${(e: Event) => {
        const target = e.target as HTMLInputElement;
        let n = parseLocaleNumber(target.value, editor._hass);
        if (n === null) {
          // Invalid/empty input: restore the displayed value from config.
          // Assigning .value directly is required because Lit dirty-checks the
          // bound .value expression: when the config is unchanged a re-render
          // won't write back, so the invalid text would otherwise persist.
          target.value = formatNumberForInput(value, editor._hass);
          return;
        }
        if (typeof min === "number") n = Math.max(min, n);
        if (typeof max === "number") n = Math.min(max, n);
        if (isInt) n = Math.round(n);
        // Normalise the displayed text to the canonical formatted value so
        // clamped/reformatted input (e.g. "999" -> "3", a different
        // separator, trailing zeros) is reflected even when the resulting
        // config value is unchanged (same Lit dirty-check caveat).
        target.value = formatNumberForInput(n, editor._hass);
        onValue(n);
      }}
    />
  `;
}

/**
 * Render a text input using our own native `<input>` (`.pp-input`), replacing
 * HA's removed `ha-textfield`. Commits live on `input`, mirroring the previous
 * `ha-textfield @input` behaviour. `onInput` receives the raw string value.
 */
export function renderTextField({
  value,
  onInput,
  placeholder = "",
  width = "",
  type = "text",
  disabled = false,
}: TextFieldOptions): TemplateResult {
  return html`
    <input
      class="pp-input"
      type=${type}
      .value=${value ?? ""}
      placeholder=${placeholder}
      ?disabled=${disabled}
      style=${width ? `width: ${width};` : ""}
      @input=${(e: Event) => onInput((e.target as HTMLInputElement).value)}
    />
  `;
}

/**
 * Render the round reset (↺) button using a native `<button>`
 * (`.pp-icon-button`), replacing HA's migrated `ha-button`.
 */
export function renderResetButton({
  title = "",
  onClick,
  style = "",
  disabled = false,
}: ResetButtonOptions): TemplateResult {
  return html`
    <button
      class="pp-icon-button"
      type="button"
      title=${title}
      style=${style}
      ?disabled=${disabled}
      @click=${onClick}
    >
      ↺
    </button>
  `;
}

/**
 * Render a text button (select-all, apply, reset-all) using a native
 * `<button>` (`.pp-button`), replacing HA's migrated `ha-button`.
 */
export function renderTextButton({
  label,
  onClick,
  style = "",
  disabled = false,
}: TextButtonOptions): TemplateResult {
  return html`
    <button
      class="pp-button"
      type="button"
      style=${style}
      ?disabled=${disabled}
      @click=${onClick}
    >
      ${label}
    </button>
  `;
}
