# Supported integrations and compatibility

`pollenprognos-card` can display data from the following Home Assistant integrations:

- [Pollenprognos](https://github.com/JohNan/homeassistant-pollenprognos)
- [DWD Pollenflug](https://github.com/mampfes/hacs_dwd_pollenflug)
- [Polleninformation EU](https://github.com/krissen/polleninformation)
- [SILAM Pollen Allergy Sensor](https://github.com/danishru/silam_pollen)
- [Kleenex Pollen Radar](https://github.com/MarcoGos/kleenex_pollenradar)
- [Pollen.lu](https://github.com/Foxi352/pollen_lu)

The card tries to auto-detect which adapter to use based on your sensors. The table below lists version requirements and other notes for each integration.

| Integration | Notes |
|-------------|------|
| **Pollenprognos** | For `homeassistant-pollenprognos` **v1.1.0** and higher you need **v1.0.6** or newer of this card. For older integration versions use **v1.0.5** or earlier. |
| **Polleninformation EU** | For `polleninformation` **v0.4.0** or later you need **v2.4.2** or newer of this card. Versions **v0.3.1** and earlier require card version **v2.2.0–v2.4.1**. Forecast modes were added in card **v2.5.0** and require `polleninformation` **v0.4.4** or later. Only the `allergy_risk` sensor supports modes other than `daily`. |
| **SILAM Pollen Allergy Sensor** | Do not rename the sensors created by the integration. For `silam_pollen` **v0.2.7** and newer you need **v2.4.1** or newer of this card. Older integration versions require **v2.3.0–v2.4.0**. |
| **DWD Pollenflug** | Keep the default sensor names. You need card version **v2.0.0** or newer. |
| **Kleenex Pollen Radar** | Keep the default sensor names. Supports forecasts for Netherlands, UK, France, Italy and USA. Added in card **v2.6.0**. **Note**: The integration reports level as "low" even when ppm values are 0, while the card interprets 0 ppm as "none" level. This different interpretation may affect which allergens appear in the card, and the level of the allergen, as compared to the integration. To confirm what the card shows, open up the relevant sensor in the integration (`trees`, `weeds`, or `grass`). Look at the attributes. Even though the ppm **value** is `0` (no particles in the air) the **level** is shown as `low`. The card would instead show a ppm level of `0` as `none`. |
| **Pollen.lu** | Keep the default sensor names. The integration exposes current-day pollen levels for Luxembourg with one sensor per allergen. Added in card **v2.8.0**. |
