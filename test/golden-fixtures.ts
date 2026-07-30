/**
 * Golden / characterization fixtures for adapter fetchForecast output.
 *
 * buildGoldenFixtures() returns a flat list of { adapter, variant, hass,
 * config, forecastEvent } cases. Each case is fed through the adapter's
 * fetchForecast() and its output is snapshotted in goldens.test.js.
 *
 * IMPORTANT: the builders call `new Date()` (directly and via the shared
 * test factories). Callers MUST freeze time with vi.useFakeTimers() +
 * vi.setSystemTime() BEFORE invoking buildGoldenFixtures(), otherwise the
 * date-driven forecast windows and day labels will not be deterministic.
 *
 * These fixtures deliberately exercise the code paths that the base
 * extraction (createEntityResolver / runForecastScaffold / padDays / scaling
 * tables) touches: the resolveEntityIds 3-path cascade, the per-allergen
 * scaffold loop, the padding loops, and the per-adapter level-scaling tables.
 * The fixtures reuse the exact entity-id / attribute shapes from each
 * adapter's own passing test file so the golden output stays stable.
 */

import {
  createHass,
  createPPSensor,
  createDWDSensor,
  createPLUSensor,
  createMSWSensor,
} from "./helpers.js";

import { stubConfigPP } from "../src/adapters/pp.js";
import { stubConfigDWD } from "../src/adapters/dwd.js";
import { stubConfigPEU } from "../src/adapters/peu.js";
import { stubConfigSILAM } from "../src/adapters/silam.js";
import { stubConfigATMO, ATMO_ALLERGEN_MAP, ATMO_POLLUTION_ALLERGENS } from "../src/adapters/atmo.js";
import { stubConfigPLU } from "../src/adapters/plu.js";
import { stubConfigMSW } from "../src/adapters/msw.js";
import { stubConfigIRMKMI } from "../src/adapters/irmkmi.js";
import { stubConfigKleenex } from "../src/adapters/kleenex/index.js";
import { stubConfigGP } from "../src/adapters/gp/index.js";
import { stubConfigGPL, GPL_ATTRIBUTION } from "../src/adapters/gpl/index.js";

// ---------------------------------------------------------------------------
// Per-adapter local builders (mirrors of the helpers in each *.test.js).
// ---------------------------------------------------------------------------

// -- PP -------------------------------------------------------------------
function ppHass(cityKey: string, allergenMap: Record<string, Array<number | null>>) {
  const states: Record<string, any> = {};
  for (const [allergen, levels] of Object.entries(allergenMap)) {
    states[`sensor.pollen_${cityKey}_${allergen}`] = createPPSensor(levels);
  }
  return createHass(states);
}

// -- DWD ------------------------------------------------------------------
function dwdHass(
  regionId: string,
  allergenMap: Record<string, [number, number, number]>,
) {
  const states: Record<string, any> = {};
  for (const [allergen, [today, tomorrow, twoDays]] of Object.entries(allergenMap)) {
    states[`sensor.pollenflug_${allergen}_${regionId}`] = createDWDSensor(
      today,
      tomorrow,
      twoDays,
    );
  }
  return createHass(states, { language: "de" });
}

// -- PEU ------------------------------------------------------------------
function peuSensor(levelValues: number[], opts: Record<string, any> = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const forecast = levelValues.map((lv, i) => {
    const d = new Date(today.getTime() + i * 86400000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return { datetime: `${yyyy}-${mm}-${dd}T00:00:00`, level: lv };
  });
  return {
    state: String(levelValues[0] ?? 0),
    attributes: { forecast, data_stale: false, ...opts },
  };
}

function peuHass(location: string, allergenMap: Record<string, number[]>, opts: Record<string, any> = {}) {
  const states: Record<string, any> = {};
  for (const [allergen, levels] of Object.entries(allergenMap)) {
    states[`sensor.polleninformation_${location}_${allergen}`] = peuSensor(levels, opts);
  }
  return createHass(states);
}

// -- SILAM ----------------------------------------------------------------
function silamHass(location: string, weatherAttrs: Record<string, any> = {}) {
  const weatherEntityId = `weather.silam_pollen_${location.toLowerCase()}_forecast`;
  const states = {
    [weatherEntityId]: {
      state: "sunny",
      attributes: {
        pollen_birch: 30,
        pollen_alder: 5,
        pollen_grass: 12,
        index: 2,
        forecast: [
          { datetime: "2026-06-16T00:00:00", pollen_birch: 40, pollen_alder: 10, pollen_grass: 20, index: 3 },
          { datetime: "2026-06-17T00:00:00", pollen_birch: 20, pollen_alder: 2, pollen_grass: 8, index: 1 },
          { datetime: "2026-06-20T00:00:00", pollen_birch: 60, pollen_alder: 1, pollen_grass: 30, index: 4 },
        ],
        ...weatherAttrs,
      },
    },
  };
  return createHass(states, { entities: {}, language: "en" });
}

// -- ATMO -----------------------------------------------------------------
function atmoHass(location: string, allergenStates: Array<[string, number, number?]>) {
  const states: Record<string, any> = {};
  for (const [allergen, todayVal, tomorrowVal] of allergenStates) {
    const frSlug = ATMO_ALLERGEN_MAP[allergen];
    let todayId;
    if (allergen === "allergy_risk") {
      todayId = `sensor.qualite_globale_pollen_${location}`;
    } else if (allergen === "qualite_globale") {
      todayId = `sensor.qualite_globale_${location}`;
    } else if (ATMO_POLLUTION_ALLERGENS.has(allergen)) {
      todayId = `sensor.${frSlug}_${location}`;
    } else {
      todayId = `sensor.niveau_${frSlug}_${location}`;
    }
    const j1Id = `${todayId}_j_1`;
    states[todayId] = { state: String(todayVal), attributes: { "Libellé": "" } };
    if (tomorrowVal !== undefined) {
      states[j1Id] = { state: String(tomorrowVal), attributes: { "Libellé": "" } };
    }
  }
  return createHass(states, { language: "fr" });
}

// -- PLU ------------------------------------------------------------------
function pluHass(allergenMap: Record<string, number>) {
  const states: Record<string, any> = {};
  for (const [allergen, value] of Object.entries(allergenMap)) {
    states[`sensor.pollen_${allergen}`] = createPLUSensor(value);
  }
  return createHass(states);
}

// -- MSW ------------------------------------------------------------------
function mswHass(allergenMap: Record<string, [string, string]>) {
  const states: Record<string, any> = {};
  for (const [, [mswSlug, levelStr]] of Object.entries(allergenMap)) {
    states[`sensor.pollen_${mswSlug}_level_at_8000_za`] = createMSWSensor(levelStr);
  }
  return createHass(states, { language: "en" });
}

// -- IRMKMI ---------------------------------------------------------------
function irmkmiSensor(colorState: string, attrOverrides: Record<string, any> = {}) {
  return {
    state: colorState,
    attributes: {
      device_class: "enum",
      options: ["green", "yellow", "orange", "red", "purple", "active", "none"],
      attribution: "Weather data from the Royal Meteorological Institute of Belgium meteo.be",
      ...attrOverrides,
    },
  };
}

function irmkmiHass(allergenMap: Record<string, [string, string]>, location = "home") {
  const states: Record<string, any> = {};
  for (const [, [slug, colorState]] of Object.entries(allergenMap)) {
    states[`sensor.${location}_${slug}_level`] = irmkmiSensor(colorState);
  }
  return createHass(states, { language: "en" });
}

// -- Kleenex --------------------------------------------------------------
function kleenexEntity(
  location: string,
  category: string,
  ppmValue: number,
  details: Array<{ name: string; value: number }> = [],
  forecast: Array<{ level: number; details?: any[] }> = [],
) {
  return {
    entity_id: `sensor.kleenex_pollen_radar_${location}_${category}`,
    state: String(ppmValue),
    attributes: {
      details: details.map((d) => ({ name: d.name, value: d.value })),
      forecast: forecast.map((f, i) => ({
        datetime: new Date(Date.now() + (i + 1) * 86400000).toISOString(),
        level: f.level,
        details: f.details || [],
      })),
    },
  };
}

function kleenexHass(entities: Array<{ entity_id: string; [key: string]: any }>) {
  const states: Record<string, any> = {};
  for (const entity of entities) {
    states[entity.entity_id] = entity;
  }
  return createHass(states);
}

// -- GP -------------------------------------------------------------------
function gpSensor(
  displayName: string,
  indexValue: number,
  forecast: Record<string, any> = {},
  attrOverrides: Record<string, any> = {},
) {
  return {
    state: indexValue >= 0 ? "Moderate" : "No data",
    attributes: {
      display_name: displayName,
      index_value: indexValue,
      category: "Moderate",
      in_season: "True",
      icon: "mdi:flower-pollen",
      device_class: "enum",
      ...forecast,
      ...attrOverrides,
    },
  };
}

function gpHass(statesMap: Record<string, any>) {
  return createHass(statesMap, { entities: undefined });
}

// -- GPL ------------------------------------------------------------------
function gplTypeSensor(
  icon: string,
  stateValue: number,
  forecastItems: any[] = [],
  attrOverrides: Record<string, any> = {},
) {
  return {
    state: String(stateValue),
    attributes: {
      icon,
      attribution: GPL_ATTRIBUTION,
      forecast: forecastItems,
      ...attrOverrides,
    },
  };
}

function gplPlantSensor(
  code: string,
  stateValue: number,
  forecastItems: any[] = [],
  attrOverrides: Record<string, any> = {},
) {
  return {
    state: String(stateValue),
    attributes: {
      code,
      attribution: GPL_ATTRIBUTION,
      forecast: forecastItems,
      ...attrOverrides,
    },
  };
}

function gplForecastItem(offset: number, value: number, hasIndex = true) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const d = new Date(base.getTime() + offset * 86400000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return {
    offset,
    date: `${yyyy}-${mm}-${dd}`,
    has_index: hasIndex,
    value,
    category: value === 0 ? "none" : value < 3 ? "low" : "moderate",
  };
}

// Attribution-fallback discovery: no hass.entities, GPL sensors identified by
// their GPL_ATTRIBUTION attribute.
function gplAttr(states: Record<string, any>) {
  return createHass(states, { entities: undefined });
}

// ---------------------------------------------------------------------------
// Fixture assembly
// ---------------------------------------------------------------------------

interface GoldenCase {
  adapter: string;
  variant: string;
  hass: any;
  config: any;
  forecastEvent: any;
}

export function buildGoldenFixtures(): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const add = (
    adapter: string,
    variant: string,
    hass: any,
    config: any,
    forecastEvent: any = null,
  ) => cases.push({ adapter, variant, hass, config, forecastEvent });

  const cfg = (stub: any, overrides: Record<string, any>) => ({ ...stub, ...overrides });

  // -- PP -----------------------------------------------------------------
  add(
    "pp",
    "default",
    ppHass("stockholm", {
      bjork: [3, 4, 2, 1],
      al: [1, 2, 0, 0],
      gras: [2, 3, 1, 0],
    }),
    cfg(stubConfigPP, { city: "Stockholm", allergens: ["Björk", "Al", "Gräs"] }),
  );
  add(
    "pp",
    "padding-and-sentinel",
    ppHass("stockholm", { bjork: [3, 4] }),
    cfg(stubConfigPP, {
      city: "Stockholm",
      allergens: ["Björk"],
      days_to_show: 6,
      pollen_threshold: 0,
    }),
  );
  add(
    "pp",
    "threshold-filtering",
    ppHass("stockholm", { bjork: [3, 4, 2, 1], al: [0, 0, 0, 0] }),
    cfg(stubConfigPP, {
      city: "Stockholm",
      allergens: ["Björk", "Al"],
      pollen_threshold: 1,
    }),
  );
  // Mid-sequence gap: the middle forecast day has no reading (level null) and
  // pollen_threshold > 0, so pp skips it. Under the old day0..dayN contract this
  // produced a SPARSE key set (day0, day2, day3 with no day1) alongside a
  // COMPACT days[] ([today, day2, day3]). Locks that divergence before the
  // days[] migration so the Step-1 diff shows exactly what the sparse dayN
  // keys carried; after the swap only the dayN keys disappear and readers move
  // to the compact days[] (deliberate consistency correction, not a regression).
  add(
    "pp",
    "mid-sequence-gap",
    ppHass("stockholm", { bjork: [3, null, 2, 1] }),
    cfg(stubConfigPP, {
      city: "Stockholm",
      allergens: ["Björk"],
      days_to_show: 4,
      pollen_threshold: 1,
    }),
  );

  // -- DWD ----------------------------------------------------------------
  add(
    "dwd",
    "default",
    dwdHass("50", { erle: [3, 1.5, 0], birke: [2, 1, 0] }),
    cfg(stubConfigDWD, { region_id: "50", allergens: ["erle", "birke"] }),
  );
  add(
    "dwd",
    "days-padding",
    dwdHass("50", { birke: [2, 1, 0] }),
    cfg(stubConfigDWD, { region_id: "50", allergens: ["birke"], days_to_show: 5 }),
  );
  add(
    "dwd",
    "threshold-zero",
    dwdHass("50", { erle: [0, 0, 0], birke: [2, 1, 0] }),
    cfg(stubConfigDWD, {
      region_id: "50",
      allergens: ["erle", "birke"],
      pollen_threshold: 0,
    }),
  );

  // -- PEU ----------------------------------------------------------------
  add(
    "peu",
    "default",
    peuHass("amsterdam", { birch: [2, 1, 0, 0], grasses: [3, 2, 1, 0] }),
    cfg(stubConfigPEU, {
      location: "amsterdam",
      allergens: ["birch", "grasses"],
      pollen_threshold: 0,
    }),
  );
  add(
    "peu",
    "stale-data",
    peuHass("amsterdam", { birch: [2, 1, 0, 0] }, { data_stale: true }),
    cfg(stubConfigPEU, {
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    }),
  );
  add(
    "peu",
    "padding",
    peuHass("amsterdam", { birch: [2, 1] }),
    cfg(stubConfigPEU, {
      location: "amsterdam",
      allergens: ["birch"],
      days_to_show: 5,
      pollen_threshold: 0,
    }),
  );

  // -- SILAM (daily mode, forecastEvent = null) ---------------------------
  add(
    "silam",
    "daily",
    silamHass("stockholm"),
    cfg(stubConfigSILAM, {
      location: "stockholm",
      allergens: ["birch", "alder", "grass"],
      mode: "daily",
      pollen_threshold: 0,
    }),
    null,
  );
  add(
    "silam",
    "daily-with-index",
    silamHass("stockholm"),
    cfg(stubConfigSILAM, {
      location: "stockholm",
      allergens: ["birch", "index"],
      mode: "daily",
      pollen_threshold: 0,
    }),
    null,
  );

  // -- ATMO (pollen + pollution) ------------------------------------------
  add(
    "atmo",
    "default",
    atmoHass("paris", [
      ["birch", 3, 2],
      ["grass", 2, 1],
    ]),
    cfg(stubConfigATMO, { location: "paris", allergens: ["birch", "grass"] }),
  );
  add(
    "atmo",
    "with-pollution",
    atmoHass("paris", [
      ["birch", 3, 2],
      ["no2", 2, 1],
      ["pm10", 1, 0],
    ]),
    cfg(stubConfigATMO, {
      location: "paris",
      allergens: ["birch", "no2", "pm10"],
      pollen_threshold: 0,
    }),
  );
  // Atmo's two special raw levels: 0 = "Indisponible" (no data) and 7 =
  // "Événement". birch's tomorrow is raw 0; grass's today is raw 7. Captures
  // how mapAtmoLevel maps these onto state/display_state, so the Step-3
  // state-normalization diff (raw 0 -> state -1, raw 7 -> state 6, both
  // matching display_state) is visible and reviewable. Committed before that
  // change with the old shape (state 0 / state 7).
  add(
    "atmo",
    "unavailable-and-event",
    atmoHass("paris", [
      ["birch", 3, 0],
      ["grass", 7, 5],
    ]),
    cfg(stubConfigATMO, {
      location: "paris",
      allergens: ["birch", "grass"],
      pollen_threshold: 0,
    }),
  );

  // -- PLU ----------------------------------------------------------------
  add(
    "plu",
    "default",
    pluHass({ birch: 25, alder: 5 }),
    cfg(stubConfigPLU, { allergens: ["birch", "alder"], pollen_threshold: 0 }),
  );
  add(
    "plu",
    "nan-value",
    createHass({ "sensor.pollen_birch": { state: "unavailable", attributes: {} } }),
    cfg(stubConfigPLU, { allergens: ["birch"], pollen_threshold: 0 }),
  );

  // -- MSW ----------------------------------------------------------------
  add(
    "msw",
    "default",
    mswHass({ birch: ["birch", "Medium"], grass: ["grasses", "Low"] }),
    cfg(stubConfigMSW, { allergens: ["birch", "grass"], pollen_threshold: 0 }),
  );

  // -- IRMKMI -------------------------------------------------------------
  add(
    "irmkmi",
    "default",
    irmkmiHass({ birch: ["birch", "yellow"], grass: ["grasses", "orange"] }),
    cfg(stubConfigIRMKMI, { allergens: ["birch", "grass"], pollen_threshold: 0 }),
  );

  // -- Kleenex (category + individual + forecast + NA fallback) -----------
  add(
    "kleenex",
    "default",
    kleenexHass([
      kleenexEntity(
        "amsterdam",
        "trees",
        200,
        [
          { name: "Birch", value: 150 },
          { name: "Oak", value: 50 },
        ],
        [
          { level: 3, details: [{ name: "Birch", value: 120 }, { name: "Oak", value: 40 }] },
          { level: 1, details: [{ name: "Birch", value: 10 }, { name: "Oak", value: 5 }] },
        ],
      ),
    ]),
    cfg(stubConfigKleenex, {
      location: "amsterdam",
      allergens: ["birch", "oak", "trees_cat"],
      pollen_threshold: 0,
    }),
  );

  // -- GP -----------------------------------------------------------------
  add(
    "gp",
    "default",
    gpHass({
      "sensor.google_pollen_grass": gpSensor("Grass", 3, { tomorrow: 2 }),
      "sensor.google_pollen_birch": gpSensor("Birch", 4, { tomorrow: 3 }),
    }),
    cfg(stubConfigGP, {
      allergens: ["grass_cat", "birch"],
      pollen_threshold: 0,
      days_to_show: 2,
    }),
  );
  // Collision path: three sensors share the localized display_name "Gräs" and
  // carry no unique_id (entities undefined -> tier-3 prefix scan). The first
  // classifies to the grass category; the second collides and is reclassified
  // as the graminales plant via GP_COLLISION_PLANTS; the third collides again
  // but graminales is already taken, so the `!locEntities.has(alt)` guard drops
  // it (both branches of the onCollision guard exercised -- PR8 near-miss).
  add(
    "gp",
    "collision",
    gpHass({
      "sensor.google_pollen_gras": gpSensor("Gräs", 3, { tomorrow: 2 }),
      "sensor.google_pollen_gras_2": gpSensor("Gräs", 2, { tomorrow: 1 }),
      "sensor.google_pollen_gras_3": gpSensor("Gräs", 1, { tomorrow: 0 }),
    }),
    cfg(stubConfigGP, {
      allergens: ["grass_cat", "graminales"],
      pollen_threshold: 0,
      days_to_show: 2,
    }),
  );

  // -- GPL (type + plant sensors, forecast, summary block) ----------------
  add(
    "gpl",
    "default",
    gplAttr({
      "sensor.pollenlevels_grass": gplTypeSensor("mdi:grass", 3, [
        gplForecastItem(1, 2),
        gplForecastItem(2, 1),
      ]),
      "sensor.pollenlevels_birch": gplPlantSensor("birch", 4, [
        gplForecastItem(1, 3),
        gplForecastItem(2, 2),
      ]),
    }),
    cfg(stubConfigGPL, {
      allergens: ["grass_cat", "birch"],
      pollen_threshold: 0,
      days_to_show: 3,
    }),
  );
  add(
    "gpl",
    "summary-block",
    gplAttr({
      "sensor.pollenlevels_grass": gplTypeSensor("mdi:grass", 3, [gplForecastItem(1, 2)]),
      "sensor.pollenlevels_tree": gplTypeSensor("mdi:tree", 2, [gplForecastItem(1, 1)]),
      "sensor.pollenlevels_birch": gplPlantSensor("birch", 4, [gplForecastItem(1, 3)]),
    }),
    cfg(stubConfigGPL, {
      allergens: ["grass_cat", "trees_cat", "birch"],
      pollen_threshold: 0,
      days_to_show: 2,
      show_summary_block: true,
    }),
  );

  return cases;
}
