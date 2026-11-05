import { describe, it, expect } from "vitest";
import { detectIntegrationStates } from "../../src/utils/autodetect.js";

/**
 * #383: autodetect is cached at two levels, and both must be invisible to
 * callers.
 *
 * 1. One detection per `hass` object (HA never mutates one).
 * 2. Id-only filters reused across hass objects while the entity id set is
 *    exactly the same; any added, removed or swapped id recomputes them.
 */
function hass(ids: string[]): any {
  return {
    states: Object.fromEntries(
      ids.map((id) => [id, { entity_id: id, state: "1", attributes: {} }]),
    ),
    entities: {},
    devices: {},
    language: "en",
  };
}

const DWD = ["sensor.pollenflug_birke_112", "sensor.pollenflug_erle_112"];
const OTHER = ["sensor.kitchen_temperature", "light.hall"];

describe("autodetect caching (#383)", () => {
  it("returns the same detection for the same hass object", () => {
    const h = hass([...DWD, ...OTHER]);
    expect(detectIntegrationStates(h)).toBe(detectIntegrationStates(h));
  });

  it("recomputes for a new hass object", () => {
    const a = detectIntegrationStates(hass([...DWD, ...OTHER]));
    const b = detectIntegrationStates(hass([...DWD, ...OTHER]));
    expect(b).not.toBe(a);
    expect(b.states.dwd).toEqual(a.states.dwd);
  });

  it("reuses id filters while the id set is unchanged", () => {
    const a = detectIntegrationStates(hass([...DWD, ...OTHER]));
    const b = detectIntegrationStates(hass([...DWD, ...OTHER]));
    // same array instance: the filter did not rerun
    expect(b.states.dwd).toBe(a.states.dwd);
    expect(b.states.dwd).toEqual(DWD);
  });

  it("picks up an added entity", () => {
    detectIntegrationStates(hass([...DWD, ...OTHER]));
    const added = "sensor.pollenflug_hasel_112";
    const b = detectIntegrationStates(hass([...DWD, added, ...OTHER]));
    expect(b.states.dwd).toEqual([...DWD, added]);
  });

  it("drops a removed entity", () => {
    detectIntegrationStates(hass([...DWD, ...OTHER]));
    const b = detectIntegrationStates(hass([DWD[0]!, ...OTHER]));
    expect(b.states.dwd).toEqual([DWD[0]]);
  });

  it("notices a swap that keeps the count", () => {
    detectIntegrationStates(hass([...DWD, ...OTHER]));
    const swapped = "sensor.pollenflug_roggen_112";
    const b = detectIntegrationStates(hass([DWD[0]!, swapped, ...OTHER]));
    expect(b.states.dwd).toEqual([DWD[0], swapped]);
  });

  it("keeps every integration's filter correct after a change", () => {
    const ids = [
      ...DWD,
      "sensor.polleninformation_wien_birch",
      "sensor.kleenex_pollen_radar_home_trees",
      ...OTHER,
    ];
    detectIntegrationStates(hass(ids));
    const b = detectIntegrationStates(hass(ids.slice(1)));
    expect(b.states.dwd).toEqual([DWD[1]]);
    expect(b.states.peu).toEqual(["sensor.polleninformation_wien_birch"]);
    expect(b.states.kleenex).toContain(
      "sensor.kleenex_pollen_radar_home_trees",
    );
  });
});

describe("shared filter results are frozen (#383 follow-up)", () => {
  it("throws on mutation instead of leaking into other callers", () => {
    const d = detectIntegrationStates(hass([...DWD, ...OTHER]));
    expect(Object.isFrozen(d.states.dwd)).toBe(true);
    expect(() => (d.states.dwd as string[]).push("sensor.x")).toThrow(
      TypeError,
    );
  });
});
