// ------------------------------------------------------------------ //
// §1 Integration & Location section
// Extracted verbatim from PollenEditorBase._renderIntegrationSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html, type TemplateResult } from "lit";
import type { PollenEditorLike } from "../types.js";
import {
  GOOGLE_MAPS_TEXT,
  GOOGLE_POLLEN_SOURCE_TEXT,
} from "../../constants.js";
import { googleAttributionColor } from "../../rendering/google-attribution-styles.js";

export function renderIntegrationSection(
  editor: PollenEditorLike,
): TemplateResult {
  const c = editor._editorConfig();
  return html`
    <!-- §1 Integration & Location -->
    <details open>
      <summary>
        ${editor._t("summary_integration_and_place")}
        ${editor._renderSectionReset(editor._integrationResetKeys())}
      </summary>
      <div class="section-helper">${editor._t("helper_integration_and_place")}</div>

      <div class="subgroup-header">${editor._t("subgroup_source")}</div>

      <ha-formfield label="${editor._t("integration")}">
        <ha-selector
          .hass=${editor._hass}
          .selector=${{
            select: {
              mode: "dropdown",
              options: editor._buildIntegrationOptions(),
            },
          }}
          .value=${c.integration}
          @value-changed=${(e: CustomEvent) => {
            const v = e.detail?.value;
            if (v !== undefined) editor._updateConfig("integration", v);
          }}
        ></ha-selector>
      </ha-formfield>
      ${// Google attribution (#338), shown for the Google-backed integrations
      // right under the picker. Both strings are mandated verbatim by the
      // Google Pollen API attribution policy, so they are never localized.
      // Unlike the card footer this row ignores show_google_attribution: the
      // person configuring the card must see the attribution requirement even
      // when they have turned the footer off.
      c.integration === "gpl" || c.integration === "gp"
        ? html`<div
            class="google-attribution"
            style="--pp-google-attribution-color: ${googleAttributionColor(
              editor._hass,
            )};"
          >
            ${GOOGLE_MAPS_TEXT} — ${GOOGLE_POLLEN_SOURCE_TEXT}
          </div>`
        : ""}
      ${c.integration === "pp"
        ? html`
            <ha-formfield label="${editor._t("city")}">
              <ha-selector
                .hass=${editor._hass}
                .selector=${{
                  select: {
                    mode: "dropdown",
                    options: [
                      {
                        value: "",
                        label: editor._t("location_autodetect"),
                      },
                      ...(editor.installedPpLocations || []).map(([key, label]) => ({
                        value: key,
                        label,
                      })),
                      {
                        value: "manual",
                        label: editor._t("location_manual"),
                      },
                    ],
                  },
                }}
                .value=${c.city || ""}
                @value-changed=${(e: CustomEvent) => {
                  const v = e.detail?.value;
                  if (v !== undefined) editor._updateConfig("city", v);
                }}
              ></ha-selector>
            </ha-formfield>
          `
        : c.integration === "peu"
          ? html`
              <ha-formfield label="${editor._t("location")}">
                <ha-selector
                  .hass=${editor._hass}
                  .selector=${{
                    select: {
                      mode: "dropdown",
                      options: [
                        {
                          value: "",
                          label: editor._t("location_autodetect"),
                        },
                        ...(editor.installedPeuLocations || []).map(([slug, title]) => ({
                          value: slug,
                          label: title,
                        })),
                        {
                          value: "manual",
                          label: editor._t("location_manual"),
                        },
                      ],
                    },
                  }}
                  .value=${c.location || ""}
                  @value-changed=${(e: CustomEvent) => {
                    const v = e.detail?.value;
                    if (v !== undefined) editor._updateConfig("location", v);
                  }}
                ></ha-selector>
              </ha-formfield>
            `
          : c.integration === "silam"
            ? html`
                <ha-formfield label="${editor._t("location")}">
                  <ha-selector
                    .hass=${editor._hass}
                    .selector=${{
                      select: {
                        mode: "dropdown",
                        options: [
                          {
                            value: "",
                            label: editor._t("location_autodetect"),
                          },
                          ...(editor.installedSilamLocations || []).map(([slug, title]) => ({
                            value: slug,
                            label: title,
                          })),
                          {
                            value: "manual",
                            label: editor._t("location_manual"),
                          },
                        ],
                      },
                    }}
                    .value=${c.location || ""}
                    @value-changed=${(e: CustomEvent) => {
                      const v = e.detail?.value;
                      if (v !== undefined) editor._updateConfig("location", v);
                    }}
                  ></ha-selector>
                </ha-formfield>
              `
            : c.integration === "kleenex"
              ? html`
                  <ha-formfield label="${editor._t("location")}">
                    <ha-selector
                      .hass=${editor._hass}
                      .selector=${{
                        select: {
                          mode: "dropdown",
                          options: [
                            {
                              value: "",
                              label: editor._t("location_autodetect"),
                            },
                            ...(editor.installedKleenexLocations || []).map(([slug, title]) => ({
                              value: slug,
                              label: title,
                            })),
                            {
                              value: "manual",
                              label: editor._t("location_manual"),
                            },
                          ],
                        },
                      }}
                      .value=${c.location || ""}
                      @value-changed=${(e: CustomEvent) => {
                        const v = e.detail?.value;
                        if (v !== undefined) editor._updateConfig("location", v);
                      }}
                    ></ha-selector>
                  </ha-formfield>
                `
              : c.integration === "atmo"
                ? html`
                    <ha-formfield label="${editor._t("location")}">
                      <ha-selector
                        .hass=${editor._hass}
                        .selector=${{
                          select: {
                            mode: "dropdown",
                            options: [
                              {
                                value: "",
                                label: editor._t("location_autodetect"),
                              },
                              ...(editor.installedAtmoLocations || []).map(([slug, title]) => ({
                                value: slug,
                                label: title,
                              })),
                              {
                                value: "manual",
                                label: editor._t("location_manual"),
                              },
                            ],
                          },
                        }}
                        .value=${c.location || ""}
                        @value-changed=${(e: CustomEvent) => {
                          const v = e.detail?.value;
                          if (v !== undefined) editor._updateConfig("location", v);
                        }}
                      ></ha-selector>
                    </ha-formfield>
                  `
              : c.integration === "gpl" ||
                  c.integration === "gp" ||
                  c.integration === "msw" ||
                  c.integration === "irmkmi"
                ? html`
                    <ha-formfield label="${editor._t("location")}">
                      <ha-selector
                        .hass=${editor._hass}
                        .selector=${{
                          select: {
                            mode: "dropdown",
                            options: [
                              {
                                value: "",
                                label: editor._t("location_autodetect"),
                              },
                              ...(c.integration === "gp"
                                ? (editor.installedGpLocations || [])
                                : c.integration === "msw"
                                  ? (editor.installedMswLocations || [])
                                  : c.integration === "irmkmi"
                                    ? (editor.installedIrmkmiLocations || [])
                                    : (editor.installedGplLocations || [])
                              ).map(([slug, title]) => ({
                                value: slug,
                                label: title,
                              })),
                              {
                                value: "manual",
                                label: editor._t("location_manual"),
                              },
                            ],
                          },
                        }}
                        .value=${c.location || ""}
                        @value-changed=${(e: CustomEvent) => {
                          const v = e.detail?.value;
                          if (v !== undefined) editor._updateConfig("location", v);
                        }}
                      ></ha-selector>
                    </ha-formfield>
                  `
              : c.integration === "plu"
                ? html`
                    <ha-formfield label="${editor._t("location")}">
                      <ha-selector
                        .hass=${editor._hass}
                        .selector=${{
                          select: {
                            mode: "dropdown",
                            options: [
                              {
                                value: "",
                                label: editor._t("location_autodetect"),
                              },
                              {
                                value: "manual",
                                label: editor._t("location_manual"),
                              },
                            ],
                          },
                        }}
                        .value=${c.location === "manual" ? "manual" : ""}
                        @value-changed=${(e: CustomEvent) => {
                          const v = e.detail?.value;
                          if (v !== undefined) editor._updateConfig("location", v);
                        }}
                      ></ha-selector>
                    </ha-formfield>
                  `
              : html`
                  <ha-formfield label="${editor._t("region_id")}">
                    <ha-selector
                      .hass=${editor._hass}
                      .selector=${{
                        select: {
                          mode: "dropdown",
                          options: [
                            {
                              value: "",
                              label: editor._t("location_autodetect"),
                            },
                            ...(editor.installedDwdLocations || []).map(([key, label]) => ({
                              value: key,
                              label,
                            })),
                            {
                              value: "manual",
                              label: editor._t("location_manual"),
                            },
                          ],
                        },
                      }}
                      .value=${c.region_id || ""}
                      @value-changed=${(e: CustomEvent) => {
                        const v = e.detail?.value;
                        if (v !== undefined) editor._updateConfig("region_id", v);
                      }}
                    ></ha-selector>
                  </ha-formfield>
                `}
      ${!editor._showModeSelector()
        ? ""
        : c.integration === "silam" &&
          editor._hasSilamWeatherEntity(
            c.location as string,
            c.entity_weather as string,
          )
        ? html`
            <ha-formfield label="${editor._t("mode")}">
              <ha-selector
                .hass=${editor._hass}
                .selector=${{
                  select: {
                    mode: "dropdown",
                    options: [
                      { value: "daily", label: editor._t("mode_daily") },
                      { value: "twice_daily", label: editor._t("mode_twice_daily") },
                      { value: "hourly", label: editor._t("mode_hourly") },
                    ],
                  },
                }}
                .value=${c.mode || "daily"}
                @value-changed=${(e: CustomEvent) => {
                  const v = e.detail?.value;
                  if (v !== undefined) editor._updateConfig("mode", v);
                }}
              ></ha-selector>
            </ha-formfield>
          `
        : c.integration === "peu"
          ? html`
              <ha-formfield label="${editor._t("mode")}">
                <ha-selector
                  .hass=${editor._hass}
                  .selector=${{
                    select: {
                      mode: "dropdown",
                      options: [
                        { value: "daily", label: editor._t("mode_daily") },
                        { value: "twice_daily", label: editor._t("mode_twice_daily") },
                        { value: "hourly", label: editor._t("mode_hourly") },
                        { value: "hourly_second", label: editor._t("mode_hourly_second") },
                        { value: "hourly_third", label: editor._t("mode_hourly_third") },
                        { value: "hourly_fourth", label: editor._t("mode_hourly_fourth") },
                        { value: "hourly_sixth", label: editor._t("mode_hourly_sixth") },
                        { value: "hourly_eighth", label: editor._t("mode_hourly_eighth") },
                      ],
                    },
                  }}
                  .value=${c.mode || "daily"}
                  @value-changed=${(e: CustomEvent) => {
                    const v = e.detail?.value;
                    if (v !== undefined) editor._updateConfig("mode", v);
                  }}
                ></ha-selector>
              </ha-formfield>
              <p>${editor._t("peu_nondaily_expl")}</p>
            `
          : ""}
      ${(c.integration === "pp" && c.city === "manual") ||
      (c.integration === "dwd" && c.region_id === "manual") ||
      ((c.integration === "peu" || c.integration === "silam" || c.integration === "kleenex" || c.integration === "atmo" || c.integration === "gpl" || c.integration === "gp" || c.integration === "plu") &&
        c.location === "manual")
        ? html`
            <details>
              <summary>${editor._t("summary_entity_prefix_suffix")}</summary>
              <ha-formfield label="${editor._t("entity_prefix")}">
                ${editor._renderTextField({
                  value: (c.entity_prefix as string) || "",
                  placeholder: editor._t("entity_prefix_placeholder"),
                  onInput: (v) => editor._updateConfig("entity_prefix", v),
                })}
              </ha-formfield>
              <ha-formfield label="${editor._t("entity_suffix")}">
                ${editor._renderTextField({
                  value: (c.entity_suffix as string) || "",
                  placeholder: editor._t("entity_suffix_placeholder"),
                  onInput: (v) => editor._updateConfig("entity_suffix", v),
                })}
              </ha-formfield>
              ${c.integration === "silam"
                ? html`
                    <ha-formfield label="${editor._t("entity_weather")}">
                      ${editor._renderTextField({
                        value: (c.entity_weather as string) || "",
                        placeholder: editor._t("entity_weather_placeholder"),
                        onInput: (v) =>
                          editor._updateConfig("entity_weather", v),
                      })}
                    </ha-formfield>
                  `
                : ""}
            </details>
          `
        : ""}

      <!-- Title subgroup inside §1 (suppressed for elements with no card chrome) -->
      ${editor._showTitleSection()
        ? html`
            <div class="subgroup-header">${editor._t("subgroup_title")}</div>
            <div style="display:flex; gap:8px; align-items:center;">
              <ha-formfield label="${editor._t("title_hide")}">
                <ha-checkbox
                  .checked=${c.title === false}
                  @change=${(e: Event) => {
                    if ((e.target as HTMLInputElement).checked) {
                      editor._updateConfig("title", false);
                    } else {
                      editor._updateConfig("title", true);
                    }
                  }}
                ></ha-checkbox>
              </ha-formfield>
              <ha-formfield label="${editor._t("title_automatic")}">
                <ha-checkbox
                  .checked=${c.title === true || c.title === undefined}
                  @change=${(e: Event) => {
                    if ((e.target as HTMLInputElement).checked) {
                      editor._updateConfig("title", true);
                    } else {
                      editor._updateConfig("title", "");
                    }
                  }}
                ></ha-checkbox>
              </ha-formfield>
            </div>
            <ha-formfield label="${editor._t("title")}">
              ${editor._renderTextField({
                value:
                  typeof c.title === "string"
                    ? c.title
                    : c.title === false
                      ? "(false)"
                      : "",
                placeholder: editor._t("title_placeholder"),
                disabled: c.title === false,
                onInput: (val) => {
                  if (val.trim() === "") {
                    editor._updateConfig("title", true);
                  } else {
                    editor._updateConfig("title", val);
                  }
                },
              })}
            </ha-formfield>
          `
        : ""}
    </details>
  `;
}
