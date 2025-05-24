// src/index.js

// Import main card and editor so that custom elements are registered
import "./pollenprognos-card.js";
import "./pollenprognos-editor.js";

// Register for Lovelace UI picker (HACS)
window.customCards = window.customCards || [];
window.customCards.push({
  type: "pollenprognos-card",
  name: "Pollenprognos Card",
  preview: true,
  description: "Visar en grafisk prognos för pollenhalter",
  documentationURL: "https://github.com/krissen/pollenprognos-card",
});
