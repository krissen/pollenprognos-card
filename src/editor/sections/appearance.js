// ------------------------------------------------------------------ //
// §5 Card appearance section
// Extracted verbatim from PollenEditorBase._renderAppearanceSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html } from "lit";

export function renderAppearanceSection(editor) {
  const c = editor._editorConfig();
  return html`
    <!-- §5 Appearance (badge editor overrides the title to "Badge appearance") -->
    <details>
      <summary>
        ${editor._appearanceSectionTitle()}
        ${editor._renderSectionReset(editor._appearanceResetKeys())}
      </summary>
      <div class="section-helper">${editor._appearanceSectionHelper()}</div>
      <ha-formfield label="${editor._t("background_color")}">
          <div style="display:flex; gap:8px; align-items:center;">
            ${editor._renderTextField({
              value: c.background_color || "",
              placeholder: editor._t("background_color_placeholder") || "#ffffff",
              width: "120px",
              onInput: (v) => editor._updateConfig("background_color", v),
            })}
            <input
              type="color"
              .value=${c.background_color &&
              /^#[0-9a-fA-F]{6}$/.test(c.background_color)
                ? c.background_color
                : "#ffffff"}
              @input=${(e) =>
                editor._updateConfig("background_color", e.target.value)}
              style="width: 36px; height: 32px; border: none; background: none; cursor: pointer;"
              title="${editor._t("background_color_picker") || "Pick color"}"
            />
          </div>
        </ha-formfield>
        ${editor._showCardSizeControls()
          ? html`
              <ha-formfield label="${editor._t("icon_size")}">
                <ha-slider
                  min="16"
                  max="128"
                  step="1"
                  .value=${c.icon_size ?? 48}
                  @input=${(e) =>
                    editor._updateConfig("icon_size", Number(e.target.value))}
                  style="width: 120px;"
                ></ha-slider>
                ${editor._renderNumberField({
                  value: c.icon_size ?? 48,
                  min: 16,
                  max: 128,
                  step: 1,
                  onValue: (n) => editor._updateConfig("icon_size", n),
                })}
              </ha-formfield>
              <ha-formfield label="${editor._t("text_size_ratio")}">
                <ha-slider
                  min="0.5"
                  max="2"
                  step="0.05"
                  .value=${c.text_size_ratio ?? 1}
                  @input=${(e) =>
                    editor._updateConfig(
                      "text_size_ratio",
                      Number(e.target.value),
                    )}
                  style="width: 120px;"
                ></ha-slider>
                ${editor._renderNumberField({
                  value: c.text_size_ratio ?? 1,
                  min: 0.5,
                  max: 2,
                  step: 0.05,
                  onValue: (n) => editor._updateConfig("text_size_ratio", n),
                })}
              </ha-formfield>
            `
          : ""}
        ${editor._renderAppearanceExtras()}
    </details>
  `;
}
