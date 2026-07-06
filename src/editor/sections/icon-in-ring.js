// ------------------------------------------------------------------ //
// §8 Icon in ring section
// Extracted verbatim from PollenEditorBase._renderIconInRingSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html } from "lit";
import { LEVELS_DEFAULTS } from "../../utils/levels-defaults.js";

export function renderIconInRingSection(editor) {
  const c = editor._editorConfig();
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
                @change=${(e) =>
                  editor._updateConfig("icon_in_ring", e.target.checked)}
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
            .value=${c.icon_in_ring_size_ratio ??
            LEVELS_DEFAULTS.icon_in_ring_size_ratio}
            @input=${(e) =>
              editor._updateConfig(
                "icon_in_ring_size_ratio",
                Number(e.target.value),
              )}
          ></ha-slider>
          ${editor._renderNumberField({
            value:
              c.icon_in_ring_size_ratio ??
              LEVELS_DEFAULTS.icon_in_ring_size_ratio,
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
          @value-changed=${(e) => {
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
                  .value=${/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(
                    c.icon_in_ring_static_color || "",
                  )
                    ? c.icon_in_ring_static_color
                    : "#000000"}
                  @input=${(e) =>
                    editor._updateConfig(
                      "icon_in_ring_static_color",
                      e.target.value,
                    )}
                  style="width: 28px; height: 28px; border: none; background: none;"
                />
                ${editor._renderTextField({
                  value: c.icon_in_ring_static_color || "",
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
