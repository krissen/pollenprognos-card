# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
