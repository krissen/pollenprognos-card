import { describe, it, expect } from "vitest";
import { resolveNumericValue } from "../../src/utils/adapter-helpers.js";

// resolveNumericValue is the single shared decision for the number shown in the
// ring / value text: the calculated level by default, or the raw measurement
// when the user opts in (numeric_value_raw, or the legacy PEU
// numeric_state_raw_risk alias). A no-op for days without a raw_value.

const dayWithRaw = { state: 2, display_state: 2, raw_value: 369 };
const dayNoRaw = { state: 3, display_state: 3 };

describe("resolveNumericValue", () => {
  it("returns the level (display_state) by default", () => {
    expect(resolveNumericValue(dayWithRaw, {})).toBe(2);
    expect(resolveNumericValue(dayWithRaw, { numeric_value_raw: false })).toBe(2);
  });

  it("returns the raw value when numeric_value_raw is on", () => {
    expect(resolveNumericValue(dayWithRaw, { numeric_value_raw: true })).toBe(369);
  });

  it("honours the legacy PEU numeric_state_raw_risk alias", () => {
    expect(
      resolveNumericValue(dayWithRaw, { numeric_state_raw_risk: true }),
    ).toBe(369);
  });

  it("falls back to the level when raw is requested but raw_value is absent", () => {
    expect(resolveNumericValue(dayNoRaw, { numeric_value_raw: true })).toBe(3);
  });

  it("falls back to state when display_state is absent", () => {
    expect(resolveNumericValue({ state: 4 }, {})).toBe(4);
  });

  it("ignores a non-numeric or negative raw_value (keeps the level)", () => {
    expect(
      resolveNumericValue(
        { state: 1, display_state: 1, raw_value: "x" },
        { numeric_value_raw: true },
      ),
    ).toBe(1);
    expect(
      resolveNumericValue(
        { state: 1, display_state: 1, raw_value: -1 },
        { numeric_value_raw: true },
      ),
    ).toBe(1);
  });

  it("is null-safe on a missing day", () => {
    expect(resolveNumericValue(null, { numeric_value_raw: true })).toBeNull();
    expect(resolveNumericValue(undefined, {})).toBeNull();
  });
});
