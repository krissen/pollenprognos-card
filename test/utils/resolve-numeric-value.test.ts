import { describe, it, expect } from "vitest";
import { resolveNumericValue } from "../../src/utils/adapter-helpers.js";

// resolveNumericValue is the single shared decision for the number shown in the
// ring / value text: the calculated level by default, or the raw measurement
// when the user opts in (numeric_value_raw, or the legacy PEU
// numeric_state_raw_risk alias). A no-op for days without a raw_value.

const dayWithRaw: any = { state: 2, display_state: 2, raw_value: 369 };
const dayNoRaw: any = { state: 3, display_state: 3 };

describe("resolveNumericValue", () => {
  it("returns the level (display_state) by default", () => {
    expect(resolveNumericValue(dayWithRaw, {} as any)).toBe(2);
    expect(
      resolveNumericValue(dayWithRaw, { numeric_value_raw: false } as any),
    ).toBe(2);
  });

  it("returns the raw value when numeric_value_raw is on", () => {
    expect(
      resolveNumericValue(dayWithRaw, { numeric_value_raw: true } as any),
    ).toBe(369);
  });

  it("honours the legacy numeric_state_raw_risk alias only for PEU", () => {
    expect(
      resolveNumericValue(dayWithRaw, {
        integration: "peu",
        numeric_state_raw_risk: true,
      } as any),
    ).toBe(369);
    // A stale legacy flag on another integration must NOT force raw.
    expect(
      resolveNumericValue(dayWithRaw, {
        integration: "plu",
        numeric_state_raw_risk: true,
      } as any),
    ).toBe(2);
  });

  it("falls back to the level when raw is requested but raw_value is absent", () => {
    expect(
      resolveNumericValue(dayNoRaw, { numeric_value_raw: true } as any),
    ).toBe(3);
  });

  it("falls back to state when display_state is absent", () => {
    expect(resolveNumericValue({ state: 4 } as any, {} as any)).toBe(4);
  });

  it("ignores a non-numeric or negative raw_value (keeps the level)", () => {
    expect(
      resolveNumericValue(
        { state: 1, display_state: 1, raw_value: "x" } as any,
        { numeric_value_raw: true } as any,
      ),
    ).toBe(1);
    expect(
      resolveNumericValue(
        { state: 1, display_state: 1, raw_value: -1 } as any,
        { numeric_value_raw: true } as any,
      ),
    ).toBe(1);
  });

  it("is null-safe on a missing day", () => {
    expect(
      resolveNumericValue(null as any, { numeric_value_raw: true } as any),
    ).toBeNull();
    expect(resolveNumericValue(undefined as any, {} as any)).toBeNull();
  });
});
