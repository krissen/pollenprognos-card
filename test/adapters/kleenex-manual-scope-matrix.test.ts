import { describe, it, expect, beforeEach } from "vitest";
import {
  scopeManualEntities,
  discoverKleenex,
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

/**
 * A second renamed device ("Kleenex pollen zuid") with two entities that
 * classify to the same key. Its IDs are not legacy-shaped, so neither the
 * classified map (which keeps one entity per key) nor the legacy-slug step can
 * place the duplicate -- only the entity registry's device link can.
 */
const ZUID_DEVICE = {
  identifiers: [["kleenex_pollenradar", "Zuid"]],
  config_entries: ["cfg_zuid"],
  name: "Kleenex Pollen Radar (Zuid)",
  name_by_user: "Kleenex pollen zuid",
};
const ZUID_IDS = ["sensor.kleenex_pollen_zuid_trees"];
const ZUID_DUPLICATE_ID = "sensor.kleenex_pollen_zuid_bomen";

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
  | "multi-duplicate-renamed"
  | "device-less-owner"
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

function sensorState(entityId: string, state: string, friendlyName?: string) {
  return {
    entity_id: entityId,
    state,
    attributes: {
      friendly_name: friendlyName ?? entityId,
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
  // Entities on no device derive their location label from friendly_name, so
  // the fixture has to carry realistic ones for that environment.
  let parisFriendly = false;

  if (env !== "bare") {
    // Owner (Paris). In the device-less environment its entities are in the
    // registry with our platform but attached to no device at all, which is
    // the only way an entity reaches discovery's "default" bucket.
    if (owner !== "absent" && env === "device-less-owner") {
      parisFriendly = true;
      paris.forEach((eid, i) => {
        entities[eid] = {
          device_id: null,
          platform: "kleenex_pollenradar",
          translation_key: i === 0 ? "trees" : "grass",
          unique_id: null,
          entity_category: null,
        };
      });
    } else if (owner !== "absent") {
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
    const friendlyFor = (index: number) =>
      parisFriendly
        ? `Kleenex pollen ${index === 0 ? "Trees" : "Grass"}`
        : undefined;
    if (owner === "available" || owner === "absent") {
      paris.forEach((eid, i) => {
        states[eid] = sensorState(eid, "100", friendlyFor(i));
      });
    } else if (owner === "unavailable") {
      paris.forEach((eid, i) => {
        states[eid] = sensorState(eid, "unavailable", friendlyFor(i));
      });
    }
    // owner === "no-states": registry entries only, no state objects.
  } else {
    paris.forEach((eid) => (states[eid] = sensorState(eid, "100")));
  }

  if (env === "multi-duplicate-renamed") {
    devices.dev_zuid = ZUID_DEVICE;
    [...ZUID_IDS, ZUID_DUPLICATE_ID].forEach((eid) => {
      states[eid] = sensorState(eid, "7");
      entities[eid] = entityEntry("dev_zuid", "trees");
    });
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

  if (env !== "single" && env !== "multi-duplicate-renamed") {
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
  /**
   * The device this prefix is the slug of, named concretely. The ownership
   * invariant applies only when that device actually exists in the cell's
   * registry -- naming a role instead ("the first colliding device") silently
   * pointed the assertion at whichever device an environment happened to list.
   */
  ownsDevice: string | null;
}

const PREFIX_FORMS: PrefixForm[] = [
  {
    form: "1-renamed-device-slug",
    prefix: "kleenex_pollen_",
    note: "exact slug of the renamed device",
    ownsDevice: "dev_paris",
  },
  {
    form: "2-legacy-device-slug",
    prefix: "kleenex_pollen_radar_utrecht_",
    note: "exact slug of the legacy device",
    ownsDevice: "dev_utrecht",
  },
  {
    form: "3-broad-legacy-prefix",
    prefix: "kleenex_pollen_radar_",
    note: "prefix of several locations' IDs, slug of none",
    ownsDevice: null,
  },
  {
    form: "4-truncated-non-slug",
    prefix: "kleenex_pol",
    note: "truncated, matches no device slug",
    ownsDevice: null,
  },
  {
    form: "5-non-slug-with-matches",
    prefix: "kleenex_",
    note: "matches every entity, slug of no device",
    ownsDevice: null,
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
  "multi-duplicate-renamed": {
    hasRegistry: true,
    ownerDevice: "dev_paris",
    collidingDevices: ["dev_zuid"],
    tier3Locations: 0,
  },
  "device-less-owner": {
    // The owner's entities hang off no device, so no device slug can own a
    // prefix here and every cell falls through to the discovery steps.
    hasRegistry: true,
    ownerDevice: null,
    collidingDevices: ["dev_utrecht"],
    tier3Locations: 1,
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

/** The device the given prefix form is the slug of, if this cell has it. */
function ownedDevice(
  spec: EnvSpec,
  owner: OwnerMode,
  form: PrefixForm,
): string | null {
  const device = form.ownsDevice;
  if (!device) return null;
  // The owner device is only in the registry when the owner mode says so.
  if (device === spec.ownerDevice) return owner === "absent" ? null : device;
  return spec.collidingDevices.includes(device) ? device : null;
}

const ENVIRONMENTS: Environment[] = [
  "multi",
  "multi-long",
  "multi-legacy",
  "multi-duplicate-keys",
  "multi-duplicate-renamed",
  "device-less-owner",
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

/**
 * The registry-known locations the given entities belong to: their device, or
 * the shared device-less bucket for registry entries with our platform and no
 * device (discovery keys those as "default"). Counting devices alone would miss
 * a merge that involves the device-less bucket.
 */
function devicesOf(hass: HomeAssistant, entityIds: string[]): Set<string> {
  const out = new Set<string>();
  const h = hass as unknown as {
    entities: Record<string, { device_id?: string | null; platform?: string }>;
  };
  for (const eid of entityIds) {
    const entry = h.entities?.[eid];
    if (!entry) continue;
    if (entry.device_id) out.add(entry.device_id);
    else if (entry.platform === "kleenex_pollenradar") out.add("deviceless");
  }
  return out;
}

function labelOf(deviceId: string): string {
  if (deviceId === "dev_zuid") return "Kleenex pollen zuid";
  if (deviceId === "deviceless") return "Kleenex pollen";
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
          //
          // Carve-out, same spirit as the unregistered one: the device-ownership
          // step decides membership purely on the entity registry's device link,
          // so a registry entry with our platform and no device at all is not
          // "another device" to it and rides along. Deliberate -- were the link
          // ever missing wholesale, dropping would leave an empty card, while
          // keeping degrades to the pre-narrowing behaviour. The step's own
          // cells below pin what it does keep.
          const owned = ownedDevice(spec, owner, formSpec);
          const keptDevices = devicesOf(hass, scope.entityIds);
          const countedDevices = owned
            ? new Set([...keptDevices].filter((id) => id !== "deviceless"))
            : keptDevices;
          expect(countedDevices.size).toBeLessThanOrEqual(1);

          // Invariant: the header names the location the data comes from.
          if (scope.label) {
            for (const deviceId of countedDevices) {
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
          if (owned) {
            expect([...countedDevices].filter((id) => id !== owned)).toEqual(
              [],
            );
            for (const eid of scope.entityIds) {
              const deviceId = (hass as any).entities?.[eid]?.device_id;
              expect(
                deviceId === undefined ||
                  deviceId === null ||
                  deviceId === owned,
              ).toBe(true);
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

  // Nagelfar round 5: the duplicate in the cell above sits on legacy-shaped IDs,
  // so the legacy-slug step can place it and the device link is not what drops
  // it. Here the losing device is renamed -- its IDs carry no legacy slug -- so
  // the classified map (one entity per key) and the slug step both come up
  // empty, and only the entity registry's device link can attribute it.
  it("drops a duplicate on a renamed losing device, which only the device link can place", () => {
    const hass = buildHass("multi-duplicate-renamed", "available");
    const ids = Object.keys((hass as any).states);
    expect(ids).toContain(ZUID_DUPLICATE_ID);

    // Precondition: discovery's classified map does not hold the duplicate.
    const discovery = discoverKleenex(hass);
    const zuid = discovery.locations.get("zuid");
    expect([...(zuid?.entities.values() ?? [])]).not.toContain(
      ZUID_DUPLICATE_ID,
    );
    // Precondition: its ID is not legacy-shaped, so the slug step has no key.
    expect(discovery.locations.has("kleenex_pollen_zuid")).toBe(false);

    // A prefix no device slug answers to, so the device-ownership step stands
    // aside and the attribution chain inside the discovery path decides.
    const scope = scopeManualEntities(hass, ids, { prefix: "kleenex_pol" });

    expect(scope.entityIds).toEqual(PARIS_IDS);
    expect(scope.label).toBe("Kleenex pollen");
  });

  // The device-less bucket: registry entries with our platform and no device at
  // all, which discovery keys as "default". Nothing but discovery's classified
  // map can attribute those -- their IDs carry no legacy slug and there is no
  // device to link -- so this cell is what keeps that step honest.
  it("narrows to a device-less owner, which only the classified map can place", () => {
    const hass = buildHass("device-less-owner", "available");
    const ids = Object.keys((hass as any).states);

    const discovery = discoverKleenex(hass);
    expect(discovery.locations.get("default")?.entities.size).toBe(2);
    expect(discovery.locations.has("kleenex_pollen")).toBe(false);

    const scope = scopeManualEntities(hass, ids, { prefix: "kleenex_pollen_" });

    expect(scope.entityIds).toEqual(PARIS_IDS);
    for (const eid of UTRECHT_IDS) expect(scope.entityIds).not.toContain(eid);
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
