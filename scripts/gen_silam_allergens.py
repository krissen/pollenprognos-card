import json
import os
import re
import unicodedata

"""
scripts/gen_silam_allergens.py

Purpose: Generate possible allergen names for silam_pollen,
    using the translation files in the integration. Necessary
    to be able to automatically read in allergens for silam,
    regardless of the users locale.

How to use: python3 scripts/gen_silam_allergens.py

Result: Writes a JSON file with allergen names and slug mappings
    in OUT_FILE

Prerequisite: have silam_pollen in ../silam_pollen -directory or
    adjust TRANSLATIONS_DIR according to your setup.
"""


TRANSLATIONS_DIR = "../silam_pollen/custom_components/silam_pollen/translations"
OUT_FILE = "./src/adapters/silam_allergen_map.json"

def normalize(text):
    if not text:
        return ""
    # Unicode NFD, ta bort diakritiska marks
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != 'Mn')
    text = text.lower()
    # Ersätt allt icke-alnum med _
    text = re.sub(r'[^a-z0-9]+', '_', text)
    # Trimma ledande/följande _
    text = re.sub(r'^_+|_+$', '', text)
    return text

def main():
    result = {}
    master_eng = {}
    with open(os.path.join(TRANSLATIONS_DIR, "en.json"), encoding="utf-8") as f:
        en_data = json.load(f)
        sensor = en_data["entity"]["sensor"]
        for key in sensor:
            if key in ("index", "fetch_duration"):
                continue
            eng_name = sensor[key].get("name", key)
            master_eng[key] = {
                "slug": key,
                "name": eng_name
            }
    for fname in os.listdir(TRANSLATIONS_DIR):
        if not fname.endswith(".json"):
            continue
        lang = fname.split(".")[0]
        with open(os.path.join(TRANSLATIONS_DIR, fname), encoding="utf-8") as f:
            data = json.load(f)
            sensor = data.get("entity", {}).get("sensor", {})
            mapping = {}
            for key, info in sensor.items():
                if key in ("index", "fetch_duration"):
                    continue
                if lang == "en":
                    # Bara engelska sluggar i engelska mappningen
                    mapping[key] = key
                else:
                    # Lokal slug
                    local_name = info.get("name", key)
                    local_slug = normalize(local_name)
                    # Undvik dubletter: bara lokalt namn om det skiljer sig från engelsk slug
                    if local_slug != key:
                        mapping[local_slug] = key
            result[lang] = mapping
    # Bygg reverse-namn-lookup också
    names_by_lang = {}
    for fname in os.listdir(TRANSLATIONS_DIR):
        if not fname.endswith(".json"):
            continue
        lang = fname.split(".")[0]
        with open(os.path.join(TRANSLATIONS_DIR, fname), encoding="utf-8") as f:
            data = json.load(f)
            sensor = data.get("entity", {}).get("sensor", {})
            for key, info in sensor.items():
                if key in ("index", "fetch_duration"):
                    continue
                if key not in names_by_lang:
                    names_by_lang[key] = {}
                names_by_lang[key][lang] = info.get("name", key)
    out = {
        "mapping": result,
        "names": names_by_lang
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"Wrote {OUT_FILE}")

if __name__ == "__main__":
    main()

