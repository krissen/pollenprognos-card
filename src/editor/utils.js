// ------------------------------------------------------------------ //
// Editor-local utilities shared across the base editor and sections.  //
// ------------------------------------------------------------------ //

import { css } from "lit";

// ------------------------------------------------------------------ //
// Recursive merge utility — shared by both editors.                   //
// ------------------------------------------------------------------ //

export const deepMerge = (target, source) => {
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

/**
 * Shared CSS for the per-section ↺ reset button and its summary anchoring.
 * Spliced into both editors' styles (PollenPrognosCardEditor and
 * PollenPrognosBadgeEditor) so the two never drift. `details > summary` reserves
 * right padding for the absolutely-positioned, vertically-centred button;
 * :focus-visible gives keyboard users a ring. Avoids :has() (older Firefox ESR).
 */
export const sectionResetStyles = css`
  details > summary {
    position: relative;
    padding-right: 48px;
  }
  .section-reset {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--divider-color, #ccc);
    background: transparent;
    color: var(--secondary-text-color);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .section-reset:hover,
  .section-reset:focus-visible {
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }
  .section-reset:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 1px;
  }
`;

/**
 * Styling for the editor's own form controls, replacing HA's removed/migrated
 * built-in components (`ha-textfield`, `ha-button`) on HA 2026.6+. Built only
 * from HA theme tokens so native `<input>`/`<button>` match the surrounding HA
 * form fields and inherit the user's theme. Shared by both editors.
 */
export const editorControlStyles = css`
  /* Text/number input — emulates HA's filled textfield look. */
  .pp-input {
    font-family: inherit;
    font-size: 1em;
    color: var(--primary-text-color);
    background: var(
      --mdc-text-field-fill-color,
      var(--secondary-background-color, rgba(0, 0, 0, 0.05))
    );
    border: none;
    border-bottom: 1px solid
      var(--mdc-text-field-idle-line-color, var(--divider-color, #ccc));
    border-radius: 4px 4px 0 0;
    padding: 6px 8px;
    box-sizing: border-box;
    outline: none;
    min-width: 0;
  }
  .pp-input:hover {
    border-bottom-color: var(
      --mdc-text-field-hover-line-color,
      var(--primary-text-color, #212121)
    );
  }
  .pp-input:focus {
    border-bottom: 2px solid var(--primary-color);
    padding-bottom: 5px;
  }
  .pp-input:disabled {
    opacity: 0.5;
    cursor: default;
  }
  /* Numeric variant keeps the compact width used next to the sliders. */
  .pp-input.num-field {
    width: 80px;
    min-width: 80px;
    max-width: 100px;
    font-size: 1.1em;
  }

  /* Text button — outlined, like HA's buttons. */
  .pp-button {
    font-family: inherit;
    font-size: 0.95em;
    color: var(--primary-color);
    background: transparent;
    border: 1px solid var(--primary-color);
    border-radius: 4px;
    padding: 6px 16px;
    cursor: pointer;
    line-height: 1.2;
  }
  .pp-button:hover {
    background: rgba(var(--rgb-primary-color, 33, 150, 243), 0.08);
  }
  .pp-button:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 1px;
  }
  .pp-button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Round reset (↺) button — same look as the per-section reset. */
  .pp-icon-button {
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--divider-color, #ccc);
    background: transparent;
    color: var(--secondary-text-color);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }
  .pp-icon-button:hover,
  .pp-icon-button:focus-visible {
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }
  .pp-icon-button:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 1px;
  }
  .pp-icon-button:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;
