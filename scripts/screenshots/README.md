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

Card and badge configs live under `docs/screenshots/fixtures/` so the image set
is reproducible:

- `integration-cards.json` — one card per integration (`int-<id>.png`, plus `msw-zurich.png`)
- `feature-cards.json` — hero, feature (icon/value-in-ring, minimal), summary, modes
- `badge-row.json` — the curated badge-variant row
- `hero-badges.json` — the compact README badge block (see its `_note`)

`build_fixtures.py` applies the curated badge row to the stock tabs (All
Integrations, Modes) and to a dedicated **Documentation** view, live over the HA
WebSocket API (no restart). The QA `#235 badge` view is left untouched.

```bash
python build_fixtures.py
```

## Capture

`capture_docs.py` is the main generator: it shoots each card in its own
throwaway single-card view (avoids masonry cross-bleed and stays stable against
edits to the shared QA tabs), driven by the fixtures above. Readiness is checked
through a locator handle (which pierces the card's shadow DOM), so a slow
integration right after an HA restart doesn't produce empty pills. Always review
each image.

```bash
python capture_docs.py                              # all single-card shots + badge row
python capture_docs.py --only feature-minimal.png   # a subset
```

`capture_editors.py` opens the card/badge visual editor and screenshots the
editor element (the `ha-dialog` wrapper is portaled and has zero box):

```bash
python capture_editors.py            # editor-card.png + editor-badge.png
```

It drives the UI without matching any translated label (edit mode via `?edit=1`,
edit controls via their structure inside `hui-card-options` /
`hui-badge-edit-mode`), so it runs against an HA instance in any language. The
resulting screenshots still show the instance's UI language, so shoot the
committed docs images against an English-language HA.

`shoot.py` is a thin helper for ad-hoc shots (a badge row or a card by index in
a given view).

The README badge block (`hero-badges.png`) is shot manually: apply
`fixtures/hero-badges.json` as a view's `badges:`, open it at a narrow viewport
(~210 px) so the badges wrap into a compact block, and screenshot
`hui-view-badges`.

Images render in the HA UI language (English via the browser locale by default);
avoid fixture cards that pin a `date_locale`. Keep PNGs lean (element crops, not
full-page dumps).
