#!/usr/bin/env python3
"""Apply curated documentation fixtures to the hass-test pollen-test dashboard.

Adds a curated badge row (varied visual/content modes, low repetition) to the
stock tabs (All Integrations, Modes) and a dedicated 'Documentation' view, via
the live HA WebSocket API (no restart). Idempotent: re-running replaces the
Documentation view and refreshes the stock-tab badge rows. Token from HASS_TOKEN.
"""
import json, os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("HASS_URL", "http://localhost:8123")
TOKEN = os.environ.get("HASS_TOKEN", "")
DASH = "pollen-test"

# Curated, varied badge row (see docs/screenshots/fixtures/badge-row.json).
CURATED = json.load(open(os.path.join(os.path.dirname(__file__),
                    "..", "..", "docs", "screenshots", "fixtures", "badge-row.json")))

HERO = {"type": "custom:pollenprognos-card", "integration": "pp", "city": "manual",
        "entity_prefix": "pollen_forshaga", "allergens": ["Al", "Björk", "Gräs", "Hassel"]}

def tokens_init():
    t = {"access_token": TOKEN, "token_type": "Bearer", "expires_in": 315360000,
         "hassUrl": URL, "clientId": None, "expires": 2095679825000, "refresh_token": ""}
    return "window.localStorage.setItem('hassTokens', %s);" % json.dumps(json.dumps(t))

def main():
    if not TOKEN: print("set HASS_TOKEN", file=sys.stderr); sys.exit(2)
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(); ctx.add_init_script(tokens_init())
        pg = ctx.new_page(); pg.goto(URL, wait_until="networkidle"); pg.wait_for_timeout(2500)
        cfg = pg.evaluate("async () => await document.querySelector('home-assistant').hass.callWS({type:'lovelace/config', url_path:'%s'})" % DASH)
        views = cfg["views"]
        # stock tabs: All Integrations (path 'all'), Modes (path 'modes') get the badge row
        for v in views:
            if v.get("path") in ("all", "modes"):
                v["badges"] = list(CURATED)
        # Documentation view: replace if present else append
        doc = {"title": "Documentation", "path": "documentation",
               "badges": list(CURATED), "cards": [HERO]}
        views = [v for v in views if v.get("path") != "documentation"] + [doc]
        cfg["views"] = views
        pg.evaluate("async (cfg) => await document.querySelector('home-assistant').hass.callWS({type:'lovelace/config/save', url_path:'%s', config:cfg})" % DASH, cfg)
        print("saved. views now:", [v.get("path") for v in views])
        b.close()

if __name__ == "__main__":
    main()
