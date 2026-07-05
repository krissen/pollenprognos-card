import type { LovelaceCardConfig } from "./home-assistant.js";

/**
 * User-facing card configuration.
 *
 * YAML is the reality here: a value declared as a boolean in the editor can
 * arrive as the string "true"/"false" (or a number) from a hand-written YAML
 * config, which is why the code coerces via `coerceBool` and friends. The value
 * union reflects that. A full key inventory is deferred; the index signature
 * keeps the type open until keys are enumerated in a later PR.
 */
export interface CardConfig extends LovelaceCardConfig {
  /** Selected integration id (pp, dwd, silam, ...). */
  integration?: string;
  [key: string]: boolean | string | number | unknown;
}

/**
 * Badge configuration. Shares the same YAML-value reality as {@link CardConfig};
 * kept as a distinct alias so badge-specific keys can be enumerated separately
 * later.
 */
export interface BadgeConfig extends LovelaceCardConfig {
  integration?: string;
  [key: string]: boolean | string | number | unknown;
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
