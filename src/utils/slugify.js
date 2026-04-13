// src/utils/slugify.js
// Matches Home Assistant frontend slugify (common/string/slugify.ts).
// Uses character table for Latin diacritics + Cyrillic transliteration.
// https://github.com/home-assistant/frontend/blob/dev/src/common/string/slugify.ts
export const slugify = (value, delimiter = "_") => {
  const a =
    "àáâäæãåāăąабçćčđďдèéêëēėęěеёэфğǵгḧхîïíīįìıİийкłлḿмñńǹňнôöòóœøōõőоṕпŕřрßśšşșсťțтûüùúūǘůűųувẃẍÿýыžźżз·";
  const b = `aaaaaaaaaaabcccdddeeeeeeeeeeefggghhiiiiiiiiijkllmmnnnnnoooooooooopprrrsssssstttuuuuuuuuuuvwxyyyzzzz${delimiter}`;
  const p = new RegExp(a.split("").join("|"), "g");
  const complex_cyrillic = {
    ж: "zh",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ю: "iu",
    я: "ia",
  };

  let slugified;

  if (value === "") {
    slugified = "";
  } else {
    slugified = value
      .toString()
      .toLowerCase()
      .replace(p, (c) => b.charAt(a.indexOf(c)))
      .replace(/[а-я]/g, (c) => complex_cyrillic[c] || "")
      .replace(/(\d),(?=\d)/g, "$1")
      .replace(/[^a-z0-9]+/g, delimiter)
      .replace(new RegExp(`(${delimiter})\\1+`, "g"), "$1")
      .replace(new RegExp(`^${delimiter}+`), "")
      .replace(new RegExp(`${delimiter}+$`), "");

    if (slugified === "") {
      slugified = "unknown";
    }
  }

  return slugified;
};
