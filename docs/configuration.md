# Configuration

This document lists all available YAML options for `pollenprognos-card` and shows a few example snippets. The card can also be configured entirely from the Home Assistant UI editor.

Additional documentation:

- [Integrations and compatibility](integrations.md)
- [Localization and custom phrases](localization.md)
- [Related projects](related-projects.md)

## Options

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `string` | **Required** | Must be `custom:pollenprognos-card`. |
| `integration` | `string` | `pp` | Adapter to use: `pp`, `dwd`, `peu` or `silam`. If omitted the card tries to detect the correct integration. |
| `city` *(PP only)* | `string` | **Required** (PP) | City name matching your Pollenprognos sensor IDs. |
| `region_id` *(DWD only)* | `string` | **Required** (DWD) | Numerical DWD region code. |
| `location` *(PEU, SILAM only)* | `string` | **Required** (PEU/SILAM) | Location slug matching your integration sensors. |
| `entity_prefix` | `string` | *(auto)* | Prefix for sensor entity IDs when sensors use custom names. Use an empty string for entities like `sensor.mugwort`. In the UI editor, enter `null` to save an empty prefix. |
| `entity_suffix` | `string` | *(auto)* | Optional suffix after the allergen slug. Reuses `region_id` for DWD when left empty. Enter `null` in the UI editor to leave it empty. |
| `mode` *(PEU, SILAM only)* | `string` | `daily` | Forecast mode. SILAM supports `daily`, `hourly` and `twice_daily`. PEU supports `daily`, `twice_daily` and hourly variants: `hourly`, `hourly_second`, `hourly_third`, `hourly_fourth`, `hourly_sixth`, `hourly_eighth`. For PEU, modes other than `daily` only work with the `allergy_risk` sensor and require `polleninformation` **v0.4.4** or later together with card **v2.4.8** or newer. |
| `levels_colors` | `array<string>` | `["#ffeb3b", "#ffc107", "#ff9800", "#ff5722", "#e64a19", "#d32f2f"]` | Colors for the segments in the level circle. |
| `levels_empty_color` | `string` | `rgba(200, 200, 200, 0.15)` | Color for empty segments. |
| `levels_gap_color` | `string` | `var(--card-background-color)` | Color for gaps in the level circle. |
| `levels_thickness` | `integer` | `60` | Thickness of the level circle (10–90). |
| `levels_gap` | `integer` | `1` | Gap width between segments. |
| `levels_text_color` | `string` | `var(--primary-text-color)` | Color for the value inside the level circle. |
| `levels_text_size` | `number` | `0.3` | Size of the numeric value inside the circle relative to icon size. |
| `levels_icon_ratio` | `number` | `1` | Multiplier applied to `icon_size` for the level circles. |
| `levels_text_weight` | `string` | `normal` | Font weight for the value inside the circle. |
| `icon_size` | `integer` | `48` | Icon size in pixels. |
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
| `sort` | `string` | `name_ascending` (PP) / `value_descending` (DWD) | Row sorting mode. |
| `allergy_risk_top` *(PEU only)* | `boolean` | `true` | Show the `allergy_risk` or `index` sensor first in the list. |
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

Only the `allergy_risk` allergen supports forecast modes other than `daily`. These modes require `polleninformation` **v0.4.4** or later and card **v2.4.8** or newer.

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

