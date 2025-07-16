/**
 * Returns true if a and b are deeply equal.
 * Arrays are compared shallowly and unordered (["a","b"] == ["b","a"]).
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
      if (a[k].length !== b[k].length) return false;
      // Compare arrays unordered
      if ([...a[k]].sort().join(",") !== [...b[k]].sort().join(","))
        return false;
    } else if (typeof a[k] === "object" && typeof b[k] === "object") {
      if (!deepEqual(a[k], b[k])) return false;
    } else if (a[k] !== b[k]) {
      return false;
    }
  }
  return true;
}
