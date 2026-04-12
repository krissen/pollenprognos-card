# Installation Guide

This guide will walk you through installing both the pollenprognos-card and one of the supported pollen data integrations.

## Prerequisites

You need Home Assistant installed and running. This card is designed for the Lovelace UI.

## Step 1: Install a Pollen Data Integration

Before installing the card, you need one of the supported pollen data integrations. Choose the one that provides data for your region:

### Option A: Pollenprognos (Sweden)

Install via HACS:
1. Open HACS → Integrations
2. Click the "+" button
3. Search for "Pollenprognos"
4. Install the integration
5. Restart Home Assistant
6. Add the integration via Settings → Devices & Services

**Repository**: [homeassistant-pollenprognos](https://github.com/JohNan/homeassistant-pollenprognos)

### Option B: DWD Pollenflug (Germany)

Install via HACS:
1. Open HACS → Integrations
2. Click the "+" button
3. Search for "DWD Pollenflug"
4. Install the integration
5. Restart Home Assistant
6. Add the integration via Settings → Devices & Services

**Repository**: [hacs_dwd_pollenflug](https://github.com/mampfes/hacs_dwd_pollenflug)

### Option C: Polleninformation EU (Europe)

Install via HACS:
1. Open HACS → Integrations
2. Click the "+" button
3. Search for "Polleninformation"
4. Install the integration
5. Restart Home Assistant
6. Add the integration via Settings → Devices & Services

**Repository**: [polleninformation](https://github.com/krissen/polleninformation)

### Option D: SILAM Pollen Allergy Sensor

Install via HACS:
1. Open HACS → Integrations
2. Click the "+" button
3. Search for "SILAM Pollen"
4. Install the integration
5. Restart Home Assistant
6. Add the integration via Settings → Devices & Services

**Repository**: [silam_pollen](https://github.com/danishru/silam_pollen)

### Option E: Kleenex Pollen Radar (Netherlands, UK, France, Italy, USA)

Install via HACS:
1. Open HACS → Integrations
2. Click the "+" button
3. Search for "Kleenex Pollen Radar"
4. Install the integration
5. Restart Home Assistant
6. Add the integration via Settings → Devices & Services

**Repository**: [kleenex_pollenradar](https://github.com/MarcoGos/kleenex_pollenradar)

### Option F: Pollen.lu (Luxembourg)

Install via HACS:
1. Open HACS → Integrations
2. Click the "+" button
3. Search for "Pollen.lu"
4. Install the integration
5. Restart Home Assistant
6. Add the integration via Settings → Devices & Services

**Repository**: [pollen_lu](https://github.com/Foxi352/pollen_lu)

### Option G: Atmo France (France)

Install via HACS:
1. Open HACS → Integrations
2. Click the "+" button
3. Search for "Atmo France"
4. Install the integration
5. Restart Home Assistant
6. Add the integration via Settings → Devices & Services

**Repository**: [atmofrance](https://github.com/sebcaps/atmofrance)

### Option H: Google Pollen Levels (Global)

Install via HACS:
1. Open HACS → Integrations
2. Click the "+" button
3. Search for "Google Pollen Levels" or "pollenlevels"
4. Install the integration
5. Restart Home Assistant
6. Add the integration via Settings → Devices & Services

**Repository**: [pollenlevels](https://github.com/eXPerience83/pollenlevels)

### Option I: Google Pollen (Global)

Install via HACS:
1. Open HACS → Integrations
2. Click the "+" button
3. Search for "Google Pollen" or "home-assistant-google-pollen"
4. Install the integration
5. Restart Home Assistant
6. Add the integration via Settings → Devices & Services (requires a Google Cloud API key)

**Repository**: [home-assistant-google-pollen](https://github.com/svenove/home-assistant-google-pollen)

## Step 2: Install Pollenprognos Card

### Via HACS (Recommended)

1. Open HACS in your Home Assistant
2. Go to "Frontend"
3. Click the "+" button in the bottom right
4. Search for "Pollenprognos Card"
5. Click "Install"
6. Reload your browser cache (Ctrl+F5 or Cmd+Shift+R)

### Manual Installation

1. Download the latest `pollenprognos-card.js` from the [releases page](https://github.com/krissen/pollenprognos-card/releases)
2. Copy the file to your Home Assistant `config/www/` directory
3. Add the resource in your Lovelace configuration:
   - Go to Settings → Dashboards → Resources
   - Click "Add Resource"
   - URL: `/local/pollenprognos-card.js`
   - Resource type: JavaScript Module
4. Reload your browser cache

## Step 3: Verify Installation

1. Check that your pollen integration is creating sensors:
   - Go to Developer Tools → States
   - Search for your pollen sensors (e.g., `sensor.birch_stockholm` for Pollenprognos)
2. If you see pollen sensors, you're ready to add the card!

> **"Custom element doesn't exist"?** The card resource may not have registered properly. See the [troubleshooting guide](troubleshooting.md#card-not-found--old-version-still-running) for how to verify and fix resource registration.

## Next Steps

- See [quick-start.md](quick-start.md) for adding your first card
- See [configuration.md](configuration.md) for all available options
- See [integrations.md](integrations.md) for integration-specific compatibility notes

## Troubleshooting

For detailed troubleshooting, see the [Troubleshooting Guide](troubleshooting.md). Common issues include:

- **Card not found**: Clear your browser cache (Ctrl+Shift+R) and check for [conflicting card installations](troubleshooting.md#conflicting-card-installations)
- **No sensors showing**: Check that sensors exist in Developer Tools > States and that [your integration version is compatible](integrations.md)
- **Version mismatch**: Verify the [actually running version](troubleshooting.md#how-to-check-the-running-version) matches what HACS installed
