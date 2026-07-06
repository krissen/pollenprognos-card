// src/index.ts

// Import main card and editor so that custom elements are registered
import "./pollenprognos-card.js";
import "./pollenprognos-editor.js";
// Import the badge element and its editor so they register as custom elements
import "./pollenprognos-badge.js";
import "./pollenprognos-badge-editor.js";

import { suggestEntityConfig } from "./utils/autodetect.js";
import type { HomeAssistant } from "./types/home-assistant.js";

// Register for Lovelace UI picker (HACS)
window.customCards = window.customCards || [];
window.customCards.push({
  type: "pollenprognos-card",
  name: "Pollenprognos Card",
  preview: true,
  description: "Visar en grafisk prognos för pollenhalter",
  documentationURL: "https://github.com/krissen/pollenprognos-card",
  // HA 2026.6 card-picker suggestions: when a user picks a pollen sensor, offer
  // a correctly-configured card under the picker's Community section. Returns
  // null for entities we don't recognise.
  getEntitySuggestion: (hass, entityId) =>
    suggestEntityConfig(hass as HomeAssistant, entityId),
});

// Register for the Lovelace badge picker. HA reads window.customBadges the same
// way it reads window.customCards; the `type` is the bare element tag (no
// "custom:" prefix).
window.customBadges = window.customBadges || [];
window.customBadges.push({
  type: "pollenprognos-badge",
  name: "Pollenprognos Badge",
  preview: true,
  description: "Kompakt pollenbadge för dashboards",
  documentationURL: "https://github.com/krissen/pollenprognos-card",
});
