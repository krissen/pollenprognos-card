// ------------------------------------------------------------------ //
// §10 Advanced section
// Extracted verbatim from PollenEditorBase._renderAdvancedSection; `this` -> `editor`.
// ------------------------------------------------------------------ //

import { html, type TemplateResult } from "lit";
import type { PollenEditorLike } from "../types.js";

export function renderAdvancedSection(
  editor: PollenEditorLike,
): TemplateResult {
  const c = editor._editorConfig();
  return html`
    <details>
      <summary>
        ${editor._t("summary_advanced")}
        ${editor._renderSectionReset(["debug", "show_version"])}
      </summary>
      <div class="section-helper">${editor._t("helper_advanced")}</div>
      <ha-formfield label="${editor._t("debug")}">
        <ha-switch
          .checked=${c.debug}
          @change=${(e: Event) =>
            editor._updateConfig(
              "debug",
              (e.target as HTMLInputElement).checked,
            )}
        ></ha-switch>
      </ha-formfield>
      <ha-formfield label="${editor._t("show_version")}">
        <ha-switch
          .checked=${c.show_version !== false}
          @change=${(e: Event) =>
            editor._updateConfig(
              "show_version",
              (e.target as HTMLInputElement).checked,
            )}
        ></ha-switch>
      </ha-formfield>
      <div class="version-info">${editor._versionLabel()}: ${__VERSION__}</div>
    </details>
  `;
}
