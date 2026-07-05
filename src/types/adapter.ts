import type { HomeAssistant } from "./home-assistant.js";
import type { PollenSensor } from "./sensor.js";
import type { CardConfig } from "./config.js";

/**
 * A forecast event delivered via `hass.connection.subscribeMessage` (SILAM
 * hourly/twice_daily). Its shape is integration-defined; the card forwards it
 * opaquely to `fetchForecast`, so it stays permissive here.
 */
export type ForecastEvent = Record<string, unknown>;

/**
 * The common shape of an integration adapter module (the namespace object from
 * `import * as X`). Every adapter exports `fetchForecast`, `resolveEntityIds`,
 * and a `stubConfig*`. Discovery/classifier helpers are adapter-specific and
 * optional here.
 *
 * Call-site notes:
 * - `fetchForecast` takes an optional third `forecastEvent`; only SILAM reads
 *   it, the others ignore the extra argument.
 * - `resolveEntityIds` takes an optional fourth `precomputedDiscovery`; only
 *   SILAM uses it. It returns a Map of allergen key -> entity id (both
 *   auto-detect and manual mode); `findAvailableSensors` reads `.values()`.
 */
export interface AdapterModule {
  fetchForecast(
    hass: HomeAssistant,
    config: CardConfig,
    forecastEvent?: ForecastEvent | null,
  ): Promise<PollenSensor[]>;

  resolveEntityIds(
    cfg: CardConfig,
    hass: HomeAssistant,
    debug?: boolean,
    precomputedDiscovery?: unknown,
  ): Map<string, string>;

  /** Default configuration template consumed by the editor (`stubConfig*`). */
  stubConfig?: CardConfig;
}
