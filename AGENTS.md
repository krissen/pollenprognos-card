# AGENTS.md

## Automated Agent Instructions for GitHub Copilot

### Project Overview
This is a Home Assistant Lovelace card for displaying pollen forecasts. The card supports multiple pollen data integrations through adapters and provides a visual editor interface.

### Technology Stack
- **Framework**: Lit Element (Web Components)
- **Build System**: Vite
- **Language**: Modern ES6+ JavaScript
- **Dependencies**: lit, chart.js, intl-messageformat
- **Target Environment**: Home Assistant frontend (modern browsers)

### Development Environment Setup
1. **Prerequisites**: Node.js and npm
2. **Install dependencies**: `npm install`
3. **Development build**: `npm run dev`
4. **Production build**: `npm run build`
5. **Version update**: `npm run update-version` (auto-runs before build)

### Directory and File Handling
- **IGNORE COMPLETELY**: `dist` directory (build artifacts)
- **IGNORE COMPLETELY**: `node_modules` directory (dependencies)
- **LOCALIZATION CONSTRAINT**: In `src/locales/` directory, only process `en.json` file. All other language files (cs.json, da.json, de.json, etc.) must be ignored to prevent translation corruption.
- **BUILD ARTIFACTS**: Files in `dist/` are auto-generated - never edit manually

### Project Architecture
- **Main Entry**: `src/index.js` (exports the card components)
- **Card Component**: `src/pollenprognos-card.js` (main card implementation)
- **Editor Component**: `src/pollenprognos-editor.js` (visual configuration editor)
- **Adapters**: `src/adapters/` (integration-specific data handlers for pp, dwd, peu, silam)
- **Utilities**: `src/utils/` (shared helper functions)
- **Constants**: `src/constants.js` (configuration and data constants)
- **Internationalization**: `src/i18n.js` (language detection and text loading)
- **Images**: `src/pollenprognos-images.js` (embedded SVG icons)

### Coding Standards and Patterns

#### General Principles
- Follow KISS (Keep It Simple, Stupid) and DRY (Don't Repeat Yourself) principles
- Use modern ES6+ JavaScript syntax (modules, arrow functions, destructuring)
- Prefer `const` and `let` over `var`
- Use template literals for string interpolation
- Comment complex logic and public methods in English

#### Lit Element Patterns
- Use `static get styles()` for CSS-in-JS styling
- Implement `render()` method returning `html` template literals
- Use `static get properties()` for reactive properties
- Handle property changes in `updated(changedProperties)` lifecycle method
- Use `this.requestUpdate()` to trigger re-rendering when needed

#### Chart.js Integration
- Register required Chart.js components before use
- Cache chart instances in `_chartCache` Map to prevent memory leaks
- Properly destroy charts when component unmounts

#### Error Handling
- Store error states in `_error` property with translation keys
- Display user-friendly translated error messages
- Use try-catch blocks around external API calls and data processing

#### Adapter Pattern
- Each integration has its own adapter in `src/adapters/`
- Adapters implement consistent interface: `stubConfig`, `findSensors`, `getData`
- Auto-detection of available integrations based on sensor entities

### Configuration and Validation
- Configuration validation happens in editor component
- Use deep equality checks (`deepEqual`) to prevent unnecessary re-renders
- Cosmetic-only changes should not trigger card reloads
- Provide sensible defaults for all configuration options

### Internationalization (i18n)
- **CRITICAL**: Only modify `src/locales/en.json` for English text changes
- Use `t(key, hass)` function for all user-visible text
- Language auto-detection follows Home Assistant's language setting
- Fallback to English if translation key is missing

### Data Processing
- Normalize data from different integrations using adapter pattern
- Handle missing or malformed data gracefully
- Support multiple forecast modes (daily, hourly, twice_daily)
- Validate sensor availability before attempting data access

### Styling Guidelines
- Use CSS-in-JS with Lit's `css` template literal
- Follow CSS custom properties for theming integration with Home Assistant
- Responsive design considerations for various Home Assistant dashboard sizes
- Use CSS Grid and Flexbox for layouts

### Testing and Validation
- **Build Validation**: Always run `npm run build` to verify changes
- **Manual Testing**: Test in Home Assistant environment when possible
- **HACS Validation**: CI validates HACS compatibility automatically
- **Integration Testing**: Test with different pollen integrations if available

### Version Management
- Version is auto-updated from git tags via `scripts/update-version.js`
- Do not manually edit version numbers in `package.json`
- Build process automatically includes version in output

### Dependencies and External APIs
- Minimize external dependencies
- Bundle all dependencies (no externals in build)
- Handle network errors gracefully for pollen data fetching
- Respect Home Assistant's entity state update patterns

### Performance Considerations
- Use efficient rendering patterns in Lit
- Cache expensive computations
- Minimize DOM updates through proper reactive property usage
- Dispose of resources (charts, subscriptions) properly

### Common Pitfalls to Avoid
1. **Never edit generated files** in `dist/`
2. **Never modify non-English locale files** in `src/locales/`
3. **Don't break adapter interface consistency** when modifying integrations
4. **Avoid direct DOM manipulation** - use Lit's reactive rendering
5. **Don't forget to register Chart.js components** before use
6. **Always handle missing entities gracefully** in adapters

### Comments and Documentation
- All code should be commented for clarity, especially complex logic
- All documentation, including comments, must be written in English
- Document public methods and complex algorithms
- Include JSDoc comments for important functions when appropriate