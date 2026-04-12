// src/utils/slugify.js
// Unicode → ASCII transliteration using any-ascii, matching HA's backend behavior.
// Replaces the previous limited Latin+Cyrillic character table.
import anyAscii from "any-ascii";

export const slugify = (value, delimiter = "_") => {
  if (value === "") return "";

  const slugified = anyAscii(value)
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/[^a-z0-9]+/g, delimiter)
    .replace(new RegExp(`(${delimiter})\\1+`, "g"), "$1")
    .replace(new RegExp(`^${delimiter}+`), "")
    .replace(new RegExp(`${delimiter}+$`), "");

  return slugified || "unknown";
};
