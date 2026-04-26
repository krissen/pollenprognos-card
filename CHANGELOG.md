# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Device-based entity discovery across most adapters** (issue #202). PP, DWD, PEU, SILAM, Atmo, GPL and GP now resolve sensors via the Home Assistant device registry as the primary path, with platform scan and regex/selector fallbacks. Result: multi-instance setups (multiple cities/regions of the same integration) route correctly without manual configuration, and for these adapters entity-ID renames no longer break detection. The `location` field (and `city` for PP, `region_id` for DWD) now accepts a `config_entry_id` (ULID) in addition to the legacy slug for these seven adapters (previously only GPL/GP). Slug-based configs continue to work. Kleenex is not part of this migration and continues to use entity-ID slug matching.
- Stale-config recovery: if a saved `config_entry_id` no longer matches any discovered location (e.g. integration reinstalled), the card auto-recovers instead of rendering empty. Explicit retry-as-autodetect path implemented for DWD, GPL and GP; PP and PEU recover via their pre-existing template-fallback path. SILAM and Kleenex do not auto-recover — for these, re-pick the location in the visual editor after a reinstall.
- (kleenex) Per-allergen DetailSensor fallback and a clearer warning for US/CA zones where the upstream API only returns category totals (issue #206). The NA-zone warning is de-duplicated per session and per location.

### Changed
- Discovery helper extracted to `src/utils/adapter-helpers.js` (`discoverEntitiesByDevice`, `resolveLocationByKey`, `findLocationBySlug`). PP, DWD, PEU, SILAM, Atmo, GPL and GP now share the same three-tier cascade, eliminating bespoke regex-based discovery in those adapters.
- (editor) PP and DWD location dropdowns now sorted consistently when populated via the secondary discovery path.
- (card) Header location label now resolved through the shared discovery helper for PP, DWD, PEU, GPL, GP. Discovery results are cached per-render to avoid redundant entity scans.
- (dwd) Region-ID prefix stripped from auto-derived region labels; ID suffix only appended when needed to disambiguate duplicate region names.
- (pp) Tier-3 fallback city labels now restore diacritics (Malmö, Visby etc.) via `PP_POSSIBLE_CITIES` instead of showing the slugified form.
- (peu) Allergen classification uses an explicit whitelist instead of a greedy regex, avoiding misclassification for entity IDs that happen to contain allergen-like substrings.

### Fixed
- (gpl, gp) Strip integration-appended " - <category> (<lat>,<lng>)" suffix from location labels (issue #208). Previously the editor dropdown and card title leaked text like "Hem - Pollentyper (50.45, 30.52)". Now uses a locale-agnostic util (`cleanDeviceLabel`) that handles any HA language, applied at both discovery and the card's title resolver for defense-in-depth.
- (kleenex) Manual mode `entity_prefix`/`entity_suffix` handling honored consistently across category-sensor heuristics and the DetailSensor fallback pass.
- (helpers) `isConfigEntryId` tightened to the Crockford base32 alphabet to avoid false positives on entity-id-shaped strings.

### Documentation
- `docs/configuration.md`: clarified that the `location` field accepts a `config_entry_id` for PP, DWD, PEU, SILAM, Atmo, GPL and GP, not just GPL/GP.
- `docs/troubleshooting.md`: clarified that stale-config recovery after an integration reinstall is adapter-specific: DWD/GPL/GP retry autodetect, PP/PEU recover via template fallback, and SILAM requires re-picking the location.
- `docs/integrations.md` + `docs/troubleshooting.md`: documented the Kleenex NA-zone limitation and the DetailSensor fallback for EU/UK zones.

## [3.1.0] - 2026-04-19

### Added
- New `gp` adapter for [home-assistant-google-pollen](https://github.com/svenove/home-assistant-google-pollen) by svenove (#199). Uses the same Google Pollen API as the existing `gpl` adapter but supports the different entity format (flat forecast attributes, `display_name`-based allergen classification). Auto-detection, visual editor, location discovery, and manual mode all supported.
- Troubleshooting guide (`docs/troubleshooting.md`) covering common installation, cache, version and integration issues; linked from README and issue templates.
- GitHub issue templates for bug reports and feature requests, with direct links to the troubleshooting guide.

### Changed
- Atmo France: discovery refactored to a three-tier strategy (device registry, entity registry by platform, legacy regex fallback). Primary path now uses device identifiers, which survives entity renaming and correctly groups sensors per config entry in multi-instance setups (#201).
- Atmo France: card header auto-title now resolved through discovery instead of attribute scanning.
- GP adapter: sensor classification now works for all 35 Google Pollen API languages. Uses `unique_id` as primary classification and pre-generated `display_name` lookup maps as fallback (no runtime transliteration needed).
- GP/GPL adapters: location dropdown now shows user-renamed device names (`name_by_user`) instead of default device name.
- Slugify: replaced `any-ascii` runtime dependency with pre-generated display-name maps for the GP adapter, reducing bundle size and runtime work.
- SILAM: cache discovery results across `set hass()`, forecast subscription, and `fetchForecast()` to eliminate redundant entity scans.
- SILAM: precompute inverse allergen maps once per `resolveEntityIds()` call instead of per allergen.
- SILAM: add `performance.now()` timing instrumentation under `debug: true`.
- HACS: removed country filter from `hacs.json` to fix visibility of the card in HACS for users outside the previously listed countries.

### Fixed
- Atmo France: card could not find sensors after upstream integration change where entity IDs include a configurable instance prefix; prefixed entity IDs are now recognized in auto-detect (#200).
- Atmo France: special states `Indisponible` (level 0) and `Événement` (level 7) now use the card's localized label instead of the integration's always-French `Libellé` attribute, so non-French users see translated text.
- SILAM: invalid empty key in Russian allergen mapping; added empty-slug validation to the generator script.

### Documentation
- Expanded troubleshooting guide covering browser cache, installation conflicts, verifying the running version, resource registration and integration-specific notes.
- Brought GP adapter documentation up to par with GPL (design decisions, sensor discovery, classification, collision handling, multi-location support).
- Various consistency fixes: branch-agnostic links, removed stale `any-ascii` references, corrected console log examples and version references.

## [3.0.1] - 2026-03-15

### Fixed
- SILAM: fix browser freeze when entity is unavailable; infinite microtask loop caused by reactive property assignments triggering re-renders (#193)
- SILAM: guard reactive assignments in subscription failure and missing weather entity error paths to avoid unnecessary extra renders

## [3.0.0] - 2026-03-12

### Changed
- **Adapter architecture refactored**: each adapter now exports `resolveEntityIds(cfg, hass, debug?)` for sensor detection, replacing centralized if/else chains in `sensors.js`
- **Adapter registry** (`adapter-registry.js`): single lookup for adapter modules and stub configs via `getAdapter()`, `getStubConfig()`, `getAllAdapterIds()`
- **Shared adapter helpers** (`utils/adapter-helpers.js`): extracted common logic from adapters into reusable pure functions (`getLangAndLocale`, `mergePhrases`, `buildDayLabel`, `clampLevel`, `sortSensors`, `resolveAllergenNames`, `meetsThreshold`, `normalizeManualPrefix`, `resolveManualEntity`)
- **Post-fetch filtering** (`filterSensorsPostFetch`) extracted from card's `set hass()` into a utility
- **Allergen translation** grouped by adapter with per-adapter alias maps (`PP_ALIASES`, `DWD_ALIASES`, etc.) and a single `toCanonicalAllergenKey()` lookup
- Kleenex adapter modularized into `constants`, `levels`, `discovery`, `forecast`
- GPL adapter modularized into `constants`, `discovery`, `forecast`
- Editor: replaced `ha-select`/`mwc-list-item` dropdowns with `ha-selector` for compatibility with HA 2026.2+ (MWC components removed from HA frontend)
- Removed legacy PNG image system (`pollenprognos-images.js`); all icons are now SVG-only
- Net reduction of ~1,200 lines across `src/`

### Added
- Vitest test harness with shared test helpers
- Contract tests for all 9 adapters (pp, dwd, peu, silam, kleenex, plu, atmo, gpl, gp)
- Tests for sensor detection, autodetect, setConfig, normalization, and post-fetch filtering
- Unit tests for `clampLevel`, `detectLang`, `t()` locale fallback, and SVG contract (`getSvgContent`)
- Spanish translation for `card.error_entity_unavailable`

### Fixed
- Editor: infinite `set hass()` dispatch loop caused by `deepEqual()` key count mismatch with `LEVELS_DEFAULTS` (#191)
- Editor: integration dropdown selection race condition where `set hass()` autodetection could override the user's choice before the config round-trip completed
- Editor: case sensitivity for integration ID in YAML mode (e.g. "SILAM" now correctly maps to "silam")
- Editor: no longer crashes on invalid or partial integration strings typed in YAML (e.g. "s", "sil", "silam pollen")
- Sensor detection: unavailable or unknown entities (e.g. from disabled integrations) are now excluded from available sensor count, so the card correctly shows "no sensors found" instead of "no allergens"
- SILAM: fix infinite loop when using `location: "manual"` (weather entity lookup received raw `"manual"` string)
- SILAM: auto-show overall pollen index for locations with no individual allergen sensors enabled
- SILAM: show localized "Very low levels" label when the integration reports `very_low` (its lowest state, which lacks a true "none")
- SILAM: guard forecast subscription against unavailable entities
- SILAM: cancel forecast subscription when switching integration
- SILAM: fix subscription race condition where cards showed no data until page refresh
- SILAM: forecast callback now applies `filterSensorsPostFetch` (allergen filtering)
- SILAM: forecast subscription recovery after weather entity transitions from unavailable to available
- SILAM: daily fallback now lowercases location for entity ID matching
- SILAM: manual mode now tries canonical (English) allergen slug first, then localized slugs; previously the first language mapping (Dutch) was always used, causing entity lookup failures for non-Dutch installations
- SILAM: manual mode now uses `entity_prefix` as location hint for weather entity discovery; previously an empty location caused the first discovered location to be used, mismatching weather data and sensors
- Kleenex: location name extraction when `friendly_name` lacks location
- Kleenex: undefined variable in debug threshold log
- Kleenex: header truncation for locations with commas
- Kleenex: editor header regex now matches card pattern for French allergen names
- Kleenex: fallback sensor search now scoped to configured location, preventing cross-location matches
- Card header: show generic "Pollen forecast" instead of trailing preposition when no location is resolved
- Adapter helpers: locale fallback when `defaultLocale` is undefined
- Sensor detection: non-existent entity IDs (stale or incorrect) are now excluded instead of silently passing through
- `clampLevel`: treat null/undefined as missing data instead of level 0
- Removed dead `findSensors`/`getData` stubs from kleenex and gpl adapter facades

## [2.9.2] - 2026-02-26

### Fixed
- iOS scroll position jump caused by unnecessary re-renders on every HA state update (#186)
- `deepEqual` array comparison gave false positives for object elements

## [2.9.1] - 2026-02-25

### Added
- Spanish translations

## [2.9.0] - 2026-02-22

### Added
- **Google Pollen Levels integration** — new adapter with native 0–5 scale, attribute-based detection, and full editor support
- **Atmo France integration** — pollution adapter with air quality index, block separator, grouped summaries, and lungs icon
- Greek translations
- Allergy risk icons with differentiated facial expressions per level
- `card_mod` support (style changes no longer trigger data reload)

### Changed
- SILAM: use entity registry for sensor detection, fixing issues with renamed locations
- SILAM: improved autodetection reliability (graceful fallback, subscription failure handling)

### Fixed
- Atmo: correct level mapping (0=unavailable, 7=event), entity patterns in manual mode
- Suppress negative values (-1) in circle overlays and labels

## [2.8.1] - 2026-01-05

### Added
- Per-allergen stale data detection and display

### Fixed
- Column count when sensors have different amounts of day data

## [2.8.0] - 2025-12-22

### Added
- **Pollen.lu (PLU) integration** with editor support and documentation
- Polish translations

### Fixed
- Pollenprognos and PLU autodetection for manually named sensors

## [2.7.2] - 2025-10-13

### Added
- Kleenex: support for localized category sensor names (singular/plural variants)
- Kleenex: manual mode support

### Fixed
- PEU: short phrase translations for category allergens

## [2.7.1] - 2025-10-03

### Added
- Allergen stroke color sync option (`allergen_stroke_color_synced`)
- Independent gap control (`allergen_levels_gap_synced`)
- Show allergens with n/a values when threshold is 0

### Fixed
- Stroke width now accepts 0
- DWD: icon coloring in minimal mode
- Allergens resetting when reopening editor or switching display modes

## [2.7.0] - 2025-09-29

### Added
- **SVG icon system** replacing PNG images — procedurally generated, color-aware icons
- **Allergen color system** with level inheritance and customizable colors per level
- Customizable "no allergens" color (`#a9cfe0` default)
- `sort: none` option to preserve config allergen order
- Stroke width slider (0–100) with automatic gap synchronization

### Changed
- Unified color source for allergen icons and level circles (`LEVELS_DEFAULTS`)
- Editor reorganized: allergen/circle color sections restructured

## [2.6.0] - 2025-09-11

### Added
- **Kleenex Pollen Radar integration** with 5-level scale, category allergens (trees/grass/weeds), grouped editor, and new allergens (chenopod, nettle, poaceae)
- "No allergens" display when all sensors are filtered out

### Fixed
- Kleenex: level mapping, location filtering, threshold handling

## [2.5.3] - 2025-09-08

### Changed
- Bundle Chart.js locally instead of loading from CDN

## [2.5.2] - 2025-08-26

### Fixed
- Localized, reason-specific error messages for location issues

## [2.5.1] - 2025-08-17

### Added
- French translations (by @zen2)

## [2.5.0] - 2025-08-04

### Added
- Manual location mode for custom sensor names
- Custom entity prefix/suffix support
- Allergen sensor links (tap allergen to navigate to entity)
- Allergy risk/index display (top placement, raw values)
- PEU hourly display modes
- Allergen sorting options (by value, name, or none)

### Changed
- Level circles adapt segment count to integration's max level
- SILAM threshold adjustments

### Fixed
- Level circle persistence across DOM updates
- Localization alignment with Home Assistant conventions

## [2.4.7] - 2025-07-27

### Added
- Configurable icon-to-level ratio (`levels_icon_ratio`)

### Fixed
- PEU allergen image mapping
- DWD level circle segment count

## [2.4.6] - 2025-07-26

### Added
- Custom level phrases support
- Integration-specific documentation

## [2.4.5] - 2025-07-18

### Added
- Version info display in editor and console

### Fixed
- PEU allergen names (#62)
- Build optimization (no critical errors on local builds)

## [2.4.4] - 2025-07-16

### Fixed
- Card flickering caused by unnecessary redraws (#58)

## [2.4.3] - 2025-07-16

### Fixed
- PEU default location names when not explicitly set

## [2.4.2] - 2025-07-16

### Added
- Configurable gap between allergens in minimal mode (#55)

### Fixed
- PEU: support for new API allergen names (#50)
- SILAM: twice_daily and hourly mode issues (#54)
- Reduced unnecessary redraws

## [2.4.1] - 2025-07-15

### Added
- Configurable icon size for allergens and levels
- SILAM: daily forecast support (requires silam_pollen >= 0.2.7)

### Changed
- Editor UI improvements and rearranged sections

## [2.4.0] - 2025-07-14

### Added
- **Level circles** — Chart.js doughnut charts replacing static level images
- Configurable text size ratio
- Editor reorganization with clearer sections

### Changed
- `show_empty_days` defaults to `false` for all integrations

## [2.3.4] - 2025-07-05

### Changed
- Improved allergen icon color balance across all levels

## [2.3.3] - 2025-07-02

### Added
- SILAM: twice daily and hourly forecast modes with editor support
- Localized sorting and tap-action labels in editor

### Fixed
- Location reset when switching integrations
- Invalid pollen values (-1) no longer generate date columns

## [2.3.2] - 2025-07-01

### Added
- Translations: Czech, Danish, Finnish, Italian, Dutch, Norwegian, Russian, Slovak

## [2.3.1] - 2025-07-01

### Changed
- SILAM: improved thresholds, Cyrillic location name support
- License changed to Apache 2.0

## [2.3.0] - 2025-06-29

### Added
- **SILAM Pollen Allergy Sensor integration** with autodetection and locale-independent operation

## [2.2.4] - 2025-06-23

### Added
- Configurable background color

## [2.2.3] - 2025-06-12

### Fixed
- Clearer error messages distinguishing "no sensors available" from "all filtered out"

## [2.2.2] - 2025-06-12

### Fixed
- Tap-toggle can now toggle off
- Pollenprognos sensor filtering

## [2.2.1] - 2025-06-11

### Fixed
- PEU autodetection and title extraction

## [2.2.0] - 2025-06-10

### Added
- **Polleninformation EU (PEU) integration** with autodetection and scaled levels
- Allow empty string to hide card header

## [2.1.0] - 2025-06-04

### Added
- Tap action support

## [2.0.5] - 2025-06-01

### Fixed
- Beech allergen mapping (#24)

## [2.0.3] - 2025-05-30

### Added
- Pollen value display inside level circles
- Clearer config options for allergen text/value display
- Integration-specific threshold slider

## [2.0.1] - 2025-05-29

### Fixed
- German translation improvements

## [2.0.0] - 2025-05-29

### Added
- **DWD Pollenflug integration** (German pollen forecast)
- Full internationalization system with auto-detection from Home Assistant locale
- Multilingual editor and card
- Autodetection of installed integration
- HACS integration with automated release workflow

### Changed
- Unified allergen name translation system across integrations

## [1.2.0] - 2025-05-08

### Added
- **Visual editor** (Lovelace GUI configuration) with city dropdown, threshold slider, and all config options

## [1.1.2] - 2025-05-04

### Added
- Day display options: abbreviated, boldfaced, uppercase, relative dates
- `show_empty_days` option

## [1.1.1] - 2025-05-02

### Fixed
- Ignore stale forecast values

## [1.1.0] - 2025-04-30

### Added
- Custom phrases support
- City name umlaut handling in titles

## [1.0.6] - 2025-04-29

### Changed
- Updated for compatibility with homeassistant-pollenprognos v1.1.0

## [1.0.5] - 2025-03-21

### Fixed
- CDN loading issues

## [1.0.4] - 2023-05-09

### Added
- Handling for unavailable values (-1/NA)

### Changed
- Default sort changed to `value_descending`

## [1.0.2] - 2023-05-08

### Added
- Sorting: by value or name (ascending/descending)

## [1.0.1] - 2023-05-08

### Added
- `pollen_threshold` configuration
- Minimal display mode
- Configurable `days_to_show`

## [1.0.0] - 2022-08-05

- Initial release
