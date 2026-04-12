# Troubleshooting

This guide covers the most common issues reported with pollenprognos-card and how to resolve them. If your issue is not listed here, please [open a GitHub issue](https://github.com/krissen/pollenprognos-card/issues/new/choose) with the diagnostic information described in [Collecting diagnostic information](#collecting-diagnostic-information).

## Before you report an issue

Most reported issues fall into a few well-known categories. Please work through this checklist before opening an issue:

1. **Verify your running card version** (see [How to check the running version](#how-to-check-the-running-version))
2. **Force-refresh your browser cache** (see [Cache and version problems](#cache-and-version-problems))
3. **Check for conflicting cards** (see [Conflicting card installations](#conflicting-card-installations))
4. **Test with a minimal config** to rule out config-related issues
5. **Enable debug mode** and check the browser console for clues

If the issue persists after these steps, open an issue with the diagnostic info from the template.

---

## Common issues

### Cache and version problems

**This is the single most common cause of issues.** HACS downloading a new version does not mean your browser is running it. The browser (or the HA Companion app) may serve a cached old version.

**Symptoms:**
- "Custom element doesn't exist: pollenprognos-card"
- `dict.forecast is undefined` or `dict.forecast.state` errors
- Editor text unreadable or missing options
- Features from a new version not appearing

**How to fix:**

*Desktop browser (quick method):*
1. Press Ctrl+Shift+R (or Cmd+Shift+R on Mac) to force-reload
2. If that is not enough, open the browser's developer tools (usually F12 or right-click > "Inspect"), go to the **Network** tab, check **Disable cache**, and reload again

*Home Assistant Companion app (iOS/Android):*
1. Open the Companion App
2. Go to **Settings** (gear icon) > **Companion App**
3. Scroll down to **Troubleshooting**
4. Tap **Reset Frontend Cache**
5. Restart the app

*HACS shows the right version but the card still behaves like the old one?*
- In HACS > Frontend > pollenprognos-card, open the three-dot menu and select **Redownload** to force HACS to re-fetch the file
- Restart Home Assistant: Settings > System > three-dot menu (top right) > Restart Home Assistant
- On some setups, the browser needs to be fully closed and reopened (not just refreshed)

### How to check the running version

The card prints its version to the **browser console** on load. The browser console is a built-in tool in all browsers that shows technical messages from the page. Here is how to open it:

1. Open your dashboard with the card
2. Open the browser console:
   - **Desktop browsers**: Press F12 (or right-click anywhere on the page and select "Inspect"), then click the **Console** tab
   - **HA Companion app**: The console is not directly accessible; add `show_version: true` to your card config instead (see tip below)
3. Look for a line like: `Pollenprognos Card: version v3.0.1`

This is the **actually running** version. The value after `version` is either a git tag (e.g. `v3.0.1`) or a short commit hash when the build is not on an exact tag. If it does not match what HACS shows as installed, you have a cache problem (see above).

> **Tip:** Add `show_version: true` to your card config to ensure the version is always logged to the console.

### Conflicting card installations

This card and its predecessors (Isabella Alstrom's `lovelace-pollenprognos-card` and Nidayand's `lovelace-pollen-card`) all register the same custom element name: `custom:pollenprognos-card`. If more than one is installed, they conflict silently, and the wrong version may load.

**How to check:**
1. In HACS > Frontend, search for "pollen". You should only have **one** pollen card installed.
2. Check your `/config/www/` directory (via File Editor, SSH, or Samba) for leftover files:
   - `pollenprognos-card.js`
   - `lovelace-pollenprognos-card.js`
   - Any folder named `pollenprognos` or `pollen-card`
3. Check Settings > Dashboards > Resources for duplicate entries pointing to old card files. (Note: the Resources tab is only visible when **Advanced Mode** is enabled in your user profile.)

**How to fix:**
- Remove any old card files from `/config/www/`
- Remove any duplicate resource entries
- Uninstall old cards from HACS if still listed
- Clear your cache (see above)

---

### "No pollen sensors found"

The card could not find any sensors matching your integration and location.

**Common causes:**

1. **Integration not installed or not configured.** Check Developer Tools > States (in HA 2026.2+: Settings > Developer Tools > States) and search for your pollen sensors (e.g., `sensor.pollen_`, `sensor.dwd_pollenflug_`, `sensor.silam_pollen_`). If no sensors appear, the issue is with the integration, not the card.

2. **Wrong integration selected.** Make sure the `integration` field in your card config matches your installed integration. Valid values: `pp`, `dwd`, `peu`, `silam`, `kleenex`, `plu`, `atmo`, `gpl`, `gp`.

3. **Wrong location/city/region.** The location value must match what the integration created. Check your sensor entity IDs in Developer Tools > States to find the correct value.

4. **Sensors renamed in Home Assistant.** Most adapters detect sensors by entity ID patterns. If you renamed your sensor entities, auto-detection will fail. Options:
   - Rename entities back to their defaults, or
   - Use `manual` mode with `entity_prefix`/`entity_suffix` (see [configuration.md](configuration.md))

5. **Integration version incompatible with card version.** See [integrations.md](integrations.md) for the compatibility matrix.

**Quick test:** Try adding the card with only the minimum config to see if auto-detection works:
```yaml
type: custom:pollenprognos-card
```
If the card finds sensors with this minimal config, the issue is in your config, not in sensor detection.

---

### Allergens missing from the card

Some or all allergens are not showing even though sensors exist.

**Common causes:**

1. **`pollen_threshold` filtering them out.** The default threshold is 1, which hides allergens with level 0 ("none"). Set `pollen_threshold: 0` to show all allergens regardless of level.

2. **Integration updated and changed sensor/allergen names.** When an integration changes how it names sensors or attributes, the card may not recognize them until it is updated. Check [integrations.md](integrations.md) for version requirements.

3. **Allergen names not in the `allergens` list.** If you specify an `allergens` array in your config, only those allergens are shown. Remove the `allergens` key to show all detected allergens, or check that the names match the valid keys for your integration (see [configuration.md](configuration.md#valid-allergen-keys)).

4. **Localized entity names.** Some integrations create entity IDs in the user's language (e.g., Dutch `bomen` instead of English `trees`). The card handles most known localizations, but if your language is not yet covered, please report it with the exact entity IDs.

---

### Editor problems

**Can't select integration, region, or allergens in the visual editor:**
- Verify that you typed the integration name in lowercase (e.g., `silam`, not `SILAM`)
- Check that the integration's sensors are available in Developer Tools > States (Settings > Developer Tools > States in HA 2026.2+)
- Enable `debug: true` in YAML mode and check the console for detection messages

**Allergen list resets when opening the editor:**
- This was fixed in v2.7.1. Update the card.

**Editor text unreadable (wrong colors):**
- This was a CSS theme compatibility issue fixed in v2.3.4. Update the card.

---

### Card freezes the browser

If selecting an integration or loading the card causes the browser tab to freeze:

1. This is usually caused by the underlying integration being in a broken state (e.g., returning errors instead of data).
2. Check your Home Assistant logs (Settings > System > Logs) for errors from the pollen integration.
3. Try removing and re-adding the integration.
4. If the issue is with SILAM, check that the integration itself is working: verify that the weather entity (e.g., `weather.silam_pollen_home`) has valid attributes.

This was specifically addressed for SILAM in card v3.0.1 by fixing a reactive-property infinite microtask loop that could freeze the browser.

---

### Integration-specific notes

#### Pollenprognos (PP)
- Requires card v1.0.6+ for integration v1.1.0+
- If allergens changed names (e.g., `Ambrosia` to `Malortsambrosia`), update both the card and your config

#### DWD Pollenflug
- Keep default sensor names; renaming breaks detection
- Uses a 0-3 scale internally (mapped to the card's 0-6 scale)
- If minimal mode shows wrong colors, update to card v2.7.0+

#### Polleninformation EU (PEU)
- Requires card v2.4.2+ for integration v0.4.0+
- Multi-part location names (e.g., "Le Blanc-Mesnil") are supported from card v2.4.2
- Forecast modes (hourly, twice_daily) only work with `allergy_risk` sensors and integration v0.4.4+

#### SILAM Pollen
- The card uses the entity registry for detection when available; renamed entities fall back to pattern matching
- If location is not detected, set `location` explicitly in your config
- Daily mode and hourly/twice_daily modes may show slightly different levels (this is expected; the integration reports different values per source)

#### Kleenex Pollen Radar
- Entity names may be localized (e.g., Dutch `bomen`/`kruiden`/`gras` instead of `trees`/`weeds`/`grasses`). Supported from card v2.6.0.
- The integration reports "low" level even for 0 ppm; the card shows 0 ppm as "none". This is intentional.

#### Google Pollen Levels (GPL)
- Entities can be renamed freely; the card detects them by platform attribute, not entity ID
- Works with any HA language
- Multi-location setups are supported via separate config entries

#### Google Pollen (GP, svenove)
- Detected by `google_pollen` platform or `sensor.google_pollen_*` entity prefix
- Allergens are classified via the `display_name` attribute, which is localized by the integration's language setting; English names are supported out of the box
- The API provides up to 4 forecast days (today + 3)
- If you have both `pollenlevels` and `google_pollen` installed, set `integration: gp` explicitly

---

## Collecting diagnostic information

When reporting an issue, include the following. This information lets us diagnose the problem without multiple rounds of back-and-forth questions.

### 1. Card version (required)

The **running** version from the browser console (not what HACS shows). See [How to check the running version](#how-to-check-the-running-version) for step-by-step instructions.

### 2. Environment (required)

- **Home Assistant Core version** (Settings > About, or click the version number at the bottom of the sidebar)
- **Integration name and version** (Settings > Devices & Services > click your pollen integration > three-dot menu > About)
- **Browser/platform** (e.g., Chrome on Windows, Safari on iOS, HA Companion on Android)

### 3. Card YAML config (required)

Copy your card config from the YAML editor:
1. Edit your dashboard
2. Click "Edit" on the card
3. Switch to the YAML editor (if in visual mode, click "Show code editor")
4. Copy the full YAML

### 4. Sensor entity IDs (required for "sensors not found" issues)

Go to Developer Tools > States (Settings > Developer Tools > States in HA 2026.2+) and search for your pollen sensors. Copy 2-3 example entity IDs exactly as shown, e.g.:
```
sensor.silam_pollen_home_birch_2
sensor.dwd_pollenflug_31_hasel
sensor.pollen_stockholm_bjork
```

### 5. Sensor attributes (helpful for display issues)

For a relevant sensor, click on it in Developer Tools > States and copy the full attributes section. This shows us the data structure the integration provides.

### 6. Debug console output (helpful for detection issues)

1. Add `debug: true` to your card config:
   ```yaml
   type: custom:pollenprognos-card
   debug: true
   # ... rest of your config
   ```
2. Reload the page
3. Open the browser console (F12 > Console tab, see [How to check the running version](#how-to-check-the-running-version) for details)
4. Copy all lines that mention "pollenprognos" or your integration name

### 7. Browser console errors (required for error/crash issues)

Open the browser console (F12 > Console tab) and copy any red error messages. Include the full error text, not just a screenshot.

### 8. Home Assistant logs (helpful for integration errors)

Check Settings > System > Logs for errors from your pollen integration. Search for the integration name (e.g., "silam", "pollenprognos", "polleninformation"). Copy any relevant error entries.

---

## Is it a card issue or an integration issue?

Many reported issues turn out to be problems with the underlying integration, not the card itself. Here is how to tell:

| Check | If yes | Likely issue in |
|-------|--------|-----------------|
| Sensors missing from Developer Tools > States | No sensors at all | **Integration** |
| Sensor state is "unavailable" or "unknown" | Sensor exists but has no data | **Integration** |
| Sensor attributes empty or have unexpected values | Data looks wrong | **Integration** |
| HA logs show errors from the pollen integration | Integration errors | **Integration** |
| Card shows "No sensors found" but sensors exist in States | Detection failure | **Card** |
| Card shows wrong levels/colors for existing sensors | Rendering bug | **Card** |
| Editor options missing or broken | UI bug | **Card** |

If the issue is in the integration, report it on the integration's GitHub repository (linked in [integrations.md](integrations.md)).
