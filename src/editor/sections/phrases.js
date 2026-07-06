// ------------------------------------------------------------------ //
// §9 Translations & strings section
// Extracted verbatim from PollenEditorBase._renderPhrasesSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html } from "lit";
import { t, detectLang, SUPPORTED_LOCALES } from "../../i18n.js";
import { normalize } from "../../utils/normalize.js";
import { toCanonicalAllergenKey } from "../../constants.js";

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

/**
 * Seed config.phrases with the localized default names for the chosen
 * language (the "Apply translations" action), and set date_locale to it.
 * Shared by the card and badge editors. Uses _currentAllergens() so the
 * GPL/GP installed plants are included via the editor's discovered list.
 */
export function resetPhrases(editor, lang) {
  if (editor.debug) console.debug("[Editor] resetPhrases - lang:", lang);
  editor._updateConfig("date_locale", lang);

  const integration = editor._config?.integration;
  const rawKeys = editor._currentAllergens();

  const full = {};
  const short = {};
  rawKeys.forEach((raw) => {
    const normKey = normalize(raw);
    const canonKey = toCanonicalAllergenKey(normKey);
    // SILAM's aggregate uses the user-facing 'index' name, not 'allergy_risk'.
    const transKey = normKey === "index" ? "index" : canonKey;
    // Use the shared resolver so a missing editor phrase falls back to the
    // card allergen name / capitalized term instead of storing the raw i18n
    // key as the phrase default (issue #262 follow-up: `graminales`).
    full[raw] = editor._resolveAllergenPhrase(transKey, raw, { lang });
    short[raw] = editor._resolveAllergenPhrase(transKey, raw, {
      short: true,
      lang,
    });
  });

  const numLevels = editor._currentNumLevels();
  // 5-level integrations (MSW, PEU, Kleenex) use the scale-specific severity
  // labels rather than the first five of the 7-level palette.
  const levelKeyPrefix =
    integration === "msw" ||
    integration === "irmkmi" ||
    integration === "peu" ||
    integration === "kleenex"
      ? "editor.phrases_levels5"
      : "editor.phrases_levels";
  const levels = Array.from({ length: numLevels }, (_, i) =>
    t(`${levelKeyPrefix}.${i}`, lang),
  );

  const days = {
    0: t(`editor.phrases_days.0`, lang),
    1: t(`editor.phrases_days.1`, lang),
    2: t(`editor.phrases_days.2`, lang),
  };

  editor._updateConfig("phrases", {
    full,
    short,
    levels,
    days,
    no_information: t("editor.no_information", lang),
  });
}
