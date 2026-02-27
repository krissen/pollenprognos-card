// src/adapters/kleenex/discovery.js
import { KLEENEX_LOCALIZED_CATEGORY_NAMES } from "../../constants.js";
import { slugify } from "../../utils/slugify.js";
import { normalizeManualPrefix } from "../../utils/adapter-helpers.js";
import { INDIVIDUAL_TO_CATEGORY } from "./constants.js";

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
  return map;
}
