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
- [Google Pollen](https://github.com/svenove/home-assistant-google-pollen)

The card tries to auto-detect which adapter to use based on your sensors. The table below lists version requirements and other notes for each integration.

| Integration | Notes |
|-------------|------|
| **Pollenprognos** | For `homeassistant-pollenprognos` **v1.1.0** and higher you need **v1.0.6** or newer of this card. For older integration versions use **v1.0.5** or earlier. |
| **Polleninformation EU** | For `polleninformation` **v0.4.0** or later you need **v2.4.2** or newer of this card. Versions **v0.3.1** and earlier require card version **v2.2.0–v2.4.1**. Forecast modes were added in card **v2.5.0** and require `polleninformation` **v0.4.4** or later. Only the `allergy_risk` sensor supports modes other than `daily`. |
| **SILAM Pollen Allergy Sensor** | The card tries to discover SILAM entities via the entity registry when available. If registry data is unavailable, it falls back to entity-id pattern matching; in that case renamed entities may not be detected. For `silam_pollen` **v0.2.7** and newer you need **v2.4.1** or newer of this card. Older integration versions require **v2.3.0–v2.4.0**. When no individual allergen sensors are enabled for a location, the card automatically shows the overall pollen index from the weather entity. **Note:** The integration may report different index values in the entity state vs. the forecast subscription (e.g. `very_low` as the current state but `low` in forecast entries). The card displays whatever each source reports, so `daily` mode and `twice_daily`/`hourly` modes may show slightly different levels for the same location. |
| **DWD Pollenflug** | Keep the default sensor names. You need card version **v2.0.0** or newer. |
| **Kleenex Pollen Radar** | Keep the default sensor names. Supports forecasts for Netherlands, UK, France, Italy and USA. Added in card **v2.6.0**. **Note**: The integration reports level as "low" even when ppm values are 0, while the card interprets 0 ppm as "none" level. This different interpretation may affect which allergens appear in the card, and the level of the allergen, as compared to the integration. To confirm what the card shows, open up the relevant sensor in the integration (`trees`, `weeds`, or `grass`). Look at the attributes. Even though the ppm **value** is `0` (no particles in the air) the **level** is shown as `low`. The card would instead show a ppm level of `0` as `none`. **US zones**: the upstream API does not return per-allergen breakdowns for North America. Only category totals are available. Use `allergens: [trees_cat, grass_cat, weeds_cat]` in your card config; individual allergens such as `birch` or `oak` will never appear for US zones. **EU/UK zones**: per-allergen data comes through the category sensors automatically. If individual allergens are missing, try enabling the per-allergen DetailSensor entities in HA (disabled by default in the entity registry under Settings → Devices & Services → Kleenex Pollen Radar). The card will detect and use them as a fallback when category-sensor details are empty. |
| **Pollen.lu** | Keep the default sensor names. The integration exposes current-day pollen levels for Luxembourg with one sensor per allergen. Added in card **v2.8.0**. |
| **Atmo France** | Keep the default sensor names. The integration provides pollen levels (0–6) for French cities with optional J+1 forecasts. Added in card **v2.9.0**. |
| **Google Pollen Levels** | Entity names can be freely renamed or localized — the card detects sensors by their `platform` attribute or `attribution` string, not by entity ID patterns. Works with any Home Assistant language. Supports multi-location setups via separate config entries. Added in card **v2.9.0**. |
| **Google Pollen** | For `home-assistant-google-pollen` by svenove. Uses the same Google Pollen API but a different HA integration. Sensors are detected by the `google_pollen` platform or entity prefix `sensor.google_pollen_*`. Allergens are classified primarily via `unique_id` (language-independent) with `display_name` lookup as fallback, covering all 35 languages the API supports via pre-generated name maps. The API returns up to 4 days of forecast. Supports multi-location setups via separate config entries. Added in card **v3.1.0**. |

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

## Google Pollen (svenove) — design decisions

The Google Pollen (GP) adapter supports the [home-assistant-google-pollen](https://github.com/svenove/home-assistant-google-pollen) integration by svenove. Both GP and GPL use the same underlying Google Pollen API, but the two HA integrations expose data in different formats.

### Differences from GPL

| Aspect | GPL (`pollenlevels`) | GP (`google_pollen`) |
|--------|---------------------|---------------------|
| Allergen identification | `code` attribute + icon mapping | `display_name` attribute |
| Forecast format | `attributes.forecast[]` array | Flat attributes: `tomorrow`, `day 3`, `day 4` |
| Today's level | `sensor.state` (numeric) | `attributes.index_value` (numeric); state is text category |
| Max forecast days | 5 | 4 |
| Attribution string | `"Data provided by Google Maps Pollen API"` | None |

### Sensor discovery

1. **Primary**: `hass.entities` filtered by `platform === "google_pollen"`, excluding diagnostic sensors.
2. **Fallback**: Entity IDs starting with `sensor.google_pollen_`.

### Sensor classification

Each sensor is classified as either a **category sensor** or an **individual plant sensor**. The adapter tries two strategies in order:

| Strategy | When used | How it works | Example |
|----------|-----------|-------------|---------|
| `unique_id` extraction | `hass.entities` available | Extract code from `google_pollen_{code}_{lat}_{lon}` | `google_pollen_birch_59.33_18.07` -> `birch` |
| `display_name` lookup | Fallback when `unique_id` unavailable | Trim + lowercase, then look up in `GP_DISPLAY_NAME_MAP` | `"Björk"` -> `birch` |

Category codes from `unique_id` are mapped to canonical keys:

| `unique_id` code | Allergen key |
|-----------------|-------------|
| `grass` | `grass_cat` |
| `tree` | `trees_cat` |
| `weed` | `weeds_cat` |

Plant codes (e.g. `birch`, `oak`, `ragweed`) are kept as-is.

**Collision handling**: In some languages, a category sensor and a plant sensor share the same `display_name` (e.g. Swedish "Gräs" for both the GRASS category and the GRAMINALES plant). When this happens, the first sensor gets the category key and the second is reclassified as a plant via `GP_COLLISION_PLANTS`.

### Multi-location support

Like GPL, the adapter groups sensors by `config_entry_id` (resolved via the device registry). Each `google_pollen` config entry represents one location. The card stores the `config_entry_id` in the `location` field and shows human-readable labels derived from device names (preferring `name_by_user` if the user has renamed the device) in the editor dropdown.

If only the fallback detection path is available (no `hass.entities`), all sensors are grouped into a single default location.

### Level scale

Same as GPL: 0-5 UPI scale, mapped to the card's 6-level display system.
