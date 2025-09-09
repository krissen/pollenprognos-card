// src/utils/sensors.js
import { normalize, normalizeDWD } from "./normalize.js";
import { slugify } from "./slugify.js";
import silamAllergenMap from "../adapters/silam_allergen_map.json" assert { type: "json" };

export function findAvailableSensors(cfg, hass, debug = false) {
  const integration = cfg.integration;
  let sensors = [];

  // Manual mode: use custom prefix/suffix regardless of integration
  const manual =
    cfg.city === "manual" ||
    cfg.region_id === "manual" ||
    cfg.location === "manual";
  if (manual) {
    const prefix = cfg.entity_prefix || "";
    const suffix = cfg.entity_suffix || "";
    for (const allergen of cfg.allergens || []) {
      let slug;
      if (integration === "dwd") {
        slug = normalizeDWD(allergen);
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
    const locationSlug = (cfg.location || "").toLowerCase();
    for (const allergen of cfg.allergens || []) {
      let sensorId;
      if (cfg.location === "manual") {
        const prefix = cfg.entity_prefix || "";
        const suffix = cfg.entity_suffix || "";
        sensorId = `${prefix}${allergen}${suffix}`;
      } else {
        sensorId = locationSlug
          ? `sensor.kleenex_pollenradar_${locationSlug}_${allergen}`
          : null;
        
        // If no location slug or sensor not found, try to find any matching sensor
        if (!sensorId || !hass.states[sensorId]) {
          const candidates = Object.keys(hass.states).filter((id) =>
            id.startsWith(`sensor.kleenex_pollenradar_`) && id.includes(`_${allergen}`)
          );
          if (candidates.length >= 1) {
            sensorId = candidates[0]; // Take first match
          }
        }
      }
      
      if (debug) {
        console.debug(
          `[findAvailableSensors][kleenex] allergen: '${allergen}', locationSlug: '${locationSlug}', sensorId: '${sensorId}', exists: ${!!hass.states[sensorId]}`,
        );
      }
      if (hass.states[sensorId]) sensors.push(sensorId);
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
