# Integration Compatibility Matrix

Reference document for refactoring. Documents per-integration behavior that must be preserved.

---

## Autodetect precedence

### Card `set hass()` (pollenprognos-card.js ~933-1043)

```
1. PP        sensor.pollen_*  (excludes pollenflug_*, excludes single-underscore PLU slugs)
2. PLU       sensor.pollen_{slug}  (single underscore, slug in pluAllergenSlugs)
3. PEU       sensor.polleninformation_*
4. DWD       sensor.pollenflug_*
5. SILAM     hass.entities platform=silam_pollen || sensor.silam_pollen_*
6. Kleenex   sensor.kleenex_pollen_radar_*
7. ATMO      regex: niveau_{fr_slug}_* || pollution_slug_* || qualite_globale_*  (excludes _j_\d+$)
8. GPL       hass.entities platform=pollenlevels || attribution fallback
```

Supports `_skipIntegrations` Set (cleared on setConfig).

### Editor `setConfig()` (pollenprognos-editor.js ~485-552)

```
1. PP        sensor.pollen_*  (NO pollenflug exclusion, NO PLU exclusion)
2. PEU       sensor.polleninformation_*
3. DWD       sensor.pollenflug_*
4. SILAM     hass.entities platform check || sensor.silam_pollen_*
5. Kleenex   sensor.kleenex_pollen_radar_*
6. ATMO      regex: niveau_{fr_pollen_slug}_*  (pollen only, no pollution)
7. GPL       hass.entities pollenlevels || attribution fallback
```

**Differences from card:** PLU absent. PP check simpler. No `_skipIntegrations`.

### Editor `set hass()` (pollenprognos-editor.js ~887-896)

```
1. PP
2. PLU
3. PEU
4. DWD
5. SILAM
6. ATMO
7. GPL
```

**Differences from card:** Kleenex absent. No `_skipIntegrations`.

---

## Per-integration details

### PP (Pollenprognos, Swedish)

| Property | Value |
|---|---|
| Location field | `city` |
| Entity pattern | `sensor.pollen_{city}_{allergen}` |
| Manual mode | `city === "manual"`: `sensor.{prefix}{rawKey}{suffix}` |
| Native levels | 0-6 |
| Scaling | None (direct) |
| NaN result | `null` (unique among all integrations) |
| Max clamp | 6 |
| Special keys | None |
| Discovery | No |
| Forecast subscription | No |
| Days available | 4 default |

### DWD (Pollenflug, German)

| Property | Value |
|---|---|
| Location field | `region_id` |
| Entity pattern | `sensor.pollenflug_{allergen}_{region_id}` |
| Manual mode | `region_id === "manual"`: `sensor.{prefix}{rawKey}{suffix}` |
| Native levels | 0-3 (half-steps possible) |
| Scaling | `level * 2`, then round and clamp 0-6 |
| NaN result | `-1` |
| Max clamp | None (just NaN check) |
| Special keys | None |
| Discovery | No |
| Forecast subscription | No |
| Days available | 2 max (today + tomorrow + day_after) |
| Normalization | Uses `normalizeDWD()` (ae/oe/ue mapping) |
| Locale fallback | Falls back to `stubConfigDWD.date_locale` (not hass locale) |

### PEU (Polleninformation EU)

| Property | Value |
|---|---|
| Location field | `location` |
| Entity pattern | `sensor.polleninformation_{location}_{allergen}` |
| Manual mode | `location === "manual"`: `sensor.{prefix}{coreSlug}{suffix}` (allergy_risk uses `allergy_risk_hourly` for non-daily) |
| Native levels | 0-4 (daily), 0-4 index or text for hourly allergy_risk |
| Scaling | Daily: `level < 2 ? floor(level*6/4) : ceil(level*6/4)` maps 0,1,2,3,4 to 0,1,3,5,6. Hourly allergy_risk: `indexToLevel()` [0,1,3,5,6] |
| NaN result | `-1` |
| Max clamp | 4 (native), 6 (after scaling) |
| Special keys | `allergy_risk` (prepended to `PEU_ALLERGENS`, not in default stubConfig allergens) |
| Discovery | No |
| Forecast subscription | No |
| Modes | daily, hourly, twice_daily, hourly_second through hourly_eighth |
| User level names | Accepts 5 or 7 values (5 maps through [0,1,3,5,6]) |

### SILAM (Pollen Allergy Sensor)

| Property | Value |
|---|---|
| Location field | `location` |
| Entity pattern | Discovery: `hass.entities` platform=silam_pollen. Fallback: `sensor.silam_pollen_{location}_{ha_slug}`. Weather: `weather.silam_pollen_{location}_{suffix}` |
| Manual mode | `location === "manual"`: reverse map through `silam_allergen_map.mapping` for slug |
| Native levels | Grain counts (continuous) for allergens; 0-4 or text for index |
| Scaling | Allergens: `grainsToLevel()` (per-allergen thresholds, returns 0-6). Index: `indexToLevel()` [0,1,3,5,6] |
| NaN result | `-1` |
| Max clamp | 6 (grainsToLevel) |
| Special keys | `index` (maps to `allergy_risk` via ALLERGEN_TRANSLATION; appended to SILAM_ALLERGENS, not in default stub) |
| Discovery | Yes (primary path, via `discoverSilamSensors()`) |
| Forecast subscription | Yes (only integration using `forecastEvent` third parameter) |
| Post-fetch filtering | Daily: entity_id-based with reverse map fallback. Non-daily: no entity filtering |
| i18n | `silam_allergen_map.json` for localized allergen names (11 languages) |

### Kleenex (Pollen Radar, Dutch)

| Property | Value |
|---|---|
| Location field | `location` |
| Entity pattern | `sensor.kleenex_pollen_radar_{location}_{category}` (3 category sensors: trees/grass/weeds; individuals from `details` attribute) |
| Manual mode | `location === "manual"`: filters all kleenex sensors by prefix, localized category name matching. sensors.js strips `sensor.` and appends `_` |
| Native levels | 0-4 (PPM to level via category thresholds) |
| Scaling | Same as PEU: `level < 2 ? floor(level*6/4) : ceil(level*6/4)` |
| NaN result | `-1` |
| Max clamp | 4 |
| Special keys | `trees_cat`, `grass_cat`, `weeds_cat` (category allergens) |
| Discovery | No |
| Forecast subscription | No |
| Sorting | Two-tiered: `sort_category_allergens_first` |
| User level names | Accepts 5 or 7 values (same as PEU) |
| Localization | `KLEENEX_ALLERGEN_MAP` (Dutch/French/Italian/English to canonical) |

### PLU (Pollen.lu, Luxembourg)

| Property | Value |
|---|---|
| Location field | None (Luxembourg-only, no location config) |
| Entity pattern | `sensor.pollen_{alias}` (no location component; tries all aliases per allergen) |
| Manual mode | Not supported |
| Native levels | 0-3 (threshold-based: none/low/moderate/high) |
| Scaling | Level names indexed via [0,1,3,5] |
| NaN result | `-1` (uses `Number.isFinite()` check) |
| Max clamp | 3 (implicit from thresholds) |
| Special keys | None |
| Discovery | No |
| Forecast subscription | No |
| Days available | 1 (today only) |
| Aliases | `RAW_ALIAS_NAMES` with Latin/French/German/English per allergen |
| Extra day props | `thresholds`, `level_string`, `last_update`, `next_poll` |
| Sorting | Passes `locale` to `localeCompare()` |

### ATMO (Atmo France)

| Property | Value |
|---|---|
| Location field | `location` |
| Entity pattern | Pollen: `sensor.niveau_{fr_slug}_{location}`. Pollution: `sensor.{fr_slug}_{location}`. allergy_risk: `sensor.qualite_globale_pollen_{location}`. qualite_globale: `sensor.qualite_globale_{location}`. Forecast: `{base}_j_1` |
| Manual mode | `location === "manual"`: different stem per type (niveau_, bare slug, qualite_globale_pollen, qualite_globale) |
| Native levels | 0-7 (0=indisponible, 1-6=valid, 7=evenement) |
| Scaling | None (1-6 direct). Special: 0=empty, 7=capped at 6 display |
| NaN result | `-1` |
| Max clamp | None (raw preserved) |
| Special keys | `allergy_risk` (qualite_globale_pollen), `qualite_globale` (air quality), pollution: `pm25`, `pm10`, `ozone`, `no2`, `so2` |
| Discovery | No |
| Forecast subscription | No |
| Days available | 2 (today + j+1) |
| Sorting | Block-based: `sort_pollution_block`, `pollution_block_position`, uses `display_state` |
| Groups | `pollen` or `pollution` group property on sensor dicts |
| Pinning | Both `allergy_risk` and `qualite_globale` pinned to top of their blocks |

### GPL (Google Pollen Levels)

| Property | Value |
|---|---|
| Location field | `location` |
| Entity pattern | Discovery via `hass.entities` platform=pollenlevels, grouped by `config_entry_id`. No fixed pattern; uses `classifySensor()` on `attributes.code` (plants) or `attributes.icon` (types) |
| Manual mode | `location === "manual"`: discovery + `resolveEntityId()` with prefix/suffix filter. sensors.js strips `sensor.` |
| Native levels | 0-5 |
| Scaling | `level < 2 ? floor(level*6/5) : ceil(level*6/5)` maps 0,1,2,3,4,5 to 0,1,3,4,5,6 |
| NaN result | `-1` |
| Max clamp | 5 |
| Special keys | `grass_cat`, `trees_cat`, `weeds_cat` (type sensors) |
| Discovery | Yes (primary path, via `discoverGplSensors()`) |
| Forecast subscription | No |
| Sorting | Two-tiered: `sort_category_allergens_first` (like Kleenex) |
| Attribution | `"Data provided by Google Maps Pollen API"` (fallback detection) |

---

## allowedFields in setConfig()

`allowedFields` = all keys from integration's stubConfig PLUS 15 hardcoded extras:

```
type, card_mod, allergens, icon_size, icon_color_mode, icon_color,
city, location, region_id, tap_action, debug, show_version,
title, days_to_show, date_locale
```

Cross-integration location fields (`city`, `location`, `region_id`) are always preserved to survive integration switches.

Many extras overlap with stub keys; the hardcoded list ensures they survive even if the active stub doesn't include them.

---

## Post-fetch filtering (pollenprognos-card.js set hass())

### SILAM (special path)

- **Daily mode**: entity_id-based. If sensor has `entity_id`, checks `availableSensors.includes()`. If missing, builds reverse map from `hass.states` to match `allergenReplaced`. Config_entry_id locations without entity_id are excluded.
- **Non-daily modes**: No entity filtering (returns true unconditionally).

### All other integrations

- Name-based filtering: `allergenReplaced` (normalized) must be in configured allergens list.
- DWD uses `normalizeDWD()` for comparison; all others use `normalize()`.
- SILAM is explicitly excluded from this name-based filter.

---

## Level scaling summary

| Integration | Native | Formula | Display range |
|---|---|---|---|
| PP | 0-6 | direct | 0-6 |
| DWD | 0-3 | `*2`, round, clamp | 0-6 |
| PEU | 0-4 | floor/ceil `*6/4` | 0,1,3,5,6 |
| SILAM grains | continuous | per-allergen thresholds | 0-6 |
| SILAM index | 0-4 | `indexToLevel` | 0,1,3,5,6 |
| Kleenex | 0-4 | floor/ceil `*6/4` | 0,1,3,5,6 |
| PLU | 0-3 | index [0,1,3,5] | 0,1,3,5 |
| ATMO | 0-7 | direct (0=empty, 7=cap at 6) | 0-6 |
| GPL | 0-5 | floor/ceil `*6/5` | 0,1,3,4,5,6 |

## testVal/NaN behavior

| Integration | NaN/negative returns | Max clamp |
|---|---|---|
| PP | `null` | 6 |
| DWD | `-1` | none |
| PEU | `-1` | 4 |
| SILAM | `-1` | 6 (grains) / indexed (index) |
| Kleenex | `-1` | 4 |
| PLU | `-1` | 3 (implicit) |
| ATMO | `-1` | none |
| GPL | `-1` | 5 |
