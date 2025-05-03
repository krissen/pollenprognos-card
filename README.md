# pollenprognos-card

A Lovelace card to display the sensor data from the integration [Home Assistant Pollenprognos integration](https://github.com/JohNan/homeassistant-pollenprognos).

![Screenshot 2022-08-05 at 22 37 45](https://user-images.githubusercontent.com/2181965/183159066-2cef1a6e-e59b-4bb3-832b-7bff781b471c.png)

## Requirement

- [Home Assistant Pollenprognos integration](https://github.com/JohNan/homeassistant-pollenprognos)  
  **Note,** for `homeassistant-pollenprognos` v1.1.0 and higher, you need v1.0.6 or above of this card.  
For `homeassistant-pollenprognos` <1.1.0, use <=v1.0.5 of `pollenprognos-card`.

### Install with HACS

Add <https://github.com/krissen/pollenprognos-card> as a custom integration.
See more info: <https://hacs.xyz/docs/faq/custom_repositories>

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)  
[![HACS Action](https://github.com/krissen/pollenprognos-card/actions/workflows/hacs_action.yml/badge.svg)](https://github.com/krissen/pollenprognos-card/actions/workflows/hacs_action.yml)

## Credits

Small improvements to [pollen-card](https://github.com/nidayand/lovelace-pollen-card) by @nidayand , who in turn rewrote @isabellaalstrom's [pollenprognos-card](https://github.com/isabellaalstrom/lovelace-pollenprognos-card).

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

## Options

| Name             | Type                     | Default                                                                                                                                       | Description                                                                                                                             |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | string                   | **Required**                                                                                                                                  | `custom:pollen-card`                                                                                                                   |
| `city`           | string                   | **Required**                                                                                                                                  | City from which you have sensors                                                                                                       |
| `allergens`      | list                     | **Required**                                                                                                                                  | List of allergens for which you have sensors                                                                                           |
| `days_to_show`   | integer                  | `4`                                                                                                                                           | How many days to show, `0` (only allergen) to `4`                                                                                       |
| `days_relative`   | boolean                  | `true`                                                                                                                                           | Whether to write out closest three days in relative terms (`true` gives `Today`, `Tomorrow`) or absolute (`false´ gives`Monday`,`Tuesday`)                                                                                      |
| `minimal`        | boolean                  | `false`                                                                                                                                       | Use minimal, flexible layout                                                                                                            |
| `pollen_threshold` | integer                | `1`                                                                                                                                           | Threshold of pollen value (`0–6`) for any of days `1–4` to show                                                                        |
| `show_text`      | boolean                  | `false`                                                                                                                                       | Set to `true` if you want to show the state text under the images                                                                       |
| `sort`           | string                   | `name_ascending`                                                                                                                              | Change how list of allergens is sorted. Possible values: `value_ascending`, `value_descending`, `name_ascending`, `name_descending`      |
| `title`          | boolean \| string        | generated                                                                                                                                     | If boolean, controls showing generated title; if string, uses as custom title                                                           |
| `debug`          | boolean                  | `false`                                                                                                                                       | Enable debug logging in the browser console                                                                                             |
| `phrases.full`   | object <string,string>   | `{}`                                                                                                                                          | Custom full allergen display names keyed by the original allergen                                                                       |
| `phrases.short`  | object <string,string>   | `{}`                                                                                                                                          | Custom short allergen display names keyed by the original allergen                                                                      |
| `phrases.levels` | array <string>           | `["Ingen pollen","Låga halter","Låga-måttliga halter","Måttliga halter","Måttliga-höga halter","Höga halter","Mycket höga halter"]`            | Custom list of pollen intensity level names for indexes 0–6                                                                             |
| `phrases.days`   | object <number,string>   | `{}`                                                                                                                                          | Custom labels for days keyed by day offset (`0`=today, `1`=tomorrow, `2`=day after tomorrow). Day four is created according to config key `date_locale`.                                           |
| `date_locale`    | string                   | `"sv-SE"`                                                                                                                                     | Locale for formatting weekday names when displaying dates (e.g. `sv-SE`, `en-GB`)                                                        |

## Examples

### Normal layout

<table>
<tr>
<td>2 days, no text</td>
<td><img width="510" alt="card_2_days_without_text" src="https://user-images.githubusercontent.com/2943684/234618818-0f5b4953-8604-48e9-b308-20a3887b45d8.png"></td>
<td>

```yaml
cards:
  - type: 'custom:pollenprognos-card'
    city: Forshaga
    show_text: false
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
    show_text: true
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
  <tr>
<td>0 days</td>
<td><img width="509" alt="card_0_days" src="https://user-images.githubusercontent.com/2943684/234618464-1d90b53a-61d7-4fe1-b5f8-10ae4cc17883.png"></td>
<td>

```yaml
cards:
  - type: 'custom:pollenprognos-card'
    city: Forshaga
    show_text: false
    days_to_show: 0
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
  <tr><td colspan="3">Maybe try minimal layout instead?</td></tr>
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
    show_text: false
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
    show_text: true
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
  show_text: true
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
