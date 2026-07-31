import { describe, it, expect } from "vitest";
import { allergenListForIntegration } from "../../src/editor/integration-allergens.js";
import {
  stubConfigKleenex,
  KLEENEX_EDITOR_ALLERGENS,
} from "../../src/adapters/kleenex/index.js";

/**
 * Issue #313: the US/NA zones report category totals only, so a user there has
 * to be able to pick `trees_cat`/`grass_cat`/`weeds_cat` in the editor. They
 * are offered everywhere but selected nowhere by default -- the default card
 * still shows the per-allergen rows an EU install has, and the adapter's
 * fallback covers US users who never open the editor.
 */
describe("editor allergen list: Kleenex categories", () => {
  const CATEGORY_KEYS = ["trees_cat", "grass_cat", "weeds_cat"];

  it("offers the three category totals", () => {
    const list = allergenListForIntegration("kleenex");
    for (const key of CATEGORY_KEYS) expect(list).toContain(key);
  });

  it("keeps offering every individual allergen", () => {
    const list = allergenListForIntegration("kleenex");
    for (const key of stubConfigKleenex.allergens as string[]) {
      expect(list).toContain(key);
    }
  });

  it("leaves the default selection unchanged", () => {
    // The stub is what a fresh card starts from; adding categories there would
    // change every existing EU card on upgrade.
    for (const key of CATEGORY_KEYS) {
      expect(stubConfigKleenex.allergens as string[]).not.toContain(key);
    }
  });

  it("lists no duplicates", () => {
    expect(new Set(KLEENEX_EDITOR_ALLERGENS).size).toBe(
      KLEENEX_EDITOR_ALLERGENS.length,
    );
  });
});
