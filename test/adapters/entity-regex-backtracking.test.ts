import { describe, it, expect } from "vitest";
import { DWD_ENTITY_ID_RE } from "../../src/adapters/dwd.js";
import { MSW_FALLBACK_RE } from "../../src/adapters/msw.js";
import { ATMO_FALLBACK_RE } from "../../src/adapters/atmo.js";

/**
 * #383: the entity-id regexes used a `(?:\w+_)*` device-name prefix. `\w`
 * includes `_`, so the starred group can split a prefix in exponentially many
 * ways, and every id that does NOT match gets all of them tried. With ~14k
 * entities each `set hass` spent over a second in these regexes and the
 * dashboard froze. `(?:\w+_)?` accepts exactly the same ids (any `\w` run of
 * length >= 2 ending in `_` is a single `\w+_` token) in linear time.
 *
 * This file proves the rewrite is behaviour-neutral (old vs new over a matrix
 * of ids, full match and capture groups) and keeps the pattern out of src/.
 */
const STAR = "(?:\\w+_)*";
const OPT = "(?:\\w+_)?";

const REGEXES = { DWD_ENTITY_ID_RE, MSW_FALLBACK_RE, ATMO_FALLBACK_RE };

/** The pre-#383 form of a regex, rebuilt from the live one. */
function starred(re: RegExp): RegExp {
  expect(re.source).toContain(OPT);
  return new RegExp(re.source.replace(OPT, STAR), re.flags);
}

const TAILS = [
  // DWD
  "pollenflug_birke_112",
  "pollenflug_graeser_31",
  "pollenflug_ambrosia_102",
  "pollenflug_birke_x",
  "pollenflug__birke_112",
  // MSW
  "pollen_birch_level_at_8000",
  "pollen_grasses_level_at_bern",
  "pollen_oak_level",
  // ATMO
  "niveau_ambroisie_tours",
  "niveau_alerte_bouleau_tours",
  "qualite_globale_pollen_tours",
  "qualite_globale_tours",
  "pm25_tours",
  "dioxyde_d_azote_tours",
  "ozone",
  // unrelated
  "temperature",
  "battery_level",
];
const PREFIXES = [
  "",
  "_",
  "a_",
  "__",
  "a__",
  "home_",
  "pollenflug_",
  "pollenflug_birke_1_",
  "meteoswiss_at_8000_klo_",
  "chambray_les_tours_",
  "x1_y2_z3_",
  "a_b_c_d_e_f_g_h_i_",
];
const DOMAINS = ["sensor.", "binary_sensor.", "sensor"];

const IDS = DOMAINS.flatMap((d) =>
  PREFIXES.flatMap((p) => TAILS.map((t) => d + p + t)),
);

describe("entity-id regexes without exponential backtracking (#383)", () => {
  for (const [name, re] of Object.entries(REGEXES)) {
    it(`${name} matches exactly what the starred form matched`, () => {
      const old = starred(re);
      const diffs = IDS.filter(
        (id) => JSON.stringify(old.exec(id)) !== JSON.stringify(re.exec(id)),
      );
      expect(diffs).toEqual([]);
      // the matrix must actually exercise both outcomes
      expect(IDS.some((id) => re.test(id))).toBe(true);
      expect(IDS.some((id) => !re.test(id))).toBe(true);
    });

    it(`${name} stays fast on long non-matching ids`, () => {
      // 40 tokens: the starred form would need ~2^40 steps per id.
      const id =
        "sensor." + Array.from({ length: 40 }, (_, i) => `t${i}`).join("_");
      const t = performance.now();
      for (let i = 0; i < 2000; i++) re.test(id);
      expect(performance.now() - t).toBeLessThan(200);
    });
  }

  it("src/ has no starred \\w+_ prefix group in a regex literal", () => {
    const sources = import.meta.glob("../../src/**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const bad = /\((?:\?:)?\\w[+*]_\)[*+]/;
    const hits = Object.entries(sources).flatMap(([path, text]) =>
      text
        .split("\n")
        .map((line, i) => ({ line, i }))
        // prose comments may name the old form to explain the fix
        .filter(({ line }) => !/^\s*(\*|\/\/)/.test(line) && bad.test(line))
        .map(({ i }) => `${path}:${i + 1}`),
    );
    expect(hits).toEqual([]);
  });
});
