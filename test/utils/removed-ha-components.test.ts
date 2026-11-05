import { describe, it, expect } from "vitest";

/**
 * Home Assistant removes frontend components without a runtime error: a
 * leftover tag is just an unknown element, so its label or input silently
 * disappears from our editor. That happened with `ha-textfield` in 2026.6
 * (#265) and with `ha-formfield` in 2026.11 (#383). This scan keeps every
 * component HA has documented as removed out of `src/`, so the next removal
 * becomes one entry here instead of another broken release.
 *
 * Sources (contributors.home-assistant.io blog):
 * - 2026-10-28 "Frontend component updates in 2026.11": ha-formfield,
 *   ha-md-list, ha-md-list-item and ha-radio removed.
 * - HA 2026.6: ha-textfield removed.
 */
const REMOVED = [
  { tag: "ha-textfield", since: "2026.6" },
  { tag: "ha-formfield", since: "2026.11" },
  { tag: "ha-md-list", since: "2026.11" },
  { tag: "ha-md-list-item", since: "2026.11" },
  { tag: "ha-radio", since: "2026.11" },
];

// Every source file as raw text, keyed by path. Vite resolves the glob, so
// the test needs no Node fs/path typings.
const SOURCES = import.meta.glob("../../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("removed HA frontend components", () => {
  const files = Object.entries(SOURCES);

  it("finds the source tree", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const { tag, since } of REMOVED) {
    it(`src/ renders no <${tag}> (removed in HA ${since})`, () => {
      // Opening tag only: the name may still appear in prose comments that
      // explain why a replacement exists.
      const re = new RegExp(`<${tag}(?=[\\s>/])`);
      const hits = files.filter(([, text]) => re.test(text)).map(([p]) => p);
      expect(hits).toEqual([]);
    });
  }
});
