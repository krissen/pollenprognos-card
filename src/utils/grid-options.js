// Compute Home Assistant sections-view grid sizing for the card.
//
// HA calls the card's getGridOptions() to place and resize it in the 12-column
// sections grid (~30px per column, ~56px per row). Without it a card always
// spans the full width and its height is ignored. This helper is a pure function
// so the sizing logic can be unit-tested without instantiating the LitElement.
//
// minimal mode = a single horizontal strip of icons (1 row tall; width scales
//   with the number of allergens).
// normal mode = a forecast table whose height varies (title on/off, icon_size,
//   day-label header, one row per allergen, no-data / no-information states), so
//   the height is left content-driven via rows:"auto".
export function computeGridOptions(config = {}, sensorCount = 0) {
  const count =
    Number.isFinite(sensorCount) && sensorCount > 0 ? sensorCount : 1;

  if (config && config.minimal) {
    // Icons sit side by side: one row tall; ~2 grid cols per icon at default size.
    const columns = Math.min(12, Math.max(3, count * 2));
    return { rows: 1, columns, min_rows: 1, min_columns: 2 };
  }

  // Forecast table: benefits from width; height determined by content.
  return { rows: "auto", columns: 12, min_rows: 1, min_columns: 6 };
}
