// src/utils/config-normalize.ts
//
// The single validation/coercion boundary for card configuration.
//
// YAML is the reality: a value the editor writes as a boolean can arrive as the
// string "true"/"false" from a hand-written config, and a numeric field can
// arrive as a numeric string ("4"). Historically each read-site coped on its
// own (coerceBool, Number(), typeof guards) scattered across the card, badge,
// mixin and editor sections. This module folds that into one place so setConfig
// (and the card's set hass) produce a config whose known fields already carry
// their canonical runtime types.
//
// Coercion is intentionally minimal and directed by the cross-stub field-type
// union (see buildFieldTypeSets):
//   - a field that is boolean in any stub coerces the exact strings
//     "true"/"false" to booleans (everything else is left untouched);
//   - a field that is a number in any stub coerces a finite numeric string to
//     a number, and falls back to the stub default when the value can never be
//     one (icon_size: abc, an empty scalar, .nan, a boolean or a nested
//     structure) so read-sites doing arithmetic only ever see a number;
//   - `allergens` is guaranteed to be an array (falls back to the stub default
//     when a malformed non-array slips through).
// Fields no stub types as boolean/number (title, city/location/region_id,
// date_locale, tap_action, ...) are never coerced, so title="false"
// stays the string the header logic expects and entity-id slugs stay strings.
//
// The result is frozen: nothing downstream mutates the card's config in place
// (verified across card, badge, mixin, adapters and utils), so freezing turns a
// stray future mutation into a loud error instead of a silent config drift.

import type {
  AdapterStubConfig,
  CardConfig,
  RawCardConfig,
} from "../types/config.js";
import { getAllAdapterIds, getStubConfig } from "../adapter-registry.js";

/**
 * Known field types, unioned across *all* adapter stubs. Coercion is driven by
 * these sets rather than the single resolved stub so a field is coerced
 * consistently regardless of which integration is active — critical for set
 * hass, which spreads the full (unfiltered) user config: a field the active
 * stub omits (e.g. show_summary_top_types on SILAM/ATMO, defined only in the
 * GPL stub) still coerces to its canonical type. Every field carries a single
 * type across stubs (verified), so the union is unambiguous.
 */
function buildFieldTypeSets(): {
  booleanFields: Set<string>;
  numberFields: Set<string>;
} {
  const booleanFields = new Set<string>();
  const numberFields = new Set<string>();
  for (const id of getAllAdapterIds()) {
    const stub = getStubConfig(id);
    if (!stub) continue;
    for (const [key, value] of Object.entries(stub)) {
      if (typeof value === "boolean") booleanFields.add(key);
      else if (typeof value === "number") numberFields.add(key);
    }
  }
  return { booleanFields, numberFields };
}

const { booleanFields: BOOLEAN_FIELDS, numberFields: NUMBER_FIELDS } =
  buildFieldTypeSets();

// link_to_sensors is a boolean flag that deliberately has NO stub default: its
// absence means "default on" and an explicit `true` is a distinct, meaningful
// opt-in (it lets a configured tap_action be shadowed by per-icon more-info,
// see iconMoreInfoEnabled / #279). Because no stub declares it, the cross-stub
// union above can't discover its type, so register it here so a hand-written
// `link_to_sensors: "false"` YAML string still coerces to a boolean.
BOOLEAN_FIELDS.add("link_to_sensors");

/**
 * Non-stub config keys that setConfig accepts in addition to the resolved
 * adapter stub's own keys. Kept identical to the list the card historically
 * inlined so the allowed-field filter is unchanged.
 */
export const CARD_EXTRA_FIELDS: readonly string[] = [
  "type",
  "card_mod",
  "allergens",
  "icon_size",
  "icon_color_mode",
  "icon_color",
  "city",
  "location",
  "region_id",
  "tap_action",
  // No stub declares link_to_sensors any more (absence = default on, explicit
  // true = opt in to per-icon more-info alongside a tap_action; see #279), so
  // it must be listed here or setConfig's allowed-field filter would strip a
  // user-set value.
  "link_to_sensors",
  "debug",
  "show_version",
  "title",
  "days_to_show",
  "date_locale",
];

/** The field set setConfig keeps: the stub's own keys plus the card extras. */
export function cardAllowedFields(stub: AdapterStubConfig): string[] {
  return Object.keys(stub).concat(CARD_EXTRA_FIELDS as string[]);
}

/**
 * Merge a raw user config onto the adapter stub.
 *
 * `filter: true` (setConfig) keeps only allowed fields; `filter: false`
 * (set hass) spreads the full raw config, preserving the card's long-standing
 * asymmetry where set hass does not strip unknown keys. In both cases the
 * resolved `integration` wins over any value carried in the stub or raw config.
 * The raw object is never mutated (it may be HA's frozen config).
 */
export function mergeCardConfig(
  raw: RawCardConfig,
  stub: AdapterStubConfig,
  { integration, filter }: { integration?: string; filter: boolean },
): Record<string, unknown> {
  let picked: Record<string, unknown>;
  if (filter) {
    picked = {};
    for (const k of cardAllowedFields(stub)) {
      if (k in raw) picked[k] = raw[k];
    }
  } else {
    picked = { ...raw };
  }
  return { ...stub, ...picked, integration };
}

/** Icon edge length in px when `icon_size` is absent or unusable. */
export const DEFAULT_ICON_SIZE = 48;

/**
 * The read-side guard for `icon_size`, shared by the card's three read-sites
 * (minimal rows, daily rows, the `--pollen-icon-size` custom property) and the
 * editor's slider/number field, so they can never disagree about a size.
 *
 * The second half of a two-layer defence: {@link coerceConfigTypes} repairs
 * hand-written YAML (`icon_size: 48px`, plausible since the editor label reads
 * "Icon size (px)") at the config boundary, but not every config reaches the
 * card through it — the editor spreads its config without coercing. And the
 * boundary deliberately keeps 0 and negative numbers, which are legitimate for
 * other number fields but yield invalid CSS or a clamped ring as an edge
 * length. Anything that isn't a positive finite number renders at the default
 * rather than flowing into the geometry, where the daily path would produce a
 * NaN donut width and minimal mode a literal `width: ${value}px`.
 */
export function resolveIconSize(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_ICON_SIZE;
}

/**
 * Replace a number-typed field whose value can never become a finite number
 * (hand-written `icon_size: abc` or `icon_size: true`, an explicit `.nan`, an
 * empty scalar) with the stub default, dropping the key when the resolved stub
 * does not declare the field. Without this the value survives to read-sites
 * that now expect a number and reaches arithmetic — donut geometry calls
 * toFixed on it and aborts the render, the normal-mode paths emit NaN geometry,
 * and minimal mode interpolates it straight into `width: ${value}px`.
 */
function dropUnusableNumber(
  out: Record<string, unknown>,
  key: string,
  stubFields: Record<string, unknown>,
): void {
  if (typeof stubFields[key] === "number") out[key] = stubFields[key];
  else delete out[key];
}

/**
 * Coerce known-typed fields to their canonical runtime types, driven by the
 * cross-stub field-type union ({@link BOOLEAN_FIELDS} / {@link NUMBER_FIELDS}).
 * The stub is used only for the `allergens` array fallback. Returns a new
 * object; the input is not mutated.
 */
export function coerceConfigTypes(
  merged: Record<string, unknown>,
  stub: AdapterStubConfig,
): CardConfig {
  const out: Record<string, unknown> = { ...merged };
  const stubFields = stub as Record<string, unknown>;

  for (const [key, value] of Object.entries(out)) {
    if (BOOLEAN_FIELDS.has(key)) {
      if (value === "true") out[key] = true;
      else if (value === "false") out[key] = false;
    } else if (NUMBER_FIELDS.has(key)) {
      if (typeof value === "string") {
        const n = value.trim() === "" ? NaN : Number(value);
        if (Number.isFinite(n)) out[key] = n;
        else dropUnusableNumber(out, key, stubFields);
      } else if (typeof value !== "number" || !Number.isFinite(value)) {
        // Everything that is neither a usable string nor a finite number:
        // `icon_size: true` (Number(true) === 1, so the old read-sites drew a
        // 1px icon), an object/array from a malformed nesting, null from an
        // empty YAML scalar, .nan, Infinity.
        dropUnusableNumber(out, key, stubFields);
      }
    }
  }

  // allergens must be an array for the adapters / render loops. A malformed
  // non-array (e.g. a hand-written scalar) falls back to the stub default.
  if ("allergens" in out && !Array.isArray(out.allergens)) {
    const stubAllergens = (stub as Record<string, unknown>).allergens;
    if (Array.isArray(stubAllergens)) out.allergens = stubAllergens;
  }

  return out as CardConfig;
}

/**
 * Apply type coercion and freeze the result. The freeze enforces the
 * card-wide invariant that config is immutable once built.
 */
export function finalizeCardConfig(
  merged: Record<string, unknown>,
  stub: AdapterStubConfig,
): CardConfig {
  return Object.freeze(coerceConfigTypes(merged, stub)) as CardConfig;
}

/**
 * The full boundary: merge onto the stub, coerce known types, freeze. Used by
 * setConfig; set hass composes mergeCardConfig + its hass-driven derivations +
 * finalizeCardConfig so the coerce/freeze tail stays shared.
 */
export function normalizeCardConfig(
  raw: RawCardConfig,
  stub: AdapterStubConfig,
  { integration, filter = true }: { integration?: string; filter?: boolean },
): CardConfig {
  return finalizeCardConfig(
    mergeCardConfig(raw, stub, { integration, filter }),
    stub,
  );
}
