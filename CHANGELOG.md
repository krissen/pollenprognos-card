# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Portuguese and Hungarian card translations** (issue #349). The card and
  its visual editor now speak Portuguese (`pt`) and Hungarian (`hu`), so a
  Home Assistant set to either language no longer falls back to English.
  Both files cover the full key set, including allergen names, pollen level
  descriptions and every editor label. The trigger is Polleninformation
  v0.6.0, which adds Portugal and Hungary (alongside Finland and Slovakia)
  to the integration's coverage.

### Fixed

- Prettier now formats the full source tree, including ten editor files that
  were previously excluded (issue #345).

## [4.2.0] - 2026-08-11

### Added

- **Google attribution for the two Google-backed integrations** (issue #338).
  Google Pollen Levels and Google Pollen now credit their source the way
  Google's Pollen API attribution policy requires: the card renders the
  "Google Maps" wordmark and the line "Source: Includes pollen data from
  Google" as a footer, the visual editor repeats it under the integration
  picker, and the badge shows the Google Maps pin in its corner with the full
  string as a hover title. The strings are never translated -- the policy
  prescribes their wording. Attribution is on by default and can be turned off
  with `show_google_attribution: false`, which hides the card footer and the
  badge pin but not the editor row. No other integration renders anything new.

### Changed

- **Discovery now runs at most once per HA state update per integration**
  (issue #321). Every code path that needs to find your sensors -- the card,
  the badge, the visual editor and the forecast fetch -- used to repeat the
  full entity scan on its own, several times per update. They now share one
  scan per update, which is most noticeable on dashboards that show a card
  and a badge together, or that have the editor open.
- **The editor's discovery logging follows the card's debug flag.** It was
  hardcoded to stay quiet, so its scans logged nothing even with debugging
  turned on.

### Fixed

- **Kleenex: tapping a row could open an unavailable sensor** (issue #326).
  When an allergen has its own detail sensor, that sensor is what the row
  opens -- but it was adopted as the tap target even when it was unavailable
  or unknown, leaving a row that showed perfectly good numbers from the
  category sensor and opened an empty dialog. Such a row now keeps the
  category sensor it read its numbers from. A detail sensor reporting a blank
  state is treated the same way; it used to count as a genuine reading of
  zero.
- **GPL: the discovery fallback did not know pollenlevels 3.0.0rc3's new
  attribution string** (issue #338). GPL finds its sensors through the device
  registry first and the entity registry second; only when both are
  unavailable does it fall back to scanning states for the integration's
  attribution text. That last path matched one exact string, and upstream
  reworded it in 3.0.0rc3, so setups that depended on the fallback found
  nothing. It now recognizes both the current and the legacy wording. The same
  three call sites also skip `sensor.google_pollen_*` entities, so the separate
  Google Pollen integration can never be mistaken for a GPL sensor.

## [4.1.0] - 2026-08-05

### Added

- **Polleninformation EU: four new allergens.** Dock/sorrel, plantain, sweet
  chestnut and tree of heaven -- exposed by the upstream integration since
  0.5.3 -- are now discovered, rendered with their own new icons and named in
  all 15 locales. Sorrel and plantain no longer borrow the mugwort icon.
- **The badge label can show the pollen level.** New `badge_label_content`
  option (`allergen` | `level` | `allergen_level`) controls what the text next
  to the badge circle says, using the same localized level names as the card.
  Default is the previous behaviour (allergen name).
- **The visual editor is fully translated.** The badge section, the
  icon-in-ring options and the remaining helper texts had English strings left
  in most languages; all 15 locales now cover the whole editor surface
  (over 600 strings).

### Fixed

- **PEU: Tilia is `linden`, not `lime`.** The `lime` entry in the PEU
  allergen list never matched a real entity; discovery now uses the upstream
  slug `linden`. Existing configs with `lime` keep working: configured
  allergen keys that don't match an entity literally now fall back to their
  canonical key, so old and new spellings resolve to the same sensor (and
  never duplicate rows).
- **PEU: multi-word allergens parse correctly.** Entity ids like
  `..._wien_sweet_chestnut` no longer mis-split into location "wien_sweet" +
  allergen "chestnut".
- **Swedish: ash is "Ask", not "Asp"** (wrong tree since v2.0.0).

## [4.0.1] - 2026-07-31

### Fixed

- **Kleenex works with renamed devices and manual mode** (issue #309). The
  adapter located its sensors solely through the hard-coded entity-id prefix
  `sensor.kleenex_pollen_radar_*`, which is just the slug of the integration's
  default device name; renaming the device broke auto-detection, and manual
  `entity_prefix` configs without that legacy prefix never matched. Discovery
  now goes through the device/entity registry (translation keys, device
  identifiers), so renamed devices, the editor's location dropdown, the card
  header title and badge configs all resolve correctly; pristine legacy setups
  are byte-identical. The manual-mode header now shows the location name
  instead of the configured prefix.
- **Kleenex allergen rows no longer vanish on upstream name quirks.** French
  and Italian category sensors deliver `"Poaceae "` with a trailing space, and
  the Italian site spells chenopod `"Chenepod"`; both silently dropped their
  rows (grass for FR/IT, chenopod for IT). Allergen names from the integration
  are now normalized (trimmed, whitespace-collapsed, lowercased) through one
  shared rule, the misspelling is aliased, and a test matrix pins the live
  detail names of all five supported regions (FR/IT/NL/UK/US) so future
  upstream changes fail loudly instead of dropping rows.
- **US Kleenex locations show their pollen data** (issue #313). The upstream
  integration's US zone only exposes category totals (trees/grass/weeds), never
  per-allergen details, so the card rendered "(No information)" despite live
  data. When a location has no per-allergen data, the card now falls back to
  the three category totals automatically, a zero-PPM day renders as the
  "no pollen" level (a category at zero across the whole forecast is filtered
  by `pollen_threshold`, like any all-zero allergen), and the editor's allergen
  picker offers the category totals for Kleenex. European locations and setups with per-allergen detail
  sensors are unchanged.
- **Tapping a Kleenex allergen icon opens that allergen's own sensor** (issue
  #317). When the integration's per-allergen detail sensor exists it is opened
  (even when the row's numbers came from the category sensor); otherwise the
  tap opens the category sensor the row was read out of, whose attributes
  carry the per-allergen data. Every icon leads somewhere; `link_to_sensors:
  false` remains the off switch.
- **A `more-info` tap_action without an entity no longer opens the sun.sun
  dialog.** Such an action is now inert: the card is not clickable through it,
  and the per-icon more-info it used to suppress works again. The editor warns
  when a `more-info` tap_action lacks an entity.
- **A manual Kleenex `entity_prefix` no longer mixes locations.** On installs
  with several Kleenex locations, a prefix like `kleenex_pollen_` also matched
  other entries' legacy ids (`kleenex_pollen_radar_utrecht_*`), so the card
  merged cities and the header could name the wrong one. The prefix is now
  scoped to the device it was minted from (resolved through the device
  registry, so it holds even while that device is unavailable), and when
  scoping drops entities the card says so once in the console. Single-location
  and registry-less setups (e.g. template sensors) behave exactly as before.
- **Invalid `icon_size` values fall back to the 48 px default** (issue #305).
  Hand-written YAML like `icon_size: "abc"`, `"48px"`, `true` or `0` previously
  leaked through as-is (rendering NaN-sized or zero-sized icons in some views);
  numeric strings such as `"64"` are still honoured, in the editor slider too.
  The same boundary hardening applies to every number-typed config field.

### Changed

- **Stricter compiler guarantees**: `noUncheckedIndexedAccess` is now enabled
  across the codebase (issue #306), with type-level guards only: no runtime
  behaviour changes, goldens untouched.
- **Dead `levelNames` field dropped from emitted Kleenex sensors** (issue
  #304). It was never read by the renderer.
- **Editor-screenshot tooling is locale-independent** (issue #307). Internal
  tooling only; the shipped bundle is unaffected.

## [4.0.0] - 2026-07-06

The TypeScript release: the whole codebase migrated from JavaScript + Lit 2 to
TypeScript (strict) + Lit 3, the level rings got an in-house SVG renderer, and
the bundle shrank by about 30 %. Configuration keys are unchanged and rendering
is pixel-identical. Note, however, that **two deliberate fixes change runtime
behaviour for some existing configurations**; see *Breaking behaviour changes*
below before upgrading.

### Breaking behaviour changes

- **A configured `tap_action` now takes precedence over per-icon more-info**
  (issue #279). Previously, a badge or card with a `tap_action` (e.g.
  `type: navigate`) never ran it. The level ring / allergen icon covers almost
  the whole element, and its built-in open-more-info click handler swallowed
  the tap first. With this release, a configured `tap_action` runs for the
  whole element. **If your config sets a `tap_action` AND you relied on tapping
  the icons to open more-info, add `link_to_sensors: true` to restore the
  per-icon more-info alongside the action.** Configs without a `tap_action`,
  and configs with `link_to_sensors: false`, behave exactly as before.
- **Hand-written string-typed YAML booleans and numbers now mean what they
  say.** Configuration is validated and type-coerced once when the card loads,
  so e.g. `minimal: "false"` no longer *enables* minimal mode (the string was
  truthy before) and `days_to_show: "4"` is honoured. **If a config leans on
  the old behaviour, where a quoted `"false"` acted as true, the card will now
  do what the value reads.** Configs written via the visual editor were always
  canonical and are unaffected.

### Changed

- **The whole codebase is now TypeScript (strict) on Lit 3** (issue #259). All
  source and test code migrated from JavaScript + Lit 2, with type checking,
  linting and a bundle-size guard gating CI. Adapter behaviour is pinned by
  golden characterization tests for all eleven integrations, so the migration
  is rendering-identical by construction. No configuration changes.
- **The bundle is about 30 % smaller** (289 kB to 203 kB gzip): the level rings
  are drawn by an in-house SVG donut and the Chart.js dependency is gone. The
  rings render pixel-identically to before.

### Fixed

- **`tap_action: navigate` actually loads the target view** (issue #279).
  Beyond the precedence fix above, the navigate action only updated the URL
  without dispatching Home Assistant's `location-changed` event, so the router
  never re-resolved the view.
- **German five-step scale tops out at "sehr hohe Belastung"** (issue #277).
  The German labels for the native 5-level scale (Polleninformation EU,
  MeteoSwiss, IRM KMI) borrowed the seven-step DWD wording, so the highest
  level read "hohe Belastung" ("high") where every other language says "very
  high". The German ladder is now keine / geringe / mittlere / hohe / sehr hohe
  Belastung. The DWD scale itself is unchanged (its own maximum actually is
  "hohe Belastung").
- **Atmo France "Indisponible" days show the no-data pattern** instead of an
  empty green level ring that read as "no pollen" when the truth was "no
  data".
- **The card editor's SILAM fallback no longer crashes** on a missing helper
  import that had made one auto-detection path throw since it was written.

## [3.4.0] - 2026-06-14

### Added
- **(irmkmi) Support for the IRM KMI integration** (issue #272). The card now reads pollen from [`irm-kmi-ha`](https://github.com/jdejaegh/irm-kmi-ha) (Royal Meteorological Institute of Belgium, meteo.be), which exposes seven allergens (alder, ash, birch, grass, hazel, mugwort, oak) as enum sensors per location. The meteo.be colour scale is mapped to the card's native 5-level scale (green=0, yellow=1, orange=2, red=3, purple=4) using the card's default level colours; the non-measurement states `none` (no data / out of season) and the legacy `active` flag are treated as no-data and hidden, so only allergens with an actual reading are shown. IRM KMI publishes a single current-day value, so `days_to_show` is fixed at 1. Multi-location setups (one config entry per location, e.g. Antwerp and Saint-Ghislain) are auto-discovered and selectable via the `location` field.

## [3.3.2] - 2026-06-14

### Fixed
- **(gpl) No more duplicate "Today" column with Pollen Levels** (issue #271). The sensor state holds the value for the integration's last *fetch* day, and forecast offsets count from that day; when the integration hasn't refreshed since yesterday (e.g. API quota), the first forecast item is dated *today*. The card assumed the state was today's value and appended the item after it, showing two columns both labeled "Today" — and the first one was actually yesterday's value. Day columns are now anchored by calendar date: the fetch day is derived from the forecast item dates (which come straight from the Google API), the state and each item land on their own day, and the card renders everything known from today forward — so a lagging sensor shows today's *actual* value once, and past values fall away. Dates are also parsed in the user's local timezone rather than UTC, which previously skewed day labels in timezones far from UTC (such as the reporter's Sydney). Fresh data (state fetched today) renders exactly as before.

## [3.3.1] - 2026-06-11

### Fixed
- **(gpl) Pollen Levels v3 overall-risk row stays correct alongside the new "top types" sensor** (issue #262). Pollen Levels v3 (beta 3) added overall-pollen-risk forecast attributes, and in doing so its `top_pollen_types_today` sensor (a text sensor naming the day's dominant pollen) started shipping the same `top_pollen_codes` attribute the card used to recognize the overall-risk summary. Both sensors then mapped to the `allergy_risk` slot in a location, and only entity order kept the right one; a different order could bind the text sensor and leave the overall-risk row without a value. Discovery now identifies the two sibling summary sensors (`top_pollen_types_today`, `plants_in_season_today`) explicitly and never treats them as the risk index. Legacy and v2.1.0 installations are unaffected.
- **(editor) Localized name for the Pollen Levels grass plant (`GRAMINALES`)** (issue #262). The visual editor's allergen list showed the raw key `editor.phrases_full.graminales` for Google's `GRAMINALES` grass-plant code, which is kept distinct from the grass category and had no editor name strings. The editor now resolves an allergen's label through its editor phrase, then the card's allergen name, then a readable fallback, so an unmapped code never shows a raw translation key; and `graminales` gains localized names in all 15 languages, using Google's own per-language Pollen API wording.
- **(gpl) Pollen Levels v3 multi-location support** (issue #262). Pollen Levels v3 moves from one Home Assistant config entry per location to a single parent entry (the API key) plus one config subentry per location. The card grouped discovered sensors by config entry, so several v3 locations sharing one parent collapsed into a single entry and all but the first location's sensors were dropped (a newly added v3 location did not appear). Discovery now keys locations by config subentry when present, falling back to the config entry, so each v3 location is detected and selectable independently. Legacy and migrated installations are unaffected.
- **Visual editor restored on Home Assistant 2026.6** (issue #265). HA 2026.6 removed `ha-textfield` and migrated `ha-button`, which the editor relied on for every text/number input and reset/select-all control — so on 2026.6 the input boxes rendered empty and the reset buttons appeared as oversized circles, making the editor unusable (the card itself on dashboards was unaffected). The editor now uses its own inputs and buttons, styled with Home Assistant's theme tokens so they match the surrounding UI. No configuration changes.
- **Editor number fields follow the Home Assistant profile, not the OS locale** (issue #263). The visual editor's numeric inputs (icon scale, text size, badge scale, level circle sizes, gaps, threshold, etc.) used native `type="number"` fields, whose decimal separator was dictated by the browser/OS locale. On a device whose OS uses a comma, a point was rejected even when the Home Assistant profile asked for a point, and an invalid entry could reset the value to `0`. Inputs now format and parse via the profile's `number_format` (point vs comma), accept either separator, clamp to range, and revert to the previous value instead of zeroing on invalid input. The threshold and days-to-show readouts follow the profile separator too.

## [3.3.0] - 2026-06-06

This is a visual release. pollenprognos grows a companion **badge** element you
can drop into Home Assistant's badge row, the allergen icon can move *into* the
level ring, there is an opt-in summary block and a distinct "no data" look, and
the visual editor is reorganized to be easier to navigate. None of it is
mandatory and nothing is renamed: every existing card renders exactly as before.

### Added
- **Badge support: a new `<pollenprognos-badge>` element** (issue #235). A dedicated, compact badge that appears in Home Assistant's **badge picker** (no copying YAML from a full card) and renders as a stock-sized pill in the dashboard badge row. It shares the card's rendering engine and editor sections, so there is no duplicated behaviour, yet it is its own element with its own visual editor. Highlights:
  - **Content** (`badge_content`, default `worst`): which allergen the badge concerns. `worst` ("Highest pollen level", the allergen with the highest current level), `aggregate` (the integration's overall-risk sensor, e.g. GPL/Atmo `allergy_risk`, falling back to worst), `single` (one chosen allergen via `badge_single_allergen`), or `row` (several allergens side by side).
  - **Visual** (`badge_visual`, default `icon_in_ring`): what the badge shows. `icon_in_ring` (allergen icon inside the level ring), `ring_value` (the numeric level centred in the ring), `ring_empty` (ring only), or `icon_only` (bare allergen symbol, no ring).
  - **Whole-badge scaling** (`badge_scale`, default `1`): one control scales the entire pill (height, padding, gap, label and ring together), built on Home Assistant's native badge box (`--ha-badge-size`, 36px) so a default badge sits cleanly next to built-in badges; larger sizes remain available.
  - **Label placement** (`badge_label_position`, default `right`): label to the right of the visual (the HA community convention) or below it; `badge_show_label` toggles the label.
  - In the ring-centre modes the ring auto-thins and the icon/number is enlarged for legibility at small sizes (matching the card's icon-in-ring treatment); an explicit `levels_thickness` / `levels_text_size` always wins.
  - The badge editor offers full visual parity with the card (integration & location, allergens, appearance, allergen icons, level circles and icon-in-ring sections), plus a reset-to-defaults button that preserves the integration and location. Every control updates the preview live, and the editor persists only the keys you actually set (no stub defaults baked into your YAML).
- **Allergen icon inside the level ring** (issue #227, PR #233). New `icon_in_ring` option renders the allergen icon centred in the donut hole instead of beside the ring, so the ring labels what the level is *of*. Tunable via `icon_in_ring_size_ratio` (icon size as a fraction of the ring hole, default `0.75`), `icon_in_ring_color_mode` (`static` or `follow_level`) and `icon_in_ring_static_color` (default the theme foreground). Enabling it auto-thins the ring (`levels_thickness` 60 to 35) to give the icon room, restoring the previous thickness when switched off (unless you tuned it manually). For `allergy_risk` the level-reactive smiley variant is used.
- **Distinct "no data" rendering** (PR #228). When a sensor reports level `-1` (alive but no value for this location, e.g. the upstream API returned null) the icon and ring now render with a faint fuzzy noise texture instead of collapsing into a plain "level 0" look, so missing data is visually distinguishable from a genuine zero. Opt-out via `show_no_data_distinct: false`.
- **Summary block for aggregate pollen risk** (opt-in, for GPL, SILAM and Atmo; issue #222). The aggregate (`allergy_risk` / `index`) can be rendered as a summary row pinned at the top of the card: standalone by default (a compact overall-risk overview that replaces the per-allergen rows), or with the detailed rows shown below it. The summary renders through the ordinary row path (same size, icon and multi-day layout) and appears as the first icon in minimal mode. Five new options:
  - `show_summary_block` (bool, default `false`): render the aggregate as a pinned summary row; standalone by default.
  - `show_summary_row` (bool, default `false`): also show the detailed allergen rows below the summary.
  - `show_summary_separator` (bool, default `true`): divider between the summary and the detailed rows.
  - `show_summary_top_types` (bool, default `true`, GPL only): a "Top types" row listing the day's dominant pollen categories.
  - `show_summary_plants_in_season` (bool, default `true`, GPL only): an "In season" row listing the plants currently in pollen season.
  The two GPL qualifier rows read Pollen Levels v2.1.0 data: top types from the summary sensor's category codes, and the in-season plant list from the sibling `plants_in_season_today` entity (resolved by config entry, since pollenlevels splits a location across devices). Both lists are localized to the card's own language, independent of the language the integration fetched in. All existing config keys are unchanged; with the block off the card looks exactly as before.
- **(gpl) `allergy_risk` aggregate row from Pollen Levels v2.1.0** (PR #230). GPL's `overall_pollen_risk_today` is surfaced as an `allergy_risk` row, providing the single aggregated value the summary block and the badge's `aggregate` mode build on.
- **Numeric value: show the calculated level or the raw measurement** (`numeric_value_raw`, default `false`; PR #244). For the integrations that report a raw measurement distinct from the level (Pollen.lu, Polleninformation, SILAM, Kleenex), the numeric value shown in the ring / value text can now be either the card's calculated level (default) or the raw value (concentration in grains or particles per m3, or an index). One option, honoured by both the card and the badge through a single shared resolver. Other integrations are unaffected. Polleninformation's existing `numeric_state_raw_risk` continues to work as a (PEU-scoped) alias.
- **Tap action on the badge** (PR #250). The badge gains a configurable `tap_action` (`more-info`, `navigate`, `call-service` / Home Assistant's `perform-action`), sharing the card's interaction handling and runtime. A new "Interactions" section in the badge editor configures it; the handler honours the Lovelace-standard `action` shape and forwards the action `target` (entity/device/area) to the service call.
- **Per-section reset buttons in the visual editor** (issue #235, PR #247). Every editor section now has a small reset (the circular arrow in its header) that reverts just that section's options to their defaults, complementing the existing global "Reset all". Available in both the card and the badge editor (shared implementation). The reset is coupling-aware: resetting a section that drives derived values also clears them (the synced level gap from the allergen stroke width, the auto-thinned ring thickness from icon-in-ring, the inherited empty-ring colour, and the SILAM/PEU forecast mode's day-display side effects), while keeping values owned by other sections intact. The Integration & Location reset re-autodetects the place but keeps the chosen integration.
- **Scale the allergen image within a badge** (issue #235, PR #248). New `badge_icon_scale` (default `1`) sizes the allergen visual as a whole, the ring (with its centred icon or value) in the ring modes and the bare icon in `icon_only`, without changing the label or the overall badge box. So `badge_scale` sets how big the badge is and `badge_icon_scale` sets how big the image is within it. The scaled visual is capped at the pill height so it can fill the badge but never overflows.
- **Translations & strings on the badge** (PR #245). The badge editor gains the same "Translations & strings" section as the card (language selector and custom full allergen names); the badge's date locale prefills from the Home Assistant locale, and short-name fields appear when `allergens_abbreviated` is set. Localization is applied at fetch time, so no badge runtime change.
- **Sections-view grid sizing** (issue #256). The card now implements Home Assistant's `getGridOptions()`, so in the sections-view grid it reports a sensible default size and resizes cleanly instead of always spanning the full width. The minimal layout reports a narrow strip whose width tracks the number of allergens, and the normal forecast layout a half-section minimum width; both leave their height content-driven so a header or text labels are never clipped. Additive, no config keys; `getCardSize()` (masonry view) is unchanged and the badge is unaffected.
- **Card picker suggestions** (issue #255, PR #258). On Home Assistant 2026.6+, picking a pollen sensor in the dashboard's "Add card" dialog now offers a ready-configured Pollenprognos Card in the picker's Community section, via the new `window.customCards` `getEntitySuggestion` hook. The picked entity is reverse-mapped to its integration and its specific location (city/region/location) through the shared autodetection, so the suggestion lands pre-filled at the location the picked sensor belongs to, not just the first one found. Works across all 10 integrations (including SILAM weather-only installs, which expose the allergy-risk index via a `weather.*` entity). Entities not owned by a known pollen integration, and non-renderable sibling or diagnostic sensors (for example a Pollen Levels timestamp or in-season helper, or Kleenex `_date`/`_region`), produce no suggestion. Card only (the badge is unchanged); additive and opt-in by Home Assistant, with no config keys changed.

### Changed
- **(editor) Visual editor reorganized into a flat 11-section structure** (issue #234, PR #236). Each section header now matches what it renders, ordered Source, Mode, Content, Appearance, Trailing. Title fields are inlined into "Integration & location"; allergens are promoted near the top; value display and day labels merged into one "Day display" section; the allergen-colour and level-colour expanders flattened; `show_value_numeric_in_circle` moved into "Level circles". Pure UX change: no YAML key renames, no breaking changes for existing configs.
- **(logging) Developer console messages translated to English** (issue #225, PR #229). The remaining Swedish `debug` / `warn` diagnostics (gated behind `debug: true`) are now English, matching the project language convention. Not user-facing; no behaviour change.
- **(internal) Card and badge now share one implementation per concern** (PR #243). Ring-icon CSS, the DWD ring-scaling rule, the ring-geometry derivation, the per-integration allergen list and level counts, and the allergen-key-to-sensor resolver are each defined once and reused, instead of being duplicated across the card and badge. No behaviour change beyond the level-count corrections noted below.
- **Editor section headings clarified to match Home Assistant** (issue #235, PR #249). Following the badge feedback, the editor categories were reworked so controls are easier to find: "Card appearance" → "Appearance", "Card layout" → "Layout", "Card interactivity" → "Interactions". On the badge the appearance section is now "Badge appearance" (a badge is not a card), and the badge gains the card's "Advanced" section (debug toggle and version). Badge labels now use Home Assistant's own per-language word for "badge" consistently across all 15 locales. Pure presentation: no config keys changed.
- **The badge now autodetects the installed integration** (issue #235, PR #246). Adding a badge from Home Assistant's badge picker, and opening the badge editor, now detects whichever integration is actually installed (DWD, PEU, etc.) instead of always defaulting to PollenPrognos; the editor prefills the integration and its first location and populates the location dropdowns, matching what the full card already did. Under the hood the card's integration autodetection is extracted into one shared module used by the card element, card editor, badge element and badge editor, removing previously duplicated and slightly divergent copies. Side effects of the unification: the card editor now also detects Pollen.lu and Kleenex (it previously missed them on some paths), the card element now auto-selects the first Google Pollen / MeteoSwiss location, and a weather-only SILAM install (no allergen sensors) is now detected.

### Fixed
- The summary block's "Top types" / "In season" qualifier rows and the separator no longer render unless `show_summary_block` is explicitly enabled. Previously, GPL's default config could show these rows unintentionally because the adapter always attaches `topPollen` / `plantsInSeasonList` to the allergy_risk sensor and `allergy_risk_top` defaults to true. Follow-up to #222 / #237.
- Standalone summary mode (`show_summary_block` on, `show_summary_row` off) no longer renders empty future day columns inherited from the hidden detail rows. Column count is now derived from the displayed row set instead of the full unfiltered sensor list.
- **(card) Three manual-mode quirks** (PR #232): GPL title in manual mode picked the first alphabetic location regardless of the configured `entity_prefix`, it now matches the prefix; PLU manual mode was silently disabled because the adapter deleted `cfg.location`, fixed; SILAM's forecast subscription now honours `entity_weather` in manual mode (#231).
- **(badge) `badge_content: single` now resolves the configured allergen for every integration** (PR #242, #243). The single-mode lookup compared `badge_single_allergen` only against the sensor's canonical slug, so it silently fell back to `worst` whenever the config key differed: SILAM's `index`, and the localized PP/DWD keys (`Björk`, `gräser`, `Beifuß`). Resolution now goes through a single shared resolver that reduces the configured key to the canonical allergen key (covering the generic and DWD umlaut/ß normalizations), so single mode works regardless of the integration's key style.
- **(editor) Correct level counts for Kleenex and PLU.** The editor showed 7 level-colour entries for Kleenex (native scale is 5) and the phrase reset generated 7 level labels for PLU (native 4); both now match each integration's native scale. Kleenex phrase defaults also now use the 5-level severity labels instead of borrowing the first five of the 7-level set (PR #243).
- **(editor) Fix a `ReferenceError` on phrase reset.** Resetting allergen phrases (e.g. on a language change) referenced `normalize` without importing it; the import is now present (PR #243).
- **(plu) Pollen.lu now shows the pollen level in the ring by default, not the raw concentration** (PR #244). The numeric value previously showed the raw p/m3 concentration (e.g. `369`); it now shows the calculated level, with the concentration available via `numeric_value_raw: true`.
- **(card, badge) The numeric value is now vertically centred in the ring** (PR #244). A single digit previously read slightly high because it was anchored to the text baseline.
- **(sensors) Keep `state: "unknown"` entities in `findAvailableSensors`** (PR #226). Only `unavailable` (coordinator down / entity disabled) is now treated as "no sensors found". An `unknown` entity is alive with a currently-null value (e.g. the upstream API returned null for this location), so reporting "no sensors found" was misleading; these entities are kept and render via the no-data path.
- **(badge) `badge_scale` can no longer break the editor** (issue #235, PR #248). Typing a pathological value (for example `100`) into the badge size field is clamped to a sane ceiling, so the preview can't balloon and make the editor unusable.
- **(autodetect) Correct city detection for multi-word Swedish allergens** (PR #246). PollenPrognos location auto-selection now uses the adapter's allergen-suffix extractor, so allergens whose slug contains underscores (for example `salg_och_viden`) no longer mis-derive the city.
- **(phrases) Allergen name overrides now carry across integrations** (issue #253). A `phrases.full` / `phrases.short` override keyed by one integration's allergen name (for example PollenPrognos `Gräs`) used to stop applying when you switched to another integration that names the same allergen differently (MeteoSwiss `grass`, DWD `Gräser`), because the lookup matched only the raw, per-integration key. The override now also resolves by the shared canonical allergen key, so "I customized grass" keeps meaning "grass is customized" regardless of which integration provides the data. Fully additive: existing raw-name keys still match exactly and take precedence, so no existing config changes behaviour; clearing a phrase field opts that allergen back out. Applies across every integration (card and badge), SILAM included.
- **(badge) `badge_content: single` no longer silently shows the wrong allergen** (PR #252). With `badge_content: single` and `badge_single_allergen: X`, the badge could render a *different* allergen (the highest-level one) with no error, whenever the named allergen was absent from the (often defaulted) `allergens` set or had been dropped below the threshold. Single mode now scopes the fetch to the named allergen, resolving it to the adapter's native key (so a canonical key like `birch` finds PollenPrognos `Björk`), and disables the threshold so a level-0 or no-data reading still surfaces; a genuinely unresolved name shows a no-data badge instead of the wrong allergen.
- **(badge, card) Distinguish "no pollen", "no data" and "no information"** (PR #252). A `worst`/`row`/`aggregate` badge with no pollen now shows the breezy `no_allergens` image instead of a blank pill, and a no-information visual (the `no_allergens` silhouette drawn with the no-data noise pattern, plus the "(No information)" label on the card) when entities exist but carry no usable forecast, distinct from a real level-0 ring. The classification honours adapters that flag no-data via a negative `display_state` (e.g. Atmo "Indisponible") and PollenPrognos no-info under `pollen_threshold: 0`, and a card whose allergens are all no-data now shows the no-information state instead of rendering blank.
- **(editor) Badge preview stays in sync with the allergen picker** (PR #252). Switching a badge to `single`, or switching integration while in `single`, now commits the allergen the picker shows (the first allergen) instead of leaving it unset; previously the preview fell back to "highest pollen level" while the picker displayed a different allergen.
- **(badge) Editor preview no longer blanks when changing the allergen** (PR #252). Changing the single allergen in the editor could leave the preview stuck on the empty pill until save: a stale, out-of-order fetch overwrote the current data, and a sensors-only change did not repaint. Fetches now apply only their latest result, and the badge re-renders after each fetch.

### Documentation
- `docs/configuration.md`: documented the five summary-block options in the options table, added a GPL summary-block paragraph and YAML examples, and noted the level-only block support in the SILAM and Atmo sections.
- `docs/integrations.md`: documented the GPL summary-block design decisions (card-language localization of the top types and config-entry-scoped resolution of the sibling in-season entity).
- Badge and icon-in-ring documentation (PR #242): a new `## Badge` section in `docs/configuration.md` (options table plus YAML examples), the four `icon_in_ring*` options added to the main options table, and badge coverage across `docs/installation.md`, `docs/quick-start.md`, `docs/troubleshooting.md`, `docs/integrations.md` and `docs/localization.md`, plus README and related-projects feature bullets.

## [3.2.0] - 2026-05-11

### Added
- **New `msw` adapter for [hass-swissweather](https://github.com/izacus/hass-swissweather) by [@izacus](https://github.com/izacus)**, contributed by [@r3turnNull](https://github.com/r3turnNull) (#212, polished in #214). Reads current pollen levels from MeteoSwiss `SwissPollenLevelSensor` entities and maps the categorical scale (`None` / `Low` / `Medium` / `Strong` / `Very Strong`) onto the integration's native 5-level scale (0--4). Supports the seven allergens that hass-swissweather exposes: birch, grass, alder, hazel, beech, ash, oak. MeteoSwiss publishes only current-day measurements, so `days_to_show` is fixed at 1 by the card regardless of config (no synthetic future days). Discovery uses the same device-registry helper as the other seven migrated adapters: multi-station setups route correctly via `config_entry_id`, the visual editor exposes a station picker, and renaming a SwissWeather device (`name_by_user`) does not break detection. Entity-ID auto-detection in the card and editor recognizes both bare and HA's auto-prefixed shapes (`sensor.<device-slug>_pollen_<allergen>_level_at_<station>`). The "MeteoSwiss at " prefix is stripped from default device labels so the location dropdown and card header surface "8000-KLO" rather than "MeteoSwiss at 8000-KLO" -- user-renamed devices (e.g. "Bern") are passed through unchanged.
- **Per-scale level-name i18n keys.** New `card.levels5.0..4` and `editor.phrases_levels5.0..4` keys in all 15 locale files cover the five-level severity scale, sourced from each language's existing `card.levels.{0,1,3,5,6}` strings (the same translations users have seen via PEU's runtime spread for years). MSW and PEU both read these via a new `buildLevelNamesForScale(scale, ...)` helper.
- **Device-based entity discovery across most adapters** (issue #202). PP, DWD, PEU, SILAM, Atmo, GPL and GP now resolve sensors via the Home Assistant device registry as the primary path, with platform scan and regex/selector fallbacks. Result: multi-instance setups (multiple cities/regions of the same integration) route correctly without manual configuration, and for these adapters entity-ID renames no longer break detection. The `location` field (and `city` for PP, `region_id` for DWD) now accepts a `config_entry_id` (ULID) in addition to the legacy slug for these seven adapters (previously only GPL/GP), and MSW joins this set as the eighth. Slug-based configs continue to work. Kleenex is not part of this migration and continues to use entity-ID slug matching.
- Stale-config recovery: if a saved `config_entry_id` no longer matches any discovered location (e.g. integration removed/reinstalled), the card auto-recovers instead of rendering empty. Explicit retry-as-autodetect path implemented for DWD, GPL, GP, SILAM, Atmo and MSW; PP and PEU recover via their pre-existing template-fallback path. (Kleenex is not in scope here because it does not accept a `config_entry_id`.)
- (kleenex) Per-allergen DetailSensor fallback and a clearer warning for US/CA zones where the upstream API only returns category totals (issue #206). The NA-zone warning is de-duplicated per session and per location.

### Changed
- Discovery helper extracted to `src/utils/adapter-helpers.js` (`discoverEntitiesByDevice`, `resolveLocationByKey`, `findLocationBySlug`). PP, DWD, PEU, SILAM, Atmo, GPL, GP and MSW now share the same three-tier discovery. Tier 1 (device-identifier match) and tier 2 (entity-registry platform match) cooperate rather than strictly cascade: tier 2 tops up tier 1 with entities from integration devices that lack `identifiers` metadata, so mixed-registry scenarios do not silently drop entities. Tier 3 (regex/selector fallback) runs when neither registry produces a location. Replaces the bespoke regex-based discovery these adapters used previously.
- (editor) PP and DWD location dropdowns now sorted consistently when populated via the secondary discovery path.
- (card) Header location label now resolved through the shared discovery helper for PP, DWD, PEU, GPL, GP, MSW. Discovery results are cached per-render to avoid redundant entity scans.
- (dwd) Region-ID prefix stripped from auto-derived region labels; ID suffix only appended when needed to disambiguate duplicate region names.
- (pp) Tier-3 fallback city labels now restore diacritics (Malmö, Visby etc.) via `PP_POSSIBLE_CITIES` instead of showing the slugified form.
- (peu) Allergen classification uses an explicit whitelist instead of a greedy regex, avoiding misclassification for entity IDs that happen to contain allergen-like substrings.
- (peu) Level-name lookup retired the legacy `[0, 1, 3, 5, 6]` runtime spread onto the seven-level palette; PEU now reads `state_text` at native indices from `card.levels5.0..4` (closes #215, PR #216). User-visible labels are unchanged for default configs (the new keys were sourced one-to-one from the same translations the spread used to surface) and for 5-length custom `phrases.levels` configs. Legacy 7-length configs are migrated by extracting entries at the `[0, 1, 3, 5, 6]` positions the spread historically populated, so user-visible labels stay identical there too. Editor's level-phrase defaults for PEU now use the scale-specific keys, so the form fields show "Moderate / High / Very high" instead of the previous "Low-moderate / Moderate / Moderate-high" defaults at indices 2-4. SILAM's analogous `indexToLevel` spread is intentionally kept (its dual role across mixed-allergen chart geometry is documented inline in `src/adapters/silam.js`).
- (editor) Integration dropdown now lists detected/installed integrations first, alphabetically, followed by the rest in alphabetical order (#213). With ten supported integrations the legacy registry-order list was hard to scan; the new order surfaces the user's actual installs at the top.
- (editor) `set hass()` snapshots the `hass.states` key list once and reuses it across the per-integration prefix/regex filters, reducing per-update allocations on large HA installs.

### Fixed
- (gpl, gp) Strip integration-appended " - <category> (<lat>,<lng>)" suffix from location labels (issue #208). Previously the editor dropdown and card title leaked text like "Hem - Pollentyper (50.45, 30.52)". Now uses a locale-agnostic util (`cleanDeviceLabel`) that handles any HA language, applied at both discovery and the card's title resolver for defense-in-depth.
- (kleenex) Manual mode `entity_prefix`/`entity_suffix` handling honored consistently across category-sensor heuristics and the DetailSensor fallback pass.
- (helpers) `isConfigEntryId` tightened to the Crockford base32 alphabet to avoid false positives on entity-id-shaped strings.
- (ci) `validate-hacs` workflow skipped on PRs from forks where the action would resolve to the fork repo and always fail; still runs on push to master/dev and the daily schedule.

### Documentation
- `docs/configuration.md`: clarified that the `location` field accepts a `config_entry_id` for PP, DWD, PEU, SILAM, Atmo, GPL, GP and MSW, not just GPL/GP. Added MSW section under "Valid allergen keys".
- `docs/troubleshooting.md`: documented that all adapters with `config_entry_id` support auto-recover from a stale `config_entry_id` after an integration reinstall -- no user action required. Added a MeteoSwiss section under "Integration-specific notes".
- `docs/integrations.md` + `docs/troubleshooting.md`: documented the Kleenex NA-zone limitation and the DetailSensor fallback for EU/UK zones; documented MSW as a supported integration with credit to @izacus and @r3turnNull.
- `docs/installation.md`: added Option J for MeteoSwiss / hass-swissweather.
- `docs/quick-start.md`: added MSW YAML examples (basic + Switzerland regional).
- `docs/localization.md`: documented the per-scale level-name keys (`card.levels5.*`, `editor.phrases_levels5.*`) for translators.
- `docs/related-projects.md` and `README.md`: integration count bumped to ten with MSW listed.

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
