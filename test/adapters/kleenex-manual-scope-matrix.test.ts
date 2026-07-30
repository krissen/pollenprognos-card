import { describe, it, expect, beforeEach } from "vitest";
import {
  scopeManualEntities,
  _resetManualScopeWarningsForTest,
} from "../../src/adapters/kleenex/index.js";
import type { HomeAssistant } from "../../src/types/home-assistant.js";

/**
 * Invariant matrix for manual-mode prefix scoping.
 *
 * Two consecutive review findings hit the same function from different angles
 * (remainder heuristic vs. an owner missing from discovery), so this file
 * enumerates the whole space instead of chasing a third: prefix forms x owner
 * modes x environments, with the invariants expressed once and applied to every
 * valid cell. Invalid combinations are listed with the reason rather than
 * silently omitted.
 *
 * Deliberate carve-out, decided when the narrowing rule was introduced:
 * entities the registry cannot attribute (template sensors, installs whose
 * registry the frontend does not expose) are never dropped -- manual mode is
 * the fallback for exactly those setups. "Never mix locations" therefore means
 * "never mix two registry-known locations"; unregistered entities may coexist
 * with the one location that wins.
 */

const PARIS_DEVICE = {
  identifiers: [["kleenex_pollenradar", "Paris"]],
  config_entries: ["cfg_paris"],
  name: "Kleenex Pollen Radar (Paris)",
  name_by_user: "Kleenex pollen",
};
const UTRECHT_DEVICE = {
  identifiers: [["kleenex_pollenradar", "Utrecht"]],
  config_entries: ["cfg_utrecht"],
  name: "Kleenex Pollen Radar (Utrecht)",
  name_by_user: null,
};

const PARIS_IDS = [
  "sensor.kleenex_pollen_trees",
  "sensor.kleenex_pollen_grass",
];
// The same device with only a long-named detail sensor enabled. The remainder
// after the prefix (26 characters) is longer than the colliding device's
// "radar_utrecht_trees" (19), which is what defeated the first version of the
// rule.
const PARIS_LONG_IDS = ["sensor.kleenex_pollen_zeer_lange_naam_brandnetel"];
const UTRECHT_IDS = [
  "sensor.kleenex_pollen_radar_utrecht_trees",
  "sensor.kleenex_pollen_radar_utrecht_grass",
];
const ROTTERDAM_DEVICE = {
  identifiers: [["kleenex_pollenradar", "Rotterdam"]],
  config_entries: ["cfg_rotterdam"],
  name: "Kleenex Pollen Radar (Rotterdam)",
  name_by_user: null,
};
const ROTTERDAM_IDS = ["sensor.kleenex_pollen_radar_rotterdam_trees"];
// A second entity on the same device that classifies to the same key ("bomen"
// is the Dutch trees sensor). Discovery keeps one entity per key, so this one
// is missing from its location's entity map.
const ROTTERDAM_DUPLICATE_ID = "sensor.kleenex_pollen_radar_rotterdam_bomen";

/** The same devices as seen in a mixed registry: no identifiers, so they are
 * only recognisable through their entities' `platform` (discovery tier 2). */
const PARIS_DEVICE_TIER2 = { ...PARIS_DEVICE, identifiers: [] };
const UTRECHT_DEVICE_TIER2 = { ...UTRECHT_DEVICE, identifiers: [] };

/**
 * How the owning config entry presents itself:
 *  - available: registry entries and live states.
 *  - unavailable: registry entries, states present but `unavailable`.
 *  - no-states: registry entries, no state objects at all (entry down). This is
 *    the mode discovery cannot see, since it only walks state-backed entities.
 *  - absent: not in the registry at all (the user's own template sensors).
 */
type OwnerMode = "available" | "unavailable" | "no-states" | "absent";
type Environment =
  | "multi"
  | "multi-long"
  | "multi-legacy"
  | "multi-duplicate-keys"
  | "mixed-colliding-tier2"
  | "mixed-owner-tier2"
  | "single"
  | "bare";

function entityEntry(deviceId: string, translationKey: string) {
  return {
    device_id: deviceId,
    platform: "kleenex_pollenradar",
    translation_key: translationKey,
    unique_id: null,
    entity_category: null,
  };
}

function sensorState(entityId: string, state: string) {
  return {
    entity_id: entityId,
    state,
    attributes: {
      friendly_name: entityId,
      details: [{ name: "Birch", value: 10 }],
      forecast: [],
    },
  };
}

/**
 * Build a hass mock for one (environment, owner mode) pair.
 *
 * - multi: the renamed Paris device (the prefix owner) plus the legacy Utrecht
 *   device whose entity IDs collide with the Paris prefix.
 * - single: Paris only.
 * - bare: no registry at all; both ID shapes exist as plain states, the way
 *   template sensors or a frontend without registry access present themselves.
 */
function ownerIds(env: Environment): string[] {
  return env === "multi-long" ? PARIS_LONG_IDS : PARIS_IDS;
}

/** Whether each device carries `kleenex_pollenradar` identifiers in this env. */
function identifierBacked(env: Environment): {
  owner: boolean;
  colliding: boolean;
} {
  if (env === "mixed-colliding-tier2") return { owner: true, colliding: false };
  if (env === "mixed-owner-tier2") return { owner: false, colliding: true };
  return { owner: true, colliding: true };
}

function buildHass(env: Environment, owner: OwnerMode): HomeAssistant {
  const states: Record<string, unknown> = {};
  const entities: Record<string, unknown> = {};
  const devices: Record<string, unknown> = {};
  const paris = ownerIds(env);

  if (env !== "bare") {
    // Owner (Paris).
    if (owner !== "absent") {
      devices.dev_paris = identifierBacked(env).owner
        ? PARIS_DEVICE
        : PARIS_DEVICE_TIER2;
      paris.forEach((eid, i) => {
        entities[eid] = entityEntry(
          "dev_paris",
          env === "multi-long" ? "detail_value" : i === 0 ? "trees" : "grass",
        );
      });
    }
    if (owner === "available" || owner === "absent") {
      paris.forEach((eid) => (states[eid] = sensorState(eid, "100")));
    } else if (owner === "unavailable") {
      paris.forEach((eid) => (states[eid] = sensorState(eid, "unavailable")));
    }
    // owner === "no-states": registry entries only, no state objects.
  } else {
    paris.forEach((eid) => (states[eid] = sensorState(eid, "100")));
  }

  if (env === "multi-legacy" || env === "multi-duplicate-keys") {
    // A second legacy location, so a broad `kleenex_pollen_radar_` prefix
    // matches two devices at once -- the case the narrowing warning exists for.
    devices.dev_rotterdam = ROTTERDAM_DEVICE;
    ROTTERDAM_IDS.forEach((eid) => {
      states[eid] = sensorState(eid, "5");
      entities[eid] = entityEntry("dev_rotterdam", "trees");
    });
    if (env === "multi-duplicate-keys") {
      states[ROTTERDAM_DUPLICATE_ID] = sensorState(ROTTERDAM_DUPLICATE_ID, "9");
      entities[ROTTERDAM_DUPLICATE_ID] = entityEntry("dev_rotterdam", "trees");
    }
  }

  if (env !== "single") {
    UTRECHT_IDS.forEach((eid, i) => {
      states[eid] = sensorState(eid, "20");
      if (env !== "bare") {
        entities[eid] = entityEntry("dev_utrecht", i === 0 ? "trees" : "grass");
      }
    });
    if (env !== "bare") {
      devices.dev_utrecht = identifierBacked(env).colliding
        ? UTRECHT_DEVICE
        : UTRECHT_DEVICE_TIER2;
    }
  }

  return {
    states,
    entities,
    devices,
    locale: { language: "en" },
    language: "en",
  } as unknown as HomeAssistant;
}

/** Same install, every registry/state object walked in the opposite order. */
function reversed(hass: HomeAssistant): HomeAssistant {
  const flip = (obj: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(obj).reverse());
  const h = hass as unknown as Record<string, Record<string, unknown>>;
  return {
    ...hass,
    states: flip(h.states!),
    entities: flip(h.entities!),
    devices: flip(h.devices!),
  } as HomeAssistant;
}

/**
 * A prefix form, described by *what it is* rather than by its name: `owns`
 * names the role of the device the prefix is the slug of, which is what decides
 * whether the ownership invariant applies. Invariant selection reads these
 * properties, never the form's name.
 */
interface PrefixForm {
  form: string;
  prefix: string;
  note: string;
  owns: "owner" | "colliding" | null;
}

const PREFIX_FORMS: PrefixForm[] = [
  {
    form: "1-renamed-device-slug",
    prefix: "kleenex_pollen_",
    note: "exact slug of the renamed device",
    owns: "owner",
  },
  {
    form: "2-legacy-device-slug",
    prefix: "kleenex_pollen_radar_utrecht_",
    note: "exact slug of the legacy device",
    owns: "colliding",
  },
  {
    form: "3-broad-legacy-prefix",
    prefix: "kleenex_pollen_radar_",
    note: "prefix of several locations' IDs, slug of none",
    owns: null,
  },
  {
    form: "4-truncated-non-slug",
    prefix: "kleenex_pol",
    note: "truncated, matches no device slug",
    owns: null,
  },
  {
    form: "5-non-slug-with-matches",
    prefix: "kleenex_",
    note: "matches every entity, slug of no device",
    owns: null,
  },
];

/**
 * What each environment *is*, so the invariants below can be selected from
 * properties instead of from the environment's name.
 *
 * This is not cosmetic. The first version gated the strongest invariant on
 * `env.startsWith("multi")`, and the two mixed-registry environments added
 * later silently opted out of it: a mutation that reverted half the tier-2 fix
 * kept the whole suite green while the bug was demonstrably back. A new
 * environment must now state its properties, and TypeScript will not let it be
 * added without them.
 */
interface EnvSpec {
  /** Any registry information at all (entity entries and/or devices). */
  hasRegistry: boolean;
  /** Device id of the device a prefix minted from a rename would belong to. */
  ownerDevice: string | null;
  /** Every other Kleenex device present, in the order they collide. */
  collidingDevices: string[];
  /** Locations discoverable from entity IDs alone (tier 3). */
  tier3Locations: number;
}

const ENV_SPECS: Record<Environment, EnvSpec> = {
  multi: {
    hasRegistry: true,
    ownerDevice: "dev_paris",
    collidingDevices: ["dev_utrecht"],
    tier3Locations: 1,
  },
  "multi-long": {
    hasRegistry: true,
    ownerDevice: "dev_paris",
    collidingDevices: ["dev_utrecht"],
    tier3Locations: 1,
  },
  "multi-legacy": {
    hasRegistry: true,
    ownerDevice: "dev_paris",
    collidingDevices: ["dev_utrecht", "dev_rotterdam"],
    tier3Locations: 2,
  },
  "multi-duplicate-keys": {
    hasRegistry: true,
    ownerDevice: "dev_paris",
    collidingDevices: ["dev_utrecht", "dev_rotterdam"],
    tier3Locations: 2,
  },
  "mixed-colliding-tier2": {
    hasRegistry: true,
    ownerDevice: "dev_paris",
    collidingDevices: ["dev_utrecht"],
    tier3Locations: 1,
  },
  "mixed-owner-tier2": {
    hasRegistry: true,
    ownerDevice: "dev_paris",
    collidingDevices: ["dev_utrecht"],
    tier3Locations: 1,
  },
  single: {
    hasRegistry: true,
    ownerDevice: "dev_paris",
    collidingDevices: [],
    tier3Locations: 0,
  },
  bare: {
    hasRegistry: false,
    ownerDevice: null,
    collidingDevices: [],
    tier3Locations: 1,
  },
};

/** The device the given prefix form is the slug of, in this cell. */
function ownedDevice(
  spec: EnvSpec,
  owner: OwnerMode,
  form: PrefixForm,
): string | null {
  if (form.owns === "owner") {
    // An owner absent from the registry cannot be recognised as one.
    return owner === "absent" ? null : spec.ownerDevice;
  }
  if (form.owns === "colliding") return spec.collidingDevices[0] ?? null;
  return null;
}

const ENVIRONMENTS: Environment[] = [
  "multi",
  "multi-long",
  "multi-legacy",
  "multi-duplicate-keys",
  "mixed-colliding-tier2",
  "mixed-owner-tier2",
  "single",
  "bare",
];
const OWNER_MODES: OwnerMode[] = [
  "available",
  "unavailable",
  "no-states",
  "absent",
];

/**
 * Combinations that cannot exist. Listed rather than skipped silently, so the
 * matrix documents its own shape.
 */
function invalidReason(env: Environment, owner: OwnerMode): string | null {
  if (env === "bare" && owner !== "absent") {
    return "a registry-less install has no registry entry for any device, so the owner can only be 'absent'";
  }
  if (owner === "absent" && env === "mixed-owner-tier2") {
    return "an owner known only through its entities' platform must have registry entries, so it cannot be absent from the registry";
  }
  if (owner === "absent" && env === "multi-long") {
    return "the long-entity-name variant exists to stress the remainder heuristic, which only runs for registry-known devices";
  }
  return null;
}

/** Kleenex device each kept entity belongs to, when the registry knows one. */
function devicesOf(hass: HomeAssistant, entityIds: string[]): Set<string> {
  const out = new Set<string>();
  const h = hass as unknown as {
    entities: Record<string, { device_id?: string }>;
  };
  for (const eid of entityIds) {
    const deviceId = h.entities?.[eid]?.device_id;
    if (deviceId) out.add(deviceId);
  }
  return out;
}

function labelOf(deviceId: string): string {
  if (deviceId === "dev_paris") return "Kleenex pollen";
  if (deviceId === "dev_rotterdam") return "Rotterdam";
  return "Utrecht";
}

describe("Kleenex manual-scope invariants (prefix forms x owner modes x environments)", () => {
  beforeEach(() => {
    _resetManualScopeWarningsForTest();
  });

  for (const env of ENVIRONMENTS) {
    for (const owner of OWNER_MODES) {
      const reason = invalidReason(env, owner);
      if (reason) {
        it(`${env}/${owner}: not a valid combination -- ${reason}`, () => {
          expect(reason).toBeTruthy();
        });
        continue;
      }

      const spec = ENV_SPECS[env];
      for (const formSpec of PREFIX_FORMS) {
        const { form, prefix, note } = formSpec;
        it(`${env}/${owner}/${form}: holds every invariant (${note})`, () => {
          const hass = buildHass(env, owner);
          const inputIds = Object.keys(
            (hass as unknown as { states: Record<string, unknown> }).states,
          );
          const scope = scopeManualEntities(hass, inputIds, { prefix });

          // Invariant: output is a subset of the input, order preserved.
          expect(inputIds.filter((id) => scope.entityIds.includes(id))).toEqual(
            scope.entityIds,
          );

          // Invariant: never two registry-known locations in one output.
          const keptDevices = devicesOf(hass, scope.entityIds);
          expect(keptDevices.size).toBeLessThanOrEqual(1);

          // Invariant: the header names the location the data comes from.
          if (scope.label) {
            for (const deviceId of keptDevices) {
              expect(labelOf(deviceId)).toBe(scope.label);
            }
          }

          // Invariant: an install where nothing can attribute an entity --
          // no registry, and too few tier-3 locations to tell them apart --
          // is returned untouched, with no header override.
          if (!spec.hasRegistry && spec.tier3Locations < 2) {
            expect(scope.entityIds).toEqual(inputIds);
            expect(scope.label).toBeNull();
          }

          // Invariant: when a registry-known device owns this prefix, no other
          // location's entities may appear -- not even when the owner has no
          // usable states and contributes nothing itself.
          const owned = ownedDevice(spec, owner, formSpec);
          if (owned) {
            expect([...keptDevices].filter((id) => id !== owned)).toEqual([]);
            for (const eid of scope.entityIds) {
              const deviceId = (hass as any).entities?.[eid]?.device_id;
              expect(deviceId === undefined || deviceId === owned).toBe(true);
            }
          }

          // Invariant: the outcome does not depend on registry/state iteration
          // order.
          _resetManualScopeWarningsForTest();
          const flipped = reversed(hass);
          const flippedIds = Object.keys(
            (flipped as unknown as { states: Record<string, unknown> }).states,
          );
          const flippedScope = scopeManualEntities(flipped, flippedIds, {
            prefix,
          });
          expect([...flippedScope.entityIds].sort()).toEqual(
            [...scope.entityIds].sort(),
          );
          expect(flippedScope.label).toBe(scope.label);
        });
      }
    }
  }

  // The load-bearing cells, pinned to concrete outcomes so a regression cannot
  // satisfy the generic invariants by narrowing to nothing everywhere.
  it("multi/available/renamed-slug keeps exactly the owner's entities", () => {
    const hass = buildHass("multi", "available");
    const scope = scopeManualEntities(hass, Object.keys((hass as any).states), {
      prefix: "kleenex_pollen_",
    });
    expect(scope.entityIds).toEqual(PARIS_IDS);
    expect(scope.label).toBe("Kleenex pollen");
  });

  it("multi/absent-owner/renamed-slug keeps the unregistered entities", () => {
    // The owner is not in the registry at all (template sensors). They must not
    // be silenced -- that is the documented carve-out -- so the Utrecht rows
    // ride along and no narrowing is claimed.
    const hass = buildHass("multi", "absent");
    const scope = scopeManualEntities(hass, Object.keys((hass as any).states), {
      prefix: "kleenex_pollen_",
    });
    for (const eid of PARIS_IDS) expect(scope.entityIds).toContain(eid);
  });

  it("multi/unavailable-owner/renamed-slug yields no foreign data", () => {
    const hass = buildHass("multi", "unavailable");
    const scope = scopeManualEntities(hass, Object.keys((hass as any).states), {
      prefix: "kleenex_pollen_",
    });
    expect(scope.entityIds).toEqual(PARIS_IDS);
  });

  // The docstring's boundary claim, pinned: "no registry" does not imply
  // "untouched". Tier-3 discovery attributes legacy IDs by their slug, so two
  // legacy locations are narrowed to one even with an empty registry -- what is
  // guaranteed is only that entities nothing can attribute survive.
  // Codex round 4: discovery keeps one entity per classified key, so the losing
  // location's duplicate was unattributed -- and unattributed means kept, which
  // let its data overwrite the winner's allergen values downstream.
  it("drops every entity of a losing location, duplicates included", () => {
    const hass = buildHass("multi-duplicate-keys", "absent");
    const ids = Object.keys((hass as any).states).filter((id) =>
      id.startsWith("sensor.kleenex_pollen_radar_"),
    );
    expect(ids).toContain(ROTTERDAM_DUPLICATE_ID);

    const scope = scopeManualEntities(hass, ids, {
      prefix: "kleenex_pollen_radar_",
    });

    expect(scope.entityIds).toEqual(UTRECHT_IDS);
    expect(scope.entityIds).not.toContain(ROTTERDAM_DUPLICATE_ID);
  });

  it("drops duplicates of a losing location without any registry", () => {
    // Tier-3 discovery keys locations by the legacy ID slug, so the duplicate
    // is placed by its own ID even though nothing else knows it.
    const legacyState = (id: string, city: string) => ({
      entity_id: id,
      state: "1",
      attributes: {
        friendly_name: `Kleenex Pollen Radar (${city}) Trees`,
        details: [],
        forecast: [],
      },
    });
    const hass = {
      states: {
        [UTRECHT_IDS[0]!]: legacyState(UTRECHT_IDS[0]!, "Utrecht"),
        [ROTTERDAM_IDS[0]!]: legacyState(ROTTERDAM_IDS[0]!, "Rotterdam"),
        [ROTTERDAM_DUPLICATE_ID]: legacyState(
          ROTTERDAM_DUPLICATE_ID,
          "Rotterdam",
        ),
      },
      entities: {},
      devices: {},
      locale: { language: "en" },
      language: "en",
    } as unknown as HomeAssistant;

    const scope = scopeManualEntities(hass, Object.keys((hass as any).states), {
      prefix: "kleenex_pollen_radar_",
    });

    expect(scope.entityIds).toEqual([UTRECHT_IDS[0]]);
  });

  it("narrows two legacy locations even with an empty registry", () => {
    // Realistic friendly names, since a registry-less install has nothing else
    // to derive a label from.
    const legacyState = (id: string, city: string) => ({
      entity_id: id,
      state: "1",
      attributes: {
        friendly_name: `Kleenex Pollen Radar (${city}) Trees`,
        details: [],
        forecast: [],
      },
    });
    const hass = {
      states: {
        [UTRECHT_IDS[0]!]: legacyState(UTRECHT_IDS[0]!, "Utrecht"),
        [ROTTERDAM_IDS[0]!]: legacyState(ROTTERDAM_IDS[0]!, "Rotterdam"),
      },
      entities: {},
      devices: {},
      locale: { language: "en" },
      language: "en",
    } as unknown as HomeAssistant;

    const scope = scopeManualEntities(hass, Object.keys((hass as any).states), {
      prefix: "kleenex_pollen_radar_",
    });

    expect(scope.entityIds).toEqual([UTRECHT_IDS[0]]);
    expect(scope.label).toBe("Utrecht");
  });

  // Single-entity cells. 776a559 lowered the entry guard from "at least two
  // matched entities" to "at least one", precisely so a lone entity from the
  // wrong device can be filtered out: an empty card for the right location
  // beats a populated one for the wrong city.
  it("drops a lone entity that belongs to another location", () => {
    const hass = buildHass("multi", "available");
    const scope = scopeManualEntities(hass, [UTRECHT_IDS[0]!], {
      prefix: "kleenex_pollen_",
    });

    expect(scope.entityIds).toEqual([]);
    expect(scope.label).toBe("Kleenex pollen");
  });

  it("keeps a lone entity that belongs to the owner", () => {
    const hass = buildHass("multi", "available");
    const scope = scopeManualEntities(hass, [PARIS_IDS[0]!], {
      prefix: "kleenex_pollen_",
    });

    expect(scope.entityIds).toEqual([PARIS_IDS[0]]);
    // Nothing was narrowed, so no header override is claimed.
    expect(scope.label).toBeNull();
  });

  it("multi-legacy/broad-prefix narrows to one legacy location and says so", () => {
    // No device slug equals `kleenex_pollen_radar`, so the fallback decides:
    // Utrecht's remainder ("utrecht_trees") is shorter than Rotterdam's. The
    // point of the cell is that one location wins and the user is told.
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(String(args[0]));
    try {
      const hass = buildHass("multi-legacy", "absent");
      const ids = Object.keys((hass as any).states).filter((id) =>
        id.startsWith("sensor.kleenex_pollen_radar_"),
      );
      const scope = scopeManualEntities(hass, ids, {
        prefix: "kleenex_pollen_radar_",
      });

      expect(scope.entityIds).toEqual(UTRECHT_IDS);
      expect(scope.label).toBe("Utrecht");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Utrecht");
      expect(warnings[0]).toContain("Rotterdam");
    } finally {
      console.warn = original;
    }
  });

  it("multi/legacy-slug picks the legacy device even though the other was renamed", () => {
    const hass = buildHass("multi", "available");
    const scope = scopeManualEntities(hass, Object.keys((hass as any).states), {
      prefix: "kleenex_pollen_radar_utrecht_",
    });
    expect(scope.entityIds).toEqual(UTRECHT_IDS);
    expect(scope.label).toBe("Utrecht");
  });
});
