// The normalized sensor contract every adapter's `fetchForecast` returns, and
// which the card/badge render paths consume. Fields are documented per their
// current, empirically-verified usage across all 11 adapters. Do not change
// adapter behaviour to fit the type.

/**
 * One forecast day within a sensor's `days` array.
 *
 * Universal fields (`name`, `day`, `state`, `state_text`) are emitted by every
 * adapter. The rest are integration-specific and absent elsewhere.
 */
export interface ForecastDay {
  /** Localized day label (e.g. weekday name or "Today"). */
  name: string;
  /** Day index/offset, or a date string, depending on adapter. */
  day: string | number;
  /**
   * Normalized severity level. Scale varies by integration (0-6 for
   * PP/SILAM/Atmo, 0-5 for GPL/GP, 0-4 for PEU/Kleenex/MSW/IRMKMI, 0-3 for PLU).
   * `-1` is the sentinel "no data" state honoured by the render path.
   */
  state: number;
  /** Localized level name for `state`. */
  state_text: string;
  /**
   * Display value used by the render path (ring level, numeric value). Always
   * set: it equals `state` for adapters with no separate display value (pp,
   * silam, kleenex) and diverges where the adapter shows something other than
   * the bare level (e.g. dwd scaled, atmo's -1 "unavailable" over state 0).
   */
  display_state: number | string;
  /** Raw underlying measurement (concentration/index): peu, silam, plu. */
  raw_value?: number | string | null;
  /** Per-day icon key: peu, silam. */
  icon?: string;
  /** kleenex-specific: raw ppm measurement carried alongside the level. */
  value?: number | string;
  /** kleenex-specific: localized level description (mirrors state_text). */
  description?: string;
  /** plu-specific: category thresholds carried through for display. */
  thresholds?: unknown;
  /** plu-specific: raw level string from the source. */
  level_string?: string;
  /** plu-specific: last-update timestamp. */
  last_update?: string;
  /** plu-specific: next scheduled poll timestamp. */
  next_poll?: string;
}

/**
 * A normalized pollen (or, for atmo, pollution) sensor.
 *
 * The ordered forecast lives in `days[]`; readers index it directly (`days[0]`
 * is the representative/today row). The old per-day `day0`..`dayN` keys were
 * dropped in the days[] migration -- they were a loop-index artifact, not a
 * designed contract, and diverged from `days[]` when an adapter skipped a
 * mid-sequence day (sparse dayN vs compact days[]).
 */
export interface PollenSensor {
  /** Adapter-normalized allergen slug (e.g. "birch", "graeser"). */
  allergenReplaced: string;
  /** Capitalized human label for the allergen. */
  allergenCapitalized: string;
  /** Short human label for the allergen. */
  allergenShort: string;
  /** Backing HA entity id. */
  entity_id: string;
  /** Ordered forecast days. */
  days: ForecastDay[];

  /** Aggregate/overview row rather than a single allergen: atmo, silam, gpl. */
  isSummary?: boolean;
  /** Row grouping for mixed pollen/pollution sensors: atmo. */
  group?: "pollen" | "pollution";
  /** Data-freshness flags: peu. */
  stale?: boolean;
  staleSince?: string | null;
  /** Dominant pollen summary: gpl. */
  topPollen?: unknown;
  /** In-season plant list: gpl. */
  plantsInSeasonList?: unknown;
  /** Raw entity attributes carried through: plu. */
  attributes?: Record<string, any>;
}
