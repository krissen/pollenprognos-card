import type { LovelaceCardConfig } from "./home-assistant.js";

/**
 * An element-level tap action (shared by card and badge). YAML can carry either
 * the HA `action` key or the card's legacy `type` key; both are read through the
 * mixin's unknown-tolerant resolver, so the shape stays loose.
 */
export interface TapActionConfig {
  action?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * User-facing card configuration.
 *
 * YAML is the reality here: a value declared as a boolean in the editor can
 * arrive as the string "true"/"false" (or a number) from a hand-written config.
 * As of the config boundary (src/utils/config-normalize.ts) those values are
 * coerced to their canonical types once at setConfig / set hass, so the known
 * fields below are typed as their *normalized* runtime type. `title` and
 * `date_locale` keep a widened type because they legitimately carry more than
 * one form (title = string label or `false`/`""` to hide; date_locale absent).
 *
 * The index signature stays open so unknown / adapter-added keys (and the
 * render-only cosmetic keys the editor never persists) remain accessible.
 */
export interface CardConfig extends LovelaceCardConfig {
  /** Selected integration id (pp, dwd, silam, ...). Always set after setConfig. */
  integration?: string;

  // --- Location selection (one per integration; strings, "manual" is special) ---
  city?: string;
  location?: string;
  region_id?: string;
  entity_prefix?: string;
  entity_suffix?: string;
  entity_weather?: string;

  // --- Allergen selection + display ---
  allergens?: string[];
  allergens_abbreviated?: boolean;
  allergy_risk_top?: boolean;
  index_top?: boolean;
  pollen_threshold?: number;
  sort?: string;
  mode?: string;

  // --- Day columns ---
  days_to_show?: number;
  days_relative?: boolean;
  days_abbreviated?: boolean;
  days_uppercase?: boolean;
  days_boldfaced?: boolean;
  show_empty_days?: boolean;

  // --- Value / text toggles ---
  minimal?: boolean;
  minimal_gap?: number;
  show_text_allergen?: boolean;
  show_value_text?: boolean;
  show_value_numeric?: boolean;
  show_value_numeric_in_circle?: boolean;
  numeric_value_raw?: boolean;
  /** Legacy PEU alias of numeric_value_raw. */
  numeric_state_raw_risk?: boolean;
  text_size_ratio?: number;
  show_allergen_column?: boolean;
  show_block_separator?: boolean;

  // --- Summary block (#222) ---
  show_summary_block?: boolean;
  show_summary_row?: boolean;
  show_summary_separator?: boolean;
  show_summary_top_types?: boolean;
  show_summary_plants_in_season?: boolean;

  // --- Icons ---
  icon_size?: number;
  icon_color_mode?: string;
  icon_color?: string;
  icon_in_ring?: boolean;
  icon_in_ring_color_mode?: string;
  icon_in_ring_static_color?: string;
  icon_in_ring_size_ratio?: number;

  // --- Allergen icon styling ---
  allergen_colors?: string[];
  allergen_stroke_width?: number;
  allergen_stroke_color_synced?: boolean;
  allergen_levels_gap_synced?: boolean;

  // --- Level ring styling ---
  levels_colors?: string[];
  levels_empty_color?: string;
  levels_gap_color?: string;
  levels_gap?: number;
  levels_thickness?: number;
  levels_text_color?: string;
  levels_text_size?: number;
  levels_text_weight?: string;
  levels_icon_ratio?: number;

  // --- Misc appearance / behaviour ---
  background_color?: string;
  no_allergens_color?: string;
  show_no_data_distinct?: boolean;
  link_to_sensors?: boolean;
  show_version?: boolean;
  debug?: boolean;

  // --- Adapter-specific ---
  pollution_block_position?: string;
  sort_pollution_block?: boolean;
  sort_category_allergens_first?: boolean;

  // --- Widened / non-uniform ---
  /** Header: a string label, or `false`/`""` to hide the header. */
  title?: string | boolean;
  /** BCP-47 locale tag; absent by default (auto-detected from HA). */
  date_locale?: string;
  /** Per-allergen phrase overrides (full/short/levels/days). */
  phrases?: Record<string, unknown>;
  /** Element-level tap action. */
  tap_action?: TapActionConfig;
  /** card-mod pass-through. */
  card_mod?: unknown;

  [key: string]: boolean | string | number | unknown;
}

/**
 * Badge configuration. Shares the card's YAML-value reality plus the badge's
 * own display keys (badge_content / badge_visual / ...). The badge coerces its
 * bespoke fields in {@link file://../pollenprognos-badge.ts} `_buildConfig`.
 */
export interface BadgeConfig extends CardConfig {
  badge_content?: string;
  badge_single_allergen?: string;
  badge_show_label?: boolean;
  badge_visual?: string;
  badge_scale?: number;
  badge_icon_scale?: number;
  badge_label_position?: string;
  /** What the label says: "allergen" (default) | "level" | "allergen_level". */
  badge_label_content?: string;
}

/**
 * Raw configuration as received before `setConfig` validation/coercion runs.
 * Nothing about it is trustworthy yet, hence fully opaque values.
 */
export type RawCardConfig = Record<string, unknown>;

/**
 * An adapter's `stubConfig*` default-configuration template. Stubs are merged
 * under the user config in `setConfig` (`{ ...stub, ...userConfig }`), so the
 * Lovelace `type` key always comes from the user config, never the stub. The
 * stub therefore omits `type` rather than carrying a placeholder value.
 */
export type AdapterStubConfig = Omit<CardConfig, "type">;
