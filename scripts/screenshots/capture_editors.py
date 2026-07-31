#!/usr/bin/env python3
"""Capture the visual-editor screenshots (card editor + badge editor).

Opens the Home Assistant card/badge editor for a pollenprognos element and
screenshots the editor custom element itself. The editor lives in an
`ha-dialog` whose own box has zero height (the content is portaled), so the
dialog wrapper cannot be screenshotted directly; the `pollenprognos-card-editor`
/ `pollenprognos-badge-editor` element does have a real box and is shot instead.

Flow: write a throwaway single-card + single-badge "docedit" view live via the
HA WebSocket API, enter dashboard edit mode, click the element's edit control,
then shoot the editor element. The view is removed afterwards.

Locale independence: nothing here matches on translated UI text, so the script
works against a Home Assistant in any language. Edit mode is entered through
HA's own `?edit=1` URL parameter instead of clicking a translated "Edit
dashboard" control, and the per-element edit controls are found by their
structural position inside `hui-card-options` / `hui-badge-edit-mode`.

Auth: hass-test long-lived token in HASS_TOKEN (never committed).

Usage:
    export HASS_TOKEN=<long-lived token>
    python capture_editors.py            # both: editor-card.png, editor-badge.png
    python capture_editors.py card       # only the card editor
    python capture_editors.py badge      # only the badge editor
"""
import json, os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("HASS_URL", "http://localhost:8123")
TOKEN = os.environ.get("HASS_TOKEN", "")
DASH = "pollen-test"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "screenshots")

CARD = {"type": "custom:pollenprognos-card", "integration": "pp", "city": "manual",
        "entity_prefix": "pollen_forshaga", "allergens": ["Al", "Björk", "Gräs", "Hassel"]}
BADGE = {"type": "custom:pollenprognos-badge", "integration": "pp", "city": "manual",
         "entity_prefix": "pollen_forshaga", "badge_content": "worst",
         "badge_visual": "icon_in_ring", "badge_show_label": True}


def tokens_init():
    t = {"access_token": TOKEN, "token_type": "Bearer", "expires_in": 315360000,
         "hassUrl": URL, "clientId": None, "expires": 2095679825000, "refresh_token": ""}
    return ("window.localStorage.setItem('hassTokens', %s);"
            "window.localStorage.setItem('selectedTheme', %s);"
            % (json.dumps(json.dumps(t)), json.dumps(json.dumps({"dark": False}))))


def hass_save(pg, cfg):
    pg.goto(f"{URL}/profile", wait_until="networkidle")
    for _ in range(40):
        if pg.evaluate("()=>!!(document.querySelector('home-assistant')"
                       "&&document.querySelector('home-assistant').hass)"):
            break
        pg.wait_for_timeout(300)
    pg.evaluate("async(c)=>await document.querySelector('home-assistant')"
                ".hass.callWS({type:'lovelace/config/save', url_path:'%s', config:c})" % DASH, cfg)


def poll(pg, sel, t=15000):
    waited = 0
    while waited < t:
        if pg.locator(sel).count():
            return True
        pg.wait_for_timeout(500); waited += 500
    return False


# Structural (untranslated) handles on the per-element edit controls in edit
# mode. The card's edit button is the only ha-button that is a direct child of
# the .card-actions row in hui-card-options (the reorder/overflow buttons sit in
# a nested .right div). The badge's edit control is the .edit hit area that
# hui-badge-edit-mode overlays on the badge.
CARD_EDIT = "hui-card-options .card-actions > ha-button"
BADGE_EDIT = "hui-badge-edit-mode .badge-overlay .edit"
KINDS = ("card", "badge")


def editor_tag(kind):
    return f"pollenprognos-{kind}-editor"


def click_center(pg, sel):
    """Click the middle of a located element by coordinates. Both edit controls
    live inside a shadow root whose host swallows Playwright's actionability
    hit-test ("<hui-badge-edit-mode> intercepts pointer events"), so a plain
    locator click is not reliable here."""
    bb = pg.locator(sel).first.bounding_box()
    if not bb:
        return False
    pg.mouse.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
    return True


def open_editor(pg, kind):
    # ?edit=1 is HA's own URL entry into dashboard edit mode, so we never need to
    # click a control whose label is translated.
    pg.goto(f"{URL}/{DASH}/docedit?edit=1", wait_until="networkidle")
    pg.wait_for_timeout(3000)
    sel = CARD_EDIT if kind == "card" else BADGE_EDIT
    if not poll(pg, sel):
        print(f"ERROR: {kind} edit control ({sel}) never appeared; "
              "is the dashboard in edit mode?", file=sys.stderr)
        return False
    if not click_center(pg, sel):
        print(f"ERROR: {kind} edit control has no layout box", file=sys.stderr)
        return False
    return poll(pg, editor_tag(kind))


def main():
    if not TOKEN:
        print("ERROR: set HASS_TOKEN", file=sys.stderr); sys.exit(2)
    kinds = [sys.argv[1]] if len(sys.argv) > 1 else list(KINDS)
    if any(k not in KINDS for k in kinds):
        print("ERROR: usage: capture_editors.py [card|badge]", file=sys.stderr)
        sys.exit(2)
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 1000, "height": 1700}, device_scale_factor=2)
        ctx.add_init_script(tokens_init())
        pg = ctx.new_page()
        pg.goto(f"{URL}/profile", wait_until="networkidle"); pg.wait_for_timeout(1500)
        full = pg.evaluate("async()=>await document.querySelector('home-assistant')"
                           ".hass.callWS({type:'lovelace/config', url_path:'%s'})" % DASH)
        base = [v for v in full["views"] if v.get("path") != "docedit"]
        full["views"] = base + [{"title": "docedit", "path": "docedit",
                                 "badges": [BADGE], "cards": [CARD]}]
        hass_save(pg, full)
        for kind in kinds:
            ok = open_editor(pg, kind)
            print(f"{kind} editor present:", ok)
            if ok:
                pg.wait_for_timeout(1500)
                pg.locator(editor_tag(kind)).first.screenshot(
                    path=os.path.join(OUT, f"editor-{kind}.png"))
                print(f"saved editor-{kind}.png")
        full["views"] = base
        hass_save(pg, full)
        b.close()


if __name__ == "__main__":
    main()
