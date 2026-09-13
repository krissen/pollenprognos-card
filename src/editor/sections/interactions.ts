// ------------------------------------------------------------------ //
// §11 Interactivity section
// Extracted verbatim from PollenEditorBase._renderInteractionSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html, type TemplateResult } from "lit";
import type { PollenEditorLike } from "../types.js";
import {
  parseEntityId,
  parseNavigationPath,
  parseServiceId,
} from "../../rendering/level-circle-mixin.js";

export function renderInteractionSection(
  editor: PollenEditorLike,
): TemplateResult {
  const c = editor._editorConfig();
  return html`
    <!-- §10 Interactions -->
    <details>
      <summary>
        ${editor._interactivitySectionTitle()}
        ${editor._renderSectionReset(["tap_action", "link_to_sensors"])}
      </summary>
      <div class="section-helper">${editor._interactivitySectionHelper()}</div>
      <h3>${editor._t("tap_action")}</h3>
      <ha-formfield label="${editor._t("link_to_sensors")}">
        <ha-switch
          .checked=${c.link_to_sensors !== false}
          @change=${(e: Event) =>
            editor._updateConfig(
              "link_to_sensors",
              (e.target as HTMLInputElement).checked,
            )}
        ></ha-switch>
      </ha-formfield>
      <ha-formfield label="${editor._t("tap_action_enable")}">
        <ha-switch
          .checked=${editor._tapType !== "none"}
          @change=${(e: Event) => {
            // Drop the Lovelace-standard `action` alias: the resolver gives
            // it precedence over `type`, so leaving a stale `action` here
            // would keep the old action live and make the toggle a no-op.
            // Coerce a non-object (e.g. mis-typed YAML `tap_action: "foo"`)
            // to {} first so string indices aren't spread into the config.
            const _ta = editor._config?.tap_action;
            const _base: Record<string, unknown> =
              _ta && typeof _ta === "object" && !Array.isArray(_ta)
                ? (_ta as Record<string, unknown>)
                : {};
            const { action: _drop, ..._rest } = _base;
            if ((e.target as HTMLInputElement).checked) {
              editor._tapType = "more-info";
              editor._updateConfig("tap_action", {
                ..._rest,
                type: "more-info",
              });
            } else {
              editor._tapType = "none";
              editor._updateConfig("tap_action", {
                ..._rest,
                type: "none",
              });
            }
            editor.requestUpdate();
          }}
        ></ha-switch>
      </ha-formfield>
      ${
        editor._tapType !== "none"
          ? html`
              <div style="margin-top: 10px;">
                <label>${editor._t("tap_action_type")}</label>
                <ha-selector
                  .hass=${editor._hass}
                  .selector=${{
                    select: {
                      mode: "dropdown",
                      options: [
                        {
                          value: "more-info",
                          label: editor._t("tap_action_type_more_info"),
                        },
                        {
                          value: "navigate",
                          label: editor._t("tap_action_type_navigate"),
                        },
                        {
                          value: "call-service",
                          label: editor._t("tap_action_type_call_service"),
                        },
                      ],
                    },
                  }}
                  .value=${editor._tapType}
                  @value-changed=${(e: CustomEvent) => {
                    const v = e.detail?.value;
                    if (v === undefined) return;
                    editor._tapType = v as string;
                    const tapAction: Record<string, unknown> = {
                      type: editor._tapType,
                    };
                    if (editor._tapType === "more-info")
                      tapAction.entity = editor._tapEntity;
                    if (editor._tapType === "navigate")
                      tapAction.navigation_path = editor._tapNavigation;
                    if (editor._tapType === "call-service") {
                      tapAction.service = editor._tapService;
                      try {
                        tapAction.service_data = JSON.parse(
                          editor._tapServiceData || "{}",
                        );
                      } catch {
                        tapAction.service_data = {};
                      }
                    }
                    editor._updateConfig("tap_action", tapAction);
                    editor.requestUpdate();
                  }}
                ></ha-selector>
              </div>
              ${
                editor._tapType === "more-info"
                  ? html`
                      <ha-formfield label="${editor._t("tap_action_entity")}">
                        ${editor._renderTextField({
                          value: editor._tapEntity,
                          onInput: (v) => {
                            editor._tapEntity = v;
                            editor._updateConfig("tap_action", {
                              type: "more-info",
                              entity: editor._tapEntity,
                            });
                          },
                        })}
                      </ha-formfield>
                      ${
                        !parseEntityId(editor._tapEntity)
                          ? html`<div class="field-warning">
                              ${editor._t("tap_action_more_info_needs_entity")}
                            </div>`
                          : ""
                      }
                    `
                  : ""
              }
              ${
                editor._tapType === "navigate"
                  ? html`
                      <ha-formfield
                        label="${editor._t("tap_action_navigation_path")}"
                      >
                        ${editor._renderTextField({
                          value: editor._tapNavigation,
                          onInput: (v) => {
                            editor._tapNavigation = v;
                            editor._updateConfig("tap_action", {
                              type: "navigate",
                              navigation_path: editor._tapNavigation,
                            });
                          },
                        })}
                      </ha-formfield>
                      ${
                        !parseNavigationPath(editor._tapNavigation)
                          ? html`<div class="field-warning">
                              ${editor._t("tap_action_navigate_needs_path")}
                            </div>`
                          : ""
                      }
                    `
                  : ""
              }
              ${
                editor._tapType === "call-service"
                  ? html`
                      <ha-formfield label="${editor._t("tap_action_service")}">
                        ${editor._renderTextField({
                          value: editor._tapService,
                          onInput: (v) => {
                            editor._tapService = v;
                            let data = {};
                            try {
                              data = JSON.parse(editor._tapServiceData || "{}");
                            } catch {}
                            editor._updateConfig("tap_action", {
                              type: "call-service",
                              service: editor._tapService,
                              service_data: data,
                            });
                          },
                        })}
                      </ha-formfield>
                      ${
                        !parseServiceId(editor._tapService)
                          ? html`<div class="field-warning">
                              ${editor._t("tap_action_call_service_needs_service")}
                            </div>`
                          : ""
                      }
                      <ha-formfield
                        label="${editor._t("tap_action_service_data")}"
                      >
                        ${editor._renderTextField({
                          value: editor._tapServiceData,
                          onInput: (v) => {
                            editor._tapServiceData = v;
                            let data = {};
                            try {
                              data = JSON.parse(editor._tapServiceData || "{}");
                            } catch {}
                            editor._updateConfig("tap_action", {
                              type: "call-service",
                              service: editor._tapService,
                              service_data: data,
                            });
                          },
                        })}
                      </ha-formfield>
                    `
                  : ""
              }
            `
          : ""
      }
    </details>
  `;
}
