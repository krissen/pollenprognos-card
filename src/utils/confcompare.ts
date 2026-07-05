/**
 * Returns true if a and b are deeply equal.
 * Arrays are compared unordered (["a","b"] == ["b","a"]).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao),
    bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in bo)) return false;
    if (Array.isArray(ao[k]) && Array.isArray(bo[k])) {
      if (!arraysEqualUnordered(ao[k] as unknown[], bo[k] as unknown[]))
        return false;
    } else if (typeof ao[k] === "object" && typeof bo[k] === "object") {
      if (!deepEqual(ao[k], bo[k])) return false;
    } else if (ao[k] !== bo[k]) {
      return false;
    }
  }
  return true;
}

/**
 * Unordered array comparison that handles primitives and objects.
 * Uses deepEqual for object elements instead of toString().
 */
function arraysEqualUnordered(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  // Fast path: all primitives
  if (a.every((v) => typeof v !== "object" || v === null)) {
    const sorted = (arr: unknown[]) => [...arr].sort().join("\0");
    return sorted(a) === sorted(b);
  }
  // Slow path: match each element in a to one in b
  const used = new Array(b.length).fill(false);
  for (const item of a) {
    const idx = b.findIndex(
      (el, i) => !used[i] && (item === el || deepEqual(item, el)),
    );
    if (idx === -1) return false;
    used[idx] = true;
  }
  return true;
}
