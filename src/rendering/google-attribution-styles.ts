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
// ------------------------------------------------------------------ //

import { css } from "lit";

export const googleAttributionTypography = css`
  font-family: Roboto, sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 1.3;
  color: light-dark(#5e5e5e, #ffffff);
`;
