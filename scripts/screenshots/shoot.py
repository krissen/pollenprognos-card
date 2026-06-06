#!/usr/bin/env python3
"""Capture documentation/release screenshots from the hass-test dashboard.

Reproducible generator for pollenprognos-card docs imagery. Auth is via the
hass-test long-lived token injected into localStorage (HASS_TOKEN env var, kept
out of git). It waits for the card/badge custom elements to finish loading
(no empty `.ppb-empty` placeholders) before shooting, so slow-loading
integrations don't produce empty pills.

Usage:
    export HASS_TOKEN=<long-lived token>   # never commit this
    python shoot.py --view pollen-test/documentation --badges out.png
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get("HASS_URL", "http://localhost:8123")
TOKEN = os.environ.get("HASS_TOKEN", "")

def tokens_init():
    t = {"access_token": TOKEN, "token_type": "Bearer", "expires_in": 315360000,
         "hassUrl": URL, "clientId": None, "expires": 2095679825000, "refresh_token": ""}
    theme = {"dark": False}
    return ("window.localStorage.setItem('hassTokens', %s);"
            "window.localStorage.setItem('selectedTheme', %s);"
            % (json.dumps(json.dumps(t)), json.dumps(json.dumps(theme))))

def wait_ready(page, timeout_s=30):
    """Wait until pollen elements are present and no badge shows the empty
    placeholder. Returns seconds waited."""
    start = time.time()
    while time.time() - start < timeout_s:
        n_badge = page.locator("pollenprognos-badge").count()
        n_card = page.locator("pollenprognos-card").count()
        # .ppb-empty is the badge's not-loaded / no-pick placeholder
        empties = page.evaluate(
            "() => document.querySelectorAll('pollenprognos-badge').length && "
            "[...document.querySelectorAll('pollenprognos-badge')]"
            ".filter(b=>b.shadowRoot && b.shadowRoot.querySelector('.ppb-empty')).length")
        if (n_badge or n_card) and not empties:
            return round(time.time() - start, 1)
        page.wait_for_timeout(500)
    return round(time.time() - start, 1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--view", required=True)
    ap.add_argument("--badges", help="output path: screenshot the badge row")
    ap.add_argument("--card", type=int, help="index of pollenprognos-card to shoot")
    ap.add_argument("--out", help="output path for --card")
    ap.add_argument("--timeout", type=int, default=30)
    a = ap.parse_args()
    if not TOKEN:
        print("ERROR: set HASS_TOKEN", file=sys.stderr); sys.exit(2)
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 1500, "height": 1000}, device_scale_factor=2)
        ctx.add_init_script(tokens_init())
        pg = ctx.new_page()
        pg.goto(f"{URL}/{a.view}", wait_until="networkidle")
        waited = wait_ready(pg, a.timeout)
        empties = pg.evaluate(
            "() => [...document.querySelectorAll('pollenprognos-badge')]"
            ".filter(b=>b.shadowRoot && b.shadowRoot.querySelector('.ppb-empty')).length")
        print(f"view={a.view} waited={waited}s badges={pg.locator('pollenprognos-badge').count()} "
              f"cards={pg.locator('pollenprognos-card').count()} empties_remaining={empties}")
        if a.badges:
            pg.locator("hui-view-badges").screenshot(path=a.badges)
            print("saved", a.badges)
        if a.card is not None and a.out:
            el = pg.locator("pollenprognos-card").nth(a.card)
            el.scroll_into_view_if_needed(); pg.wait_for_timeout(400)
            el.screenshot(path=a.out)
            print("saved", a.out)
        b.close()

if __name__ == "__main__":
    main()
