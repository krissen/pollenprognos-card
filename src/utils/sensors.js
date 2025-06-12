import { normalize, normalizeDWD } from "./normalize.js";

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
  }
  if (debug) console.debug(`[findAvailableSensors] Found sensors:`, sensors);
  return sensors;
}
