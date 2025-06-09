# pollenprognos-card

A Lovelace card to display the sensor data from the integration [Home Assistant Pollenprognos integration](https://github.com/JohNan/homeassistant-pollenprognos), [Polleninformation EU](https://github.com/krissen/polleninformation) or (v2.0 and above) [DWD Pollenflug](https://github.com/mampfes/hacs_dwd_pollenflug/tree/master).

![Screenshot 2022-08-05 at 22 37 45](https://user-images.githubusercontent.com/2181965/183159066-2cef1a6e-e59b-4bb3-832b-7bff781b471c.png)

<img width="527" alt="Skärmavbild 2025-05-30 kl  12 38 11" src="https://github.com/user-attachments/assets/39ae37a5-6eb5-49b7-b323-80d96923d72e" />

## Requirement

Pollenprognos-card needs one of the two supported sensor integrations; Pollenprognos, Polleninformation EU or DWD Pollenflug.

- [Home Assistant Pollenprognos integration](https://github.com/JohNan/homeassistant-pollenprognos)  
  **Note,** for `homeassistant-pollenprognos` v1.1.0 and higher, you need v1.0.6 or above of this card.  
For `homeassistant-pollenprognos` <1.1.0, use <=v1.0.5 of `pollenprognos-card`.

- [Polleninformation EU](https://github.com/krissen/polleninformation)  
  **Note,** for polleninformation, you need v2.2.0 or higher of this card.

- [DWD Pollenflug](https://github.com/mampfes/hacs_dwd_pollenflug)  
  **Note,** do not change sensor names from the integration's defaults. The card excpects sensors like `sensor.pollenflug_erle_43` and the like (ie., the defaults).

### Install with HACS

Add <https://github.com/krissen/pollenprognos-card> as a custom integration.
See more info: <https://hacs.xyz/docs/faq/custom_repositories>

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)  
[![HACS Action](https://github.com/krissen/pollenprognos-card/actions/workflows/ci.yml/badge.svg)](https://github.com/krissen/pollenprognos-card/actions/workflows/ci.yml)

## Related / Similar Projects

Below are some other Lovelace cards and integrations for pollen forecasts. Each has its own scope, strengths and limitations.

---

### lovelace-pollen-card  

<https://github.com/nidayand/lovelace-pollen-card>  
**Description:** A Lovelace card that displays pollen sensor data (forked from `isabellaalstrom/lovelace-pollenprognos-card`).  
**Pros:**  

- Makes `lovelace-pollenprognos-card` (below) usable, after changes made to the integration.
- More features than the original: minimal view, configurable number of days, custom sorting.  
- Still relatively simple to set up.  
**Cons:**  
- I believe it does not work with the latest changes to the integration (v1.1.0 and higher of `homeassistant-pollenprognos`).
- Only supports PP/Pollenprognos integration—no DWD fallback.  
- No built-in support for translating or customizing all text strings.  
- Configuration via YAML only; no visual editor.  

---

### lovelace-pollenprognos-card  

<https://github.com/isabellaalstrom/lovelace-pollenprognos-card>  
**Description:** The original card for the [Pollenprognos](https://github.com/custom-components/pollenprognos) integration in Home Assistant.  
**Pros:**  

- Straightforward display of Pollenprognos sensor data.  
**Cons:**  
- Now defunct—no longer maintained.  
- No HACS support or UI editor.  
- Requires manual copying of `pollen_img` to `www/` or configuring `img_path`.  

---

### dwd-pollenprognos-card  

<https://github.com/bhuebschen/dwd-pollenprognos-card>  
**Description:** A custom Lovelace card for the [DWD Pollenflug](https://www.dwd.de/EN/ourservices/pollen/pollen.html) sensor integration in Home Assistant, originally forked from `isabellaalstrom/lovelace-pollenprognos-card`.  
**Pros:**  

- Focused solely on DWD data (no PP adapter).  
- Implements the same basic styling and icons as the upstream card.  
**Cons:**  
- No visual editor support—configuration must be written in YAML.  
- You must manually copy the `pollen_img` folder into your `www/` directory or set a custom `img_path`.  
- Only supports DWD; cannot display PP (Pollenprognos) sensors.  

---

None of these cards support fully dynamic string localization or two-adapter fallback (PP + DWD) with a built-in UI editor. The **pollenprognos-card** you are using combines both data sources, supports HACS & the Lovelace editor, and is fully localizable via simple JSON files.

## Localization

Since v2.0.0, the card is fully localizable. Out of the box it will automatically detect your Home Assistant UI locale (e.g. `sv-SE`, `en-GB`, `de-DE`) and then:

1. **Exact match**: if you have a file named `src/locales/en-GB.json`, it will use that.  
2. **Language fallback**: otherwise it will strip the region and look for `src/locales/en.json`.  
3. **Default fallback**: if that’s missing too, it will fall back to `en.json`.  

### Supported locales

By default this repository provides:

- `src/locales/sv.json`  
- `src/locales/en.json`  
- `src/locales/de.json`  

### Adding a new language

1. Copy `src/locales/en.json` → `src/locales/xx.json` (or `xx-YY.json` for region-specific variants).  
2. Translate every value in the JSON.  
3. Commit & open a PR, or file an issue to let us know!  

Because the card uses dynamic imports (`import.meta.globEager()`), it will pick up your new file automatically—no code changes required.  

## Configuring

`pollenprognos-card` supports Home Assistant's visual UI editor since v1.2.0! For the yaml-inclined, keep reading!

## Note

In minimal mode, you might notice some odd spelling. For instance, "Hassel" is shortened to "Hssel". This is to avoid line breaks which would break symmetry. *If you don't like the current abbreviations, from v1.1.0 you can create your own custom phrases!* You'd add something like the following to the config, needing only to include lines for allergens you want to customise:

```yaml
- type: 'custom:pollenprognos-card'
  # your current config
  # then add:
  phrases:
    short:
      Malörtsambrosia: Ambrs
      Sälg och viden: Sälg
```

See example under "Custom text for allergens, values etc", below.

## Options

| Name                          | Type                      | Default (PP)                                                                                                                        | DWD Default                                                               | Description                                                                                                                                                               |                                                                                                                              |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `type`                        | `string`                  | **Required**                                                                                                                        |                                                                           | Must be `custom:pollen-card`.                                                                                                                                             |                                                                                                                              |
| `integration`                 | `string`                  | `pp`                                                                                                                                | `dwd`                                                                     | Which adapter to use. If omitted, auto-detects based on your sensors.                                                                                                     |                                                                                                                              |
| `city`    **(PP only)**       | `string`                  | **Required** (when using `pp`)                                                                                                      |                                                                           | City name matching your PP-sensor IDs (e.g. `Stockholm`, `Malmö`). Must appear in the [supported list](#supported-cities).                                                |                                                                                                                              |
| `region_id`    **(DWD only)** | `string`                  |                                                                                                                                     | **Required** (when using `dwd`)                                           | Numerical DWD region code (e.g. `31`, `91`, etc). See [DWD\_REGIONS](#dwd-region-codes) for available codes & names.                                                      |                                                                                                                              |
| `allergens`                   | `array<string>`           | `["Al","Alm","Björk","Ek","Malörtsambrosia","Gråbo","Gräs","Hassel","Sälg och viden"]`                                              | `["erle","ambrosia","esche","birke","hasel","gräser","beifuss","roggen"]` | Which pollen types to include. Keys must match your sensor IDs. Defaults differ by integration.                                                                           |                                                                                                                              |
| `days_to_show`                | `integer`                 | `4`                                                                                                                                 | `2`                                                                       | How many days to show (including today), `0–6`.                                                                                                                           |                                                                                                                              |
| `days_relative`               | `boolean`                 | `true`                                                                                                                              | `true`                                                                    | Use relative labels (“Today”, “Tomorrow”) for the first three days; beyond that falls back to locale weekdays. Set to `false` for always‐absolute (locale weekday names). |                                                                                                                              |
| `days_abbreviated`            | `boolean`                 | `false`                                                                                                                             | `false`                                                                   | Abbreviate weekday names (e.g. “Mon” instead of “Monday”), when using absolute labels.                                                                                    |                                                                                                                              |
| `days_uppercase`              | `boolean`                 | `false`                                                                                                                             | `false`                                                                   | Render weekday labels in **uppercase**.                                                                                                                                   |                                                                                                                              |
| `days_boldfaced`              | `boolean`                 | `false`                                                                                                                             | `false`                                                                   | Render weekday labels in **bold**.                                                                                                                                        |                                                                                                                              |
| `minimal`                     | `boolean`                 | `false`                                                                                                                             | `false`                                                                   | Use the compact “minimal” flex‐box layout instead of the full table.                                                                                                      |                                                                                                                              |
| `allergens_abbreviated` | `boolean` | `false` | `false` | If true, shows short names of alleergens (`phrases.allergen_short.*`) instead of full allergen names (`phrases.allergen_full.*`).|
| `show_text_allergen`          | `boolean`                 | `false`                                                                                                                             | `false`                                                                   | Show allergen name in text.                                                                                                                                              |
| `show_value_text`             | `boolean`                 | `false`                                                                                                                             | `true`                                                                    | Show pollen intensity as text below icons/cells.                                                                                                                         |
| `show_value_numeric`          | `boolean`                 | `false`                                                                                                                             | `false`                                                                   | Show numeric pollen intensity value below icons/cells.                                                                                                                   |
| `show_value_numeric_in_circle` | `boolean`                 | `false`                                                                                                                             | `false`                                                                   | Show numeric pollen intensity value inside each circle icon.                                                                                                         |                                                                                                                              |
| `show_empty_days`             | `boolean`                 | `true`                                                                                                                              | `true`                                                                    | If `true`, always render `days_to_show` columns even if sensor has no data for some days (empty placeholders).                                                            |                                                                                                                              |
| `pollen_threshold`            | `integer`                 | `1`                                                                                                                                 | `1`                                                                       | Minimum pollen value (0–6) on any of the shown days to include that allergen in the list. Set to `0` to always show all.                                                  |                                                                                                                              |
| `sort`                        | `string`                  | `name_ascending`                                                                                                                    | `value_descending`                                                        | How to sort the allergen rows. Options: `value_ascending`, `value_descending`, `name_ascending`, `name_descending`.                                                       |                                                                                                                              |
| `title`                       | `boolean`                 | `string`                                                                                                                            | *generated* (e.g. “Pollenprognos för Stockholm”)                          | *generated*                                                                                                                                                               | If `true` (or omitted) shows the auto‐generated header. If `false` hides header. If you provide a string, uses that instead. |
| `date_locale`                 | `string`                  | `"sv-SE"`                                                                                                                           | `"de-DE"`                                                                 | IETF locale for formatting weekdays via `toLocaleDateString` (e.g. `en-GB`, `de-DE`).                                                                                     |                                                                                                                              |
| `debug`                       | `boolean`                 | `false`                                                                                                                             | `false`                                                                   | Enable verbose console logging for troubleshooting.                                                                                                                       |                                                                                                                              |
| `phrases.full`                | `<object>`                | `{}`                                                                                                                                | `{"erle":"Erle",…}`                                                       | Map original allergen keys to full‐length display names. DWD default includes German names; PP default is empty (uses raw sensor names).                                  |                                                                                                                              |
| `phrases.short`               | `<object>`                | `{}`                                                                                                                                | `{}`                                                                      | Map original allergen keys to short display names. Defaults to the same as `full`.                                                                                        |                                                                                                                              |
| `phrases.levels`              | `<array<string>>`         | `["Ingen pollen","Låga halter","Låga-måttliga halter","Måttliga halter","Måttliga-höga halter","Höga halter","Mycket höga halter"]` | `["keine Belastung",…]`                                                   | Custom level names for intensity indexes 0–6. DWD default is the German list; PP uses Swedish defaults.                                                                   |                                                                                                                              |
| `phrases.days`                | `<object<number,string>>` | `{}`                                                                                                                                | `{}`                                                                      | Override the label for specific day-offsets (0=Today, 1=Tomorrow, 2=Day after tomorrow). Beyond those, absolute weekday names are used per `date_locale`.                 |                                                                                                                              |
| `phrases.no_information`      | `string`                  | `"(Ingen information)"`                                                                                                             | `""`                                                                      | Text to show when `state_text` would otherwise be empty (e.g. before data arrives).                                                                                       |                                                                                                                              |

## Examples

### Normal layout

<table>
 <tr>
  <td>4 days, value inside circles, German translation</td>
  <td><img width="527" alt="card_4_days_values_inside_circle" src="https://github.com/user-attachments/assets/dd242bd4-e891-4dde-9163-d1870ced84b1" /></td>
  <td>

   ```yaml
type: custom:pollenprognos-card
integration: dwd
region_id: ""
allergens:
  - erle
  - ambrosia
  - esche
  - birke
  - hasel
  - gräser
  - beifuss
  - roggen
minimal: false
show_text_allergen: true
show_value_text: true
show_value_numeric: false
show_value_numeric_in_circle: true
show_empty_days: true
debug: false
days_to_show: 2
days_relative: true
days_abbreviated: false
days_uppercase: false
days_boldfaced: false
pollen_threshold: 0.5
sort: value_descending
allergens_abbreviated: false
date_locale: de
phrases:
  full:
    erle: Erle
    ambrosia: Ambrosia
    esche: Esche
    birke: Birke
    hasel: Hasel
    gräser: Gräser
    beifuss: Beifuß
    roggen: Roggen
  short:
    erle: Erle
    ambrosia: Ambro
    esche: Esche
    birke: Birke
    hasel: Hasel
    gräser: Gräs
    beifuss: Beifu
    roggen: Roggn
  levels:
    - keine Belastung
    - keine bis geringe Belastung
    - geringe Belastung
    - geringe bis mittlere Belastung
    - mittlere Belastung
    - mittlere bis hohe Belastung
    - hohe Belastung
  days:
    "0": Heute
    "1": Morgen
    "2": Übermorgen
  no_information: Keine Information
type: custom:pollenprognos-card
```

  </td>
 </tr>
<tr>
<td>2 days, no text</td>
<td><img width="510" alt="card_2_days_without_text" src="https://user-images.githubusercontent.com/2943684/234618818-0f5b4953-8604-48e9-b308-20a3887b45d8.png"></td>
<td>

```yaml
cards:
  - type: 'custom:pollenprognos-card'
    city: Forshaga
    show_text_allergen: true
    show_value_text: false
    show_value_numeric: false
    days_to_show: 2
    days_to_show: 2
    allergens:
      - Al
      - Alm
      - Malörtsambrosia
      - Björk
      - Ek
      - Gråbo
      - Gräs
      - Hassel
      - Sälg och viden
```

</td>
</tr>
<tr>
<td>4 days, with text</td>
<td><img width="505" alt="card_4_days_with_text" src="https://user-images.githubusercontent.com/2943684/234618933-586749ed-04f2-4784-95ee-768265d2d14c.png"></td>
<td>

```yaml
cards:
  - type: 'custom:pollenprognos-card'
    city: Forshaga
    show_text_allergen: true
    show_value_text: true
    show_value_numeric: false
    days_to_show: 4
    allergens:
      - Al
      - Alm
      - Malörtsambrosia
      - Björk
      - Ek
      - Gråbo
      - Gräs
      - Hassel
      - Sälg och viden
```

</td>
</tr>
  </table>
  
### Minimal layout
  
<table>
  <td>Minimal, without text and title</td>
<td><img width="371" alt="card_minimal_notext_notitle" src="https://user-images.githubusercontent.com/2943684/234701286-1bd0d2bd-2df4-49e8-83ac-0b2c7207d3e8.png">
</td>
<td>

```yaml
cards:
  - type: 'custom:pollenprognos-card'
    city: Forshaga
    show_text_allergen: false
    show_value_text: false
    show_value_numeric: false
    title: false
    minimal: true
    days_to_show: 4        # HAS NO EFFECT IN MINIMAL LAYOUT
    allergens:
      - Al
      - Alm
      - Malörtsambrosia
      - Björk
      - Ek
      - Gråbo
      - Gräs
      - Hassel
      - Sälg och viden
```

</td>
</tr>
  <tr>
<td>Minimal, with text and title</td>
<td><img width="369" alt="card_minimal_withtext_withtitle" src="https://user-images.githubusercontent.com/2943684/234700980-bfa4faa2-2e4b-41fd-8be0-f8d65d1f083d.png">
</td>
<td>

```yaml
cards:
  - type: 'custom:pollenprognos-card'
    city: Forshaga
    show_text_allergen: true
    show_value_text: false
    show_value_numeric: true
    minimal: true
    days_to_show: 4        # HAS NO EFFECT IN MINIMAL LAYOUT
    allergens:
      - Al
      - Alm
      - Malrötsambrosia
      - Björk
      - Ek
      - Gråbo
      - Gräs
      - Hassel
      - Sälg och viden
```

</td>
</tr>
</table>

### Custom text for allergens, values etc

<table>
<tr>
<td>Custom text</td>
<td><img width="377" alt="Skärmavbild 2025-04-29 kl  19 41 43" src="https://github.com/user-attachments/assets/71635179-1bce-427f-8563-0cc7163ad6ea" />
</td>
<td>

```yaml
- type: 'custom:pollenprognos-card'
  city: Forshaga
  show_text_allergen: true
  show_value_text: true
  show_value_numeric: false
  minimal: false
  sort: value_descending
  pollen_threshold: 0
  days_to_show: 2
  date_locale: en-GB
  allergens:
    - Al
    - Alm
    - Malörtsambrosia
    - Björk
    - Ek
    - Gråbo
    - Gräs
    - Hassel
    - Sälg och viden
  phrases:
    full:
      Al: Alder
      Alm: Elm
      Malörtsambrosia: Ragweed
      Björk: Birch
      Ek: Oak
      Gråbo: Mugwort
      Gräs: Grass
      Hassel: Hazel
      Sälg och viden: Willow and sallow
    short:
      Al: Alder
      Alm: Elm
      Malörtsambrosia: Ragweed
      Björk: Birch
      Ek: Oak
      Gråbo: Mugwort
      Gräs: Grass
      Hassel: Hazel
      Sälg och viden: Willow
    no_information: "(N/A)"
    levels:
      - No pollen
      - Low
      - Low-Moderate
      - Moderate
      - Moderate-High
      - High
      - Very high
    days:
      0: Today
      1: Tomorrow
      2: Day after tomorrow
```

</td>
</tr>
</table>

## Credits

This is a fork of [pollen-card](https://github.com/nidayand/lovelace-pollen-card) by @nidayand , who in turn rewrote @isabellaalstrom's [pollenprognos-card](https://github.com/isabellaalstrom/lovelace-pollenprognos-card).
