import { describe, it, expect } from "vitest";
import { cleanDeviceLabel } from "../../src/utils/device-label.js";

describe("cleanDeviceLabel: locale matrix", () => {
  it("strips Swedish 'Pollentyper (lat,lng)' suffix", () => {
    expect(cleanDeviceLabel("Hem - Pollentyper (50.450034,30.524136)")).toBe("Hem");
  });

  it("strips German 'Pollentypen (lat,lng)' suffix", () => {
    expect(cleanDeviceLabel("Stockholm - Pollentypen (59.3293,18.0686)")).toBe("Stockholm");
  });

  it("strips English 'Pollen types (lat,lng)' suffix", () => {
    expect(cleanDeviceLabel("Lyon - Pollen types (45.764,4.8357)")).toBe("Lyon");
  });

  it("strips multi-word French 'Niveaux de pollen' suffix", () => {
    expect(cleanDeviceLabel("Paris - Niveaux de pollen (48.8566,2.3522)")).toBe("Paris");
  });

  it("strips Italian-style suffix", () => {
    expect(cleanDeviceLabel("Roma - Tipi di polline (41.9028,12.4964)")).toBe("Roma");
  });

  it("works for an unknown future locale (locale-agnostic)", () => {
    // Whatever the integration appends, as long as the (<coords>) trailer
    // looks numeric, the strip kicks in.
    expect(cleanDeviceLabel("Tokyo - 花粉タイプ (35.6762,139.6503)")).toBe("Tokyo");
  });
});

describe("cleanDeviceLabel: hyphenated location names", () => {
  it("preserves internal hyphens when the suffix is stripped", () => {
    expect(cleanDeviceLabel("Saint-Cloud - Pollentyper (48.84,2.21)")).toBe("Saint-Cloud");
  });

  it("preserves a fully hyphenated name when no suffix is present", () => {
    expect(cleanDeviceLabel("Saint-Cloud")).toBe("Saint-Cloud");
  });

  it("handles em-dash and en-dash in the separator (defensive)", () => {
    expect(cleanDeviceLabel("Hem – Pollentyper (50.45,30.52)")).toBe("Hem");
    expect(cleanDeviceLabel("Hem — Pollentyper (50.45,30.52)")).toBe("Hem");
  });
});

describe("cleanDeviceLabel: no-op cases", () => {
  it("leaves an already-clean name untouched", () => {
    expect(cleanDeviceLabel("Hem")).toBe("Hem");
    expect(cleanDeviceLabel("My Custom Location")).toBe("My Custom Location");
  });

  it("does not strip parenthesized text that is not coordinate-shaped", () => {
    expect(cleanDeviceLabel("My Lab (Test)")).toBe("My Lab (Test)");
    expect(cleanDeviceLabel("Office (Building B)")).toBe("Office (Building B)");
    expect(cleanDeviceLabel("Hem - Office (Building B)")).toBe("Hem - Office (Building B)");
  });

  it("does not strip a single-number parenthesized suffix (not coordinate-shaped)", () => {
    // Legitimate names with sequence numbers, year suffixes, etc.
    expect(cleanDeviceLabel("Home (2)")).toBe("Home (2)");
    expect(cleanDeviceLabel("Paris (2024)")).toBe("Paris (2024)");
    expect(cleanDeviceLabel("Office (123)")).toBe("Office (123)");
    expect(cleanDeviceLabel("Sensor (3.14)")).toBe("Sensor (3.14)");
  });

  it("does not strip ' - <suffix>' when no coord-paren is present", () => {
    // Without the coord signal, we can't tell integration noise from a
    // legitimate dashed name like a venue suffix. Leave it alone.
    expect(cleanDeviceLabel("Branch Office - Annex")).toBe("Branch Office - Annex");
  });

  it("trims leading/trailing whitespace", () => {
    expect(cleanDeviceLabel("  Hem  ")).toBe("Hem");
  });
});

describe("cleanDeviceLabel: coordinate-paren variants", () => {
  it("handles coord-paren with internal whitespace", () => {
    expect(cleanDeviceLabel("Hem - Pollentyper (50.45, 30.52)")).toBe("Hem");
    expect(cleanDeviceLabel("Hem - Pollentyper ( 50.45 , 30.52 )")).toBe("Hem");
  });

  it("handles negative coordinates", () => {
    expect(cleanDeviceLabel("Quito - Pollen types (-0.18,-78.47)")).toBe("Quito");
    expect(cleanDeviceLabel("New York - Pollen types (40.71,-74.01)")).toBe("New York");
  });

  it("handles coordinates with explicit + sign", () => {
    expect(cleanDeviceLabel("Place - Type (+50.45,+30.52)")).toBe("Place");
  });

  it("strips coord-paren even without ' - <suffix>' before it", () => {
    // Edge case: device named only "<location> (<coords>)" without separator.
    expect(cleanDeviceLabel("Hem (50.45,30.52)")).toBe("Hem");
  });

  it("strips suffix even when the suffix itself contains a hyphen", () => {
    // The separator regex uses lastIndexOf on whitespace-padded separators,
    // so dashes inside the suffix don't block matching.
    expect(cleanDeviceLabel("Hem - Pollen-types (50.45,30.52)")).toBe("Hem");
    expect(cleanDeviceLabel("Hem - co2-monitor data (50.45,30.52)")).toBe("Hem");
  });
});

describe("cleanDeviceLabel: defensive input handling", () => {
  it("returns the input as-is when not a string", () => {
    expect(cleanDeviceLabel(null)).toBe(null);
    expect(cleanDeviceLabel(undefined)).toBe(undefined);
    expect(cleanDeviceLabel(42)).toBe(42);
    expect(cleanDeviceLabel({})).toEqual({});
  });

  it("returns empty string for empty/whitespace-only input", () => {
    expect(cleanDeviceLabel("")).toBe("");
    expect(cleanDeviceLabel("   ")).toBe("");
  });

  it("falls back to trimmed input when cleaning would leave empty string", () => {
    // Pathological case: name is only the coord-paren. The strip would
    // result in empty string; we return the trimmed original instead.
    expect(cleanDeviceLabel("(50.45,30.52)")).toBe("(50.45,30.52)");
  });
});
