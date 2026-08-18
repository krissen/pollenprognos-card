/**
 * Per-update-cycle discovery memoization: the adoption contract (#321).
 *
 * PR A added memoizeByHass (unit-tested in test/utils/adapter-helpers.test.ts);
 * this file asserts that every adapter actually adopted it, and that adopting
 * it did not change what discovery returns. The invariant is identical for all
 * eleven adapters, so it is table-driven rather than scattered across the
 * per-adapter test files: an adapter added without memoization cannot pass this
 * table, and a reader sees the whole surface in one place.
 *
 * Two independent instruments, deliberately both:
 *
 *   1. vi.spyOn(helpers, "discoverEntitiesByDevice") counts the actual registry
 *      sweeps the adapters make. It sees the engine, so it proves the cache hit
 *      rather than merely trusting the wrapper.
 *   2. window.__ppDiscoveryScans (recordDiscoveryScan) counts the two sweeps
 *      that never reach the engine and therefore cannot be spied on: Kleenex's
 *      kleenexDeviceIds ("Kleenex:deviceIds", #322) and Atmo's detectLocation
 *      ("ATMO:detectLocation", #323). Both are module-private, so the counter
 *      the instrumentation exists for is the only honest way to observe them.
 *      The tests run under the node environment, so `window` is stubbed in.
 *
 * A hass object must never be shared between test cases here: memoization keys
 * on object identity, so a reused fixture would hand a later case a cache hit
 * from an earlier one and make a broken adapter look memoized. Every case
 * builds its own hass; the "new tick" half clones with a spread, which is
 * exactly what HA does semantically (same data, new object).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HomeAssistant } from "../../src/types/home-assistant.js";
import * as helpers from "../../src/utils/adapter-helpers.js";
import {
  createHass,
  createHassWithRegistry,
  createPPSensor,
  GPL_ATTRIBUTION,
} from "../helpers.js";

import { discoverPpSensors } from "../../src/adapters/pp.js";
import { discoverDwdSensors } from "../../src/adapters/dwd.js";
import { discoverPeuSensors } from "../../src/adapters/peu.js";
import { discoverPluSensors } from "../../src/adapters/plu.js";
import { discoverMswSensors } from "../../src/adapters/msw.js";
import { discoverIrmkmiSensors } from "../../src/adapters/irmkmi.js";
import { discoverAtmoSensors } from "../../src/adapters/atmo.js";
import { discoverGpSensors } from "../../src/adapters/gp/index.js";
import { discoverGplSensors } from "../../src/adapters/gpl/index.js";
import { discoverKleenex } from "../../src/adapters/kleenex/index.js";
import { discoverSilamSensors } from "../../src/utils/silam.js";

// ---------------------------------------------------------------------------
// Fixtures: one registry-backed install per adapter
// ---------------------------------------------------------------------------
// Entity-ID and attribute shapes mirror each adapter's own test file, the same
// way test/golden-fixtures.ts does. Each fixture is wired through the entity
// registry so discovery reaches the engine on tier 1/2 rather than the
// tier-3 fallback (which PLU and SILAM disable entirely).

function ppHass(): HomeAssistant {
  // Forecast attributes included so the cross-cycle test below can run a real
  // fetchForecast rather than one that bails out early.
  return createHassWithRegistry([
    {
      entityId: "sensor.pollen_stockholm_bjork",
      state: "3",
      attributes: createPPSensor([3, 2, 1]).attributes,
      deviceId: "dev_pp",
      platform: "pollenprognos",
      deviceMeta: {
        name: "Pollenprognos Stockholm",
        configEntries: ["cfg_pp"],
      },
    },
    {
      entityId: "sensor.pollen_stockholm_gras",
      state: "1",
      attributes: createPPSensor([1, 0, 0]).attributes,
      deviceId: "dev_pp",
      platform: "pollenprognos",
    },
  ]);
}

function dwdHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.pollenflug_birke_50",
      state: "2",
      deviceId: "dev_dwd",
      platform: "dwd_pollenflug",
      deviceMeta: {
        name: "Pollenflug Gefahrenindex",
        configEntries: ["cfg_dwd"],
      },
    },
    {
      entityId: "sensor.pollenflug_erle_50",
      state: "1",
      deviceId: "dev_dwd",
      platform: "dwd_pollenflug",
    },
  ]);
}

function peuHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.polleninformation_vienna_birch",
      state: "2",
      deviceId: "dev_peu",
      platform: "polleninformation",
      deviceMeta: {
        name: "Polleninformation (Vienna)",
        configEntries: ["cfg_peu"],
      },
    },
    {
      entityId: "sensor.polleninformation_vienna_grass",
      state: "1",
      deviceId: "dev_peu",
      platform: "polleninformation",
    },
  ]);
}

function pluHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.pollen_birch",
      state: "2",
      deviceId: "dev_plu",
      platform: "pollen_lu",
      deviceMeta: { name: "Pollen.lu", configEntries: ["cfg_plu"] },
    },
    {
      entityId: "sensor.pollen_grasses",
      state: "1",
      deviceId: "dev_plu",
      platform: "pollen_lu",
    },
  ]);
}

function mswHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.pollen_birch_level_at_8000_za",
      state: "strong",
      deviceId: "dev_msw",
      platform: "swissweather",
      deviceMeta: { name: "MeteoSwiss at 8000-ZA", configEntries: ["cfg_msw"] },
    },
    {
      entityId: "sensor.pollen_grasses_level_at_8000_za",
      state: "weak",
      deviceId: "dev_msw",
      platform: "swissweather",
    },
  ]);
}

function irmkmiHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.home_birch_level",
      state: "green",
      deviceId: "dev_irm",
      platform: "irm_kmi",
      deviceMeta: { name: "IRM KMI Home", configEntries: ["cfg_irm"] },
    },
    {
      entityId: "sensor.home_grasses_level",
      state: "yellow",
      deviceId: "dev_irm",
      platform: "irm_kmi",
    },
  ]);
}

function atmoHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.niveau_bouleau_paris",
      state: "2",
      attributes: { Libellé: "" },
      deviceId: "dev_atmo",
      platform: "atmofrance",
      deviceMeta: { name: "Atmo France Paris", configEntries: ["cfg_atmo"] },
    },
    {
      entityId: "sensor.niveau_graminees_paris",
      state: "1",
      attributes: { Libellé: "" },
      deviceId: "dev_atmo",
      platform: "atmofrance",
    },
  ]);
}

function gpHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.google_pollen_birch",
      state: "Moderate",
      attributes: {
        display_name: "Birch",
        index_value: 2,
        category: "Moderate",
        device_class: "enum",
      },
      deviceId: "dev_gp",
      platform: "google_pollen",
      deviceMeta: { name: "Google Pollen Home", configEntries: ["cfg_gp"] },
    },
    {
      entityId: "sensor.google_pollen_grass",
      state: "Low",
      attributes: {
        display_name: "Grass",
        index_value: 1,
        category: "Low",
        device_class: "enum",
      },
      deviceId: "dev_gp",
      platform: "google_pollen",
    },
  ]);
}

function gplHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.pollen_birch_home",
      state: "2",
      attributes: { code: "BIRCH", attribution: GPL_ATTRIBUTION, forecast: [] },
      deviceId: "dev_gpl",
      platform: "pollenlevels",
      deviceMeta: { name: "Pollen Levels Home", configEntries: ["cfg_gpl"] },
    },
    {
      entityId: "sensor.pollen_grass_home",
      state: "1",
      attributes: {
        code: "GRAMINALES",
        attribution: GPL_ATTRIBUTION,
        forecast: [],
      },
      deviceId: "dev_gpl",
      platform: "pollenlevels",
    },
  ]);
}

function kleenexHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.kleenex_pollen_radar_utrecht_grass",
      state: "12",
      attributes: { details: [], forecast: [] },
      deviceId: "dev_kleenex",
      platform: "kleenex_pollenradar",
      deviceMeta: {
        name: "Kleenex Pollen Radar (Utrecht)",
        identifiers: [["kleenex_pollenradar", "utrecht"]],
        configEntries: ["cfg_kleenex"],
      },
    },
    {
      entityId: "sensor.kleenex_pollen_radar_utrecht_trees",
      state: "8",
      attributes: { details: [], forecast: [] },
      deviceId: "dev_kleenex",
      platform: "kleenex_pollenradar",
    },
  ]);
}

/**
 * Two Kleenex locations whose entity IDs share a prefix: the shape manual-mode
 * scoping exists for (issue #309 follow-up), and the only one that reaches
 * kleenexDeviceIds.
 */
function kleenexTwoLocationHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.kleenex_pollen_grass",
      state: "12",
      attributes: { details: [], forecast: [] },
      deviceId: "dev_home",
      platform: "kleenex_pollenradar",
      deviceMeta: {
        name: "Kleenex pollen",
        identifiers: [["kleenex_pollenradar", "home"]],
        configEntries: ["cfg_home"],
      },
    },
    {
      entityId: "sensor.kleenex_pollen_radar_utrecht_grass",
      state: "8",
      attributes: { details: [], forecast: [] },
      deviceId: "dev_utrecht",
      platform: "kleenex_pollenradar",
      deviceMeta: {
        name: "Kleenex Pollen Radar (Utrecht)",
        identifiers: [["kleenex_pollenradar", "utrecht"]],
        configEntries: ["cfg_utrecht"],
      },
    },
  ]);
}

/**
 * An Atmo install whose only entities are forecast-day ones. Discovery skips
 * them (isRelevant excludes `_j_N`), so resolution falls through to the legacy
 * slug path -- the one detectLocation scans hass.states for.
 */
function atmoForecastOnlyHass(): HomeAssistant {
  return createHass({
    "sensor.niveau_bouleau_paris_j_1": {
      entity_id: "sensor.niveau_bouleau_paris_j_1",
      state: "2",
      attributes: { Libellé: "" },
    },
    "sensor.niveau_graminees_paris_j_1": {
      entity_id: "sensor.niveau_graminees_paris_j_1",
      state: "1",
      attributes: { Libellé: "" },
    },
  });
}

function silamHass(): HomeAssistant {
  return createHassWithRegistry([
    {
      entityId: "sensor.silam_pollen_stockholm_birch",
      state: "30",
      deviceId: "dev_silam",
      platform: "silam_pollen",
      translationKey: "birch",
      deviceMeta: { name: "SILAM Stockholm", configEntries: ["cfg_silam"] },
    },
    {
      entityId: "sensor.silam_pollen_stockholm_grass",
      state: "12",
      deviceId: "dev_silam",
      platform: "silam_pollen",
      translationKey: "grass",
    },
  ]);
}

/** Location count for both discovery shapes (SILAM converts the engine map). */
function locationCount(discovery: unknown): number {
  const locations = (discovery as { locations?: Map<string, unknown> })
    ?.locations;
  return locations ? locations.size : 0;
}

interface MemoCase {
  /** Adapter id, used as the test name. */
  id: string;
  /** The memoized discovery entry point the card and editor call. */
  discover: (hass: HomeAssistant, debug?: boolean) => unknown;
  /** Registry-backed install for this adapter. */
  makeHass: () => HomeAssistant;
}

const CASES: MemoCase[] = [
  { id: "pp", discover: discoverPpSensors, makeHass: ppHass },
  { id: "dwd", discover: discoverDwdSensors, makeHass: dwdHass },
  { id: "peu", discover: discoverPeuSensors, makeHass: peuHass },
  { id: "plu", discover: discoverPluSensors, makeHass: pluHass },
  { id: "msw", discover: discoverMswSensors, makeHass: mswHass },
  { id: "irmkmi", discover: discoverIrmkmiSensors, makeHass: irmkmiHass },
  { id: "atmo", discover: discoverAtmoSensors, makeHass: atmoHass },
  { id: "gp", discover: discoverGpSensors, makeHass: gpHass },
  { id: "gpl", discover: discoverGplSensors, makeHass: gplHass },
  { id: "kleenex", discover: discoverKleenex, makeHass: kleenexHass },
  { id: "silam", discover: discoverSilamSensors, makeHass: silamHass },
];

describe("discovery memoization: per-adapter call counts (#321)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Guards the fixtures themselves: a hass that discovers nothing would still
  // satisfy the call-count assertions (memoizeByHass caches empty results too),
  // so the table would keep passing while proving nothing about real installs.
  it.each(CASES)(
    "$id: the fixture discovers a real location",
    ({ discover, makeHass }) => {
      expect(locationCount(discover(makeHass()))).toBeGreaterThan(0);
    },
  );

  it.each(CASES)(
    "$id: sweeps the registry once per hass and returns the same reference",
    ({ discover, makeHass }) => {
      const spy = vi.spyOn(helpers, "discoverEntitiesByDevice");
      const hass = makeHass();

      const first = discover(hass);
      const second = discover(hass);
      const third = discover(hass);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
      expect(third).toBe(first);
    },
  );

  it.each(CASES)(
    "$id: sweeps again when Home Assistant swaps the hass object",
    ({ discover, makeHass }) => {
      const spy = vi.spyOn(helpers, "discoverEntitiesByDevice");
      const tick1 = makeHass();
      // Same states/registries, new identity: what HA hands the card on every
      // state update.
      const tick2 = { ...tick1 } as HomeAssistant;

      const first = discover(tick1);
      const second = discover(tick2);

      expect(spy).toHaveBeenCalledTimes(2);
      expect(second).not.toBe(first);
      expect(locationCount(second)).toBe(locationCount(first));
    },
  );
});

// ---------------------------------------------------------------------------
// The two sweeps that never reach the engine
// ---------------------------------------------------------------------------
// kleenexDeviceIds (#322) and Atmo's detectLocation (#323) walk the registries
// themselves and are module-private, so neither the engine spy nor a direct
// import can see them. They carry their own recordDiscoveryScan tags precisely
// so they can be counted; these tests read those counters.

describe("discovery memoization: sweeps counted by tag (#322, #323)", () => {
  let counters: Record<string, number>;

  beforeEach(() => {
    counters = {};
    // recordDiscoveryScan is a no-op without a window; the suite runs under the
    // node environment, so stand one up for the duration of the test.
    vi.stubGlobal("window", { __ppDiscoveryScans: counters });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Manual mode is what reaches the device sweep: scopeManualEntities narrows a
  // straddling prefix, and it asks kleenexDeviceIds who owns the prefix.
  const kleenexManualConfig = {
    integration: "kleenex",
    location: "manual",
    entity_prefix: "kleenex_pollen_",
    allergens: ["grass"],
    days_to_show: 2,
    pollen_threshold: 0,
  } as never;

  it("Kleenex:deviceIds: the device sweep runs once per hass", async () => {
    const { fetchForecast } =
      await import("../../src/adapters/kleenex/index.js");
    const hass = kleenexTwoLocationHass();

    await fetchForecast(hass, kleenexManualConfig);
    await fetchForecast(hass, kleenexManualConfig);
    await fetchForecast(hass, kleenexManualConfig);

    expect(counters["Kleenex:deviceIds"]).toBe(1);
  });

  it("Kleenex:deviceIds: the device sweep runs again on a new hass", async () => {
    const { fetchForecast } =
      await import("../../src/adapters/kleenex/index.js");
    const tick1 = kleenexTwoLocationHass();
    const tick2 = { ...tick1 } as HomeAssistant;

    await fetchForecast(tick1, kleenexManualConfig);
    await fetchForecast(tick2, kleenexManualConfig);

    expect(counters["Kleenex:deviceIds"]).toBe(2);
  });

  const atmoLegacyConfig = {
    integration: "atmo",
    location: "",
    allergens: ["birch", "grass"],
  } as never;

  it("ATMO:detectLocation: the state scan runs once per hass", async () => {
    const { resolveEntityIds } = await import("../../src/adapters/atmo.js");
    const hass = atmoForecastOnlyHass();

    resolveEntityIds(atmoLegacyConfig, hass);
    resolveEntityIds(atmoLegacyConfig, hass);
    resolveEntityIds(atmoLegacyConfig, hass);

    expect(counters["ATMO:detectLocation"]).toBe(1);
  });

  it("ATMO:detectLocation: the state scan runs again on a new hass", async () => {
    const { resolveEntityIds } = await import("../../src/adapters/atmo.js");
    const tick1 = atmoForecastOnlyHass();
    const tick2 = { ...tick1 } as HomeAssistant;

    resolveEntityIds(atmoLegacyConfig, tick1);
    resolveEntityIds(atmoLegacyConfig, tick2);

    expect(counters["ATMO:detectLocation"]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cross-cycle: detection and the fetch path share one sweep
// ---------------------------------------------------------------------------
// This is the payoff #321 is actually after. Within one HA tick the card and
// the badge each run their own detection pass and the card then fetches; every
// one of those swept the registries separately before memoization. Two
// detections are what makes the test bite: detectIntegrationStates already
// memoizes within a single DetectionResult, so a single pass would pass even
// unmemoized. The contract is one sweep per platform per tick, no matter how
// many consumers ask.

/** Sweeps the engine performed under a given logTag. */
function sweepsFor(
  spy: { mock: { calls: unknown[][] } },
  logTag: string,
): number {
  return spy.mock.calls.filter(
    (call) => (call[1] as { logTag?: string })?.logTag === logTag,
  ).length;
}

describe("discovery memoization: detection and fetch share one sweep (#321)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pp: two detections plus fetchForecast sweep once", async () => {
    const { detectIntegrationStates } =
      await import("../../src/utils/autodetect.js");
    const { fetchForecast } = await import("../../src/adapters/pp.js");
    const spy = vi.spyOn(helpers, "discoverEntitiesByDevice");
    const hass = ppHass();

    // PP discovery sits behind a lazy getter in the detection result; the card
    // and badge both reach it when resolving the location label.
    detectIntegrationStates(hass).getPpDiscovery();
    detectIntegrationStates(hass).getPpDiscovery();

    await fetchForecast(hass, {
      integration: "pp",
      city: "Stockholm",
      allergens: ["Björk", "Gräs"],
      days_to_show: 3,
      pollen_threshold: 0,
    } as never);

    expect(sweepsFor(spy, "PP")).toBe(1);
  });

  it("kleenex: two detections plus fetchForecast sweep once", async () => {
    const { detectIntegrationStates } =
      await import("../../src/utils/autodetect.js");
    const { fetchForecast } =
      await import("../../src/adapters/kleenex/index.js");
    const spy = vi.spyOn(helpers, "discoverEntitiesByDevice");
    const hass = kleenexHass();

    // Kleenex discovery runs eagerly during detection.
    detectIntegrationStates(hass);
    detectIntegrationStates(hass);

    await fetchForecast(hass, {
      integration: "kleenex",
      location: "utrecht",
      allergens: ["grass", "trees"],
      days_to_show: 3,
      pollen_threshold: 0,
    } as never);

    expect(sweepsFor(spy, "Kleenex")).toBe(1);
  });

  it("every eager detection platform sweeps once across two detections", async () => {
    const { detectIntegrationStates } =
      await import("../../src/utils/autodetect.js");
    const spy = vi.spyOn(helpers, "discoverEntitiesByDevice");
    const hass = kleenexHass();

    detectIntegrationStates(hass);
    detectIntegrationStates(hass);

    // SILAM, Kleenex, ATMO and GP run their discovery eagerly on every
    // detection pass, so they are the ones a second consumer used to double.
    for (const tag of ["SILAM", "Kleenex", "ATMO", "GP"]) {
      expect(sweepsFor(spy, tag), `${tag} sweeps`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// The extra counters must not depend on someone else going first
// ---------------------------------------------------------------------------

describe("discovery memoization: Kleenex:deviceIds installs its own counter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The tests above hand recordDiscoveryScan a counter object that already
  // exists, which hides whether the tag can bootstrap one. In a real debug
  // session nothing pre-creates it: the first sweep of the tick has to, from
  // its own debug flag. The device sweep therefore has to receive that flag
  // through findPrefixOwnerDevice, or it only ever counts when the engine's
  // eager "Kleenex" sweep happens to run first and install the object for it.
  it("counts under debug with no engine sweep beforehand", async () => {
    const { scopeManualEntities } =
      await import("../../src/adapters/kleenex/discovery.js");
    const fakeWindow: { __ppDiscoveryScans?: Record<string, number> } = {};
    vi.stubGlobal("window", fakeWindow);
    const spy = vi.spyOn(helpers, "discoverEntitiesByDevice");
    const hass = kleenexTwoLocationHass();

    const scope = scopeManualEntities(hass, Object.keys(hass.states), {
      prefix: "kleenex_pollen_",
      debug: true,
    });

    // Narrowing happened on the registry alone, so the engine never ran and
    // could not have created the counter object.
    expect(scope.label).toBe("Kleenex pollen");
    expect(spy).not.toHaveBeenCalled();
    expect(fakeWindow.__ppDiscoveryScans).toEqual({ "Kleenex:deviceIds": 1 });
  });

  it("stays silent without debug when nothing opted in", async () => {
    const { scopeManualEntities } =
      await import("../../src/adapters/kleenex/discovery.js");
    const fakeWindow: { __ppDiscoveryScans?: Record<string, number> } = {};
    vi.stubGlobal("window", fakeWindow);
    const hass = kleenexTwoLocationHass();

    scopeManualEntities(hass, Object.keys(hass.states), {
      prefix: "kleenex_pollen_",
    });

    expect(fakeWindow.__ppDiscoveryScans).toBeUndefined();
  });
});
