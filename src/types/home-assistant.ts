// Minimal hand-rolled Home Assistant typings.
//
// Following the Mushroom-cards approach, we vendor a small, purpose-built slice
// of the HA frontend types instead of depending on `custom-card-helpers` (which
// lags HA releases). Only the properties this codebase actually reads are typed;
// grep the `hass.` / registry access sites before widening any of these.

/**
 * A single entity state from `hass.states`. The card only reads `state` and
 * `attributes`; the timestamp fields are included for completeness since HA
 * always provides them. `attributes` is genuinely dynamic per-integration data,
 * so it stays an open record (matching HA's own `any`-typed attributes).
 */
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
}

/**
 * Reduced entity-registry entry as exposed on `hass.entities`. This is the
 * frontend's display shape: it lacks `unique_id`/`config_entry_id` for most
 * entities, though some integrations do surface `unique_id` (read by the GP
 * adapter). Location discovery that needs config-subentry data must read the
 * device (see {@link DeviceRegistryEntry.config_entries_subentries}), not this.
 */
export interface EntityRegistryDisplayEntry {
  entity_id: string;
  device_id?: string;
  platform?: string;
  translation_key?: string;
  // HA reports "config" | "diagnostic" | null; discovery only checks falsiness.
  entity_category?: string | null;
  unique_id?: string;
}

/**
 * Device-registry entry from `hass.devices` (the full registry, unlike the
 * reduced `hass.entities`). `config_entries_subentries` maps each config-entry
 * id to its subentry ids (or `[null]` for legacy top-level entries) and is the
 * basis for subentry-aware location keying in `deviceLocationKey`.
 */
export interface DeviceRegistryEntry {
  id: string;
  identifiers: Array<[string, string]>;
  name?: string | null;
  name_by_user?: string | null;
  config_entries?: string[];
  config_entries_subentries?: Record<string, Array<string | null>>;
  primary_config_entry?: string | null;
}

/** Unsubscribe callback returned by `connection.subscribeMessage`. */
export type UnsubscribeFunc = () => void;

/**
 * The websocket connection off `hass.connection`. Only `subscribeMessage` is
 * used (SILAM hourly/twice_daily forecast subscriptions).
 */
export interface HassConnection {
  subscribeMessage<T = unknown>(
    callback: (message: T) => void,
    subscribeMessage: Record<string, unknown>,
  ): Promise<UnsubscribeFunc>;
}

/** Locale settings from `hass.locale`. */
export interface HassLocale {
  language?: string;
  // Mirrors HA's NumberFormat enum (e.g. "comma_decimal", "decimal_comma",
  // "system", "language", "none", ...); read by number-format helpers.
  number_format?: string;
  [key: string]: unknown;
}

/**
 * The `hass` object handed to the card/badge and passed through adapters.
 * Typed to the surface this codebase touches; other members remain permissive
 * via the index signature so future access sites do not require a widening.
 */
export interface HomeAssistant {
  states: Record<string, HassEntity>;
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, DeviceRegistryEntry>;
  language: string;
  locale: HassLocale;
  connection: HassConnection;
  callService?: (
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ) => Promise<unknown>;
  localize?: (key: string, ...args: unknown[]) => string;
  callWS?: <T = unknown>(msg: Record<string, unknown>) => Promise<T>;
  themes?: Record<string, unknown>;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Base Lovelace card config: a `type` plus arbitrary integration keys. */
export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}
