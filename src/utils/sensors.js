// src/utils/sensors.js
import { normalize, normalizeDWD } from "./normalize.js";
import silamAllergenMap from "../adapters/silam_allergen_map.json" assert { type: "json" };

// Skapa dynamisk reverse-map: masterAllergen => slug för rätt språk
export function getSilamReverseMap(lang) {
  const mapping =
    silamAllergenMap.mapping?.[lang] || silamAllergenMap.mapping?.en || {};
  const reverse = {};
  for (const [slug, master] of Object.entries(mapping)) {
    reverse[master] = slug;
  }
  return reverse;
}
export function findAvailableSensors(cfg, hass, debug = false) {
  const integration = cfg.integration;
  let sensors = [];
  if (integration === "pp") {
    const cityKey = normalize(cfg.city || "");
    for (const allergen of cfg.allergens || []) {
      const rawKey = normalize(allergen);
      const sensorId = `sensor.pollen_${cityKey}_${rawKey}`;
      const exists = !!hass.states[sensorId];
      if (debug) {
        console.debug(
          `[findAvailableSensors][pp] allergen: '${allergen}', cityKey: '${cityKey}', rawKey: '${rawKey}', sensorId: '${sensorId}', exists: ${exists}`,
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
    const locationSlug = (cfg.location || "").toLowerCase();
    for (const allergen of cfg.allergens || []) {
      const allergenSlug = normalize(allergen);
      let sensorId = locationSlug
        ? `sensor.polleninformation_${locationSlug}_${allergenSlug}`
        : null;
      let exists = sensorId && hass.states[sensorId];
      if (!exists) {
        // Fallback: sök efter exakt match på slug
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
    const lang = cfg.date_locale?.slice(0, 2) || "en"; // eller plocka från hass.locale/language
    const reverse = getSilamReverseMap(lang);
    const locationSlug = (cfg.location || "").toLowerCase();
    for (const allergen of cfg.allergens || []) {
      const hassSlug = reverse[allergen] || allergen;
      const sensorId = `sensor.silam_pollen_${locationSlug}_${hassSlug}`;
      const exists = !!hass.states[sensorId];
      if (debug) {
        console.debug(
          `[findAvailableSensors][silam] allergen: '${allergen}', locationSlug: '${locationSlug}', hassSlug: '${hassSlug}', sensorId: '${sensorId}', exists: ${exists}`,
          hass.states[sensorId],
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
