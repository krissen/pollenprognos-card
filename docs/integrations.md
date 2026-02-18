# Supported integrations and compatibility

`pollenprognos-card` can display data from the following Home Assistant integrations:

- [Pollenprognos](https://github.com/JohNan/homeassistant-pollenprognos)
- [DWD Pollenflug](https://github.com/mampfes/hacs_dwd_pollenflug)
- [Polleninformation EU](https://github.com/krissen/polleninformation)
- [SILAM Pollen Allergy Sensor](https://github.com/danishru/silam_pollen)
- [Kleenex Pollen Radar](https://github.com/MarcoGos/kleenex_pollenradar)
- [Pollen.lu](https://github.com/Foxi352/pollen_lu)
- [Atmo France](https://github.com/sebcaps/atmofrance)
- [Google Pollen Levels](https://github.com/eXPerience83/pollenlevels)

The card tries to auto-detect which adapter to use based on your sensors. The table below lists version requirements and other notes for each integration.

| Integration | Notes |
|-------------|------|
| **Pollenprognos** | For `homeassistant-pollenprognos` **v1.1.0** and higher you need **v1.0.6** or newer of this card. For older integration versions use **v1.0.5** or earlier. |
| **Polleninformation EU** | For `polleninformation` **v0.4.0** or later you need **v2.4.2** or newer of this card. Versions **v0.3.1** and earlier require card version **v2.2.0–v2.4.1**. Forecast modes were added in card **v2.5.0** and require `polleninformation` **v0.4.4** or later. Only the `allergy_risk` sensor supports modes other than `daily`. |
| **SILAM Pollen Allergy Sensor** | Do not rename the sensors created by the integration. For `silam_pollen` **v0.2.7** and newer you need **v2.4.1** or newer of this card. Older integration versions require **v2.3.0–v2.4.0**. |
| **DWD Pollenflug** | Keep the default sensor names. You need card version **v2.0.0** or newer. |
| **Kleenex Pollen Radar** | Keep the default sensor names. Supports forecasts for Netherlands, UK, France, Italy and USA. Added in card **v2.6.0**. **Note**: The integration reports level as "low" even when ppm values are 0, while the card interprets 0 ppm as "none" level. This different interpretation may affect which allergens appear in the card, and the level of the allergen, as compared to the integration. To confirm what the card shows, open up the relevant sensor in the integration (`trees`, `weeds`, or `grass`). Look at the attributes. Even though the ppm **value** is `0` (no particles in the air) the **level** is shown as `low`. The card would instead show a ppm level of `0` as `none`. |
| **Pollen.lu** | Keep the default sensor names. The integration exposes current-day pollen levels for Luxembourg with one sensor per allergen. Added in card **v2.8.0**. |
| **Atmo France** | Keep the default sensor names. The integration provides pollen levels (0–6) for French cities with optional J+1 forecasts. Added in card **v2.9.0**. |
| **Google Pollen Levels** | Entity names can be freely renamed or localized — the card detects sensors by their `platform` attribute or `attribution` string, not by entity ID patterns. Works with any Home Assistant language. Supports multi-location setups via separate config entries. Added in card **v2.9.0**. |

## Google Pollen Levels — design decisions

The Google Pollen Levels (GPL) adapter uses a different detection strategy than the other adapters. This section explains the design choices and how sensor discovery works.

### Why attribute-based detection

Most adapters in this card detect sensors by matching entity ID patterns with regular expressions. For example, the DWD adapter looks for `sensor.dwd_pollenflug_*` and the Pollenprognos adapter matches `sensor.*_stockholm`.

This approach does not work for the `pollenlevels` integration because Home Assistant translates entity IDs into the user's language. A Swedish setup creates `sensor.stockholm_typer_pollen_gras`, but a Russian setup creates `sensor.hem_tipy_pyltsy_trava`. No single regex can match all languages.

The GPL adapter instead uses **attribute-based detection**: it examines sensor metadata (platform, attribution, icon, code) rather than the entity ID string. This makes it work regardless of the Home Assistant language or any entity renaming the user may have done.

### Sensor discovery

The adapter tries two detection paths in order:

1. **Primary — `hass.entities`**: Filters by `platform === "pollenlevels"` and excludes diagnostic sensors (`entity_category` is set on meta sensors like region, date, last_updated). This path also provides `device_id` for grouping sensors into locations.

2. **Fallback — `hass.states`**: Scans all sensors for `attributes.attribution === "Data provided by Google Maps Pollen API"` and excludes `device_class: "date"` / `"timestamp"`. Used when `hass.entities` is not available or returns no results.

### Sensor classification

Each sensor is classified as either a **type sensor** (category) or a **plant sensor** (individual allergen):

| Check | Classification | Key |
|-------|---------------|-----|
| Has `attributes.code` | Plant sensor | `code` value, e.g. `"birch"`, `"oak"` |
| No `code`, `icon` = `mdi:grass` | Type sensor | `grass_cat` |
| No `code`, `icon` = `mdi:tree` | Type sensor | `trees_cat` |
| No `code`, `icon` = `mdi:flower-tulip` | Type sensor | `weeds_cat` |

The `code` attribute is always in English regardless of the Home Assistant language. The icon values come from the integration's `TYPE_ICONS` dictionary and are stable across versions.

### Multi-location support

When the primary detection path is available, the adapter groups sensors by `config_entry_id` (resolved via the device registry). Each `pollenlevels` config entry represents one location. The card stores the `config_entry_id` in the `location` field and shows human-readable labels derived from device names in the editor dropdown.

If only the fallback path is available, all sensors are grouped into a single default location.

### Level scale

Google Pollen API uses a 0–5 scale. The card keeps this scale as-is and displays 5 segments in the doughnut chart (one per active level, excluding level 0 "None"). Level names are mapped to the card's standard terminology the same way as for Kleenex and PEU — the raw level is preserved for sorting and thresholds while the display text is looked up from the card's localized level name table.
