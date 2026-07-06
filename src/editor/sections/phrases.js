// ------------------------------------------------------------------ //
// §9 Translations & strings section
// Extracted verbatim from PollenEditorBase._renderPhrasesSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html } from "lit";
import { detectLang, SUPPORTED_LOCALES } from "../../i18n.js";

export function renderPhrasesSection(editor) {
  const c = editor._editorConfig();
  const allergens = editor._currentAllergens();
  const numLevels = editor._currentNumLevels();
  // Type-guard every phrases subfield: YAML can supply a wrong type (e.g.
  // phrases.levels as an object), which would otherwise break rendering.
  const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
  const phrases = isObj(c.phrases) ? c.phrases : {};
  const full = isObj(phrases.full) ? phrases.full : {};
  const short = isObj(phrases.short) ? phrases.short : {};
  const levels = Array.isArray(phrases.levels) ? phrases.levels : [];
  const days = isObj(phrases.days) ? phrases.days : {};
  // Default the language selector from the config's date_locale (not just the
  // HA language) so an existing per-locale override is reflected before the
  // user touches the dropdown. Guard date_locale to a string: detectLang
  // calls .slice() on it, so a non-string YAML value would throw here.
  const dateLocale =
    typeof c.date_locale === "string" ? c.date_locale : undefined;
  const selectedLang =
    editor._selectedPhraseLang || detectLang(editor._hass, dateLocale);
  return html`
    <!-- Translations & strings -->
    <details>
      <summary>
        ${editor._t("summary_translation_and_strings")}
        ${editor._renderSectionReset(editor._phrasesResetKeys())}
      </summary>
      <div class="section-helper">
        ${editor._t("helper_translation_and_strings")}
      </div>
      <ha-formfield label="${editor._t("locale")}">
        ${editor._renderTextField({
          value: dateLocale || "",
          onInput: (v) => editor._updateConfig("date_locale", v),
        })}
      </ha-formfield>
      <h3>${editor._t("phrases")}</h3>
      <div class="preset-buttons">
        <ha-formfield label="${editor._t("phrases_translate_all")}">
          <ha-selector
            .hass=${editor._hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: SUPPORTED_LOCALES.map((code) => ({
                  value: code,
                  label:
                    new Intl.DisplayNames([editor._lang], {
                      type: "language",
                    }).of(code) || code,
                })),
              },
            }}
            .value=${selectedLang}
            @value-changed=${(e) => {
              const v = e.detail?.value;
              if (v !== undefined) editor._selectedPhraseLang = v;
            }}
          ></ha-selector>
        </ha-formfield>
        ${editor._renderTextButton({
          label: editor._t("phrases_apply"),
          onClick: () =>
            editor._resetPhrases(editor._selectedPhraseLang || selectedLang),
        })}
      </div>
      <details>
        <summary>${editor._t("phrases_full")}</summary>
        ${allergens.map(
          (a) => html`
            <ha-formfield .label=${a}>
              ${editor._renderTextField({
                value: full[a] || "",
                onInput: (v) => {
                  const p = {
                    ...phrases,
                    full: { ...full, [a]: v },
                  };
                  editor._updateConfig("phrases", p);
                },
              })}
            </ha-formfield>
          `,
        )}
      </details>
      ${editor._showPhraseShort()
        ? html`
            <details>
              <summary>${editor._t("phrases_short")}</summary>
              ${allergens.map(
                (a) => html`
                  <ha-formfield .label=${a}>
                    ${editor._renderTextField({
                      value: short[a] || "",
                      onInput: (v) => {
                        const p = {
                          ...phrases,
                          short: { ...short, [a]: v },
                        };
                        editor._updateConfig("phrases", p);
                      },
                    })}
                  </ha-formfield>
                `,
              )}
            </details>
          `
        : ""}
      ${editor._showPhraseLevels()
        ? html`
            <details>
              <summary>${editor._t("phrases_levels")}</summary>
              ${Array.from({ length: numLevels }, (_, i) => i).map(
                (i) => html`
                  <ha-formfield .label=${i}>
                    ${editor._renderTextField({
                      value: levels[i] || "",
                      onInput: (v) => {
                        const lv = [...levels];
                        lv[i] = v;
                        editor._updateConfig("phrases", {
                          ...phrases,
                          levels: lv,
                        });
                      },
                    })}
                  </ha-formfield>
                `,
              )}
            </details>
          `
        : ""}
      ${editor._showPhraseDays()
        ? html`
            <details>
              <summary>${editor._t("phrases_days")}</summary>
              ${[0, 1, 2].map(
                (i) => html`
                  <ha-formfield .label=${i}>
                    ${editor._renderTextField({
                      value: days[i] || "",
                      onInput: (v) => {
                        const dd = { ...days, [i]: v };
                        editor._updateConfig("phrases", {
                          ...phrases,
                          days: dd,
                        });
                      },
                    })}
                  </ha-formfield>
                `,
              )}
            </details>
          `
        : ""}
      <ha-formfield label="${editor._t("no_information")}">
        ${editor._renderTextField({
          value: phrases.no_information || "",
          onInput: (v) =>
            editor._updateConfig("phrases", {
              ...phrases,
              no_information: v,
            }),
        })}
      </ha-formfield>
    </details>
  `;
}
