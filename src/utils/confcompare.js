/**
 * Returns true if a and b are deeply equal.
 * Arrays are compared unordered (["a","b"] == ["b","a"]).
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const aKeys = Object.keys(a),
    bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let k of aKeys) {
    if (!(k in b)) return false;
    if (Array.isArray(a[k]) && Array.isArray(b[k])) {
      if (!arraysEqualUnordered(a[k], b[k])) return false;
    } else if (typeof a[k] === "object" && typeof b[k] === "object") {
      if (!deepEqual(a[k], b[k])) return false;
    } else if (a[k] !== b[k]) {
      return false;
    }
  }
  return true;
}

/**
 * Unordered array comparison that handles primitives and objects.
 * Uses deepEqual for object elements instead of toString().
 */
function arraysEqualUnordered(a, b) {
  if (a.length !== b.length) return false;
  // Fast path: all primitives
  if (a.every((v) => typeof v !== "object" || v === null)) {
    const sorted = (arr) => [...arr].sort().join("\0");
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
