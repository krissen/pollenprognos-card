#!/usr/bin/env python3
import json
import sys
from collections import defaultdict
from pathlib import Path

LOCALES_DIR = Path(__file__).parent.parent / "src/locales"
MASTER = "en.json"


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    # Spara med alfabetisk ordning
    with open(path, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(data.items())), f, ensure_ascii=False, indent=2)


def scan_missing():
    files = sorted([f for f in LOCALES_DIR.glob("*.json")])
    master_path = LOCALES_DIR / MASTER
    if not master_path.exists():
        print(f"Master file {master_path} not found")
        sys.exit(1)
    master = load_json(master_path)

    # Samla saknade nycklar per språk
    missing_per_lang = defaultdict(list)
    for file in files:
        if file.name == MASTER:
            continue
        data = load_json(file)
        for key in master:
            if key not in data:
                missing_per_lang[file.stem].append(key)

    if not missing_per_lang:
        print("✔ Alla språkfiler har alla nycklar från master")
        return

    # Rapportera
    for key in master:
        saknas_i = [lang for lang, keys in missing_per_lang.items() if key in keys]
        if saknas_i:
            print(
                f"Nyckel '{key}' (\"{master[key]}\" i {MASTER}) saknas i: {', '.join(saknas_i)}"
            )

    # Skapa format för översättning
    output = defaultdict(dict)
    for lang, keys in missing_per_lang.items():
        for key in keys:
            output[lang][key] = master[key]
    if output:
        print("\n\n# Översätt följande nycklar till respektive språk:\n")
        print(json.dumps(output, ensure_ascii=False, indent=2))
        print("\n---")
        print("Då översättningen är klar, spara JSON till fil och kör:\n")
        print("  python3 gen_locales.py update path/till/oversattning.json")


def update_with_translation(json_path, force=False):
    with open(json_path, encoding="utf-8") as f:
        translation = json.load(f)
    for lang, keys in translation.items():
        loc_file = LOCALES_DIR / (lang + ".json")
        if not loc_file.exists():
            print(f"Varnar: Språkfil saknas: {loc_file}")
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
            msg = f"{lang}.json: {count_new} nya nycklar inlagda"
            if force and count_updated:
                msg += f", {count_updated} uppdaterade (force=True)"
            print(msg)
        else:
            msg = f"{lang}.json: inga nya nycklar inlagda"
            if force:
                msg += " (force=True)"
            print(msg)


if __name__ == "__main__":
    # Argumenthantering: stöd för --force (eller -f) som sista argument
    force = False
    args = sys.argv
    if "--force" in args:
        force = True
        args.remove("--force")
    elif "-f" in args:
        force = True
        args.remove("-f")
    if len(args) == 1 or args[1] == "scan":
        scan_missing()
    elif args[1] == "update" and len(args) == 3:
        update_with_translation(args[2], force=force)
    else:
        print(
            "Usage:\n"
            "  python3 gen_locales.py scan\n"
            "  python3 gen_locales.py update oversattning.json [--force|-f]"
        )
