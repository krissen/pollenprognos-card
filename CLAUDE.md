# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

### Development
- `npm run dev` - Start Vite development server with hot reload
- `npm run build` - Build production bundle to `dist/pollenprognos-card.js`
- `npm run preview` - Preview production build locally

### Version Management
- `npm run update-version` - Sync version from git tags to package.json (runs automatically before build)
- Version is embedded in the build via Vite's `__VERSION__` define

### Testing
There are no automated tests in this project. Manual testing is done by loading the card in Home Assistant.

## Project Architecture

### Overview
A Lovelace custom card for Home Assistant that displays pollen forecasts from multiple integrations. Built with Lit web components, Vite bundling, and Chart.js for visualizations.

### Core Components

**Main Card** (`src/pollenprognos-card.js`)
- LitElement-based custom element (`<pollenprognos-card>`)
- Renders pollen forecasts with SVG icons and Chart.js doughnut charts
- Handles real-time updates via Home Assistant state subscriptions
- Manages display modes: minimal, daily, hourly, twice_daily
- Uses adapter pattern to normalize data from different integrations

**Visual Editor** (`src/pollenprognos-editor.js`)
- LitElement-based configuration UI for Home Assistant's visual editor
- Auto-generates forms based on adapter stub configs
- Provides integration-specific options (cities, regions, locations)
- Live preview updates as user changes settings

**Entry Point** (`src/index.js`)
- Imports and registers card and editor as custom elements
- Registers with HACS custom card picker

### Adapter System

Located in `src/adapters/`, each file exports:
- `stubConfig*` - Default configuration template for the editor
- `getAllergens()` - List of available allergen keys
- `getPossibleCities()/getPossibleRegions()/getPossibleLocations()` - Location options
- `getEntityPattern()` - Function to generate entity ID patterns
- `getDataStructure()` - Map of allergen → entity IDs for a given config

**Supported Integrations:**
- `pp.js` - Pollenprognos (Swedish)
- `dwd.js` - DWD Pollenflug (German)
- `peu.js` - Polleninformation EU (European)
- `silam.js` - SILAM Pollen Allergy Sensor (forecast-based)
- `kleenex.js` - Kleenex Pollen Radar (Dutch)
- `plu.js` - Pollen.lu (Luxembourg)
- `atmo.js` - Atmo France (French air quality/pollen)
- `gpl.js` - Google Pollen Levels (global, via pollenlevels HACS integration)

When adding support for a new integration, create a new adapter file following the existing pattern and register it in `src/constants.js` ADAPTERS map.

### Utilities

**Normalization** (`src/utils/normalize.js`)
- `normalize()` - Converts allergen names to canonical slugs (e.g., "Björk" → "birch")
- `normalizeDWD()` - DWD-specific normalization handling German characters
- Uses `slugify()` helper and `ALLERGEN_TRANSLATION` map from constants

**Sensor Detection** (`src/utils/sensors.js`)
- `findAvailableSensors()` - Auto-detects which integration is installed
- Returns adapter key and location/city/region ID

**Level Defaults** (`src/utils/levels-defaults.js`)
- Default color schemes and styling for pollen level circles
- Conversion utilities for backwards compatibility

**SILAM Helpers** (`src/utils/silam.js`)
- Special handling for SILAM's weather entity pattern
- Reverse mapping from weather entity attributes to allergen data

### Internationalization

**Translation System** (`src/i18n.js`)
- Eagerly loads all locale files from `src/locales/*.json` using Vite's `import.meta.glob`
- `detectLang()` - Auto-detects language from Home Assistant settings
- `t()` - Translation function using IntlMessageFormat for variable interpolation
- 14 supported languages: cs, da, de, el, en, fi, fr, it, nl, no, pl, ru, sk, sv

**Locale Files** (`src/locales/*.json`)
- Flat JSON structure with dot-separated keys
- Keys include: allergen names (full/short), level descriptions, UI labels, weekday names
- English (`en.json`) serves as fallback

### Graphics

**SVG Icons** (`src/pollenprognos-svgs.js`)
- Procedurally generated SVG icons for 24+ allergen types
- `getSvgContent()` returns SVG markup with dynamic styling (fill, stroke, size)
- Icons use both fill and stroke for visual depth
- Rendered via Lit's `unsafeSVG` directive

**Raster Fallback** (`src/pollenprognos-images.js`)
- PNG fallback images for older browsers
- Not actively used but kept for backwards compatibility

**Chart.js Integration**
- Doughnut charts for pollen level circles
- Lazy canvas creation on first render
- Chart instances cached in `_chartCache` Map
- Custom colors, gaps, and thickness via config

### Configuration

**Constants** (`src/constants.js`)
- `ADAPTERS` - Registry of all adapter modules
- `DWD_REGIONS` - German region code → name mapping
- `ALLERGEN_TRANSLATION` - Allergen name normalization map
- `ALLERGEN_ICON_FALLBACK` - Default icon when allergen not recognized
- `PP_POSSIBLE_CITIES` - List of Swedish cities
- `COSMETIC_FIELDS` - Config fields that don't require data reload

**Stub Configs**
Each adapter exports a `stubConfig*` object with all possible configuration options and their defaults. The editor merges user config with stub config to determine which options to display.

### State Management

**Home Assistant Integration**
- Card receives `hass` object with all entity states
- Subscribes to forecast events for SILAM hourly/twice_daily modes via `hass.connection.subscribeMessage()`
- Unsubscribes on disconnect to prevent memory leaks
- Uses `updated()` lifecycle to detect config/entity changes

**Reactive Properties**
- `config` - Card configuration (set by Home Assistant)
- `hass` - Home Assistant state object (updated frequently)
- `_error` - Error message translation key
- `_forecastEvent` - Cached forecast data from subscriptions

### Display Modes

**Minimal Mode** (`minimal: true`)
- Horizontal icon-only layout with configurable gaps
- No text labels, just allergen icons with level circles
- Used for compact dashboard displays

**Standard Modes**
- `daily` - Shows daily forecast columns
- `hourly` - Hourly forecast (SILAM, some PEU sensors)
- `twice_daily` - Morning/evening forecasts (SILAM, PEU)

**PEU Hourly Variants**
- `hourly_second`, `hourly_third`, `hourly_fourth`, `hourly_sixth`, `hourly_eighth`
- Different interval slices of hourly data

### Color System

**Two Color Modes:**

1. **Inherit Mode** (`levels_inherit_mode: "inherit_allergen"`, default)
   - Level circle colors and gap color come from allergen icon styling
   - `allergen_stroke_width` controls both icon outline and level gap
   - Gap width auto-syncs via formula: `levelGap = Math.round(strokeWidth / 30)`
   - Single source of truth for visual consistency

2. **Custom Mode** (`levels_inherit_mode: "custom"`)
   - Level circles use independent `levels_colors` and `levels_gap_color`
   - Allergen icons styled separately via `allergen_colors` or `allergen_color_mode`
   - Full independent control at cost of potential visual mismatch

**Allergen Icon Coloring:**
- `allergen_color_mode: "default_colors"` - Built-in color palette based on level
- `allergen_color_mode: "custom"` - User-defined colors per level (0-6)
- `allergen_stroke_color_synced: true` - Stroke matches fill color for consistency

### Build System

**Vite Configuration** (`vite.config.js`)
- Library mode: bundles everything into single ES module
- Output: `dist/pollenprognos-card.js`
- Legacy plugin for dev mode only (not production)
- Injects git version/commit hash as `__VERSION__`
- No externals - all dependencies bundled

**Version Injection**
- `scripts/update-version.js` extracts version from git tags
- Removes 'v' prefix and suffixes like '-beta1'
- Writes to both `package.json` and `package-lock.json`
- Runs automatically via `prebuild` npm script

## HACS Integration

- Published as official HACS repository
- `hacs.json` specifies wide country support (60+ countries)
- `filename: "pollenprognos-card.js"` tells HACS what to download
- GitHub releases trigger HACS updates

## Common Patterns

### Adding a New Allergen
1. Add translation to `ALLERGEN_TRANSLATION` in `src/constants.js`
2. Add SVG icon to `svgs` object in `src/pollenprognos-svgs.js`
3. Update locale files in `src/locales/*.json` with full/short names
4. Add to adapter's `getAllergens()` if integration-specific

### Adding a New Integration
1. Create `src/adapters/newintegration.js` following existing pattern
2. Export `stubConfig*`, `getAllergens()`, location getters, `getEntityPattern()`, `getDataStructure()`
3. Register in `ADAPTERS` map in `src/constants.js`
4. Update editor to handle integration-specific config fields
5. Add normalization rules if allergen names differ

### Modifying Display Layout
- Lit template is in `render()` method of `src/pollenprognos-card.js`
- CSS is in static `styles` getter using Lit's `css` tagged template
- Level circles rendered by `_renderLevelCircle()` which creates Chart.js canvas
- Icon + data rows built in `_renderAllergenRows()`

### Debugging
- Set `debug: true` in card config to enable console logging
- Check `show_version: true` to log version on load
- Use `findAvailableSensors()` to diagnose auto-detection issues
- Inspect `this._error` for error translation keys
