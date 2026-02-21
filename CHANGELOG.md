# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2.9.0] - Unreleased

- (locales) Sort el.json keys to match en.json order
- Adding new JSON keys to support new version release
- short names fix
- (el): add Greek translations for pollen card
- (style) Remove redundant allergy_risk_-1 and _0 SVG variants
- (allergy risk) Differentiated facial expression depending on allergy level
- (atmo) Prioritize card i18n level names over French Libellé attribute
- (fix) Remove falsy fallback in empty-days column count
- (style) Replace air quality icon with anatomical lungs silhouette
- (gpl) Fix day placeholders, manual mode discovery, and forecast guard
- (style) Rename qualite_globale.svg to air_quality.svg
- (atmo) Group summaries with their data blocks
- (atmo) Add lungs icon for qualite_globale (AQI)
- (atmo) Fix const assignment error in fetchForecast
- (fix) Suppress -1 in circle overlay and empty parentheses in labels
- (fix) Suppress negative display_state in numeric output, fix column count
- (atmo) Map Atmo France levels correctly (0=unavailable, 7=event)
- (locales) Add show_block_separator translation to all locales
- (atmo) Fix autodetection, day placeholders, block separator, and subset toggle
- (gpl) Read forecast attributes correctly using .value field
- (atmo) Add pollution adapter support, editor grouping, and sensor fixes
- (atmo) Add pollution icons, translations, and constant mappings
- (gpl) Fix show_empty_days ignoring empty day placeholders
- (gpl) Fix stub config fallback, manual mode detection, and prefix normalization
- (gpl) Use native 0-5 scale with 5 doughnut segments
- (docs) Add GPL integration documentation
- (locales) Add GPL allergen translations for maple, graminales, cypress_pine
- (gpl) Fix editor GPL discovery lifecycle and Select All duplicates
- (gpl) Ersätt regex-baserad detektion med attribut-baserad
- (docs) Add Google Pollen Levels to documentation
- (locales) Add Google Pollen integration strings
- (gpl) Add editor support for Google Pollen Levels
- (gpl) Add card support for Google Pollen Levels
- (gpl) Register adapter and add sensor detection
- (gpl) Add Google Pollen Levels adapter
- (docs) Add Atmo France to documentation
- (atmo) Add Atmo France integration adapter

## [2.8.1] - 2026-01-05

- (locales) Added missing strings for stale data
- (fix) Use first sensor with days data for column count
- (fix) Address review feedback: optional chaining and unused properties
- (stale-data) Add per-allergen stale data detection and display
- Fix typo in Polish locale for card interactivity

## [2.8.0] - 2025-12-22

- (fix: pp, plu) Apply same autodetect fix to editor
- (pl.json) Remove trailing whitespace
- (plu.js) Derive PLU_SUPPORTED_ALLERGENS from RAW_ALIAS_NAMES
- (docs) Update PLU version to v2.8.0
- (pl.json) Add missing PLU allergen translations
- (fix: pp, plu) Restore PP autodetect for manual pollen_ sensors
- (README.md) Add Contributing link to Support section
- (docs) Update to 13 languages and 6 integrations
- (docs) Add installation and quick-start guides
- (CONTRIBUTING.md) Fix title and add Development section
- (docs) Adjustments to README
- (package) version bump
- (docs) Added contributors and clarified project lineage
- (docs) Added Polish to provided locales and n+1 for supported locales in the README
- claude init
- Fix Polish translations for allergens and errors
- Fix Polish translations for allergen terms
- Update Polish translations for allergens and settings
- Update Polish translations in pl.json
- Add Polish localization for allergen card
- Fix grasses alias for Pollen.lu
- (locales) Added missing strings
- Document PLU integration and localize editor labels
- Fix PLU integration defaults and location reset
- Add beech alias spelling variant

## [2.7.2] - 2025-10-13

- Fix Kleenex manual mode to support localized category suffixes
- Fix Kleenex location detection to support localized category names
- Auto-add underscore to prefix and fix title extraction in manual mode
- Handle entity_prefix with sensor. prefix gracefully
- Add manual mode filtering in Kleenex adapter and exclude from general handler
- (kleenex) Added kruid(en) as a possible alias to onkruiden, weeds
- Fix Kleenex manual mode sensor ID construction
- Refactor: Extract KLEENEX_LOCALIZED_CATEGORY_NAMES to constants.js to eliminate duplication
- Add Kleenex integration to manual mode UI condition
- Use prefix matching for localized category names to handle singular/plural variants
- Support localized category sensor names for Kleenex integration
- Use slugify() for consistent location normalization across kleenex integration
- Fix location slug normalization for kleenex category sensors
- remove debug file
- Fix PEU adapter to use canonKey for short phrases and restore grasses translation
- Add missing editor.phrases_short.*_cat locale strings and remove redundant grasses key
- (locales) Added missing string
- (locales) Added missing allergens

## [2.7.1] - 2025-10-03

- (locales) Stroke sync translations
- Add allergen_stroke_color_synced and allergen_levels_gap_synced to COSMETIC_FIELDS
- Add allergen_levels_gap_synced feature for independent gap control
- Fix card rendering to respect allergen_stroke_width: 0
- Change allergen_stroke_color_synced default to true
- Fix slider to allow 0 value and add config option to docs
- (locales) Stroke color sync translations
- Add allergen stroke color sync option
- Apply display_state fix to normal mode icon coloring as well
- Fix DWD adapter to set display_state and use it for minimal mode icon coloring
- Show allergens with n/a values when threshold is 0
- Fix sorting error when sensors have n/a values and threshold is 0
- (locale) Translated latest string-additions
- (editor, peu) Added explanation about only allergen_risk being available in non-daily modes
- Fix debug getter to handle undefined _config
- Make all debug logging conditional on debug: true
- Fix allergen reset when switching from non-daily to daily mode
- Fix root cause: mode change resetting allergens to defaults
- debug output
- Add dispatch source identification to all config-changed events
- debug output
- Fix allergens resetting when matching stub defaults
- debug output
- Add more comprehensive debug logging for allergen tracking
- Changes before error encountered
- Add comprehensive debug logging for allergen persistence issue
- Improve allergen preservation logic in editor
- Also update _userConfig when mode changes affect allergens
- Fix disabled allergens becoming enabled when reopening editor
- Fix allergens being reset when reopening editor

## [2.7.0] - 2025-09-29

- (editor) Tweaked gap line aesthetics
- Show actual gap value when inheriting from allergen
- Implement conditional gap control based on inheritance mode
- Initial analysis - understanding editor inheritance issue
- Fix code review issues: extract magic numbers and refactor complex ternary
- (editor) Tweaked sync between stroke and gap when going from (levels) custom to inherit
- Fix empty color sync between allergen and levels when inheriting
- Fix stroke width reset to sync with gap when inheriting
- Fix line thickness reset sync and sort none handling
- (editor) Tweaked ratio between gap and stroke width
- Improve README features and related projects documentation
- (readme, docs) Cleanup + TOC
- Fix sort: none for Kleenex adapter to preserve config allergen order
- Add documentation for sort: none option
- (locale) sort_none for supported languages
- Implement sort: none option for pollenprognos-card
- (locale) Changed header strings
- (editor) Moved allergen stroke
- (locale) New strings
- Fix no_allergens color rendering and update label text
- (locale) New strings
- Fix no_allergens color by removing hardcoded SVG color style
- Update documentation with new variables and synchronization behavior
- Fix no_allergens SVG to respect CSS stroke-width variables
- Add customizable no_allergens color picker with default #a9cfe0
- (editor) Tweaked ratio between gap and stroke width
- Fix gap sync logic and update UI labels to 'aesthetics'
- Fix allergen stroke width: step=5, sync with level gap, keep textfield input
- Implement allergen and level circle synchronization improvements
- Update documentation: add new color management config options and system overview
- Sync gap color with allergen outline, add stroke width slider 0-100, fix rgba previews
- Fix level circle color mapping: segments now properly represent pollen levels 1-6
- Unify color systems: both allergen and level colors now use same LEVELS_DEFAULTS source
- Fix reset button, level color mapping sync, and hide level config when inheriting
- Fix level mapping, color preview, and add stroke width control with working outline
- Fix color system logic: default allergen colors and proper level 0 mapping
- (editor) Moved settings around (allergen/circle colours)
- esbuild, rollup
- Major editor enhancement: allergen color system, level inheritance, moved sections
- Remove accidentally committed demo file
- Fix editor crashes and add missing icon color translations
- Switch to build-time SVG imports following HA best practices
- Fix SVG loading infinite loop causing browser freeze
- Phase 4-5: Add icon color configuration and cleanup PNG system
- Phase 1-3: Implement SVG rendering system replacing PNG images
- optimerat svg
- fixed no allergens
- svg images
- inverted a batch of 10 svg:s
- patched grass and hazel (0 only)
- svg images (needs to be inverted)
- Add multiple countries to pollenprognos-card

## [2.6.0] - 2025-09-11

- (kleenex, docs) Clarified difference between the card and the integration
- Add documentation note about Kleenex integration level interpretation difference
- Fix Kleenex integration level display: use 4 segments like PEU instead of 6
- Fix centering issue for no allergens display
- (images) Fixed no allergens
- (locale) No allergen translations
- Implement no allergens display for filtered sensors
- (images) PNG and mappings for no_allergens
- Enhance documentation for Kleenex Pollen Radar
- Fix select all button to include category allergens for kleenex integration
- Update Kleenex Pollen Radar card version note
- (editor) Fix button
- Cleanup
- Fix category allergen detection in findAvailableSensors for kleenex integration
- (card) Debug info
- (card) Added a debug line
- Add comprehensive debugging for category allergen independent display issue with detailed level tracking
- Add comprehensive debugging for category allergen processing to identify display issue
- Add sensor building phase debugging to track category allergen processing
- Add comprehensive debugging and error handling for category allergen processing
- Add enhanced debugging for category allergen processing to identify display issue
- Add enhanced debugging for kleenex category allergen display issue
- (kleenex) Changed variable name; added strings for category sorting
- Fix kleenex adapter TypeError: change sensors from const to let to allow reassignment
- Fix kleenex category allergen sorting to control card display order instead of editor visibility
- Add Kleenex-specific checkbox to control category allergen visibility in editor
- (kleenex) Strings for category allergens
- Fix grass category vs individual allergen conflict by using distinct internal naming
- (kleenex, editor) Allergen header strings
- Fix ReferenceError: move testVal function definition to top of fetchForecast
- Fix kleenex level system to properly implement 5-level scale (0-4) with correct display mapping
- (kleenex) Short version of new allergens
- Fix kleenex location filtering for multiple locations
- Fix kleenex PPM thresholds with category-specific 5-level system matching integration
- Implement Kleenex editor improvements: grouped allergens, threshold default, and translations
- (kleenex) poaceae minus1
- (kleenex) nettle minus1
- (kleenex) Strings for the recently added allergens
- (kleenex) Chenopod images
- (kleenex) Images for poaceae; mappings for poaceae and nettle (reusing nettle and pellitory)
- Add support for localized Kleenex allergen names across all regions
- kleenex test results
- Fix Kleenex API testing scripts to correctly parse allergen data structure
- kleenex test results
- Add support for new Kleenex allergens: chenopod, nettle, and poaceae
- Fix Kleenex API testing scripts with correct endpoints and methods
- Add Kleenex API testing suite with dynamic coordinate generation
- Fix kleenex category allergen naming by separating icon fallback from text translation
- Add comprehensive debug logging to track kleenex sensor data flow
- Fix kleenex category allergen rendering by improving safety check logic
- Add detailed debug logging to track kleenex category allergen rendering issue
- Fix kleenex pollen_threshold to show all allergens including level 0
- (editor) Fix reset all -button
- Fix kleenex rendering crash and add detailed debug logging
- Fix kleenex allergen data separation and add comprehensive debug logging
- (kleenex) Locale for editor allergens
- (kleenex) Mappings for new allergen images
- (kleenex) Added allergen images
- Fix kleenex value calculation to prioritize numeric values over text levels
- Fix kleenex title formatting, location dropdown display, and PPM thresholds
- Fix kleenex adapter missing days array causing TypeError
- Fix kleenex sensor detection to only look for category sensors (trees/grass/weeds)
- Fix read-only config property error and missing kleenex integration handling in editor
- Fix runtime error by normalizing integration names and adding fallback handling
- Fix kleenex integration sensor patterns and add missing editor support
- (locale) More Kleenex strings
- Fix kleenex adapter to extract individual allergens from sensor details
- (locale) Added keys for kleenex
- Fix kleenex integration detection and stub configuration
- paketversion
- Complete kleenex integration with documentation, translations, and image mappings
- Implement kleenex pollenradar adapter with autodetection and UI integration
- Enhance AGENTS.md with comprehensive GitHub Copilot coding agent instructions

## [2.5.3] - 2025-09-08

- import chart.js locally, not with full cdn URL

## [2.5.2] - 2025-08-26

- release fix
- (locale) Added error messages for locales
- fix: render apply control as button
- feat: clarify location errors and button style
- fix: display reason-specific messages
- (locale) Fix for French

## [2.5.1] - 2025-08-17

- (docs) mention all included localizations
- package json
- bugfixed fr json
- fr locale by @zen2

## [2.5.0] - 2025-08-04

- Reset allergens when returning to daily mode
- (readme) No need to mention special sensors there
- Update README images
- (silam) Adjusted thresholds and explained them in docs
- Lets make this 2.5.0; change version compatibility in docs
- (locale) auto/manual strings
- Add manual location mode for custom sensor names
- Fix autodetection for pollen integrations
- feat: improve editor language handling
- (editor) Move custom prefix-suffix summary below mode
- (locale) suffix/prefix strings
- summary for custom prefix and suffix
- fix: preserve first typed prefix character
- fix: clear location when editing custom entity names
- fix: reset custom prefix on detected location
- feat: allow clearing prefix via null
- feat: support empty entity prefix
- feat: add prefix/suffix config support
- feat: support suffix for custom sensors
- feat: allow custom sensor prefixes
- git ignore dist
- fix: rebuild charts when element reconnects
- fix: persist level circle config in dataset
- fix: restore level circle charts after DOM updates
- feat: update package version from git tag
- (locale) resolveKey bugfix
- installed required package
- refactor: align localization with HA
- localisations for allergen linking
- move link placement
- better fallback than camera.pollen
- feat: add sensor links for allergens
- docs: document polleninformation mode requirements
- translations for all locales
- docs: document top placement options
- allergy risk/index at top true by default
- feat: rename silam index option
- Show raw allergy risk values only in numeric displays
- Handle PEU raw level data
- fix(peu): match numeric values and add raw risk option
- Add allergen sorting options and selection helpers
- Add hourly modes for PEU
- fix pie chart levels for dwd and image scaling
- Adapt level circle to integration max levels
- disable allergy risk by default
- allergy risk icons
- dist card
- support for allergen_risk and index "allergen" sensors

## [2.4.7] - 2025-07-27

- fix PEU allergen image mapping
- fix pie chart levels for dwd and image scaling
- Adapt level circle to integration max levels
- fix default level names
- (editor) Move title layout category from root to sub-category under layout
- Add levels_icon_ratio config and improve icon scaling

## [2.4.6] - 2025-07-26

- dist card
- fix PEU level name overrides
- fix: respect custom level phrases
- Add docs for integrations, localization and related projects

## [2.4.5] - 2025-07-18

- (vite) No critical errors on local builds
- refactor: optimize card and editor
- Add AGENTS.md with automated agent instructions
- Initial plan for creating AGENTS.md file
- Initial plan
- (readme) Adjusted allergen lists
- (cleanup) Removed temp file
- (translations) Tweaks
- (translations) Additional keys
- Add version info in editor
- (card) Chars
- Improve version log style and release workflow
- feat: add console version logging
- (peu) Proper fix for new allergen names (fixes #62)

## [2.4.4] - 2025-07-16

- (card) Försöker fixa blinket, igen #58
- Revert "(card) Further reduction of unnecessary redraws"
- (card) Försöker fixa blinket

## [2.4.3] - 2025-07-16

- (peu) Hotfix for peu default location names if user did not provide

## [2.4.2] - 2025-07-16

- (card) Further reduction of unnecessary redraws
- (readme) Version compatibility information re:polleninformation
- (card) Reducing unnecessary redraws
- (readme) Added valid allergen keys for each integration
- (peu) Support new api allergen names (#50)
- (card) Minimal gap tweaks
- (editor) Tweaks for editor CSS
- (card) Localised strings for minimal_gap (#55)
- (card, editor) User configurable gap (padding) between allergens in minimal config, specifically (#55)
- (editor) Lessen unwarranted updating
- silam twice_daily and hourly bugfixing #54

## [2.4.1] - 2025-07-15

- (editor) Second level detail summary background colour tweak
- (editor) Small UI tweaks (#51 now complete)
- (editor) Re-arranged some more
- (silam) Birch, grass and hazel, lowest threshold from 5 to 1
- (silam) Bugfix, LEVELS
- (readme) Correct card version for silam 0.2.7
- (peu, silam) Correct icon_size in stub
- (card, editor) Variable size for images (allergen and level—same for both)
- (dwd, peu, pp, silam) entity id to dict
- (readme) Correct versions re:silam compatibility
- (card, editor) safeguards around .startswith
- (silam) README, v2.3.4 breaks backwards compatibility with silam_pollen <v0.2.7
- (silam) Support daily forecast (new in silam_pollen 0.2.7)

## [2.4.0] - 2025-07-14

- (dist card)
- (readme) Added text size ratio to the options table
- (dwd, pp, silam) Show empty days to false as default
- (editor) Clearer sections in editor
- (silam) Changed threshold for level 1 for birch, grass and hazel from 5 to 1. Seems odd to say there's nothing when there is, albeit low?
- (editor) Re-arranged more.
- (locale) Translations for new editor strings
- (card) Variable size for text, done
- (images) remove another block referencing static images
- (images) remove another block referencing static images
- (card, levels) Tweaked gap color
- (images) removed static level images; no longer used
- dist card
- (peu) Hide empty days per default
- (readme) Added missing options
- (card, locale) Updates for levels
- (card) tweaking levels options
- (card) levels, pretty good; just need to set colours still
- (card) levels, at the level(lol) of nitpicking now
- (card) levels, numeric in circle in place
- (card) levels, closer still
- (card) levels, closer
- (card) I see levels; still work to do
- (editor) Options for generated levels
- (contributing) added file
- (locale) Translation for icon size
- (peu, silam) Correct icon_size in stub
- (editor) Protection for type when resetting multiple times
- (card, editor) Variable size for images (allergen and level—same for both)
- (dwd, peu, pp, silam) entity id to dict
- (readme) Update

## [2.3.4] - 2025-07-05

- cleaned some comments
- (icons) Same colour for all 0 as well
- (icons) More even colours within levels, and tried to find a good balance for each level
- tweaked some 0-images (#45)
- upscaled images (#45)

## [2.3.3] - 2025-07-02

- (locale) Language-inspecific name for SILAM
- (editor, silam hourly) Fallback detection of location when not explicitly set yet
- (editor) Reset location when changing integrations
- (card, silam forcast) Respect user's chosen days_to_show
- (pp, dwd, peu, silam) Do not return dates vid invalid pollen values (-1 and the like), only int >=0
- (locale) Don't translate integrations.
- (card) better handling of level row
- (card) better handling of day labels
- (card) minimal restored
- (card) circle-number restored
- (card) adapt size to number of columns
- (locale) Made sure localisation 'stuck' to additional items when executing
- (locale) Localised tap-action in editor
- (silam) Show empty days = false as default when mode is hourly or twice_daily
- (silam) Handle more possibilities of weather entity name
- (readme) Rewrote options; now also includes mode (silam)
- (editor, locale, card) Silam twice daily—fully functional?
- (editor) Bugfix, sort value/localized string
- (locale) Additional new strings (sort)
- (gen locales) Kopiera output till clipboard
- (gen locales) Rapportera saknade nycklar
- (editor) Använd locale för sortering
- (locale) Additional new strings (silam, modes)
- (gen locales) Separate modes
- translation keys
- (scripts) gen_locales, to check and update locales
- (editor) Use locales for silam mode strings
- (editor) Support for silam forecast modes
- (silam) hourly updates—fixed
- (silam) hourly almost working
- (silam) preliminary hourly support in place

## [2.3.2] - 2025-07-01

- translations for cs, da, fi, it, nl, no, ru and sk

## [2.3.1] - 2025-07-01

- (silam) using the new thresholds
- Update silam.js
- (silam) better slugifier—ha's own
- (silam) better auto-identification of locale name
- (locale) String for no integration found
- (silam) better support for cyrillic
- (license) rename
- (licence) Apache
- Update README.md

## [2.3.0] - 2025-06-29

- (editor) Better parsing of place names with multiple parts
- Fixed some minor locale-things
- (readme) added information about silam
- (silam) works regardless of card config locale
- (silam) better filtering
- (silam) basic functionality is there
- (silam) script for mapping silam allergens, and the current resulting file

## [2.2.4] - 2025-06-23

- README: added background_color to the table
- (card, adapters, locales) Support and respect background-color
- (editor) add config options for background-color
- (card) implementera stöd för backgroundc-color (style)
- (card) ha-card (not twice) and card-content div

## [2.2.3] - 2025-06-12

- (card) better error messages: no sensors available at all, or due to filtering

## [2.2.2] - 2025-06-12

- (card) tap-toggle should be able to toggle-off
- (locale) phrases_short.beech was missing
- (pp) better handling of explicit
- (pp) filtrera på korrekt sträng (inte phrases)

## [2.2.1] - 2025-06-11

- (peu) fix autodetect of title
- (peu) the card autodetection correctly sets stub
- (peu) card fetches correct stub; sensor stub still incorrect
- autodetect does not work; after reset all, it does work
- fixa location slugs och grejer

## [2.2.0] - 2025-06-10

- allow empty string to hide card header, as before
- better handling of title in config (card and editor logic, both)
- Update README.md
- locale (cherry-pick)
- Update README.md
- mention polleninformation in the README
- locale, bugfix
- mappings for the new allergens
- images for new types of allergens
- sorted locales by key
- peu: scale levels (images and text)
- final bugs might be fixed; filtration according to selected allergens works
- only dwd gräser left to fix, I think
- fallback, fully working
- autodetect, finds sensors for peu
- peu, a lot works—but still not full autodetect (at card-picking stage)
- påbörjat peu adapter; funkar inte ännu

## [2.1.0] - 2025-06-04

- support tap action

## [2.0.5] - 2025-06-01

- fix beech #24

## [2.0.4] - 2025-05-30

- Update README.md

## [2.0.3] - 2025-05-30

- Update README.md
- support pollen value inside circles

## [2.0.2] - 2025-05-30

- clearer config options for show allergen text/value
- better handling of sliders (aesthetic fix)
- better handling of initial threshold
- adapt threshold slider per integration
- fixed forgotten user-choices re:allergens

## [2.0.1] - 2025-05-29

- Fix typos and improve translations in German locale file
- information about related projects

## [2.0.0] - 2025-05-29

- dist card
- README
- hantera kortnamn
- kortversioner
- unified allergen names for translation (instead of separate pp/dwd
- locale, supports la-LA format
- flexible handling of language options
- language autodetect fix
- bugfix, days mismatch
- autodetect, fallback, translations—work
- autodetect, not perfekt re:language, but good enough?
- better autodetect, with fallbacks
- regressions soon fixed
- försöker göra stränghanteringen mer logisk
- pruned comments
- språk efter locale i första hand
- translations and values
- translate all in one go
- conditional debug messages
- config issues seemingly resolved
- no longer as persistent; but problems when switching integrations
- config is saved — just a bit too persistently
- autodetect works again
- switching between integrations, and editing allergens is working
- tre steg fram, två steg bak
- integrationsspecifika allergener
- README, updated options
- README: pollenflug
- dubbelkollade språk (pp)
- allt funkar
- autodetect funkar
- still not auto-detecting dwd correctly, but at least trying to fall back
- only auto-detection of dwd when pp is not installed is still left
- restore auto-detection; almost there
- multilingual card
- better default days for dwd
- multilingual editor
- latest card build
- new rye images
- rye and ash
- git ignore more
- bugfix, levels
- beech and pollenprognos-images
- translation keys for images (filenames now in english)
- översatt bilderna till engelska
- estetisk paritet med föregående version
- funktionell paritet med föregående version
- börjat implementera dwd
- bundle images
- hacs json 2
- hacs json
- release workflow
- release workflow
- README, hacs action workflow
- ignore hacsjson check
- hacs, removed type
- dist
- release workflow
- release workflow
- workflows
- prune workflows
- hacs (workflows)
- hacs (category)
- hacs (category)
- hacs (action)
- hacs (action)
- hacs
- release workflow
- hacs category
- hacs category
- hacs fix
- tell hacs where the .js is
- hacs category
- we need package.lock
- workflow, correct branch, take 2
- workflow, correct branch
- workflow for automatic build
- updated hacs
- bundling card
- git ignore more

## [1.2.0] - 2025-05-08

- Update README.md: mention visual editor
- ve: more logical order of the config options
- ve: the rest of the configuration options
- ve: stöd för stad-automatiken att även hitta Bräkne-Hoby
- ve: drop-down lista för städer är korrekt populerad
- ve: drop-down lista för städer utifrån installerade
- ve: hitta automatiskt installerad stad
- ve: threshold och dagar att visa som sliders
- ve: city works
- basic visual config functionality in place

## [1.1.2] - 2025-05-04

- fix dates_relative, new attempt
- fix dates_relative
- Update README.md: add phrases.no_infromation to example code
- fix phrases.levels regression
- restored days_boldfaced
- show_empty_days: whether to show or hide days without information
- days_boldfaced: new config option
- README: add days_uppercase
- README: add days_abbreviated
- support for abbreviation + return title
- explain in README
- turn off more console messages if debug=false
- support for exact days only
- README.md: mention custom for short versions

## [1.1.1] - 2025-05-02

- ignore old values found in forecast

## [1.1.0] - 2025-04-30

- keep umlauts in city-title
- beakta bindestreck
- Update README.md: dash and indent for custom ph. example
- Update README.md: threshold for custom phrases
- remove whitespace (line) from minimal
- Update README.md: image with translations
- support for custom phrases

## [1.0.6] - 2025-04-29

- README, correct versions...
- README: Notice of sensor version incompatibility
- revise new sensor names in README
- update to reflect changes in homeassistant-pollenprognos v1.1.0

## [1.0.5] - 2025-03-21

- Fix CDN problems

## [1.0.4] - 2023-05-09

- Checked images. Everything seems to be working. Ready for release?
- Implemented test_val more broadly
- CHANGED default sort, now set to value_descending
- Commented code
- indentation
- rewrote test_val -function. Checks for abnormally high and low values.
- tagit bort alla 7 -bilder (borde inte behövas)
- Alla -1 -bilder på plats
- Utökat stöd för -1 till dag 1 och al.
- Börjat implementera stöd för -1/NA

## [1.0.3] - 2023-05-08

- Version bump (same commit as v1.0.2)

## [1.0.2] - 2023-05-08

- Add variable: sort. Sort by value (asc/desc) or name (asc/desc).

## [1.0.1] - 2023-05-08

- added new variables to README
- Added pollen_threshold to select threshold of pollen shown (default: 1)
- If days_to_show isn't given, show full (4) amount of days
- Reset more values of "-1" to 0 (in leu of availability of NA)
- Delete hassfest.yml
- Update README.md
- Update hacs_action.yml
- Create hacs_action.yml
- Create hassfest.yml
- hacs
- Förklara stvningen av vissa allergener i minimal-kortet.
- Korta ner Hassel i minimal
- Quick bug fix
- Snyggare rader i normal-läget beroende på show_text
- Kortare namn på fler i minimal
- bugfix
- negativa värden nollade
- Nolla negativa värden
- funktion som kollar efter negativa värden
- Update README.md
- show title false funktionalitet fanns visst redan inbyggt
- Ta bort debug-kod
- Respektera title false även i normal-läget
- Lägg ut, lägg ut
- Allergen i () funkar
- Minimal fungerar
- Från table till div
- Minimerat mera; fungerar fortfarande
- Alternativ funktion används OK
- ignore gz
- Update README.md
- koll till prognos
- Update README.md
- lite större bild på allergen
- Variabler för antal dagar
- Fixat sälg/vide och tagit bort två kolumner

## [1.0.0] - 2022-08-05

- Initial release
