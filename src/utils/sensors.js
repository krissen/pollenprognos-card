// src/utils/sensors.js
import { normalize, normalizeDWD } from "./normalize.js";
import { slugify } from "./slugify.js";
import { KLEENEX_LOCALIZED_CATEGORY_NAMES } from "../constants.js";
import { PLU_ALIAS_MAP } from "../adapters/plu.js";
import { ATMO_ALLERGEN_MAP } from "../adapters/atmo.js";
import { discoverGplSensors } from "../adapters/gpl.js";
import silamAllergenMap from "../adapters/silam_allergen_map.json" assert { type: "json" };

export function findAvailableSensors(cfg, hass, debug = false) {
  const integration = cfg.integration;
  let sensors = [];

  // Manual mode: use custom prefix/suffix regardless of integration
  // Note: kleenex has special handling below due to category/individual allergen mapping
  const manual =
    cfg.city === "manual" ||
    cfg.region_id === "manual" ||
    (cfg.location === "manual" && integration !== "kleenex");
  if (manual) {
    let prefix = cfg.entity_prefix || "";
    // Remove 'sensor.' prefix if user included it
    if (prefix.startsWith("sensor.")) {
      prefix = prefix.substring(7); // Remove 'sensor.'
    }
    // Add trailing underscore if not present (unless prefix is empty)
    if (prefix && !prefix.endsWith("_")) {
      prefix = prefix + "_";
    }
    const suffix = cfg.entity_suffix || "";
    for (const allergen of cfg.allergens || []) {
      let slug;
      if (integration === "dwd") {
        slug = normalizeDWD(allergen);
      } else if (integration === "atmo") {
        slug = ATMO_ALLERGEN_MAP[allergen] || normalize(allergen);
      } else if (integration === "silam") {
        slug = null;
        for (const mapping of Object.values(silamAllergenMap.mapping)) {
          const inv = Object.entries(mapping).reduce((acc, [ha, master]) => {
            acc[master] = ha;
            return acc;
          }, {});
          if (inv[allergen]) {
            slug = inv[allergen];
            break;
          }
        }
        if (!slug) slug = normalize(allergen);
      } else {
        slug = normalize(allergen);
      }
      let sensorId = `sensor.${prefix}${slug}${suffix}`;
      let exists = !!hass.states[sensorId];
      if (!exists && suffix === "") {
        // Fallback: try to find a unique candidate starting with the prefix and slug
        const base = `sensor.${prefix}${slug}`;
        const candidates = Object.keys(hass.states).filter((id) =>
          id.startsWith(base),
        );
        if (candidates.length === 1) {
          sensorId = candidates[0];
          exists = true;
        }
      }
      if (debug) {
        console.debug(
          `[findAvailableSensors][custom] allergen: '${allergen}', slug: '${slug}', suffix: '${suffix}', sensorId: '${sensorId}', exists: ${exists}`,
        );
      }
      if (exists) sensors.push(sensorId);
    }
    if (debug) {
      console.debug(
        "[findAvailableSensors] Found sensors (",
        sensors.length,
        ") :",
        sensors,
      );
    }
    return sensors;
  }

  if (integration === "pp") {
    // City may be empty before the user selects one, so resolve sensors by search.
    let cityKey = normalize(cfg.city || "");
    // If cityKey is empty, try to detect it from available sensors.
    if (!cityKey) {
      const ppStates = Object.keys(hass.states).filter((id) =>
        id.startsWith("sensor.pollen_") && /^sensor\.pollen_(.+)_[^_]+$/.test(id),
      );
      if (ppStates.length) {
        const m = ppStates[0].match(/^sensor\.pollen_(.+)_[^_]+$/);
        cityKey = m ? m[1] : "";
      }
    }
    for (const allergen of cfg.allergens || []) {
      const rawKey = normalize(allergen);
      let sensorId = cityKey ? `sensor.pollen_${cityKey}_${rawKey}` : null;
      let exists = sensorId && hass.states[sensorId];
      if (!exists) {
        // Search for unique candidate when city is unknown or sensor missing.
        const base = cityKey
          ? `sensor.pollen_${cityKey}_`
          : "sensor.pollen_";
        const candidates = Object.keys(hass.states).filter(
          (id) =>
            id.startsWith(base) &&
            id.endsWith(`_${rawKey}`),
        );
        if (candidates.length === 1) {
          sensorId = candidates[0];
          exists = true;
        }
      }
      if (debug) {
        console.debug(
          `[findAvailableSensors][pp] allergen: '${allergen}', cityKey: '${cityKey}', rawKey: '${rawKey}', sensorId: '${sensorId}', exists: ${!!exists}`,
        );
      }
      if (exists) sensors.push(sensorId);
    }
  } else if (integration === "dwd") {
    for (const allergen of cfg.allergens || []) {
      const rawKey = normalizeDWD(allergen);
      let sensorId = cfg.region_id
        ? `sensor.pollenflug_${rawKey}_${cfg.region_id}`
        : null;
      let exists = sensorId && hass.states[sensorId];
      if (!exists) {
        // Fallback: hitta unik kandidat på prefix
        const candidates = Object.keys(hass.states).filter((id) =>
          id.startsWith(`sensor.pollenflug_${rawKey}_`),
        );
        if (candidates.length === 1) {
          sensorId = candidates[0];
          exists = true;
        }
      }
      if (debug) {
        console.debug(
          `[findAvailableSensors][dwd] allergen: '${allergen}', rawKey: '${rawKey}', region_id: '${cfg.region_id}', sensorId: '${sensorId}', exists: ${!!exists}`,
        );
      }
      if (exists) sensors.push(sensorId);
    }
  } else if (integration === "peu") {
    const locationSlug = slugify(cfg.location || "");
    for (const allergen of cfg.allergens || []) {
      const allergenSlug = normalize(allergen);
      let sensorId = locationSlug
        ? `sensor.polleninformation_${locationSlug}_${allergenSlug}`
        : null;
      let exists = sensorId && hass.states[sensorId];
      if (!exists) {
        // Fallback: search for exact slug match
        const cands = Object.keys(hass.states).filter((id) => {
          const m = id.match(/^sensor\.polleninformation_(.+)_(.+)$/);
          if (!m) return false;
          const loc = m[1];
          const allg = m[2];
          return (
            (!locationSlug || loc === locationSlug) && allg === allergenSlug
          );
        });
        if (cands.length === 1) {
          sensorId = cands[0];
          exists = true;
        }
      }
      if (debug) {
        console.debug(
          `[findAvailableSensors][peu] allergen: '${allergen}', locationSlug: '${locationSlug}', allergenSlug: '${allergenSlug}', sensorId: '${sensorId}', exists: ${!!exists}`,
        );
      }
      if (exists) sensors.push(sensorId);
    }
  } else if (integration === "silam") {
    const locationSlug = (cfg.location || "").toLowerCase();
    for (const allergen of cfg.allergens || []) {
      // Leta i ALLA språk-mappingar tills vi hittar rätt Home Assistant-slug
      let hassSlug = null;
      for (const mapping of Object.values(silamAllergenMap.mapping)) {
        // mapping: { haSlug: "master" }
        // Vi behöver master->haSlug, så invertera:
        const inv = Object.entries(mapping).reduce((acc, [ha, master]) => {
          acc[master] = ha;
          return acc;
        }, {});
        if (inv[allergen]) {
          const candidateSlug = inv[allergen];
          const sensorId = `sensor.silam_pollen_${locationSlug}_${candidateSlug}`;
          if (hass.states[sensorId]) {
            hassSlug = candidateSlug;
            // Hittade en existerande sensor!
            if (debug) {
              console.debug(
                `[findAvailableSensors][silam] allergen: '${allergen}', locationSlug: '${locationSlug}', hassSlug: '${hassSlug}', sensorId: '${sensorId}', exists: true`,
                hass.states[sensorId],
              );
            }
            sensors.push(sensorId);
            break;
          }
        }
      }
      // Om vi inte hittade någon, debugga gärna:
      if (!hassSlug && debug) {
        console.debug(
          `[findAvailableSensors][silam] allergen: '${allergen}', locationSlug: '${locationSlug}', ingen sensor hittades!`,
        );
      }
    }
  } else if (integration === "kleenex") {
    const locationSlug = slugify(cfg.location || "");
    
    // For kleenex, we only need to check the 3 main category sensors
    // Individual allergen data comes from their 'details' attributes
    const categoryAllergens = ['trees', 'grass', 'weeds'];
    const configuredAllergens = cfg.allergens || [];
    
    // Only check if any of the requested allergens map to these categories
    const needsCategories = new Set();
    for (const allergen of configuredAllergens) {
      if (categoryAllergens.includes(allergen)) {
        needsCategories.add(allergen);
      } else if (allergen.endsWith('_cat')) {
        // Category allergens with _cat suffix
        const categoryName = allergen.replace('_cat', '');
        if (categoryAllergens.includes(categoryName)) {
          needsCategories.add(categoryName);
        }
      } else {
        // Individual allergens map to categories
        const individualToCategory = {
          'alder': 'trees', 'birch': 'trees', 'cypress': 'trees', 'elm': 'trees',
          'hazel': 'trees', 'oak': 'trees', 'pine': 'trees', 'plane': 'trees', 'poplar': 'trees',
          'poaceae': 'grass',
          'mugwort': 'weeds', 'ragweed': 'weeds', 'chenopod': 'weeds', 'nettle': 'weeds'
        };
        const category = individualToCategory[allergen];
        if (category) {
          needsCategories.add(category);
        }
      }
    }
    
    // Check each needed category sensor
    for (const category of needsCategories) {
      let sensorId;
      if (cfg.location === "manual") {
        let prefix = cfg.entity_prefix || "";
        // Remove 'sensor.' prefix if user included it
        if (prefix.startsWith("sensor.")) {
          prefix = prefix.substring(7); // Remove 'sensor.'
        }
        // Add trailing underscore if not present (unless prefix is empty)
        if (prefix && !prefix.endsWith("_")) {
          prefix = prefix + "_";
        }
        const suffix = cfg.entity_suffix || "";
        
        // First try the canonical English name
        sensorId = `sensor.${prefix}${category}${suffix}`;
        
        // If sensor not found, search for localized category names
        if (!hass.states[sensorId]) {
          // Get all possible localized name prefixes for this category
          const possiblePrefixes = Object.entries(KLEENEX_LOCALIZED_CATEGORY_NAMES)
            .filter(([_, canonical]) => canonical === category)
            .map(([localPrefix, _]) => localPrefix);
          
          // Search for sensors with any of the possible localized names
          const expectedPrefix = `sensor.${prefix}`;
          const candidates = Object.keys(hass.states).filter((id) => {
            if (!id.startsWith(expectedPrefix)) return false;
            
            // Extract the part between prefix and suffix
            const middle = id.substring(expectedPrefix.length);
            if (suffix && !middle.endsWith(suffix)) return false;
            
            const categoryPart = suffix ? middle.substring(0, middle.length - suffix.length) : middle;
            
            // Check if the category part matches any of the possible localized names
            return possiblePrefixes.some(localPrefix => categoryPart.startsWith(localPrefix));
          });
          
          if (candidates.length >= 1) {
            sensorId = candidates[0]; // Take first match
          }
        }
      } else {
        // First try the canonical English name
        sensorId = locationSlug
          ? `sensor.kleenex_pollen_radar_${locationSlug}_${category}`
          : null;
        
        // If no location slug or sensor not found, search for localized names
        if (!sensorId || !hass.states[sensorId]) {
          // Get all possible localized name prefixes for this category
          const possiblePrefixes = Object.entries(KLEENEX_LOCALIZED_CATEGORY_NAMES)
            .filter(([_, canonical]) => canonical === category)
            .map(([prefix, _]) => prefix);
          
          // Search for sensors with any of the possible names (using startsWith for flexibility)
          const candidates = Object.keys(hass.states).filter((id) => {
            if (!id.startsWith(`sensor.kleenex_pollen_radar_`)) return false;
            
            // Extract the suffix after the last underscore
            const parts = id.split('_');
            const suffix = parts[parts.length - 1];
            
            // Check if the suffix starts with any of the possible category name prefixes
            return possiblePrefixes.some(prefix => suffix.startsWith(prefix));
          });
          
          if (candidates.length >= 1) {
            sensorId = candidates[0]; // Take first match
          }
        }
      }

      if (debug) {
        const isManual = cfg.location === "manual";
        const debugInfo = isManual
          ? `manual mode, prefix: '${cfg.entity_prefix || ''}', suffix: '${cfg.entity_suffix || ''}'`
          : `location: '${locationSlug}'`;
        console.debug(
          `[findAvailableSensors][kleenex] category: '${category}', ${debugInfo}, sensorId: '${sensorId}', exists: ${!!hass.states[sensorId]}`,
        );
      }
      if (hass.states[sensorId]) sensors.push(sensorId);
    }
  } else if (integration === "plu") {
    for (const allergen of cfg.allergens || []) {
      const aliases = PLU_ALIAS_MAP[allergen] || [slugify(allergen)];
      let sensorId = null;

      for (const alias of aliases) {
        const candidate = `sensor.pollen_${alias}`;
        if (hass.states[candidate]) {
          sensorId = candidate;
          break;
        }
      }

      if (!sensorId) {
        // Fallback: unique candidate by suffix match without city component
        const candidates = Object.keys(hass.states).filter((id) => {
          if (!id.startsWith("sensor.pollen_")) return false;
          const rest = id.slice("sensor.pollen_".length);
          if (rest.includes("_")) return false;
          return aliases.includes(rest);
        });
        if (candidates.length === 1) {
          sensorId = candidates[0];
        }
      }

      if (debug) {
        console.debug(
          `[findAvailableSensors][plu] allergen: '${allergen}', aliases: ${aliases.join(",")}, sensorId: '${sensorId}', exists: ${!!sensorId}`,
        );
      }

      if (sensorId) {
        sensors.push(sensorId);
      }
    }
  } else if (integration === "atmo") {
    const location = (cfg.location || "").toLowerCase();
    for (const allergen of cfg.allergens || []) {
      const frSlug = ATMO_ALLERGEN_MAP[allergen];
      if (!frSlug) continue;

      let sensorId;
      if (allergen === "allergy_risk") {
        sensorId = location
          ? `sensor.qualite_globale_pollen_${location}`
          : null;
      } else {
        sensorId = location
          ? `sensor.niveau_${frSlug}_${location}`
          : null;
      }

      let exists = sensorId && !!hass.states[sensorId];
      if (!exists) {
        // Fallback: search for matching entity
        const prefix =
          allergen === "allergy_risk"
            ? "sensor.qualite_globale_pollen_"
            : `sensor.niveau_${frSlug}_`;
        const candidates = Object.keys(hass.states).filter(
          (id) => id.startsWith(prefix) && !id.includes("_j_"),
        );
        if (candidates.length === 1) {
          sensorId = candidates[0];
          exists = true;
        }
      }

      if (debug) {
        console.debug(
          `[findAvailableSensors][atmo] allergen: '${allergen}', frSlug: '${frSlug}', location: '${location}', sensorId: '${sensorId}', exists: ${exists}`,
        );
      }
      if (exists) sensors.push(sensorId);
    }
  } else if (integration === "gpl") {
    const discovery = discoverGplSensors(hass, debug);
    const configEntryId = cfg.location || "";

    // Resolve the entity map for the configured location
    let entityMap = null;
    if (configEntryId && discovery.locations.has(configEntryId)) {
      entityMap = discovery.locations.get(configEntryId).entities;
    } else if (discovery.locations.size) {
      entityMap = discovery.locations.values().next().value.entities;
    }

    for (const allergen of cfg.allergens || []) {
      const sensorId = entityMap?.get(allergen) || null;
      const exists = sensorId && !!hass.states[sensorId];

      if (debug) {
        console.debug(
          `[findAvailableSensors][gpl] allergen: '${allergen}', configEntryId: '${configEntryId}', sensorId: '${sensorId}', exists: ${exists}`,
        );
      }
      if (exists) sensors.push(sensorId);
    }
  }
  if (debug) {
    const myLength = sensors.length;
    console.debug(
      "[findAvailableSensors] Found sensors (",
      myLength,
      "): ",
      sensors,
    );
  }

  return sensors;
}
