import { describe, it, expect } from "vitest";
import { getAdapter, getStubConfig, getAllAdapterIds } from "../src/adapter-registry.js";

const EXPECTED_IDS = ["pp", "dwd", "peu", "silam", "kleenex", "plu", "atmo", "gpl"];

describe("adapter-registry", () => {
  it("getAllAdapterIds returns all 8 integrations", () => {
    expect(getAllAdapterIds()).toEqual(EXPECTED_IDS);
  });

  it.each(EXPECTED_IDS)("getStubConfig('%s') returns an object with integration field", (id) => {
    const stub = getStubConfig(id);
    expect(stub).toBeDefined();
    expect(stub.integration).toBe(id);
  });

  it.each(EXPECTED_IDS)("getAdapter('%s') returns a module with fetchForecast", (id) => {
    const adapter = getAdapter(id);
    expect(adapter).toBeDefined();
    expect(typeof adapter.fetchForecast).toBe("function");
  });

  it("getStubConfig returns undefined for unknown id", () => {
    expect(getStubConfig("nonexistent")).toBeUndefined();
  });

  it("getAdapter returns undefined for unknown id", () => {
    expect(getAdapter("nonexistent")).toBeUndefined();
  });

  it("returns same object references as direct imports", async () => {
    const { stubConfigPP } = await import("../src/adapters/pp.js");
    const { stubConfigDWD } = await import("../src/adapters/dwd.js");
    expect(getStubConfig("pp")).toBe(stubConfigPP);
    expect(getStubConfig("dwd")).toBe(stubConfigDWD);
  });

  it("adapter module reference matches direct import", async () => {
    const PP = await import("../src/adapters/pp.js");
    expect(getAdapter("pp")).toBe(PP);
  });
});
