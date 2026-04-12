#!/usr/bin/env node
// scripts/fetch-gp-translations.js
//
// Fetches display names from the Google Pollen API for all supported languages
// and generates GP_CATEGORY_MAP and GP_ALIASES data for src/adapters/gp/constants.js
//
// Usage:
//   node scripts/fetch-gp-translations.js [--api-key KEY | --api-key-file PATH]
//
// If no key is provided, tries ./tmp/google-pollen-api.key

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { slugify } from "../src/utils/slugify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Google Pollen API supported languages (from API docs)
const LANGUAGES = [
  "ar", "bn", "cs", "da", "de", "el", "en", "es", "fi", "fr",
  "gu", "hi", "hu", "id", "it", "ja", "kn", "ko", "ml", "mr",
  "nl", "no", "pl", "pt", "ro", "ru", "sk", "sv", "ta", "te",
  "th", "tr", "uk", "vi", "zh",
];

// Pollen codes from the API (categories + plants)
const CATEGORY_CODES = ["GRASS", "TREE", "WEED"];
const PLANT_CODES = [
  "ALDER", "ASH", "BIRCH", "COTTONWOOD", "CYPRESS_PINE", "ELM",
  "GRAMINALES", "HAZEL", "JAPANESE_CEDAR", "JUNIPER", "MAPLE",
  "MUGWORT", "OAK", "OLIVE", "PINE", "RAGWEED",
];

// Canonical keys for our card
const CATEGORY_CANONICAL = { GRASS: "grass_cat", TREE: "trees_cat", WEED: "weeds_cat" };
const PLANT_CANONICAL = {
  ALDER: "alder", ASH: "ash", BIRCH: "birch", COTTONWOOD: "poplar",
  CYPRESS_PINE: "cypress", ELM: "elm", GRAMINALES: "grass",
  HAZEL: "hazel", JAPANESE_CEDAR: "cypress", JUNIPER: "cypress",
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
        // Rate limit: ~2 requests per second
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

  // Build category map: slug -> canonical key
  const categoryMap = {};
  // Build plant aliases: slug -> canonical key
  const plantAliases = {};
  // Track which slugs are ambiguous (same slug maps to different canonical keys)
  const slugConflicts = new Map();

  for (const lang of LANGUAGES) {
    for (const [code, displayName] of Object.entries(allNames[lang])) {
      const slug = slugify(displayName);
      if (!slug || slug === "unknown") continue;

      if (CATEGORY_CODES.includes(code)) {
        const canonical = CATEGORY_CANONICAL[code];
        if (categoryMap[slug] && categoryMap[slug] !== canonical) {
          if (!slugConflicts.has(slug)) slugConflicts.set(slug, new Set());
          slugConflicts.get(slug).add(`${lang}:${code}=${displayName}`);
        }
        categoryMap[slug] = canonical;
      } else if (PLANT_CANONICAL[code]) {
        const canonical = PLANT_CANONICAL[code];
        // Skip if this slug is also a category (category takes priority)
        if (!categoryMap[slug]) {
          if (plantAliases[slug] && plantAliases[slug] !== canonical) {
            if (!slugConflicts.has(slug)) slugConflicts.set(slug, new Set());
            slugConflicts.get(slug).add(`${lang}:${code}=${displayName}`);
          }
          plantAliases[slug] = canonical;
        }
      }
    }
  }

  // Remove entries where slug === canonical (no translation needed)
  for (const [slug, canonical] of Object.entries(plantAliases)) {
    if (slug === canonical) delete plantAliases[slug];
  }
  // Remove trivial category entries
  const trivialCategories = { grass: "grass_cat", tree: "trees_cat", weed: "weeds_cat" };
  // Keep all category entries (they're all needed for slugified lookups)

  // Output
  console.log("\n=== GP_CATEGORY_MAP ===\n");
  const sortedCategories = Object.entries(categoryMap).sort(([a], [b]) => a.localeCompare(b));
  console.log("export const GP_CATEGORY_MAP = {");
  for (const [slug, canonical] of sortedCategories) {
    console.log(`  ${slug}: "${canonical}",`);
  }
  console.log("};");

  console.log("\n=== GP_ALIASES (for constants.js) ===\n");
  const sortedAliases = Object.entries(plantAliases).sort(([a], [b]) => a.localeCompare(b));
  console.log("const GP_ALIASES = {");
  for (const [slug, canonical] of sortedAliases) {
    console.log(`  ${slug}: "${canonical}",`);
  }
  console.log("};");

  if (slugConflicts.size) {
    console.log("\n=== CONFLICTS (same slug, different canonical) ===\n");
    for (const [slug, sources] of slugConflicts) {
      console.log(`  ${slug}: ${[...sources].join(", ")}`);
    }
  }

  // Write machine-readable JSON for reference
  const output = {
    generated: new Date().toISOString(),
    languages: LANGUAGES,
    categoryMap,
    plantAliases,
    rawNames: allNames,
    conflicts: Object.fromEntries([...slugConflicts].map(([k, v]) => [k, [...v]])),
  };
  const outPath = resolve(projectRoot, "tmp/gp-translations.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nFull data written to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
