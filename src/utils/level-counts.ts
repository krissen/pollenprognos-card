// Single source for per-integration level counts, shared by the rendering
// mixin (ring geometry) and the editor (level-color pickers + phrase
// defaults). Keeping both counts here means a new integration's level scale is
// declared once, and the ring and the editor can never disagree.

/**
 * Number of NON-EMPTY ring segments (doughnut arcs) for an integration, i.e.
 * the highest level the ring can fill. Level 0 ("none") is the empty track and
 * is not a segment, so this is the native max level.
 *
 * Native max level by integration (from each adapter's clamp):
 * PEU/Kleenex/MSW/IRMKMI cap at 4, GPL/GP at 5, PLU at 3, and PP/SILAM/Atmo at
 * 6. DWD is special: its
 * native 0-3 scale is doubled (see scaleRingLevel) to fill the 0-6 ring, so its
 * ring shows 6 segments even though it has only 4 native levels.
 *
 * @param {string} integration
 * @returns {number}
 */
export function ringSegmentsForIntegration(integration: string): number {
  switch (integration) {
    case "peu":
    case "kleenex":
    case "msw":
    case "irmkmi":
      return 4;
    case "gpl":
    case "gp":
      return 5;
    case "plu":
      return 3;
    default:
      // pp, dwd, silam, atmo
      return 6;
  }
}

/**
 * Total native level count INCLUDING level 0 ("none"). Drives the editor's
 * level-color pickers and the number of phrase-level defaults generated.
 *
 * Equals ringSegments + 1 for every integration EXCEPT DWD: DWD's ring shows 6
 * scaled segments but it has only 4 native levels (0-3), so the editor should
 * offer 4 level entries, not 7.
 *
 * @param {string} integration
 * @returns {number}
 */
export function numLevelsForIntegration(integration: string): number {
  if (integration === "dwd") return 4;
  return ringSegmentsForIntegration(integration) + 1;
}
