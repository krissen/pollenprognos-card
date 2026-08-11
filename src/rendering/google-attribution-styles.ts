// ------------------------------------------------------------------ //
// Shared typography for the Google attribution text (issue #338).      //
//                                                                      //
// Font, the 12px floor and the two permitted colours are dictated by   //
// the Google Pollen API attribution policy                             //
// (developers.google.com/maps/documentation/pollen/policies): never    //
// scale the text below 12px, never recolour it beyond these two, never //
// localize the strings and never hide them behind a tooltip. Kept in   //
// one place so the card footer and both editor rows cannot drift.      //
// Declarations only; each surface adds its own box model.              //
//                                                                      //
// The light/dark choice comes from Home Assistant, not from the UA:    //
// each surface sets --pp-google-attribution-color from                 //
// hass.themes.darkMode (see googleAttributionColor). light-dark() was  //
// wrong here because it follows the document's color-scheme, which HA  //
// publishes as "dark light" for any named theme -- a named LIGHT theme //
// on a dark-mode OS then resolved to white text on a white card.       //
// ------------------------------------------------------------------ //

import { css } from "lit";
import type { HomeAssistant } from "../types/home-assistant.js";

/** The two colours the attribution policy permits, and nothing else. */
export const GOOGLE_ATTRIBUTION_LIGHT_COLOR = "#5e5e5e";
export const GOOGLE_ATTRIBUTION_DARK_COLOR = "#ffffff";

/**
 * Pick the policy colour that is legible on the current HA theme. Falls back to
 * the light-theme colour before hass arrives, matching the CSS fallback.
 */
export function googleAttributionColor(hass?: HomeAssistant | null): string {
  return hass?.themes?.darkMode
    ? GOOGLE_ATTRIBUTION_DARK_COLOR
    : GOOGLE_ATTRIBUTION_LIGHT_COLOR;
}

export const googleAttributionTypography = css`
  font-family: Roboto, sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 1.3;
  color: var(--pp-google-attribution-color, #5e5e5e);
`;
