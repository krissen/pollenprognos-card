#!/usr/bin/env python3
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

LOCALES_DIR = Path(__file__).parent.parent / "src/locales"
MASTER = "en.json"

ICON_OK = "✅"
ICON_WARN = "⚠️"
ICON_ADD = "➕"
ICON_DEL = "❌"

JS_FILES_TO_SCAN = [
        Path(__file__).parent.parent / "src/pollenprognos-card.js",
        Path(__file__).parent.parent / "src/pollenprognos-editor.js",
]

def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(data.items())), f, ensure_ascii=False, indent=2)

def find_missing_and_redundant():
    files = sorted([f for f in LOCALES_DIR.glob("*.json")])
    master_path = LOCALES_DIR / MASTER
    if not master_path.exists():
        print(f"{ICON_WARN} Master file {master_path} not found.")
        sys.exit(1)
    master = load_json(master_path)
    missing_per_lang = defaultdict(list)
    redundant_per_lang = defaultdict(list)
    for file in files:
        if file.name == MASTER:
            continue
        data = load_json(file)
        for key in master:
            if key not in data:
                missing_per_lang[file.stem].append(key)
        for key in data:
            if key not in master:
                redundant_per_lang[file.stem].append(key)
    return master, missing_per_lang, redundant_per_lang

def find_used_keys_in_js():
    used_keys = set()
    for js_file in JS_FILES_TO_SCAN:
        if js_file.exists():
            content = js_file.read_text(encoding="utf-8")
            # Prefix: editor. för -editor.js, card. för -card.js, annars ingen
            if js_file.name.endswith("-editor.js"):
                prefix = "editor."
            elif js_file.name.endswith("-card.js"):
                prefix = "card."
            else:
                prefix = ""
            # Hitta alla this._t("key") och this._t('key')
            matches = re.findall(r'this\._t\(\s*["\']([a-zA-Z0-9_.-]+)["\']\s*\)', content)
            for match in matches:
                if not match.startswith("editor.") and not match.startswith("card."):
                    used_keys.add(f"{prefix}{match}")
                else:
                    used_keys.add(match)
    return used_keys

def scan_missing():
    master, missing_per_lang, redundant_per_lang = find_missing_and_redundant()

    # Kolla vilka nycklar som används i JS men saknas i en.json
    used_keys = find_used_keys_in_js()
    missing_in_master = sorted(used_keys - set(master.keys()))
    if missing_in_master:
        print(f"{ICON_WARN} Nycklar som används i JS men saknas i {MASTER}:")
        for key in missing_in_master:
            print(f"  {ICON_WARN} '{key}' används i JS-filer men finns ej i {MASTER}")

    # Rapportera saknade per språk
    if not missing_per_lang:
        print(f"{ICON_OK} Alla språkfiler har alla nycklar från master.")
    else:
        print(f"{ICON_ADD} Saknade nycklar:")
        for key in master:
            saknas_i = [lang for lang, keys in missing_per_lang.items() if key in keys]
            if saknas_i:
                print(
                    f"  {ICON_WARN} '{key}' (\"{master[key]}\" i {MASTER}) saknas i:\n      {', '.join(saknas_i)}"
                )
    # Rapportera redundanta (överflödiga)
    all_redundant_keys = defaultdict(list)
    for lang, keys in redundant_per_lang.items():
        for key in keys:
            all_redundant_keys[key].append(lang)
    if all_redundant_keys:
        print(f"\n{ICON_DEL} Överflödiga nycklar (finns ej i {MASTER}):")
        for key, langs in all_redundant_keys.items():
            print(f"  {ICON_DEL} '{key}' finns i: {', '.join(langs)}")
def gen_translation_json():
    master, missing_per_lang, _ = find_missing_and_redundant()
    output = defaultdict(dict)
    for lang, keys in missing_per_lang.items():
        for key in keys:
            output[lang][key] = master[key]
    if output:
        output_text = (
            "\n# Översätt nedan till respektive språk:\n\n"
            + json.dumps(output, ensure_ascii=False, indent=2)
            + "\n\n---\n"
            + "Spara översättningarna till fil och kör:\n\n"
            + f"  python3 {Path(__file__).name} update path/till/oversattning.json\n"
        )
        print(output_text)
        try:
            subprocess.run("pbcopy", input=output_text, text=True, check=True)
            print(f"{ICON_OK} JSON + instruktion kopierad till clipboard (pbcopy)")
        except Exception as e:
            print(f"{ICON_WARN} Kunde inte kopiera till clipboard: {e}")
    else:
        print(f"{ICON_OK} Alla språkfiler har redan alla nycklar från master.")
def update_with_translation(json_path, force=False):
    with open(json_path, encoding="utf-8") as f:
        translation = json.load(f)
    for lang, keys in translation.items():
        loc_file = LOCALES_DIR / (lang + ".json")
        if not loc_file.exists():
            print(f"{ICON_WARN} Språkfil saknas: {loc_file}")
            continue
        data = load_json(loc_file)
        count_new = 0
        count_updated = 0
        for key, val in keys.items():
            if key not in data:
                data[key] = val
                count_new += 1
            elif force:
                old_val = data[key]
                if data[key] != val:
                    data[key] = val
                    count_updated += 1
        if count_new or (force and count_updated):
            save_json(loc_file, data)
            msg = f"{ICON_OK} {lang}.json: {count_new} nya nycklar inlagda"
            if force and count_updated:
                msg += f", {count_updated} uppdaterade (force=True)"
            print(msg)
        else:
            msg = f"{ICON_OK} {lang}.json: inga nya nycklar inlagda"
            if force:
                msg += " (force=True)"
            print(msg)

def delete_redundant():
    _, _, redundant_per_lang = find_missing_and_redundant()
    files = sorted([f for f in LOCALES_DIR.glob("*.json")])
    master_path = LOCALES_DIR / MASTER
    master = load_json(master_path)
    total_removed = 0
    for file in files:
        if file.name == MASTER:
            continue
        data = load_json(file)
        redundant = [key for key in data if key not in master]
        if redundant:
            for key in redundant:
                del data[key]
            save_json(file, data)
            print(f"{ICON_DEL} {file.name}: tog bort {len(redundant)} överflödiga nycklar: {', '.join(redundant)}")
            total_removed += len(redundant)
        else:
            print(f"{ICON_OK} {file.name}: inga överflödiga nycklar.")
    if total_removed == 0:
        print(f"{ICON_OK} Inga överflödiga nycklar att ta bort.")
    else:
        print(f"{ICON_DEL} Totalt borttagna nycklar: {total_removed}")

if __name__ == "__main__":
    # Argumenthantering: identifiera vilka kommandon som ska köras
    cmds = []
    update_file = None
    force = False
    args = sys.argv[1:]  # Ta bort scriptnamnet

    # Identifiera kommandon och filargument
    for i, arg in enumerate(args):
        arg_l = arg.lower()
        if arg_l in ("scan", "gen", "update", "clean"):
            cmds.append(arg_l)
        elif arg_l in ("--force", "-f"):
            force = True
        elif arg.endswith(".json"):
            update_file = arg
        # Ignorera okända, så vi kan lägga till fler i framtiden

    if not cmds:
        cmds = ["scan"]  # default

    # Alltid i given ordning
    for cmd in cmds:
        if cmd == "scan":
            scan_missing()
        elif cmd == "gen":
            gen_translation_json()
        elif cmd == "update":
            if update_file:
                update_with_translation(update_file, force=force)
            else:
                print(f"{ICON_WARN} Ingen översättningsfil angiven till update.")
        elif cmd == "clean":
            delete_redundant()
        else:
            print(f"{ICON_WARN} Okänt kommando: {cmd}")

    if not cmds or all(cmd not in ("scan", "gen", "update", "clean") for cmd in cmds):
        print(
            "\nUsage:\n"
            f"  python3 {Path(__file__).name} scan\n"
            f"  python3 {Path(__file__).name} gen\n"
            f"  python3 {Path(__file__).name} update oversattning.json [--force|-f]\n"
            f"  python3 {Path(__file__).name} clean\n"
            "\nDu kan kombinera flera kommandon i valfri ordning, t.ex.:\n"
            f"  python3 {Path(__file__).name} update oversattning.json clean\n"
        )

