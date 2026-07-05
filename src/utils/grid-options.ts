// Compute Home Assistant sections-view grid sizing for the card.
//
// HA calls the card's getGridOptions() to place and resize it in the 12-column
// sections grid (~30px per column, ~56px per row). Without it a card always
// spans the full width and its height is ignored. This helper is a pure function
// so the sizing logic can be unit-tested without instantiating the LitElement.
//
// The minimal-mode width is derived from the configured allergen count
// (config.allergens), NOT from the fetched sensor list: the sections grid calls
// getGridOptions() while it builds the card wrapper, before the card's async
// forecast fetch has populated this.sensors, and the parent grid is not
// recomputed when the sensors later load. config.allergens is synchronously
// available and stable, so the width is right from first paint.
//
// minimal mode = a horizontal strip of icons whose width scales with the number
//   of allergens. Height is left content-driven via rows:"auto": although the
//   strip is usually a single row of icons, an optional card header and per-icon
//   text/value labels (show_text_allergen / show_value_*) can push it past one
//   fixed 56px track, which a numeric rows:1 would clip or overlap.
// normal mode = a forecast table whose height varies (title on/off, icon_size,
//   day-label header, one row per allergen, no-data / no-information states), so
//   the height is likewise content-driven via rows:"auto".
export function computeGridOptions(config: Record<string, unknown> = {}): {
  rows: string;
  columns: number;
  min_rows: number;
  min_columns: number;
} {
  const configured = Array.isArray(config?.allergens)
    ? config.allergens.length
    : 0;
  const count = configured > 0 ? configured : 1;

  if (config && config.minimal) {
    // Icons sit side by side: ~2 grid cols per icon at default size.
    const columns = Math.min(12, Math.max(3, count * 2));
    return { rows: "auto", columns, min_rows: 1, min_columns: 2 };
  }

  // Forecast table: benefits from width; height determined by content.
  return { rows: "auto", columns: 12, min_rows: 1, min_columns: 6 };
}
