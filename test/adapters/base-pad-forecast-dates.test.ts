import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { padForecastDates } from "../../src/adapters/base.js";

// Padding must advance calendar days, not fixed 24-hour steps: in a zone with
// DST the autumn day is 25 hours long, so +24h from local midnight lands on
// the same date and the padded list repeats it and skips the next one.
describe("padForecastDates across DST", () => {
  // stubEnv writes process.env.TZ, which Node picks up for later Dates.
  beforeEach(() => {
    vi.stubEnv("TZ", "Europe/Stockholm");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const parse = (s: string) => new Date(s);

  it("does not repeat the autumn DST date", () => {
    const today = new Date(2026, 9, 25);
    expect(padForecastDates(["2026-10-25T00:00:00"], 3, today, parse)).toEqual([
      "2026-10-25T00:00:00",
      "2026-10-26T00:00:00",
      "2026-10-27T00:00:00",
    ]);
  });

  it("does not skip a date over the spring DST change", () => {
    const today = new Date(2026, 2, 28);
    expect(padForecastDates([], 3, today, parse)).toEqual([
      "2026-03-29T00:00:00",
      "2026-03-30T00:00:00",
      "2026-03-31T00:00:00",
    ]);
  });
});
