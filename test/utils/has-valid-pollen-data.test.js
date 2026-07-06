import { describe, it, expect, vi } from "vitest";
import { hasValidPollenData } from "../../src/utils/adapter-helpers.js";

// hasValidPollenData re-fetches at pollen_threshold 0 so the caller can
// distinguish "no pollen data at all" (returns false) from "pollen data
// exists, all below threshold" (returns true), and can choose whether to
// show the no_allergens image accordingly.

describe("hasValidPollenData", () => {
  it("returns true when a sensor has state 0 (level-0 is valid data)", async () => {
    const adapter = { fetchForecast: vi.fn().mockResolvedValue([{ days: [{ state: 0 }] }]) };
    expect(await hasValidPollenData(adapter, {}, {})).toBe(true);
  });

  it("returns true when a sensor has state 3", async () => {
    const adapter = { fetchForecast: vi.fn().mockResolvedValue([{ days: [{ state: 3 }] }]) };
    expect(await hasValidPollenData(adapter, {}, {})).toBe(true);
  });

  it("returns false when all sensors have state -1 (no-data sentinels)", async () => {
    const adapter = {
      fetchForecast: vi.fn().mockResolvedValue([
        { days: [{ state: -1 }] },
        { days: [{ state: -1 }] },
      ]),
    };
    expect(await hasValidPollenData(adapter, {}, {})).toBe(false);
  });

  it("returns false when the sensor array is empty", async () => {
    const adapter = { fetchForecast: vi.fn().mockResolvedValue([]) };
    expect(await hasValidPollenData(adapter, {}, {})).toBe(false);
  });

  it("returns false when days[0].state is missing (Number(undefined) is NaN)", async () => {
    const adapter = { fetchForecast: vi.fn().mockResolvedValue([{ days: [{}] }]) };
    expect(await hasValidPollenData(adapter, {}, {})).toBe(false);
  });

  it("returns false when days[0].state is null (Number(null) is 0, must not count as data)", async () => {
    const adapter = { fetchForecast: vi.fn().mockResolvedValue([{ days: [{ state: null }] }]) };
    expect(await hasValidPollenData(adapter, {}, {})).toBe(false);
  });

  it("returns false when all sensors are atmo-unavailable (state 0 / display_state -1)", async () => {
    const adapter = {
      fetchForecast: vi.fn().mockResolvedValue([
        { days: [{ state: 0, display_state: -1 }] },
        { days: [{ state: 0, display_state: -1 }] },
      ]),
    };
    expect(await hasValidPollenData(adapter, {}, {})).toBe(false);
  });

  it("returns true when at least one sensor has real data among unavailable ones", async () => {
    const adapter = {
      fetchForecast: vi.fn().mockResolvedValue([
        { days: [{ state: 0, display_state: -1 }] },
        { days: [{ state: 2, display_state: 2 }] },
      ]),
    };
    expect(await hasValidPollenData(adapter, {}, {})).toBe(true);
  });

  it("returns false when fetchForecast throws (defensive catch)", async () => {
    const adapter = { fetchForecast: vi.fn().mockRejectedValue(new Error("network error")) };
    expect(await hasValidPollenData(adapter, {}, {})).toBe(false);
  });

  it("calls fetchForecast with pollen_threshold coerced to 0 while preserving the rest of cfg", async () => {
    const cfg = { pollen_threshold: 5, allergens: ["x"], integration: "pp" };
    const adapter = { fetchForecast: vi.fn().mockResolvedValue([]) };

    await hasValidPollenData(adapter, {}, cfg);

    expect(adapter.fetchForecast).toHaveBeenCalledOnce();
    const receivedCfg = adapter.fetchForecast.mock.calls[0][1];
    expect(receivedCfg.pollen_threshold).toBe(0);
    expect(receivedCfg.allergens).toEqual(["x"]);
    expect(receivedCfg.integration).toBe("pp");
    // Third argument defaults to null when forecastEvent is not supplied.
    expect(adapter.fetchForecast.mock.calls[0][2]).toBeNull();
  });

  it("forwards forecastEvent as the third argument to fetchForecast", async () => {
    const forecastEvent = { ev: 1 };
    const adapter = { fetchForecast: vi.fn().mockResolvedValue([]) };

    await hasValidPollenData(adapter, {}, {}, forecastEvent);

    expect(adapter.fetchForecast.mock.calls[0][2]).toBe(forecastEvent);
  });
});
