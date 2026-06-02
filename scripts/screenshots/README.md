# Documentation screenshot tooling

Reproducible generator for the card/badge images under `docs/screenshots/`.
Drives the local **hass-test** instance with Playwright and shoots curated,
element-level screenshots (no QA-fixture scraping).

## One-time setup

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install playwright && playwright install chromium
```

## Auth

Auth is via the hass-test long-lived token, injected into `localStorage`
(never committed). Export it before running:

```bash
export HASS_TOKEN=<long-lived hass-test token>   # do NOT commit
# optional: export HASS_URL=http://localhost:8123
```

## Fixtures

`build_fixtures.py` applies the curated documentation fixtures to the
`pollen-test` dashboard live over the HA WebSocket API (no restart): it adds the
curated badge row (`docs/screenshots/fixtures/badge-row.json`) to the stock
tabs (All Integrations, Modes) and to a dedicated **Documentation** view. The QA
`#235 badge` view is left untouched.

```bash
python build_fixtures.py
```

## Capture

`shoot.py` waits for the custom elements to finish loading (no empty
`.ppb-empty` badge placeholders) before shooting, so a slow-loading integration
right after an HA restart doesn't produce empty pills. Always review each image.

```bash
# the curated badge row
python shoot.py --view pollen-test/documentation --badges ../../docs/screenshots/badge-row.png
# a card by index within a view
python shoot.py --view pollen-test/documentation --card 0 --out ../../docs/screenshots/hero-card.png
```

Images render in the HA UI language (English via the browser locale by default);
avoid fixture cards that pin a `date_locale`. Keep PNGs lean (element crops, not
full-page dumps).
