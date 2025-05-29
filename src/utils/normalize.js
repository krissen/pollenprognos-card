// src/utils/normalize.js

/**
 * Tar en text som kan innehålla diakritiska tecken,
 * tar bort dem och mappar allt till [a–z0–9_] för nycklar.
 */
export function normalize(text) {
  return (
    text
      // Dela upp accent (NFD)
      .normalize("NFD")
      // Ta bort alla diakritiska marks
      .replace(/[\u0300-\u036f]/g, "")
      // Till gemener och ersätt allt icke-alnum med underscore
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      // Trimma eventuella ledande/följande _
      .replace(/^_+|_+$/g, "")
  );
}

// Special-normalize för DWD-sensorer:
export function normalizeDWD(text) {
  return (
    text
      .toLowerCase()
      // Översätt tyska diakritiska tecken
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      // Gör resten alfanumeriskt med underscore
      .replace(/[^a-z0-9]+/g, "_")
      // Trimma eventuella _ i början/slutet
      .replace(/^_+|_+$/g, "")
  );
}
