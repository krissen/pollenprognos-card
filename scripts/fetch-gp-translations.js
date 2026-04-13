#!/usr/bin/env node
// scripts/fetch-gp-translations.js
//
// Fetches display names from the Google Pollen API for all supported languages,
// writes the raw translation data to tmp/gp-translations.json, and prints
// generated GP_DISPLAY_NAME_MAP / GP_COLLISION_PLANTS JS snippets to stdout
// for manual insertion into src/adapters/gp/constants.js.
//
// Usage:
//   node scripts/fetch-gp-translations.js [--api-key KEY | --api-key-file PATH]
//
// If no key is provided, tries ./tmp/google-pollen-api.key

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Google Pollen API supported languages (from API docs)
const LANGUAGES = [
  "ar", "bn", "cs", "da", "de", "el", "en", "es", "fi", "fr",
  "gu", "hi", "hu", "id", "it", "ja", "kn", "ko", "ml", "mr",
  "nl", "no", "pl", "pt", "ro", "ru", "sk", "sv", "ta", "te",
  "th", "tr", "uk", "vi", "zh",
];

// Pollen codes from the API (categories)
const CATEGORY_CODES = ["GRASS", "TREE", "WEED"];

// Category keys use special suffixed names; plant keys use the raw API code
// (lowercase). This matches GPL behavior where raw codes are preserved and
// canonicalization only happens at display/icon time.
const CATEGORY_CANONICAL = { GRASS: "grass_cat", TREE: "trees_cat", WEED: "weeds_cat" };
const PLANT_CANONICAL = {
  ALDER: "alder", ASH: "ash", BIRCH: "birch", COTTONWOOD: "cottonwood",
  CYPRESS_PINE: "cypress_pine", ELM: "elm", GRAMINALES: "graminales",
  HAZEL: "hazel", JAPANESE_CEDAR: "japanese_cedar", JUNIPER: "juniper",
  MAPLE: "maple", MUGWORT: "mugwort", OAK: "oak", OLIVE: "olive",
  PINE: "pine", RAGWEED: "ragweed",
};

function parseArgs() {
  const args = process.argv.slice(2);
  let apiKey = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--api-key" && args[i + 1]) {
      apiKey = args[i + 1];
      i++;
    } else if (args[i] === "--api-key-file" && args[i + 1]) {
      apiKey = readFileSync(args[i + 1], "utf-8").trim();
      i++;
    }
  }
  if (!apiKey) {
    try {
      apiKey = readFileSync(resolve(projectRoot, "tmp/google-pollen-api.key"), "utf-8").trim();
    } catch { /* ignore */ }
  }
  if (!apiKey) {
    console.error("No API key. Use --api-key KEY or --api-key-file PATH, or place key in tmp/google-pollen-api.key");
    process.exit(1);
  }
  return apiKey;
}

async function fetchPollen(apiKey, lang, lat, lon) {
  const url = new URL("https://pollen.googleapis.com/v1/forecast:lookup");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("location.latitude", lat);
  url.searchParams.set("location.longitude", lon);
  url.searchParams.set("languageCode", lang);
  url.searchParams.set("days", "1");
  url.searchParams.set("plantsDescription", "false");

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error for lang=${lang}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

function extractNames(data) {
  const names = {};
  const dailyInfo = data.dailyInfo || [];
  if (!dailyInfo.length) return names;

  const day = dailyInfo[0];
  for (const info of [...(day.pollenTypeInfo || []), ...(day.plantInfo || [])]) {
    const code = info.code;
    const displayName = info.displayName;
    if (code && displayName) {
      names[code] = displayName;
    }
  }
  return names;
}

async function main() {
  const apiKey = parseArgs();

  // Use a central European location (Berlin) to get most allergens
  // and a second location (Tokyo) for Asian-specific ones
  const locations = [
    { lat: 52.52, lon: 13.405, label: "Berlin" },
    { lat: 35.6762, lon: 139.6503, label: "Tokyo" },
  ];

  console.log("Fetching display names for", LANGUAGES.length, "languages...\n");

  // lang -> { code -> displayName }
  const allNames = {};
  let requestCount = 0;

  for (const lang of LANGUAGES) {
    allNames[lang] = {};
    for (const loc of locations) {
      try {
        // Burst throttle: 500ms pause every 5 requests
        if (requestCount > 0 && requestCount % 5 === 0) {
          await new Promise((r) => setTimeout(r, 500));
        }
        const data = await fetchPollen(apiKey, lang, loc.lat, loc.lon);
        const names = extractNames(data);
        Object.assign(allNames[lang], names);
        requestCount++;
      } catch (e) {
        console.error(`  Error for ${lang} (${loc.label}):`, e.message);
      }
    }
    const codes = Object.keys(allNames[lang]);
    process.stdout.write(`  ${lang}: ${codes.length} pollen types\n`);
  }

  // Build direct display_name lookup: lowercased name -> allergen key.
  // Category-first: if a name maps to both a category and a plant, the
  // primary map gets the category key; collisionPlants gets the plant key.
  const displayNameMap = {};
  const collisionPlants = {};

  for (const lang of LANGUAGES) {
    for (const [code, displayName] of Object.entries(allNames[lang])) {
      const key = displayName.trim().toLowerCase();
      if (!key) continue;

      if (CATEGORY_CODES.includes(code)) {
        displayNameMap[key] = CATEGORY_CANONICAL[code];
      } else if (PLANT_CANONICAL[code]) {
        const plantKey = PLANT_CANONICAL[code];
        if (displayNameMap[key] && Object.values(CATEGORY_CANONICAL).includes(displayNameMap[key])) {
          // Collision: this name is already a category; store plant separately
          collisionPlants[key] = plantKey;
        } else if (!displayNameMap[key]) {
          displayNameMap[key] = plantKey;
        }
      }
    }
  }

  // Output
  const sortedMain = Object.entries(displayNameMap).sort(([a], [b]) => a.localeCompare(b));
  const sortedCollisions = Object.entries(collisionPlants).sort(([a], [b]) => a.localeCompare(b));

  console.log("\n=== GP_DISPLAY_NAME_MAP (for src/adapters/gp/constants.js) ===\n");
  console.log(`// ${sortedMain.length} entries across ${LANGUAGES.length} languages`);
  console.log("export const GP_DISPLAY_NAME_MAP = {");
  for (const [name, canonical] of sortedMain) {
    const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    console.log(`  "${escaped}": "${canonical}",`);
  }
  console.log("};");

  console.log(`\n=== GP_COLLISION_PLANTS (for src/adapters/gp/constants.js) ===\n`);
  console.log(`// ${sortedCollisions.length} entries where GRASS category and GRAMINALES plant share display_name`);
  console.log("export const GP_COLLISION_PLANTS = {");
  for (const [name, canonical] of sortedCollisions) {
    const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    console.log(`  "${escaped}": "${canonical}",`);
  }
  console.log("};");

  // Write machine-readable JSON for reference
  const output = {
    generated: new Date().toISOString(),
    languages: LANGUAGES,
    displayNameMap,
    collisionPlants,
    rawNames: allNames,
  };
  const outPath = resolve(projectRoot, "tmp/gp-translations.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nFull data written to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
