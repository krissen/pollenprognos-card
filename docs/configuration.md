# Configuration

This document lists all available YAML options for `pollenprognos-card` and shows a few example snippets. The card can also be configured entirely from the Home Assistant UI editor.

Additional documentation:

- [Integrations and compatibility](integrations.md)
- [Localization and custom phrases](localization.md)
- [Related projects](related-projects.md)

In this file:

- [Options](#options)
- [Sorting options](#sorting-options)
- [Valid allergen keys](#valid-allergen-keys)
  - [Pollenprognos (PP)](#pollenprognos-pp)
  - [DWD Pollenflug](#dwd-pollenflug)
  - [Polleninformation EU (PEU)](#polleninformation-eu-peu)
  - [SILAM Pollen Allergy Sensor](#silam-pollen-allergy-sensor)
    - [SILAM threshold values](#silam-threshold-values)
  - [Kleenex Pollen Radar](#kleenex-pollen-radar)
    - [Category vs Individual Allergens](#category-vs-individual-allergens)
  - [Pollen.lu (PLU)](#pollenlu-plu)
  - [Atmo France](#atmo-france)
  - [Google Pollen Levels (GPL)](#google-pollen-levels-gpl)
- [Color System Overview](#color-system-overview)
  - [Allergen Icon Colors](#allergen-icon-colors)
  - [Level Circle Colors](#level-circle-colors)
  - [SVG Icon Styling](#svg-icon-styling)
  - [Color Relationships](#color-relationships)
  - [Synchronization Behavior](#synchronization-behavior)
- [Example snippets](#example-snippets)

## Options

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `string` | **Required** | Must be `custom:pollenprognos-card`. |
| `integration` | `string` | `pp` | Adapter to use: `pp`, `dwd`, `peu`, `silam`, `plu`, `kleenex`, `atmo` or `gpl`. If omitted the card tries to detect the correct integration. |
| `city` *(PP only)* | `string` | **Required** (PP) | City name matching your Pollenprognos sensor IDs, or `manual` to use custom entity prefix/suffix. |
| `region_id` *(DWD only)* | `string` | **Required** (DWD) | Numerical DWD region code, or `manual` for custom entity prefix/suffix. |
| `location` *(PEU, SILAM, Kleenex, Atmo, GPL)* | `string` | **Required** (PEU/SILAM/Kleenex/Atmo) | Location slug matching your integration sensors, or `manual` for custom entity prefix/suffix. Hidden for PLU because the integration always reports Luxembourg. For GPL, this is the `config_entry_id` of the `pollenlevels` config entry; leave empty for auto-detection when only one location is configured. |
| `entity_prefix` | `string` | *(empty)* | Prefix for sensor entity IDs in manual mode. Leave empty for sensors like `sensor.grass`. |
| `entity_suffix` | `string` | *(empty)* | Optional suffix after the allergen slug in manual mode. |
| `mode` *(PEU, SILAM only)* | `string` | `daily` | Forecast mode. SILAM supports `daily`, `hourly` and `twice_daily`. PEU supports `daily`, `twice_daily` and hourly variants: `hourly`, `hourly_second`, `hourly_third`, `hourly_fourth`, `hourly_sixth`, `hourly_eighth`. For PEU, modes other than `daily` only work with the `allergy_risk` sensor and require `polleninformation` **v0.4.4** or later together with card **v2.5.0** or newer. |
| `levels_colors` | `array<string>` | `["#FFE55A", "#FFC84E", "#FFA53F", "#FF6E33", "#FF6140", "#FF001C"]` | Colors for the segments in the level circle. |
| `levels_empty_color` | `string` | `rgba(200, 200, 200, 0.15)` | Color for empty segments. |
| `levels_gap_color` | `string` | `rgba(200, 200, 200, 1)` | Color for gaps in the level circle. When `levels_inherit_mode` is `inherit_allergen`, this is automatically set to match `allergen_outline_color`. |
| `levels_inherit_mode` | `string` | `inherit_allergen` | Control level circle colors: `inherit_allergen` uses allergen colors (including gap color from outline), `custom` uses independent level circle settings. |
| `levels_thickness` | `integer` | `60` | Thickness of the level circle (10–90). |
| `levels_gap` | `integer` | `1` | Gap width between segments (0-20). When `levels_inherit_mode` is `inherit_allergen`, this automatically syncs with `allergen_stroke_width` using the formula `levelGap = Math.round(strokeWidth / 5)`. |
| `levels_text_color` | `string` | `var(--primary-text-color)` | Color for the value inside the level circle. |
| `levels_text_size` | `number` | `0.2` | Size of the numeric value inside the circle relative to icon size. |
| `levels_icon_ratio` | `number` | `1` | Multiplier applied to `icon_size` for the level circles. |
| `levels_text_weight` | `string` | `normal` | Font weight for the value inside the circle. |
| `icon_size` | `integer` | `48` | Icon size in pixels. |
| `allergen_color_mode` | `string` | `default_colors` | Allergen icon color mode: `default_colors` uses the built-in color palette, `custom` allows setting individual colors for each level. |
| `allergen_colors` | `array<string>` | `[rgba(200,200,200,0.15), "#FFE55A", "#FFC84E", "#FFA53F", "#FF6E33", "#FF6140", "#FF001C"]` | Custom colors for allergen icons by level (0-6). Only used when `allergen_color_mode` is `custom`. Level 0 is the empty/no-pollen color, levels 1-6 are pollen intensity colors. |
| `allergen_outline_color` | `string` | `rgba(200, 200, 200, 1)` | Color for SVG icon outlines/strokes. When `levels_inherit_mode` is `inherit_allergen`, this also controls the level circle gap color. |
| `allergen_stroke_width` | `integer` | `15` | Width of SVG icon outlines (0-100, step 5). Higher values create thicker outlines around allergen icons. When `levels_inherit_mode` is `inherit_allergen` and `allergen_levels_gap_synced` is `true` (default), this also controls level circle gap width via automatic synchronization. |
| `allergen_stroke_color_synced` | `boolean` | `true` | When enabled, the stroke (outline) color of allergen icons matches the allergen level color instead of using `allergen_outline_color`. This provides better visual consistency by making both the fill and outline colors reflect the pollen severity level. |
| `allergen_levels_gap_synced` | `boolean` | `true` | When enabled and `levels_inherit_mode` is `inherit_allergen`, the level circle gap width automatically syncs with `allergen_stroke_width` using the formula `levelGap = Math.round(strokeWidth / 30)`. Set to `false` to independently control the gap width without switching all level colors to custom mode. |
| `no_allergens_color` | `string` | `#a9cfe0` | Color for the "no allergens" icon displayed when no pollen data is available. This color is independent of the allergen level color system and can be customized separately. |
| `text_size_ratio` | `number` | `1` | Global text scaling factor. |
| `allergens` | `array<string>` | *(integration default)* | List of pollen types to show. |
| `days_to_show` | `integer` | `4` (PP) / `2` (DWD) | Number of forecast columns. |
| `days_relative` | `boolean` | `true` | Use "Today", "Tomorrow" style labels for the first days. |
| `days_abbreviated` | `boolean` | `false` | Abbreviate weekday labels. |
| `days_uppercase` | `boolean` | `false` | Render weekday labels in uppercase. |
| `days_boldfaced` | `boolean` | `false` | Render weekday labels in bold. |
| `minimal` | `boolean` | `false` | Enable compact minimal layout. |
| `minimal_gap` | `integer` | `35` | Gap between icons in minimal layout. |
| `background_color` | `string` | *(empty)* | Card background color. |
| `allergens_abbreviated` | `boolean` | `false` | Use short allergen names. |
| `show_text_allergen` | `boolean` | `false` | Display allergen name below the icon. |
| `show_value_text` | `boolean` | `false` (PP) / `true` (DWD) | Show pollen intensity as text. |
| `show_value_numeric` | `boolean` | `false` | Show numeric pollen value. |
| `show_value_numeric_in_circle` | `boolean` | `false` | Place numeric value inside the circle. |
| `link_to_sensors` | `boolean` | `true` | Link allergen icons and circles to their sensor entities. |
| `numeric_state_raw_risk` | `boolean` | `false` | Show the raw allergy risk value in numeric displays (PEU only). |
| `show_empty_days` | `boolean` | `true` | Always render `days_to_show` columns even when there is no data. |
| `pollen_threshold` | `integer` | `1` | Minimum value required to show an allergen. Use `0` to always show all. |
| `sort` | `string` | `name_ascending` (PP) / `value_descending` (DWD) | Row sorting mode. Available options: `value_ascending`, `value_descending`, `name_ascending`, `name_descending`, `none`. |
| `sort_category_allergens_first` *(Kleenex, GPL)* | `boolean` | `true` | Display category allergens (trees, grass, weeds) above individual allergens in the editor. |
| `allergy_risk_top` *(PEU, Atmo)* | `boolean` | `true` | Show the `allergy_risk` and `qualite_globale` summary sensors first in the list. |
| `sort_pollution_block` *(Atmo only)* | `boolean` | `true` | Group pollution sensors (PM2.5, PM10, O₃, NO₂, SO₂) separately from pollen allergens. Only applies when `sort` is not `none`. |
| `pollution_block_position` *(Atmo only)* | `string` | `bottom` | Where to place the pollution group relative to pollen: `top` or `bottom`. Requires `sort_pollution_block: true`. |
| `show_block_separator` *(Atmo only)* | `boolean` | `false` | Show a visual separator line between pollen and pollution groups. Requires `sort_pollution_block: true`. |
| `index_top` *(SILAM only)* | `boolean` | `true` | Show the `index` sensor first in the list. |
| `title` | `string/boolean` | *(auto)* | Card title. `true` for default, `false` to hide, or provide a custom string. |
| `date_locale` | `string` | `sv-SE` (PP) / `de-DE` (DWD) | Locale used for weekday formatting. |
| `tap_action` | `object` | *(empty)* | Lovelace tap action configuration. |
| `debug` | `boolean` | `false` | Enable verbose console logging. |
| `show_version` | `boolean` | `true` | Log card version in the browser console. |
| `phrases.full` | `object` | `{}` | Map allergen keys to full length names. |
| `phrases.short` | `object` | `{}` | Map allergen keys to short names. |
| `phrases.levels` | `array<string>` | *(integration default)* | Custom names for pollen levels 0–6. |
| `phrases.days` | `object` | `{}` | Custom labels for day offsets. |
| `phrases.no_information` | `string` | `(Ingen information)` | Text shown when no data is available. |

## Sorting options

The `sort` option controls how allergens are ordered in the card display:

| Option | Description |
|--------|-------------|
| `value_ascending` | Sort by pollen level, lowest values first |
| `value_descending` | Sort by pollen level, highest values first |
| `name_ascending` | Sort alphabetically by allergen name, A-Z |
| `name_descending` | Sort alphabetically by allergen name, Z-A |
| `none` | Keep allergens in the order specified in the `allergens` configuration |

When using `sort: none`, allergens will appear in exactly the same order as listed in your `allergens` array, allowing for custom ordering based on your preferences.

## Valid allergen keys

The following keys are recognised for each adapter. Values must match your integration sensors exactly.

### Pollenprognos (PP)

```
Al
Alm
Bok
Björk
Ek
Gråbo
Gräs
Hassel
Malörtsambrosia
Sälg och viden
```

### DWD Pollenflug

```
ambrosia
beifuss
erle
esche
birke
hasel
gräser
roggen
```

### Polleninformation EU (PEU)

```
allergy_risk
alder
ash
beech
birch
cypress_family
elm
fungal_spores
grasses
hazel
lime
mugwort
nettle_family
oak
olive
plane_tree
ragweed
rye
willow
```

Only the `allergy_risk` allergen supports forecast modes other than `daily`. These modes require `polleninformation` **v0.4.4** or later and card **v2.5.0** or newer.

### SILAM Pollen Allergy Sensor

```
alder
birch
grass
hazel
mugwort
olive
ragweed
index
```

#### Sensor detection

The card tries to discover SILAM entities via the Home Assistant entity registry when available. If registry data is unavailable, it falls back to entity-id pattern matching; in that case renamed entities may not be detected. If the card does not find your sensors, set `location` explicitly in your config or use `location: manual` with `entity_prefix`/`entity_suffix`.

#### SILAM threshold values

For the SILAM integration, each allergen uses the following threshold values to determine pollen levels:

- **birch, grass, hazel:** 1, 25, 50, 100, 500, 1000, 5000
- **alder, ragweed, mugwort, olive:** 1, 10, 25, 50, 100, 500, 1000

> **Note on SILAM thresholds:**  
> For the SILAM integration, each threshold value marks the start of a new pollen level. A level applies as soon as the pollen value is greater than or equal to its threshold (≥). For example, a value of 25 will be assigned to the level that starts at 25. This ensures that all threshold values are inclusive and consistently interpreted across all levels.

### Kleenex Pollen Radar

```
# categories (for which the integration provides sensors)
trees_cat
grass_cat
weeds_cat
# individual allergens (found in the sensor's attributes)
alder
birch
chenopod
cypress
elm
hazel
mugwort
nettle
oak
pine
plane
poaceae
poplar
ragweed
```

The Kleenex Pollen Radar integration provides pollen forecasts for the Netherlands, United Kingdom, France, Italy and United States of America. The integration creates sensors with 5-day forecasts for three main allergen categories.

#### Category vs Individual Allergens

The Kleenex integration supports two types of allergens:

1. **Category allergens** (`trees`, `grass`, `weeds`) - broad sensors covering entire plant families
2. **Individual allergens** (e.g., `birch`, `oak`, `ragweed`) - specific detailed sensors for particular species

In the card editor, you can control whether category allergens (`*_cat`) are sorted at the top of the list using the "Sort category allergens first" checkbox (enabled by default). When enabled, category allergens appear at the top of the allergen list, with individual allergens listed below in alphabetical order. When disabled, category allergens are sorted like any other.

**Note:** You can create separate cards if you want to display category and individual allergens separately - one card showing only categories and another showing only specific allergens.

### Pollen.lu (PLU)

The Pollen.lu integration exposes current pollen levels for Luxembourg. The card automatically hides the location selector, limits the forecast to a single day, and labels the header as Luxembourg when this adapter is in use.

Sensors follow the pattern `sensor.pollen_<slug>` where `<slug>` matches one of the canonical allergen keys below. Thresholds are taken directly from the sensor attributes when present; the fallback values in the table are used if the integration omits them.

| Key | Description | Moderate threshold | High threshold |
|-----|-------------|--------------------|----------------|
| `alder` | Alder (*Alnus*) | 11 | 51 |
| `ash` | Ash (*Fraxinus*) | 11 | 51 |
| `beech` | Beech (*Fagus*) | 11 | 51 |
| `birch` | Birch (*Betula*) | 11 | 51 |
| `goosefoot` | Goosefoot (*Chenopodium*) | 4 | 16 |
| `hazel` | Hazel (*Corylus*) | 11 | 51 |
| `mugwort` | Mugwort (*Artemisia*) | 3 | 7 |
| `oak` | Oak (*Quercus*) | 11 | 51 |
| `plantain` | Plantain (*Plantago*) | 4 | 16 |
| `poaceae` | Grasses (*Poaceae*) | 6 | 31 |
| `sorrel` | Sorrel (*Rumex*) | 4 | 16 |

Use the localized allergen names in the editor; the card stores the canonical keys listed above in the configuration.

### Atmo France

The Atmo France integration provides pollen levels for French cities. Levels range from 0 to 6 and map directly to the card's scale without any conversion. The integration also provides optional J+1 (next-day) forecasts.

```
allergy_risk
ragweed
mugwort
alder
birch
grass
olive
```

Entity naming follows the pattern `sensor.niveau_{allergen_fr}_{city_slug}` for individual allergens and `sensor.qualite_globale_pollen_{city_slug}` for the global allergy risk. The `allergy_risk` allergen shows the overall pollen quality index and can be pinned to the top of the list with `allergy_risk_top: true`.

### Google Pollen Levels (GPL)

The Google Pollen Levels integration provides global pollen data via the Google Maps Pollen API. The card detects sensors by their platform or attribution attributes — entity IDs can be freely renamed or localized without affecting detection. See [integrations.md](integrations.md#google-pollen-levels--design-decisions) for details.

```
# Category sensors (type sensors)
grass_cat
trees_cat
weeds_cat
# Individual plant sensors (availability varies by region)
alder
ash
birch
cottonwood
cypress_pine
elm
graminales
hazel
juniper
maple
mugwort
oak
olive
pine
ragweed
```

Levels range from 0 to 5 and are displayed with 5 doughnut segments. Level names are mapped to the card's standard terms (see [integrations.md](integrations.md#level-scale)). Forecast data is read from the sensor's `attributes.forecast[]` array.

Like Kleenex, GPL distinguishes between category sensors and individual plant sensors. Category allergens can be sorted to the top of the list with `sort_category_allergens_first: true` (enabled by default).

## Color System Overview

The card provides advanced color management with two interconnected systems:

### Allergen Icon Colors

- **Default Colors Mode** (`allergen_color_mode: default_colors`): Uses the built-in color palette that matches the level circle colors
- **Custom Colors Mode** (`allergen_color_mode: custom`): Allows setting individual colors for each pollen level (0-6)
- **Level 0**: Always represents "no pollen" and uses a light gray color
- **Levels 1-6**: Represent increasing pollen intensity with progressively more intense colors

### Level Circle Colors

The level circles can either inherit colors from the allergen system or use independent settings:

- **Inherit from Allergen** (`levels_inherit_mode: inherit_allergen`, default):
  - Circle segments use the same colors as allergen icons for each level
  - Gap color automatically matches `allergen_outline_color` for visual consistency
  - Circle segment colors sync perfectly with allergen icon colors
- **Custom Level Colors** (`levels_inherit_mode: custom`):
  - Uses independent `levels_colors`, `levels_empty_color`, and `levels_gap_color` settings
  - Operates completely separately from allergen color settings

### SVG Icon Styling

- **Outline Color** (`allergen_outline_color`): Controls the stroke color around SVG icons
- **Stroke Width** (`allergen_stroke_width`): Controls outline thickness (0-100, step 5, where 0 = no outline)
- **No Allergens Color** (`no_allergens_color`): Independent color for the "no allergens" icon, separate from level-based colors
- SVG icons scale smoothly and support dynamic coloring via CSS

### Color Relationships

When using the default inheritance mode:

- Allergen level 1 → Circle segment 1 → Same color
- Allergen outline color → Circle gap color → Same color  
- Allergen stroke width → Circle gap width → Synchronized (gap = strokeWidth/5, rounded)
- Single source of truth prevents color mismatches

### Synchronization Behavior

**Inherit Mode** (`levels_inherit_mode: inherit_allergen`):

- Level circle colors automatically match allergen icon colors
- Circle gap color automatically matches allergen outline color
- Circle gap width automatically syncs with allergen stroke width
- Changes to allergen settings immediately update level circles

**Custom Mode** (`levels_inherit_mode: custom`):

- Level circles use independent color and gap settings
- No synchronization with allergen settings
- Full control over each property individually

**Special Cases**:

- **No Allergens Icon**: Always uses `no_allergens_color`, independent of level-based color systems
- **Mode Switching**: When switching from custom to default, colors automatically reset to defaults

## Example snippets

Below are a few short configuration examples. Only the relevant lines are shown.

**Pollenprognos (PP)**

```yaml
type: custom:pollenprognos-card
city: Stockholm
show_text_allergen: true
```

**DWD Pollenflug**

```yaml
type: custom:pollenprognos-card
integration: dwd
region_id: "91"
```

**Kleenex Pollen Radar**

```yaml
type: custom:pollenprognos-card
integration: kleenex
location: amsterdam  # Location will be auto-detected if omitted
days_to_show: 5
```

**Atmo France**

```yaml
type: custom:pollenprognos-card
integration: atmo
location: lyon  # Location will be auto-detected if omitted
days_to_show: 2
```

Atmo France supports both pollen allergens and air quality (pollution) sensors. By default, pollution sensors are grouped below pollen. The `allergy_risk_top` option keeps the pollen index and air quality index at the top of the list.

```yaml
type: custom:pollenprognos-card
integration: atmo
allergy_risk_top: true            # Summary indices at the top
sort_pollution_block: true        # Group pollution separately (default)
pollution_block_position: bottom  # Pollution below pollen (default)
show_block_separator: false      # Show line between blocks (default: off)
allergens:
  - allergy_risk
  - qualite_globale
  - birch
  - grass
  - olive
  - pm25
  - pm10
  - ozone
  - no2
  - so2
```

**Google Pollen Levels**

```yaml
type: custom:pollenprognos-card
integration: gpl
# location auto-detected; set config_entry_id for multi-location setups
days_to_show: 5
allergens:
  - grass_cat
  - trees_cat
  - weeds_cat
  - birch
  - oak
```

**Minimal layout**

```yaml
type: custom:pollenprognos-card
minimal: true
show_value_numeric: true
```

**Custom phrases**

```yaml
phrases:
  short:
    Malörtsambrosia: Ambrs
    Sälg och viden: Sälg
```

**Custom allergen order**

```yaml
type: custom:pollenprognos-card
allergens:
  - Birch      # Will appear first
  - Grass      # Will appear second
  - Hazel      # Will appear third
  - Oak        # Will appear fourth
sort: none     # Preserves the exact order above
```
