// Self-hiding for hide_no_allergens_display (#369), shared by the card and the
// badge. Home Assistant's hui-card / hui-badge wrappers collapse their slot
// when the wrapped element is `hidden`, and re-check that when the element
// fires card-visibility-changed / badge-visibility-changed (the pattern HA's
// own hui-updates-card uses for hide_empty). Rendering nothing alone would
// leave an empty slot in the grid or badge row.

/** The visibility event a wrapper listens for: card or badge flavour. */
export type VisibilityEvent =
  "card-visibility-changed" | "badge-visibility-changed";

/**
 * Whether the element is shown in an editor or a dashboard in edit mode. HA
 * forwards `preview` to badge elements only since frontend #54096 (HA
 * 2026.10); older releases set it on the wrapping hui-badge alone, so fall
 * back to the parent. Without the fallback a hidden element would vanish in
 * edit mode on those releases and could no longer be edited.
 */
export function isInPreview(el: HTMLElement & { preview?: unknown }): boolean {
  if (el.preview === true) return true;
  const parent = el.parentElement as { preview?: unknown } | null;
  return parent?.preview === true;
}

/**
 * Mirror `hide` onto the element's `hidden` state and tell the wrapper, only
 * on an actual change so a re-render never fires a redundant event.
 */
export function syncSelfVisibility(
  el: HTMLElement,
  hide: boolean,
  eventName: VisibilityEvent,
): void {
  if (!!el.hidden === hide) return;
  el.hidden = hide;
  el.dispatchEvent(
    new CustomEvent(eventName, {
      detail: { value: !hide },
      bubbles: true,
      composed: true,
    }),
  );
}
