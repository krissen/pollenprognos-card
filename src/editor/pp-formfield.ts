// ------------------------------------------------------------------ //
// <pp-formfield>: our own label wrapper for editor controls.          //
//                                                                     //
// HA 2026.11 removed `ha-formfield`; a leftover one no longer renders //
// its label (frontend component updates 2026.11, contributors blog,   //
// 2026-10-28). HA's suggested migration (label in the ha-switch /     //
// ha-checkbox default slot) only works on 2026.11+, and many of our   //
// formfields wrap sliders, selectors and text inputs. This element    //
// keeps the old layout on every HA version: the slotted control       //
// first, then the label, inline and vertically centred. Clicking the  //
// label toggles a slotted switch/checkbox, as ha-formfield did.       //
// ------------------------------------------------------------------ //

import { LitElement, html, css, type PropertyDeclarations } from "lit";

const TOGGLE_TAGS = new Set(["HA-SWITCH", "HA-CHECKBOX"]);

export class PpFormfield extends LitElement {
  // Numbers are valid labels (the phrase editor labels levels 0-6 by index),
  // so presence is checked against null/undefined/"", never truthiness.
  declare label: string | number | undefined;
  declare disabled: boolean;

  static override get properties(): PropertyDeclarations {
    return {
      label: { type: String },
      disabled: { type: Boolean, reflect: true },
    };
  }

  constructor() {
    super();
    this.disabled = false;
  }

  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
      color: var(--primary-text-color);
      font-family: var(--ha-font-family-body, Roboto, sans-serif);
      font-size: 0.875rem;
      line-height: 1.25rem;
      padding-block: 2px;
    }
    :host([disabled]) {
      color: var(--disabled-text-color);
    }
    label {
      padding-inline-start: 4px;
      padding-inline-end: 4px;
      cursor: pointer;
    }
    :host([disabled]) label {
      cursor: default;
    }
  `;

  private _onLabelClick(): void {
    if (this.disabled) return;
    const toggle = Array.from(this.children).find((el) =>
      TOGGLE_TAGS.has(el.tagName),
    ) as HTMLElement | undefined;
    toggle?.click();
  }

  override render() {
    const hasLabel =
      this.label !== undefined && this.label !== null && this.label !== "";
    return html`<slot></slot>${
        hasLabel
          ? html`<label @click=${this._onLabelClick}>${this.label}</label>`
          : ""
      }`;
  }
}

if (!customElements.get("pp-formfield")) {
  customElements.define("pp-formfield", PpFormfield);
}

declare global {
  interface HTMLElementTagNameMap {
    "pp-formfield": PpFormfield;
  }
}
