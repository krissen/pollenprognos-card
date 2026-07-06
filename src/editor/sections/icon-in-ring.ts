// ------------------------------------------------------------------ //
// §8 Icon in ring section
// Extracted verbatim from PollenEditorBase._renderIconInRingSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html, type TemplateResult } from "lit";
import { LEVELS_DEFAULTS } from "../../utils/levels-defaults.js";
import type { PollenEditorLike } from "../types.js";

export function renderIconInRingSection(
  editor: PollenEditorLike,
): TemplateResult {
  const c = editor._editorConfig();
  const sizeRatio =
    (c.icon_in_ring_size_ratio as number) ??
    LEVELS_DEFAULTS.icon_in_ring_size_ratio;
  const staticColor = (c.icon_in_ring_static_color as string) || "";
  return html`
    <!-- §8 Icon in ring -->
    <details>
      <summary>
        ${editor._t("summary_icon_in_ring")}
        ${editor._renderSectionReset(editor._iconInRingResetKeys())}
      </summary>
      <div class="section-helper">${editor._t("helper_icon_in_ring")}</div>
      ${editor._showIconInRingToggle()
        ? html`
            <ha-formfield label="${editor._t("icon_in_ring")}">
              <ha-checkbox
                .checked=${c.icon_in_ring === true}
                @change=${(e: Event) =>
                  editor._updateConfig(
                    "icon_in_ring",
                    (e.target as HTMLInputElement).checked,
                  )}
              ></ha-checkbox>
            </ha-formfield>
          `
        : ""}
      <ha-formfield
        label="${editor._t("icon_in_ring_size_ratio")}"
      >
        <div style="display: flex; align-items: center; gap: 8px;">
          <ha-slider
            min="0.2"
            max="0.9"
            step="0.05"
            .value=${sizeRatio}
            @input=${(e: Event) =>
              editor._updateConfig(
                "icon_in_ring_size_ratio",
                Number((e.target as HTMLInputElement).value),
              )}
          ></ha-slider>
          ${editor._renderNumberField({
            value: sizeRatio,
            min: 0.2,
            max: 0.9,
            step: 0.05,
            onValue: (n) =>
              editor._updateConfig("icon_in_ring_size_ratio", n),
          })}
        </div>
      </ha-formfield>
      <ha-formfield
        label="${editor._t("icon_in_ring_color_mode")}"
      >
        <ha-selector
          .hass=${editor._hass}
          .selector=${{
            select: {
              mode: "dropdown",
              options: [
                {
                  value: "static",
                  label:
                    editor._t("icon_in_ring_color_static") ||
                    "Static color",
                },
                {
                  value: "follow_level",
                  label:
                    editor._t("icon_in_ring_color_follow") ||
                    "Follow level color",
                },
              ],
            },
          }}
          .value=${c.icon_in_ring_color_mode || "static"}
          @value-changed=${(e: CustomEvent) => {
            const v = e.detail?.value;
            if (v !== undefined)
              editor._updateConfig("icon_in_ring_color_mode", v);
          }}
        ></ha-selector>
      </ha-formfield>
      ${(c.icon_in_ring_color_mode || "static") === "static"
        ? html`
            <ha-formfield
              label="${editor._t("icon_in_ring_static_color")}"
            >
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  type="color"
                  .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(staticColor)
                    ? staticColor
                    : "#000000"}
                  @input=${(e: Event) =>
                    editor._updateConfig(
                      "icon_in_ring_static_color",
                      (e.target as HTMLInputElement).value,
                    )}
                  style="width: 28px; height: 28px; border: none; background: none;"
                />
                ${editor._renderTextField({
                  value: staticColor,
                  placeholder: LEVELS_DEFAULTS.icon_in_ring_static_color,
                  width: "100px",
                  onInput: (v) =>
                    editor._updateConfig("icon_in_ring_static_color", v),
                })}
              </div>
            </ha-formfield>
          `
        : ""}
    </details>
  `;
}
