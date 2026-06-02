#!/usr/bin/env python3
"""Capture the documentation image set, reproducibly, from committed fixtures.

Each card is shot in its own throwaway single-card "docshot" view, written live
via the HA WebSocket API. Shooting one card per view avoids masonry cross-bleed
between adjacent tall cards and is stable against edits to the shared QA tabs
(the older index-into-a-shared-view approach broke whenever a tab was reordered).

Card configs live in committed fixtures so the set is reproducible:
  docs/screenshots/fixtures/integration-cards.json  -> int-<id>.png + msw-zurich.png
  docs/screenshots/fixtures/feature-cards.json      -> hero/feature/summary/modes
The curated badge row is shot from the Documentation view (build_fixtures.py).

Auth: hass-test long-lived token in HASS_TOKEN (never committed). Readiness is
checked through a Playwright locator handle, which pierces the card's shadow DOM
(a raw document.querySelector does not), so slow integrations don't shoot empty.

Usage:
    export HASS_TOKEN=<long-lived token>
    python capture_docs.py                       # all single-card shots + badge row
    python capture_docs.py --only feature-minimal.png,feature-icon-in-ring.png
    python capture_docs.py --no-badges           # skip the badge-row shot
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get("HASS_URL", "http://localhost:8123")
TOKEN = os.environ.get("HASS_TOKEN", "")
DASH = "pollen-test"
HERE = os.path.dirname(__file__)
FIX = os.path.join(HERE, "..", "..", "docs", "screenshots", "fixtures")
OUT = os.path.join(HERE, "..", "..", "docs", "screenshots")


def load(name):
    return json.load(open(os.path.join(FIX, name)))


def tokens_init():
    t = {"access_token": TOKEN, "token_type": "Bearer", "expires_in": 315360000,
         "hassUrl": URL, "clientId": None, "expires": 2095679825000, "refresh_token": ""}
    return ("window.localStorage.setItem('hassTokens', %s);"
            "window.localStorage.setItem('selectedTheme', %s);"
            % (json.dumps(json.dumps(t)), json.dumps(json.dumps({"dark": False}))))


def save_config(pg, cfg):
    # Save while parked on /profile: saving the dashboard we are viewing tears
    # down the page's JS context mid-call ("Execution context was destroyed").
    pg.goto(f"{URL}/profile", wait_until="networkidle")
    pg.wait_for_timeout(500)
    pg.evaluate(
        "async (c) => await document.querySelector('home-assistant')"
        ".hass.callWS({type:'lovelace/config/save', url_path:'%s', config:c})" % DASH,
        cfg,
    )


def wait_card(pg, timeout_s=40):
    """Wait until the lone pollenprognos-card has rendered an ha-card with
    content, via a locator handle (pierces shadow DOM)."""
    card = pg.locator("pollenprognos-card").first
    card.wait_for(state="attached", timeout=timeout_s * 1000)
    start = time.time()
    while time.time() - start < timeout_s:
        ok = card.evaluate(
            "c => !!(c.shadowRoot && c.shadowRoot.querySelector('ha-card') "
            "&& c.shadowRoot.textContent.trim().length > 5)")
        if ok:
            break
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(1800)  # let Chart.js rings paint
    return card


def wait_badges(pg, timeout_s=40):
    start = time.time()
    while time.time() - start < timeout_s:
        n = pg.locator("pollenprognos-badge").count()
        empties = pg.evaluate(
            "() => [...document.querySelectorAll('pollenprognos-badge')]"
            ".filter(b=>b.shadowRoot && b.shadowRoot.querySelector('.ppb-empty')).length")
        if n and not empties:
            break
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(800)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated output filenames to shoot")
    ap.add_argument("--no-badges", action="store_true")
    a = ap.parse_args()
    if not TOKEN:
        print("ERROR: set HASS_TOKEN", file=sys.stderr); sys.exit(2)

    cards = {**load("integration-cards.json"), **load("feature-cards.json")}
    if a.only:
        want = {s.strip() for s in a.only.split(",")}
        cards = {k: v for k, v in cards.items() if k in want}
        missing = want - set(cards)
        if missing:
            print("WARN: unknown filenames ignored:", missing, file=sys.stderr)

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 1100, "height": 2600}, device_scale_factor=2)
        ctx.add_init_script(tokens_init())
        pg = ctx.new_page()
        pg.goto(f"{URL}/profile", wait_until="networkidle"); pg.wait_for_timeout(1500)
        full = pg.evaluate(
            "async () => await document.querySelector('home-assistant')"
            ".hass.callWS({type:'lovelace/config', url_path:'%s'})" % DASH)
        base = [v for v in full["views"] if v.get("path") != "docshot"]

        for fn, cfg in cards.items():
            full["views"] = base + [{"title": "docshot", "path": "docshot", "cards": [cfg]}]
            save_config(pg, full)
            pg.goto(f"{URL}/{DASH}/docshot", wait_until="networkidle")
            card = wait_card(pg)
            card.screenshot(path=os.path.join(OUT, fn))
            print("saved", fn)

        if not a.no_badges and not a.only:
            pg.goto(f"{URL}/{DASH}/documentation", wait_until="networkidle")
            wait_badges(pg)
            pg.locator("hui-view-badges").screenshot(path=os.path.join(OUT, "badge-row.png"))
            print("saved badge-row.png")

        # remove the throwaway docshot view
        full["views"] = base
        save_config(pg, full)
        b.close()


if __name__ == "__main__":
    main()
