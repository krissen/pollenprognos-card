// ------------------------------------------------------------------ //
// §2 Allergens section
// Extracted verbatim from PollenEditorBase._renderAllergensSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html } from "lit";
import { formatNumberForInput } from "../../utils/number-format.js";

export function renderAllergensSection(editor) {
  const c = editor._editorConfig();
  const allergens = editor._currentAllergens();
  const thresholdParams = editor._thresholdParams();

  const SORT_VALUES = [
    "value_ascending",
    "value_descending",
    "name_ascending",
    "name_descending",
    "none",
  ];
  const sortOptions = SORT_VALUES.map((opt) => ({
    value: opt,
    label: editor._t(`sort_${opt}`),
  }));

  return html`
    <!-- §2 Allergens (promoted to §2, moved from old §3) -->
    <details>
      <summary>
        ${editor._t("summary_allergens")}
        ${editor._renderSectionReset(editor._allergensResetKeys())}
      </summary>
      <div class="section-helper">${editor._t("helper_allergens")}</div>
      ${c.integration === "kleenex" || c.integration === "gpl" || c.integration === "gp"
        ? html`
            <!-- Category allergens (controlled by checkbox) -->
            <div class="allergen-section">
              <h4
                style="margin: 8px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
              >
                ${editor._t("allergens_header_category")}
              </h4>
              <div class="allergens-group">
                ${["trees_cat", "grass_cat", "weeds_cat"].map((key) => {
                  const displayName = editor._getAllergenDisplayName(key);
                  return html`
                    <ha-formfield .label=${displayName}>
                      <ha-checkbox
                        .checked=${c.allergens.includes(key)}
                        @change=${(e) =>
                          editor._onAllergenToggle(key, e.target.checked)}
                      ></ha-checkbox>
                    </ha-formfield>
                  `;
                })}
              </div>
            </div>

            <!-- Individual allergens -->
            <div class="allergen-section">
              <h4
                style="margin: 16px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
              >
                ${editor._t("allergens_header_specific")}
              </h4>
              <div class="allergens-group">
                ${allergens
                  .filter(
                    (key) =>
                      !["trees_cat", "grass_cat", "weeds_cat"].includes(
                        key,
                      ),
                  )
                  .sort((a, b) => {
                    const displayA = editor._getAllergenDisplayName(a);
                    const displayB = editor._getAllergenDisplayName(b);
                    return displayA.localeCompare(displayB);
                  })
                  .map((key) => {
                    const displayName = editor._getAllergenDisplayName(key);
                    return html`
                      <ha-formfield .label=${displayName}>
                        <ha-checkbox
                          .checked=${c.allergens.includes(key)}
                          @change=${(e) =>
                            editor._onAllergenToggle(key, e.target.checked)}
                        ></ha-checkbox>
                      </ha-formfield>
                    `;
                  })}
              </div>
            </div>
          `
        : c.integration === "atmo"
          ? html`
              <!-- Atmo France: Summary / Pollen / Pollution blocks -->
              <div class="allergen-section">
                <h4
                  style="margin: 8px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                >
                  ${editor._t("allergens_header_summary")}
                </h4>
                <div class="allergens-group">
                  ${["allergy_risk", "qualite_globale"]
                    .filter((key) => allergens.includes(key))
                    .map((key) => {
                      const displayName =
                        editor._getAllergenDisplayName(key);
                      return html`
                        <ha-formfield .label=${displayName}>
                          <ha-checkbox
                            .checked=${c.allergens.includes(key)}
                            @change=${(e) =>
                              editor._onAllergenToggle(
                                key,
                                e.target.checked,
                              )}
                          ></ha-checkbox>
                        </ha-formfield>
                      `;
                    })}
                </div>
              </div>
              <div class="allergen-section">
                <h4
                  style="margin: 16px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                >
                  ${editor._t("allergens_header_pollen")}
                </h4>
                <div class="allergens-group">
                  ${allergens
                    .filter(
                      (key) =>
                        !["allergy_risk", "qualite_globale", "pm25", "pm10", "ozone", "no2", "so2"].includes(key),
                    )
                    .sort((a, b) => {
                      const displayA = editor._getAllergenDisplayName(a);
                      const displayB = editor._getAllergenDisplayName(b);
                      return displayA.localeCompare(displayB);
                    })
                    .map((key) => {
                      const displayName =
                        editor._getAllergenDisplayName(key);
                      return html`
                        <ha-formfield .label=${displayName}>
                          <ha-checkbox
                            .checked=${c.allergens.includes(key)}
                            @change=${(e) =>
                              editor._onAllergenToggle(
                                key,
                                e.target.checked,
                              )}
                          ></ha-checkbox>
                        </ha-formfield>
                      `;
                    })}
                </div>
              </div>
              <div class="allergen-section">
                <h4
                  style="margin: 16px 0 4px 0; font-size: 0.9em; color: var(--secondary-text-color);"
                >
                  ${editor._t("allergens_header_pollution")}
                </h4>
                <div class="allergens-group">
                  ${["pm25", "pm10", "ozone", "no2", "so2"]
                    .filter((key) => allergens.includes(key))
                    .map((key) => {
                      const displayName =
                        editor._getAllergenDisplayName(key);
                      return html`
                        <ha-formfield .label=${displayName}>
                          <ha-checkbox
                            .checked=${c.allergens.includes(key)}
                            @change=${(e) =>
                              editor._onAllergenToggle(
                                key,
                                e.target.checked,
                              )}
                          ></ha-checkbox>
                        </ha-formfield>
                      `;
                    })}
                </div>
              </div>
            `
          : html`
              <!-- Standard allergen display -->
              <div class="allergens-group">
                ${allergens.map((key) => {
                  const displayName = editor._getAllergenDisplayName(key);
                  return html`
                    <ha-formfield .label=${displayName}>
                      <ha-checkbox
                        .checked=${c.allergens.includes(key)}
                        @change=${(e) =>
                          editor._onAllergenToggle(key, e.target.checked)}
                      ></ha-checkbox>
                    </ha-formfield>
                  `;
                })}
              </div>
            `}
      <div class="preset-buttons">
        ${editor._renderTextButton({
          label: editor._t("select_all_allergens"),
          onClick: () => {
            const allAllergens =
              c.integration === "kleenex"
                ? [...allergens, "trees_cat", "grass_cat", "weeds_cat"]
                : allergens;
            editor._toggleSelectAllAllergens(allAllergens);
          },
        })}
        ${c.integration === "atmo"
          ? html`
              ${editor._renderTextButton({
                label: editor._t("select_all_pollen"),
                onClick: () => {
                  const pollenKeys = allergens.filter(
                    (k) =>
                      !["allergy_risk", "qualite_globale", "pm25", "pm10", "ozone", "no2", "so2"].includes(k),
                  );
                  editor._toggleAllergenSubset(pollenKeys);
                },
              })}
              ${editor._renderTextButton({
                label: editor._t("select_all_pollution"),
                onClick: () => {
                  const pollutionKeys = ["pm25", "pm10", "ozone", "no2", "so2"].filter(
                    (k) => allergens.includes(k),
                  );
                  editor._toggleAllergenSubset(pollutionKeys);
                },
              })}
            `
          : ""}
      </div>
      <div class="slider-row">
        <div class="slider-text">${editor._t("pollen_threshold")}</div>
        <div class="slider-value">${formatNumberForInput(c.pollen_threshold, editor._hass)}</div>
        <ha-slider
          min="${thresholdParams.min}"
          max="${thresholdParams.max}"
          step="${thresholdParams.step}"
          .value=${c.pollen_threshold}
          @input=${(e) =>
            editor._updateConfig("pollen_threshold", Number(e.target.value))}
        ></ha-slider>
      </div>
      <ha-formfield label="${editor._t("sort")}">
        <ha-selector
          .hass=${editor._hass}
          .selector=${{
            select: {
              mode: "dropdown",
              options: sortOptions,
            },
          }}
          .value=${c.sort}
          @value-changed=${(e) => {
            const v = e.detail?.value;
            if (v !== undefined) editor._updateConfig("sort", v);
          }}
        ></ha-selector>
      </ha-formfield>
      ${c.integration === "kleenex" || c.integration === "gpl" || c.integration === "gp"
        ? html`
            <ha-formfield
              label="${editor._t("sort_category_allergens_first")}"
            >
              <ha-checkbox
                .checked=${c.sort_category_allergens_first}
                @change=${(e) =>
                  editor._updateConfig(
                    "sort_category_allergens_first",
                    e.target.checked,
                  )}
              ></ha-checkbox>
            </ha-formfield>
          `
        : ""}
      ${
        // Pin-to-top toggle. Hidden for the summary-block integrations
        // when the block is on, since pinning a row that has been promoted
        // to the block is a no-op (issue #222). PEU keeps it unconditionally.
        (c.integration === "peu" ||
          ((c.integration === "silam" ||
            c.integration === "atmo" ||
            c.integration === "gpl") &&
            !c.show_summary_block))
          ? html`
            <ha-formfield
              label="${c.integration === "silam"
                ? editor._t("index_top")
                : editor._t("allergy_risk_top")}"
            >
              <ha-checkbox
                .checked=${c.integration === "silam"
                  ? c.index_top
                  : c.allergy_risk_top}
                @change=${(e) =>
                  editor._updateConfig(
                    c.integration === "silam"
                      ? "index_top"
                      : "allergy_risk_top",
                    e.target.checked,
                  )}
              ></ha-checkbox>
            </ha-formfield>
          `
        : ""}
      ${
        // Summary block (issue #222): opt-in overall-risk indicator above
        // the rows. Available for the three aggregate-risk integrations.
        c.integration === "silam" ||
        c.integration === "atmo" ||
        c.integration === "gpl"
          ? html`
            <ha-formfield label="${editor._t("show_summary_block")}">
              <ha-checkbox
                .checked=${c.show_summary_block === true}
                @change=${(e) =>
                  editor._updateConfig("show_summary_block", e.target.checked)}
              ></ha-checkbox>
            </ha-formfield>
            ${c.show_summary_block
              ? html`
                  <ha-formfield label="${editor._t("show_summary_row")}">
                    <ha-checkbox
                      .checked=${c.show_summary_row === true}
                      @change=${(e) =>
                        editor._updateConfig(
                          "show_summary_row",
                          e.target.checked,
                        )}
                    ></ha-checkbox>
                  </ha-formfield>
                  ${c.show_summary_row
                    ? html`
                        <ha-formfield
                          label="${editor._t("show_summary_separator")}"
                        >
                          <ha-checkbox
                            .checked=${c.show_summary_separator !== false}
                            @change=${(e) =>
                              editor._updateConfig(
                                "show_summary_separator",
                                e.target.checked,
                              )}
                          ></ha-checkbox>
                        </ha-formfield>
                      `
                    : ""}
                  ${c.integration === "gpl"
                    ? html`
                        <ha-formfield
                          label="${editor._t("show_summary_top_types")}"
                        >
                          <ha-checkbox
                            .checked=${c.show_summary_top_types !== false}
                            @change=${(e) =>
                              editor._updateConfig(
                                "show_summary_top_types",
                                e.target.checked,
                              )}
                          ></ha-checkbox>
                        </ha-formfield>
                        <ha-formfield
                          label="${editor._t(
                            "show_summary_plants_in_season",
                          )}"
                        >
                          <ha-checkbox
                            .checked=${c.show_summary_plants_in_season !==
                            false}
                            @change=${(e) =>
                              editor._updateConfig(
                                "show_summary_plants_in_season",
                                e.target.checked,
                              )}
                          ></ha-checkbox>
                        </ha-formfield>
                      `
                    : ""}
                `
              : ""}
          `
        : ""}
      ${c.integration === "atmo"
        ? html`
            <ha-formfield
              label="${editor._t("sort_pollution_block")}"
            >
              <ha-checkbox
                .checked=${c.sort_pollution_block}
                @change=${(e) =>
                  editor._updateConfig(
                    "sort_pollution_block",
                    e.target.checked,
                  )}
              ></ha-checkbox>
            </ha-formfield>
            ${c.sort_pollution_block
              ? html`
                  <ha-formfield
                    label="${editor._t("pollution_block_position")}"
                  >
                    <ha-selector
                      .hass=${editor._hass}
                      .selector=${{
                        select: {
                          mode: "dropdown",
                          options: [
                            {
                              value: "bottom",
                              label: editor._t("pollution_block_bottom"),
                            },
                            {
                              value: "top",
                              label: editor._t("pollution_block_top"),
                            },
                          ],
                        },
                      }}
                      .value=${c.pollution_block_position || "bottom"}
                      @value-changed=${(e) => {
                        const v = e.detail?.value;
                        if (v !== undefined)
                          editor._updateConfig("pollution_block_position", v);
                      }}
                    ></ha-selector>
                  </ha-formfield>
                  <ha-formfield
                    label="${editor._t("show_block_separator")}"
                  >
                    <ha-checkbox
                      .checked=${c.show_block_separator}
                      @change=${(e) =>
                        editor._updateConfig(
                          "show_block_separator",
                          e.target.checked,
                        )}
                    ></ha-checkbox>
                  </ha-formfield>
                `
              : ""}
          `
        : ""}
    </details>
  `;
}
