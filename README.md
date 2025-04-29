# pollenprognos-card

A Lovelace card to display the sensor data from the integration [Home Assistant Pollenprognos integration](https://github.com/JohNan/homeassistant-pollenprognos).

![Screenshot 2022-08-05 at 22 37 45](https://user-images.githubusercontent.com/2181965/183159066-2cef1a6e-e59b-4bb3-832b-7bff781b471c.png)

## Requirement

- [Home Assistant Pollenprognos integration](https://github.com/JohNan/homeassistant-pollenprognos)

### Install with HACS

Add <https://github.com/krissen/pollenprognos-card> as a custom integration.
See more info: <https://hacs.xyz/docs/faq/custom_repositories>

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)  
[![HACS Action](https://github.com/krissen/pollenprognos-card/actions/workflows/hacs_action.yml/badge.svg)](https://github.com/krissen/pollenprognos-card/actions/workflows/hacs_action.yml)

## Credits

Small improvements to [pollen-card](https://github.com/nidayand/lovelace-pollen-card) by @nidayand , who in turn rewrote @isabellaalstrom's [pollenprognos-card](https://github.com/isabellaalstrom/lovelace-pollenprognos-card).

## Note

In minimal mode, you might notice some odd spelling. For instance, "Hassel" is shortened to "Hssel". This is to avoid line breaks which would break symmetry. *Let me know if this bothers you*. Create an issue on the repo or send me a PM. I can add an option to turn it off, if there's interest.

Spelling in the normal (that is, not-minimal) card is as expected. ;-)

## Options

| Name | Type | Default | Description
| ---- | ---- | ------- | -----------
| type | string | **Required** | `custom:pollen-card`
| city | string | **Required** | City from which you have sensors
| allergens | list | **Required** | List of allergens for which you have sensors
| days_to_show | integer | **Optional** | How many days to show, 0 (only allergen) to 4. Default: 4.
| minimal | boolean | **Optional** | Use minimal, flexible layout
| pollen_threshold | integer | **Optional** | Threshold of pollen value, for any of days 1-4, to show. Possible values: 0 to 6. Default: 1.
| show_text | boolean | **Optional** | Set to `true` if you want to show the state text under the images
| sort | string | **Optional** | Change how list of allergens is sorted. Possible values: `value_ascending`, `value_descending`, `name_ascending` (default), and `name_descending`. If sorted by value, today's value is used.
| title | boolean | **Optional** | Custom title if string, boolean value if generated or not to show. Default is generated text

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
