// ------------------------------------------------------------------ //
// §7 Level circles section
// Extracted verbatim from PollenEditorBase._renderLevelCirclesSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html, type TemplateResult } from "lit";
import { LEVELS_DEFAULTS } from "../../utils/levels-defaults.js";
import type { PollenEditorLike } from "../types.js";

export function renderLevelCirclesSection(
  editor: PollenEditorLike,
): TemplateResult {
  const c = editor._editorConfig();
  const { inheritMode, gapSynced, gapDisabled } = editor._inheritState();
  const levelsColors = c.levels_colors as string[];
  const levelsTextColor = (c.levels_text_color as string) || "";
  return html`
    <!-- §7 Level circles -->
    <details>
      <summary>
        ${editor._t("summary_level_circles")}
        ${editor._renderSectionReset(editor._levelCirclesResetKeys())}
      </summary>
      <div class="section-helper">${editor._t("helper_level_circles")}</div>
      <ha-formfield
        label="${editor._t("levels_inherit_mode")}"
      >
        <ha-selector
          .hass=${editor._hass}
          .selector=${{
            select: {
              mode: "dropdown",
              options: [
                {
                  value: "inherit_allergen",
                  label:
                    editor._t("levels_inherit_allergen") ||
                    "Inherit from Allergen Colors",
                },
                {
                  value: "custom",
                  label:
                    editor._t("levels_custom") || "Use Custom Level Colors",
                },
              ],
            },
          }}
          .value=${c.levels_inherit_mode || "inherit_allergen"}
          @value-changed=${(e: CustomEvent) => {
            const v = e.detail?.value;
            if (v !== undefined) editor._updateConfig("levels_inherit_mode", v);
          }}
        ></ha-selector>
      </ha-formfield>

      ${inheritMode === "inherit_allergen"
        ? html`
            <ha-formfield
              label="${editor._t("allergen_levels_gap_synced")}"
            >
              <ha-checkbox
                .checked=${c.allergen_levels_gap_synced ?? true}
                @change=${(e: Event) =>
                  editor._updateConfig(
                    "allergen_levels_gap_synced",
                    (e.target as HTMLInputElement).checked,
                  )}
              ></ha-checkbox>
            </ha-formfield>
            <div class="field-helper">${editor._t("helper_allergen_levels_gap_synced")}</div>
          `
        : ""}

      ${inheritMode === "custom"
        ? html`
            <ha-formfield label="${editor._t("levels_colors")}">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${levelsColors.map(
                  (col: string, i: number) => html`
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <input
                        type="color"
                        .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(col)
                          ? col
                          : "#000000"}
                        @input=${(e: Event) => {
                          const newColors = [...levelsColors];
                          newColors[i] = (e.target as HTMLInputElement).value;
                          editor._updateConfig("levels_colors", newColors);
                        }}
                        style="width: 28px; height: 28px; border: none; background: none;"
                      />
                      ${editor._renderTextField({
                        value: col,
                        placeholder: editor._t("levels_colors_placeholder"),
                        width: "100px",
                        onInput: (v) => {
                          const newColors = [...levelsColors];
                          newColors[i] = v;
                          editor._updateConfig("levels_colors", newColors);
                        },
                      })}
                      ${editor._renderResetButton({
                        title: editor._t("levels_reset"),
                        style: "margin-left: 8px;",
                        onClick: () => {
                          const newColors = [...levelsColors];
                          newColors[i] = LEVELS_DEFAULTS.levels_colors[i];
                          editor._updateConfig("levels_colors", newColors);
                        },
                      })}
                    </div>
                  `,
                )}
              </div>
            </ha-formfield>

            <ha-formfield label="${editor._t("levels_empty_color")}">
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  type="color"
                  .value=${(() => {
                    const color =
                      (c.levels_empty_color as string) ||
                      LEVELS_DEFAULTS.levels_empty_color;
                    if (color.includes("rgba")) {
                      return "#c8c8c8";
                    }
                    return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color)
                      ? color
                      : "#c8c8c8";
                  })()}
                  @input=${(e: Event) =>
                    editor._updateConfig(
                      "levels_empty_color",
                      (e.target as HTMLInputElement).value,
                    )}
                  style="width: 28px; height: 28px; border: none; background: none;"
                />
                ${editor._renderTextField({
                  value: c.levels_empty_color as string,
                  placeholder: editor._t("levels_colors_placeholder"),
                  width: "100px",
                  onInput: (v) =>
                    editor._updateConfig("levels_empty_color", v),
                })}
                ${editor._renderResetButton({
                  title: editor._t("levels_reset"),
                  style: "margin-left: 8px;",
                  onClick: () =>
                    editor._updateConfig(
                      "levels_empty_color",
                      LEVELS_DEFAULTS.levels_empty_color,
                    ),
                })}
              </div>
            </ha-formfield>
          `
        : ""}

      <ha-formfield label="${editor._t("levels_thickness")}">
        <ha-slider
          min="10"
          max="90"
          step="1"
          .value=${c.levels_thickness}
          @input=${(e: Event) =>
            editor._updateConfig(
              "levels_thickness",
              Number((e.target as HTMLInputElement).value),
            )}
          style="width: 120px;"
        ></ha-slider>
        ${editor._renderNumberField({
          value: c.levels_thickness as number,
          min: 10,
          max: 90,
          step: 1,
          onValue: (n) => editor._updateConfig("levels_thickness", n),
        })}
        ${editor._renderResetButton({
          title: editor._t("levels_reset"),
          style: "margin-left: 8px;",
          onClick: () =>
            editor._updateConfig("levels_thickness", LEVELS_DEFAULTS.levels_thickness),
        })}
      </ha-formfield>

      <ha-formfield
        label="${editor._t("levels_gap")}"
        .disabled=${gapDisabled}
      >
        <ha-slider
          min="0"
          max="20"
          step="1"
          .value=${c.levels_gap}
          .disabled=${gapDisabled}
          @input=${(e: Event) =>
            editor._updateConfig(
              "levels_gap",
              Number((e.target as HTMLInputElement).value),
            )}
          style="width: 120px;"
        ></ha-slider>
        ${editor._renderNumberField({
          value: c.levels_gap as number,
          min: 0,
          max: 20,
          step: 1,
          disabled: gapDisabled,
          onValue: (n) => editor._updateConfig("levels_gap", n),
        })}
        ${editor._renderResetButton({
          title: editor._t("levels_reset"),
          style: "margin-left: 8px;",
          disabled: gapDisabled,
          onClick: () =>
            editor._updateConfig("levels_gap", LEVELS_DEFAULTS.levels_gap),
        })}
      </ha-formfield>
      <div class="field-helper">
        ${gapDisabled
          ? editor._t("helper_levels_gap_synced")
          : editor._t("helper_levels_gap_unsynced")}
      </div>

      ${inheritMode === "custom" || !gapSynced
        ? html`
            <ha-formfield label="${editor._t("levels_gap_color")}">
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  type="color"
                  .value=${(() => {
                    const color =
                      (c.levels_gap_color as string) ||
                      LEVELS_DEFAULTS.levels_gap_color;
                    if (color.includes("rgba")) {
                      return "#c8c8c8";
                    }
                    return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color)
                      ? color
                      : "#c8c8c8";
                  })()}
                  @input=${(e: Event) =>
                    editor._updateConfig(
                      "levels_gap_color",
                      (e.target as HTMLInputElement).value,
                    )}
                  style="width: 28px; height: 28px; border: none; background: none;"
                />
                ${editor._renderTextField({
                  value: c.levels_gap_color as string,
                  placeholder: editor._t("levels_colors_placeholder"),
                  width: "100px",
                  onInput: (v) => editor._updateConfig("levels_gap_color", v),
                })}
                ${editor._renderResetButton({
                  title: editor._t("levels_reset"),
                  style: "margin-left: 8px;",
                  onClick: () =>
                    editor._updateConfig(
                      "levels_gap_color",
                      LEVELS_DEFAULTS.levels_gap_color,
                    ),
                })}
              </div>
            </ha-formfield>
          `
        : ""}

      ${editor._showNumericInCircleToggle()
        ? html`
            <ha-formfield
              label="${editor._t("show_value_numeric_in_circle")}"
            >
              <ha-switch
                .checked=${c.show_value_numeric_in_circle}
                @change=${(e: Event) =>
                  editor._updateConfig(
                    "show_value_numeric_in_circle",
                    (e.target as HTMLInputElement).checked,
                  )}
              ></ha-switch>
            </ha-formfield>
            <div class="field-helper">
              ${editor._t("helper_show_value_numeric_in_circle")}
            </div>
          `
        : ""}

      ${editor._integrationHasRawValue(c.integration)
        ? html`
            <ha-formfield label="${editor._t("numeric_value_raw")}">
              <ha-switch
                .checked=${c.numeric_value_raw === true ||
                (c.integration === "peu" &&
                  c.numeric_state_raw_risk === true)}
                @change=${(e: Event) => {
                  const on = (e.target as HTMLInputElement).checked;
                  editor._updateConfig("numeric_value_raw", on);
                  // Migrate off the legacy PEU alias so the two cannot
                  // diverge (turning the switch off must not leave
                  // numeric_state_raw_risk: true silently showing raw).
                  if (c.numeric_state_raw_risk === true) {
                    editor._updateConfig("numeric_state_raw_risk", false);
                  }
                }}
              ></ha-switch>
            </ha-formfield>
            <div class="field-helper">
              ${editor._t("helper_numeric_value_raw")}
            </div>
          `
        : ""}

      <ha-formfield label="${editor._t("levels_text_weight")}">
        <ha-selector
          .hass=${editor._hass}
          .selector=${{
            select: {
              mode: "dropdown",
              options: [
                { value: "normal", label: "Normal" },
                { value: "500", label: "Medium" },
                { value: "bold", label: "Bold" },
              ],
            },
          }}
          .value=${c.levels_text_weight || "normal"}
          @value-changed=${(e: CustomEvent) => {
            const v = e.detail?.value;
            if (v !== undefined) editor._updateConfig("levels_text_weight", v);
          }}
        ></ha-selector>
      </ha-formfield>

      <ha-formfield label="${editor._t("levels_text_size")}">
        <ha-slider
          min="0.1"
          max="0.5"
          step="0.05"
          .value=${c.levels_text_size || 0.3}
          @input=${(e: Event) =>
            editor._updateConfig(
              "levels_text_size",
              Number((e.target as HTMLInputElement).value),
            )}
          style="width: 120px;"
        ></ha-slider>
        ${editor._renderNumberField({
          value: (c.levels_text_size as number) || 0.3,
          min: 0.1,
          max: 0.5,
          step: 0.05,
          onValue: (n) => editor._updateConfig("levels_text_size", n),
        })}
      </ha-formfield>

      <ha-formfield label="${editor._t("levels_icon_ratio")}">
        <ha-slider
          min="0.1"
          max="2"
          step="0.05"
          .value=${c.levels_icon_ratio || 1}
          @input=${(e: Event) =>
            editor._updateConfig(
              "levels_icon_ratio",
              Number((e.target as HTMLInputElement).value),
            )}
          style="width: 120px;"
        ></ha-slider>
        ${editor._renderNumberField({
          value: (c.levels_icon_ratio as number) || 1,
          min: 0.1,
          max: 2,
          step: 0.05,
          onValue: (n) => editor._updateConfig("levels_icon_ratio", n),
        })}
      </ha-formfield>

      <ha-formfield label="${editor._t("levels_text_color")}">
        <div style="display: flex; align-items: center; gap: 8px;">
          <input
            type="color"
            .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(levelsTextColor)
              ? levelsTextColor
              : "#000000"}
            @input=${(e: Event) =>
              editor._updateConfig(
                "levels_text_color",
                (e.target as HTMLInputElement).value,
              )}
            style="width: 28px; height: 28px; border: none; background: none;"
          />
          ${editor._renderTextField({
            value: levelsTextColor,
            placeholder: "var(--primary-text-color)",
            width: "100px",
            onInput: (v) => editor._updateConfig("levels_text_color", v),
          })}
        </div>
      </ha-formfield>
    </details>
  `;
}
