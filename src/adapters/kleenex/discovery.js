// src/adapters/kleenex/discovery.js
import { KLEENEX_LOCALIZED_CATEGORY_NAMES } from "../../constants.js";
import { slugify } from "../../utils/slugify.js";
import { normalizeManualPrefix } from "../../utils/adapter-helpers.js";
import { INDIVIDUAL_TO_CATEGORY, KLEENEX_ALLERGEN_MAP } from "./constants.js";

/**
 * Resolve category-level entity IDs for sensor detection.
 * Returns Map<categoryName, entityId> for the 3 category sensors
 * needed by the configured allergens.
 */
export function resolveEntityIds(cfg, hass, debug = false) {
  const map = new Map();
  const locationSlug = slugify(cfg.location || "");
  const categoryAllergens = ["trees", "grass", "weeds"];

  // Determine which categories are needed
  const needsCategories = new Set();
  for (const allergen of cfg.allergens || []) {
    if (categoryAllergens.includes(allergen)) {
      needsCategories.add(allergen);
    } else if (allergen.endsWith("_cat")) {
      const categoryName = allergen.replace("_cat", "");
      if (categoryAllergens.includes(categoryName)) {
        needsCategories.add(categoryName);
      }
    } else {
      const category = INDIVIDUAL_TO_CATEGORY[allergen];
      if (category) needsCategories.add(category);
    }
  }

  for (const category of needsCategories) {
    let sensorId;
    if (cfg.location === "manual") {
      const prefix = normalizeManualPrefix(cfg.entity_prefix);
      const suffix = cfg.entity_suffix || "";

      sensorId = `sensor.${prefix}${category}${suffix}`;
      if (!hass.states[sensorId]) {
        const possiblePrefixes = Object.entries(KLEENEX_LOCALIZED_CATEGORY_NAMES)
          .filter(([_, canonical]) => canonical === category)
          .map(([localPrefix]) => localPrefix);

        const expectedPrefix = `sensor.${prefix}`;
        const candidates = Object.keys(hass.states).filter((id) => {
          if (!id.startsWith(expectedPrefix)) return false;
          const middle = id.substring(expectedPrefix.length);
          if (suffix && !middle.endsWith(suffix)) return false;
          const categoryPart = suffix ? middle.substring(0, middle.length - suffix.length) : middle;
          return possiblePrefixes.some((lp) => categoryPart.startsWith(lp));
        });
        if (candidates.length >= 1) sensorId = candidates[0];
      }
    } else {
      sensorId = locationSlug
        ? `sensor.kleenex_pollen_radar_${locationSlug}_${category}`
        : null;
      if (!sensorId || !hass.states[sensorId]) {
        const possiblePrefixes = Object.entries(KLEENEX_LOCALIZED_CATEGORY_NAMES)
          .filter(([_, canonical]) => canonical === category)
          .map(([lp]) => lp);

        const candidates = Object.keys(hass.states).filter((id) => {
          if (!id.startsWith("sensor.kleenex_pollen_radar_")) return false;
          if (locationSlug) {
            const afterPrefix = id.substring("sensor.kleenex_pollen_radar_".length);
            if (!afterPrefix.startsWith(locationSlug + "_")) return false;
          }
          const parts = id.split("_");
          const suffix = parts[parts.length - 1];
          return possiblePrefixes.some((lp) => suffix.startsWith(lp));
        });
        if (candidates.length >= 1) sensorId = candidates[0];
      }
    }

    if (debug) {
      console.debug(
        `[Kleenex:resolveEntityIds] category: '${category}', sensorId: '${sensorId}', exists: ${!!hass.states[sensorId]}`,
      );
    }
    if (hass.states[sensorId]) map.set(category, sensorId);
  }

  // Also probe for individually-enabled DetailSensor entities.
  // These are disabled by default in HA (entity_registry_enabled_default=False) but
  // users may enable them. For NA zones they don't exist at all; for EU/UK zones they
  // give per-allergen data when the category sensor's details[] is empty.
  // Build a reverse index: canonical name -> Set of slugified alias entity-suffixes.
  const canonicalToAliasSlugs = new Map();
  for (const [alias, canonical] of Object.entries(KLEENEX_ALLERGEN_MAP)) {
    let slugs = canonicalToAliasSlugs.get(canonical);
    if (!slugs) {
      slugs = new Set();
      canonicalToAliasSlugs.set(canonical, slugs);
    }
    slugs.add(slugify(alias));
  }

  const individualAllergens = (cfg.allergens || []).filter(
    (a) => !["trees_cat", "grass_cat", "weeds_cat", "trees", "grass", "weeds"].includes(a),
  );

  for (const allergen of individualAllergens) {
    // map already has this allergen (from some other path) — skip.
    if (map.has(allergen)) continue;

    let detailSensorId;
    // Cover both alias-keyed slugs and the canonical name itself (in case the
    // canonical isn't an alias key in KLEENEX_ALLERGEN_MAP).
    const aliasesForCanonical = new Set(canonicalToAliasSlugs.get(allergen) || []);
    aliasesForCanonical.add(slugify(allergen));

    if (cfg.location === "manual") {
      const prefix = normalizeManualPrefix(cfg.entity_prefix);
      const suffix = cfg.entity_suffix || "";
      for (const aliasSlug of aliasesForCanonical) {
        const candidate = `sensor.${prefix}${aliasSlug}${suffix}`;
        if (hass.states[candidate]) {
          detailSensorId = candidate;
          break;
        }
      }
    } else if (locationSlug) {
      for (const aliasSlug of aliasesForCanonical) {
        const candidate = `sensor.kleenex_pollen_radar_${locationSlug}_${aliasSlug}`;
        if (hass.states[candidate]) {
          detailSensorId = candidate;
          break;
        }
      }
    }

    if (detailSensorId) {
      if (debug) {
        console.debug(
          `[Kleenex:resolveEntityIds] DetailSensor for '${allergen}': '${detailSensorId}'`,
        );
      }
      map.set(allergen, detailSensorId);
    }
  }

  return map;
}
