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
- Uses embedded PNG images instead of scalable SVG icons

## lovelace-pollenprognos-card

<https://github.com/isabellaalstrom/lovelace-pollenprognos-card>

The original card for the Pollenprognos integration.

**Pros**
- Simple display of Pollenprognos sensor data

**Cons**
- Unmaintained
- No HACS support or UI editor
- Requires manual copying of `pollen_img` to `www/` or setting `img_path`
- Uses embedded PNG images instead of scalable SVG icons

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
- Uses embedded PNG images instead of scalable SVG icons

## Summary

`pollenprognos-card` distinguishes itself through comprehensive multi-integration support, working with all six major pollen data sources (Pollenprognos, DWD, Polleninformation EU, SILAM, Kleenex, and Pollen.lu). Unlike single-integration alternatives, it features:

- **Built-in SVG icon system** with 24+ scalable allergen icons and customizable colors
- **Visual Home Assistant editor** for complete configuration without YAML editing
- **Dynamic localization** in 13 languages that automatically follows Home Assistant's language setting
- **Auto-detection** of available integrations and sensors
- **HACS official repository** status with automatic updates
- **Multiple display modes** including minimal, daily, hourly, and twice-daily forecast layouts

These features make it a comprehensive solution for pollen forecast display that works seamlessly across different data sources and regions.

