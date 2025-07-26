# Related or similar projects

Below are a few alternative Lovelace cards and integrations for pollen forecasts. Each has different features and limitations.

## lovelace-pollen-card

<https://github.com/nidayand/lovelace-pollen-card>

A card that displays pollen sensor data (forked from `isabellaalstrom/lovelace-pollenprognos-card`).

**Pros**
- Makes `lovelace-pollenprognos-card` usable after integration changes
- More features than the original card
- Still relatively easy to set up

**Cons**
- Does not work with the latest `homeassistant-pollenprognos` releases
- Supports only the Pollenprognos integration
- No built-in localization or visual editor

## lovelace-pollenprognos-card

<https://github.com/isabellaalstrom/lovelace-pollenprognos-card>

The original card for the Pollenprognos integration.

**Pros**
- Simple display of Pollenprognos sensor data

**Cons**
- Unmaintained
- No HACS support or UI editor
- Requires manual copying of `pollen_img` to `www/` or setting `img_path`

## dwd-pollenprognos-card

<https://github.com/bhuebschen/dwd-pollenprognos-card>

A custom card for the DWD Pollenflug integration.

**Pros**
- Focused only on DWD data
- Uses the same styling as the upstream card

**Cons**
- No visual editor; configuration via YAML only
- Requires manual copy of `pollen_img` or custom `img_path`
- Works only with DWD sensors

None of these cards support dynamic string localization and all four adapters. `pollenprognos-card` combines both data sources, works with HACS and the Lovelace editor, and is fully localizable.

