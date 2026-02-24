# Refactoring Plan: pollenprognos-card

**Status: COMPLETED** (branch `refactor/incremental-cleanup`, Feb 2026)

Incremental cleanup. Zero breaking changes to user config.
Each step is a separate PR/commit, gated by `npm run build` + `npm run test`.

---

## Step 0: Lock current behavior with contract tests

**Goal:** Safety net before any refactoring. Explicit behavioral contracts, not just snapshots.

### 0a. Minimal test harness

- Add `vitest` as dev dependency (lightweight, Vite-native, zero config needed).
- Add `npm run test` script.
- No runtime changes.

### 0b. Adapter contract tests

For each of the 8 adapters, create a test file that:

1. Mocks `hass.states` with realistic entity data (1-2 allergens, 2-3 days).
2. Calls `fetchForecast(hass, config)` with the adapter's `stubConfig` + minimal overrides.
3. Asserts the **behavioral contract** (not just shape):
   - Return is array of sensor dicts.
   - Each element has: `allergenReplaced` (string), `allergenCapitalized` (string), `allergenShort` (string, if abbreviated), `days` (array), `day0` (object with `state`, `label`).
   - Level values are within expected range per integration (see compat matrix).
   - NaN/negative handling matches compat matrix (PP returns `null`, others return `-1`).
   - Level scaling produces correct mapped values (e.g., DWD raw 3 becomes display 6).
   - Sorting works for all 4 sort modes.
   - Threshold filtering: sensors below `pollen_threshold` are excluded.
   - Day labels respect `daysRelative`, `daysUppercase`, and `phrases.days` overrides.

One test file per adapter: `test/adapters/pp.test.js`, etc.

### 0c. Sensor detection tests

- Mock `hass.states` with entity IDs for each integration.
- Verify `findAvailableSensors()` returns expected entity IDs.
- **Manual mode edge cases per integration:**
  - PP/DWD/PEU: prefix with/without `sensor.` prefix, suffix, unique-candidate fallback.
  - Kleenex: localized category name detection, `sensor.` stripping, `_` append.
  - GPL: discovery + prefix/suffix filter, `sensor.` stripping.
  - SILAM: reverse allergen map lookup.
  - ATMO: different entity patterns for pollen vs pollution vs summary.
  - PLU: no manual mode (verify graceful handling).

### 0d. Normalization tests

- Unit tests for `normalize()`, `normalizeDWD()`, `slugify()`.
- Cover: diacritics, German umlauts, empty strings, Cyrillic.

### 0e. setConfig() allowedFields tests

- Verify unknown fields are dropped after `setConfig()`.
- Verify all known fields pass through, including the 15 hardcoded extras:
  `type`, `card_mod`, `allergens`, `icon_size`, `icon_color_mode`, `icon_color`,
  `city`, `location`, `region_id`, `tap_action`, `debug`, `show_version`,
  `title`, `days_to_show`, `date_locale`.
- Verify cross-integration location fields survive (e.g., `city` preserved when integration is `dwd`).

### 0f. Autodetect precedence tests

Lock the current autodetect order in both card and editor. Today they diverge:

**Card `set hass()`:** PP > PLU > PEU > DWD > SILAM > Kleenex > ATMO > GPL
**Editor `setConfig()`:** PP > PEU > DWD > SILAM > Kleenex > ATMO > GPL (no PLU, simpler PP check)
**Editor `set hass()`:** PP > PLU > PEU > DWD > SILAM > ATMO > GPL (no Kleenex)

Write tests that assert these exact orders. The divergences are documented as known, not bugs to fix in this plan. (Future work may unify them, but that requires careful analysis.)

### 0g. SILAM post-fetch filtering test

Verify the special SILAM filtering in `pollenprognos-card.js` `set hass()`:
- Daily mode: entity_id-based filtering with reverse map fallback.
- Non-daily modes: no entity-level filtering (returns true unconditionally).
- Other integrations: name-based filtering with DWD using `normalizeDWD()`.

**Acceptance:** All tests green, `npm run build` passes, no runtime changes.

---

## Step 1: Centralize adapter registry (thin alias layer)

**Goal:** Replace hardcoded if/else chains with a single lookup. Initially just a thin wrapper returning the exact same object references as today.

### Current state

The codebase has 4 separate if/else chains switching on integration ID:

1. `pollenprognos-card.js` `setConfig()` (lines 852-860): selects stub config.
2. `pollenprognos-card.js` `set hass()` (lines 1046-1063): selects stub again.
3. `pollenprognos-editor.js` `getStubConfig()` (lines 56-71): nested ternary.
4. `pollenprognos-editor.js` `setConfig()` (lines 486-556): auto-detection.

Plus `ADAPTERS` map in `constants.js` (lines 12-21) already maps ID to module.

### Approach: thin alias layer

The registry must initially be a mechanical replacement returning exactly the same references. No new abstractions, no changed import order, no lazy loading.

Create `src/adapter-registry.js`:

```js
import * as PP from './adapters/pp.js';
import { stubConfigPP } from './adapters/pp.js';
// ... all 8 adapters

const registry = {
  pp:      { module: PP,      stub: stubConfigPP },
  dwd:     { module: DWD,     stub: stubConfigDWD },
  // ...
};

export function getAdapter(id)    { return registry[id]?.module; }
export function getStubConfig(id) { return registry[id]?.stub; }
export function getAllAdapterIds() { return Object.keys(registry); }
```

Then replace the 4 if/else chains with `getStubConfig(integration)` and `getAdapter(integration)`.

`ADAPTERS` in `constants.js` can be removed (or re-exported from registry for backwards compat if anything external depends on it).

### What NOT to do in this step

- Do not add metadata fields yet (defer to later steps).
- Do not change autodetect logic.
- Do not change import paths for adapters.
- Do not touch `fetchForecast()` calls.

**Acceptance:** Identical render output, editor UI, and config defaults. Contract tests green. Diff is purely mechanical: if/else replaced with map lookup, returning same references.

---

## Step 2: Extract shared adapter utilities

**Goal:** DRY the 7 patterns duplicated across all 8 adapters.

Each utility is extracted as a separate commit. Within each commit, all 8 adapters are migrated (since the functions are pure and well-tested).

### Important constraint

Do NOT move logic between "sensor discovery" (`utils/sensors.js`) and adapters in this step. Only extract pure helper functions that adapters call internally. The sensor/adapter boundary is addressed in Step 3, after contract tests and registry are both live.

### 2a. `getLangAndLocale(hass, config, stubDateLocale?)`

Duplicated in all 8 adapters (identical except DWD's fallback to stub default).

### 2b. `mergePhrases(config)`

Duplicated in 5 adapters identically, 3 with slight variation. SILAM's `getPhrases()` unifies with this.

### 2c. `buildDayLabel(date, diff, opts, lang, locale)`

~20 lines duplicated 8 times. Handles `daysRelative`, `daysUppercase`, `phrases.days` overrides, locale formatting.

### 2d. `clampLevel(n, maxLevel, nanResult)`

6 different `testVal()` implementations. PP uses `null` as nanResult, others use `-1`. Parametrize.

### 2e. `sortSensors(sensors, sortKey, locale?)`

Identical 4-way dispatch in all 8 adapters. Kleenex/GPL/ATMO apply additional tier sorting on top (kept in adapter).

### 2f. `resolveAllergenNames(canonKey, rawName, phrases, lang, abbreviated)`

Near-identical block in all 8 adapters.

### 2g. `meetsThreshold(days, threshold)`

Duplicated in all adapters.

### File structure

All extracted to: `src/utils/adapter-helpers.js`. Each function is pure (no side effects).

**Acceptance:** Contract tests green, `npm run build` passes. Each adapter's `fetchForecast()` returns identical output for identical input.

---

## Step 3: Normalize sensor/entity resolution

**Goal:** Clarify boundary between `utils/sensors.js` ("which entities exist?") and adapters ("how to interpret data").

### Prerequisite

Steps 0-2 must be complete: contract tests green, registry live, helpers extracted.

### 3a. Formalize `buildEntityId()` per adapter

Each adapter exports a function that constructs entity IDs (normal and manual mode). This already exists implicitly in each adapter's `fetchForecast()`; formalize as a named export.

### 3b. Simplify `findAvailableSensors()`

Refactor to delegate entity ID construction to adapter's `buildEntityId()` instead of reimplementing patterns. Discovery-based integrations (SILAM, GPL) keep their special paths.

### 3c. Extract manual mode helper

```js
export function buildManualEntityId(prefix, slug, suffix) {
  return `sensor.${prefix || ""}${slug}${suffix || ""}`;
}
```

The `sensor.` stripping and `_` appending differences between `sensors.js` and adapter `fetchForecast()` are preserved as-is (they serve different purposes: filtering vs. data retrieval).

**Acceptance:** Same entities selected as before (including all fallback rules). Contract tests + sensor detection tests green.

---

## Step 4: Modularize the largest adapters internally

**Goal:** Break up kleenex.js (935 lines) and gpl.js (513 lines) into focused internal modules. Public exports unchanged.

### Kleenex: `src/adapters/kleenex/`

| File | Responsibility |
|---|---|
| `index.js` | Public facade: re-exports all current named exports |
| `constants.js` | `KLEENEX_ALLERGEN_MAP`, `KLEENEX_ALLERGEN_CATEGORIES`, thresholds |
| `discovery.js` | Location detection, sensor grouping |
| `levels.js` | `ppmToLevel()`, level scaling |
| `forecast.js` | `fetchForecast()` orchestration |

### GPL: `src/adapters/gpl/`

| File | Responsibility |
|---|---|
| `index.js` | Public facade |
| `discovery.js` | `discoverGplSensors()`, `discoverGplAllergens()`, `classifySensor()` |
| `forecast.js` | `fetchForecast()` |

Internal splits only. Registry and all external consumers continue importing from `src/adapters/kleenex.js` (now `kleenex/index.js`) and `src/adapters/gpl.js` (now `gpl/index.js`).

**Acceptance:** Contract tests green, `npm run build` passes. No changed keys or text output.

---

## Step 5: Clean up ALLERGEN_TRANSLATION (last)

**Goal:** Make allergen normalization more maintainable without changing behavior.

### Why last

`ALLERGEN_TRANSLATION` is used across card, editor, and all adapters. Touching it before the safety net of contract tests + registry + helpers risks silent semantic changes.

### 5a. Introduce `toCanonicalAllergenKey(raw, integration?)`

Single function that normalizes and looks up: integration-specific alias first, then global map.

### 5b. Group adapter-specific aliases near adapters

Move integration-specific entries out of the global map into per-adapter alias constants. Global map becomes the merge of all adapter maps (computed, not hand-maintained).

### 5c. Preserve backwards compatibility

`ALLERGEN_TRANSLATION` continues to be exported from `constants.js`. No external behavior change.

**Acceptance:** `normalize("Björk")` still returns `"birch"`. All adapter outputs identical. Contract tests green.

---

## Step 6: Repo hygiene

**Goal:** Remove tracked junk files. No runtime impact.

1. Remove `.DS_Store` files tracked in `src/` and `src/images/`.
2. Add `.DS_Store` to `.gitignore` (if not already there).
3. Evaluate `src/pollenprognos-images-backup.js`: remove if no runtime import.
4. Evaluate `src/pollenprognos-images.js`: remove if truly unreferenced.

Can be done in parallel with Step 0 (no dependencies).

**Acceptance:** `npm run build` output unchanged.

---

## Delivery approach

- 1 PR per step (or smaller).
- Sub-steps are individual commits within the PR.
- Every commit must pass `npm run build`.
- After step 0, every commit must also pass `npm run test`.
- Start with Step 0 + minimal Step 1 (registry for stub/adapter lookup only).
- Steps 0 and 6 can run in parallel.
- Steps 1-5 are sequential.

## Risk assessment

| Step | Risk | Mitigation |
|---|---|---|
| 0 | Low | Only adds tests, no runtime change |
| 1 | Low | Thin alias layer, same object references, mechanical diff |
| 2 | Medium | Pure functions testable, but subtle per-adapter differences | Compat matrix documents intentional differences |
| 3 | Medium | Entity resolution is critical path | Sensor detection tests from Step 0c |
| 4 | Low | Internal restructuring only, facade preserves API |
| 5 | Medium | Allergen naming is user-visible | Done last, with full test coverage from Steps 0-4 |
| 6 | Low | No runtime changes |

## Out of scope

- Rewriting `set hass()` (1700+ lines). Requires Steps 1-3 first. Defer to future plan.
- Unifying card/editor autodetect divergences. Document and lock first, unify later.
- Adding new integrations or features.
- Changing build system or dependencies (beyond vitest).

## Reference document

See `COMPAT-MATRIX.md` for per-integration details on autodetect signals, manual mode rules, entity patterns, level scales, and special keys.
