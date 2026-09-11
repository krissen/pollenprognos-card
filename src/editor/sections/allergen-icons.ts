// ------------------------------------------------------------------ //
// §6 Allergen icons section
// Extracted verbatim from PollenEditorBase._renderAllergenIconsSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html, type TemplateResult } from "lit";
import {
  LEVELS_DEFAULTS,
  convertStrokeWidthToGap,
} from "../../utils/levels-defaults.js";
import type { PollenEditorLike } from "../types.js";

export function renderAllergenIconsSection(
  editor: PollenEditorLike,
): TemplateResult {
  const c = editor._editorConfig();
  const noAllergensColor =
    (c.no_allergens_color as string) || LEVELS_DEFAULTS.no_allergens_color;
  const outlineColor =
    (c.allergen_outline_color as string) || LEVELS_DEFAULTS.levels_gap_color;
  const strokeWidth =
    (c.allergen_stroke_width as number) ??
    LEVELS_DEFAULTS.allergen_stroke_width;
  return html`
    <!-- §6 Allergen icons -->
    <details>
      <summary>
        ${editor._t("summary_allergen_icons")}
        ${editor._renderSectionReset(editor._allergenIconsResetKeys())}
      </summary>
      <div class="section-helper">${editor._t("helper_allergen_icons")}</div>
      <ha-formfield
        label="${editor._t("allergen_color_mode") || "Allergen Color Mode"}"
      >
        <ha-selector
          .hass=${editor._hass}
          .selector=${{
            select: {
              mode: "dropdown",
              options: [
                {
                  value: "default_colors",
                  label:
                    editor._t("allergen_color_default_colors") ||
                    "Default Colors",
                },
                {
                  value: "custom",
                  label: editor._t("allergen_color_custom") || "Custom Colors",
                },
              ],
            },
          }}
          .value=${c.allergen_color_mode || "default_colors"}
          @value-changed=${(e: CustomEvent) => {
            const v = e.detail?.value;
            if (v !== undefined) editor._updateConfig("allergen_color_mode", v);
          }}
        ></ha-selector>
      </ha-formfield>

      ${
        c.allergen_color_mode === "custom"
          ? html`
              <ha-formfield
                label="${
                  editor._t("allergen_colors") || "Allergen Colors (by Level)"
                }"
              >
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${(() => {
                    const defaultAllergenColors =
                      LEVELS_DEFAULTS.allergen_colors;
                    const allergenColors =
                      (c.allergen_colors as string[]) || defaultAllergenColors;

                    return allergenColors.map(
                      (col: string, i: number) => html`
                        <div
                          style="display: flex; align-items: center; gap: 8px;"
                        >
                          <span style="min-width: 60px;">Level ${i}:</span>
                          <input
                            type="color"
                            .value=${(() => {
                              if (i === 0 && col.includes("rgba")) {
                                return "#c8c8c8";
                              }
                              return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(col)
                                ? col
                                : "#000000";
                            })()}
                            @input=${(e: Event) => {
                              const newColors = [...allergenColors];
                              newColors[i] = (
                                e.target as HTMLInputElement
                              ).value;
                              editor._updateConfig(
                                "allergen_colors",
                                newColors,
                              );
                            }}
                            style="width: 28px; height: 28px; border: none; background: none;"
                          />
                          ${editor._renderTextField({
                            value: col,
                            placeholder:
                              i === 0
                                ? editor._t("allergen_empty_placeholder") ||
                                  "rgba(200,200,200,0.15)"
                                : editor._t("allergen_colors_placeholder") ||
                                  "#ffcc00",
                            width: "120px",
                            onInput: (v) => {
                              const newColors = [...allergenColors];
                              newColors[i] = v;
                              editor._updateConfig(
                                "allergen_colors",
                                newColors,
                              );
                            },
                          })}
                          ${editor._renderResetButton({
                            title:
                              editor._t("allergen_colors_reset") || "Reset",
                            style: "margin-left: 8px;",
                            onClick: () => {
                              const newColors = [...allergenColors];
                              newColors[i] =
                                LEVELS_DEFAULTS.allergen_colors[i]!;
                              editor._updateConfig(
                                "allergen_colors",
                                newColors,
                              );
                            },
                          })}
                        </div>
                      `,
                    );
                  })()}
                </div>
              </ha-formfield>

              <ha-formfield
                label="${
                  editor._t("no_allergens_color") || "No Allergens Color"
                }"
              >
                <div style="display: flex; align-items: center; gap: 8px;">
                  <input
                    type="color"
                    .value=${
                      /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(noAllergensColor)
                        ? noAllergensColor
                        : "#a9cfe0"
                    }
                    @input=${(e: Event) =>
                      editor._updateConfig(
                        "no_allergens_color",
                        (e.target as HTMLInputElement).value,
                      )}
                    style="width: 28px; height: 28px; border: none; background: none;"
                  />
                  ${editor._renderTextField({
                    value: noAllergensColor,
                    placeholder:
                      editor._t("no_allergens_color_placeholder") || "#a9cfe0",
                    width: "100px",
                    onInput: (v) =>
                      editor._updateConfig("no_allergens_color", v),
                  })}
                  ${editor._renderResetButton({
                    title: editor._t("no_allergens_color_reset") || "Reset",
                    style: "margin-left: 8px;",
                    onClick: () =>
                      editor._updateConfig(
                        "no_allergens_color",
                        LEVELS_DEFAULTS.no_allergens_color,
                      ),
                  })}
                </div>
              </ha-formfield>
            `
          : ""
      }
      <ha-formfield label="${editor._t("allergen_outline_color")}">
        <div style="display: flex; align-items: center; gap: 8px;">
          <input
            type="color"
            .value=${(() => {
              const color = outlineColor;
              if (color.includes("rgba")) {
                return "#c8c8c8";
              }
              return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color)
                ? color
                : "#c8c8c8";
            })()}
            @input=${(e: Event) =>
              editor._updateConfig(
                "allergen_outline_color",
                (e.target as HTMLInputElement).value,
              )}
            style="width: 28px; height: 28px; border: none; background: none;"
          />
          ${editor._renderTextField({
            value: outlineColor,
            placeholder:
              editor._t("allergen_outline_placeholder") ||
              "rgba(200,200,200,1)",
            width: "100px",
            onInput: (v) => editor._updateConfig("allergen_outline_color", v),
          })}
          ${editor._renderResetButton({
            title: editor._t("allergen_outline_reset") || "Reset",
            style: "margin-left: 8px;",
            onClick: () =>
              editor._updateConfig(
                "allergen_outline_color",
                LEVELS_DEFAULTS.levels_gap_color,
              ),
          })}
        </div>
      </ha-formfield>
      <ha-formfield label="${editor._t("allergen_stroke_color_synced")}">
        <ha-checkbox
          .checked=${c.allergen_stroke_color_synced ?? true}
          @change=${(e: Event) =>
            editor._updateConfig(
              "allergen_stroke_color_synced",
              (e.target as HTMLInputElement).checked,
            )}
        ></ha-checkbox>
      </ha-formfield>
      <ha-formfield label="${editor._t("allergen_stroke_width")}">
        <ha-slider
          min="0"
          max="150"
          step="5"
          .value=${strokeWidth}
          @input=${(e: Event) => {
            const value = Number((e.target as HTMLInputElement).value);
            editor._updateConfig("allergen_stroke_width", value);
            const { inheritMode, gapSynced } = editor._inheritState();
            if (inheritMode === "inherit_allergen" && gapSynced) {
              const levelGap = convertStrokeWidthToGap(value);
              editor._updateConfig("levels_gap", levelGap);
            }
          }}
          style="width: 120px;"
        ></ha-slider>
        ${editor._renderNumberField({
          value: strokeWidth,
          min: 0,
          max: 150,
          step: 5,
          onValue: (value) => {
            editor._updateConfig("allergen_stroke_width", value);
            const { inheritMode, gapSynced } = editor._inheritState();
            if (inheritMode === "inherit_allergen" && gapSynced) {
              const levelGap = convertStrokeWidthToGap(value);
              editor._updateConfig("levels_gap", levelGap);
            }
          },
        })}
        ${editor._renderResetButton({
          title: editor._t("allergen_stroke_width_reset") || "Reset",
          style: "margin-left: 8px;",
          onClick: () =>
            editor._updateConfig(
              "allergen_stroke_width",
              LEVELS_DEFAULTS.allergen_stroke_width,
            ),
        })}
      </ha-formfield>
      <div class="field-helper">
        ${editor._t("helper_allergen_stroke_width")}
      </div>
    </details>
  `;
}
