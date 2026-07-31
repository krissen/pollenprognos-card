// src/adapters/kleenex/forecast.ts
import type { HassEntity, HomeAssistant } from "../../types/home-assistant.js";
import type { CardConfig } from "../../types/config.js";
import type { PollenSensor, ForecastDay } from "../../types/sensor.js";
import { t } from "../../i18n.js";
import { KLEENEX_LOCALIZED_CATEGORY_NAMES } from "../../constants.js";
import { slugify } from "../../utils/slugify.js";
import { buildLevelNames } from "../../utils/level-names.js";
import {
  getLangAndLocale,
  mergePhrases,
  buildDayLabel,
  clampLevel,
  sortSensors,
  meetsThreshold,
  resolveAllergenNames,
  normalizeManualPrefix,
} from "../../utils/adapter-helpers.js";
import {
  DOMAIN,
  KLEENEX_ALLERGEN_MAP,
  stubConfigKleenex,
} from "./constants.js";
import {
  CATEGORY_KEYS,
  DIAGNOSTIC_SUFFIXES,
  canonicalAllergenFromSlug,
  normalizeDetailName,
  resolveKleenexLocation,
  scopeManualEntities,
} from "./discovery.js";
import { ppmToLevel } from "./levels.js";

// One collected day of data for an allergen (raw level 0-4 plus the ppm value).
interface KleenexLevelDay {
  date: Date;
  level: number;
  value: number;
}

// Per-allergen collection bucket accumulated across the sensor passes.
interface KleenexAllergenEntry {
  levels: KleenexLevelDay[];
  entity_id: string;
  source: string;
}

// A forecast/detail item as reported by the integration (loosely shaped).
type KleenexItem = Record<string, unknown>;

// Track which (location, entity_prefix) combinations have already received the
// NA-zone warning so it isn't re-emitted on every HA state update.
const NA_WARNED_KEYS = new Set<string>();

// Test-only hook to clear the dedup state between cases.
export function _resetNaWarningsForTest(): void {
  NA_WARNED_KEYS.clear();
}

export async function fetchForecast(
  hass: HomeAssistant,
  config: CardConfig,
): Promise<PollenSensor[]> {
  const { lang, locale, daysRelative, dayAbbrev, daysUppercase } =
    getLangAndLocale(hass, config);
  const debug = config.debug;
  const days_to_show =
    (config.days_to_show as number) ||
    (stubConfigKleenex.days_to_show as number);
  const { fullPhrases, shortPhrases, userLevels, userDays, noInfoLabel } =
    mergePhrases(config, lang);
  const pollen_threshold =
    (config.pollen_threshold as number | undefined) ??
    (stubConfigKleenex.pollen_threshold as number);
  const allergens = config.allergens as string[];

  // Kleenex uses 5-level system (0-4), validate and clamp level values.
  // TODO(#259-normalize): preserve the native 0-4 scale (scaled to 0-6 only for
  // the level-name lookup below, mirroring PEU).
  const testVal = (v: unknown): number => clampLevel(v, 4, -1);

  if (debug)
    console.debug("[Kleenex] Adapter: start fetchForecast", { config, lang });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all kleenex sensors.
  //
  // Manual mode is collected separately: the user-supplied entity_prefix is the
  // whole naming contract there, and it need not contain the legacy
  // `kleenex_pollen_radar_` slug at all. The integration derives entity IDs from
  // the (renameable) device name, so a device renamed to "Kleenex pollen" yields
  // `sensor.kleenex_pollen_trees` (issue #309). Prefiltering on the legacy slug
  // before applying the prefix would drop those entities entirely.
  const manualPrefix =
    config.location === "manual"
      ? normalizeManualPrefix(config.entity_prefix)
      : "";
  let kleenexSensors: HassEntity[];
  // entity_id -> classified key from registry discovery. Empty on the legacy
  // paths, where the passes below fall back to the entity-ID heuristics.
  let keyByEntityId = new Map<string, string>();
  const located =
    config.location === "manual"
      ? null
      : resolveKleenexLocation(hass, config, !!debug);
  if (located === "ambiguous") {
    // Several locations answer to the configured value. Rendering one of them
    // would be a guess -- and the legacy entity-ID scan below would make that
    // guess for us, by picking whichever colliding device kept the unsuffixed
    // IDs. Return nothing so the card shows its own "no sensors" error.
    if (debug) {
      console.debug(
        `[Kleenex] Location '${config.location}' is ambiguous; returning no sensors`,
      );
    }
    return [];
  }
  if (located) {
    kleenexSensors = located.states;
    keyByEntityId = located.keyByEntityId;
  } else if (manualPrefix) {
    const expectedPrefix = `sensor.${manualPrefix}`;
    // The configured suffix is part of the naming contract, not decoration:
    // an install can hold both `..._birch` and `..._birch_v2`, and collecting
    // both would let state insertion order decide which one the allergen map
    // keeps -- while resolveEntityIds unambiguously selects the suffixed one.
    const manualSuffix =
      typeof config.entity_suffix === "string" ? config.entity_suffix : "";
    if (debug) {
      console.debug(
        `[Kleenex] Manual mode filtering with prefix: '${manualPrefix}'${manualSuffix ? `, suffix: '${manualSuffix}'` : ""}`,
      );
    }
    kleenexSensors = Object.values(hass.states).filter((entity) => {
      const matches =
        !!entity.entity_id &&
        entity.entity_id.startsWith(expectedPrefix) &&
        (!manualSuffix || entity.entity_id.endsWith(manualSuffix));
      if (debug && matches) {
        console.debug(`[Kleenex] Manual mode match: ${entity.entity_id}`);
      }
      return matches;
    });
    // A prefix can straddle two config entries (`kleenex_pollen_` also matches
    // another location's legacy `kleenex_pollen_radar_utrecht_*` IDs), which
    // would merge two cities into one set of rows. Narrow to a single location
    // when the registry can tell them apart.
    const scoped = scopeManualEntities(
      hass,
      kleenexSensors.map((s) => s.entity_id),
      { prefix: manualPrefix, suffix: manualSuffix, debug: !!debug },
    );
    if (scoped.entityIds.length !== kleenexSensors.length) {
      const keep = new Set(scoped.entityIds);
      kleenexSensors = kleenexSensors.filter((s) => keep.has(s.entity_id));
    }
    if (debug) {
      console.debug(
        `[Kleenex] After manual mode filtering: ${kleenexSensors.length} sensors with prefix '${expectedPrefix}'`,
      );
    }
  } else {
    kleenexSensors = Object.values(hass.states).filter((entity) => {
      return (
        entity.entity_id && entity.entity_id.startsWith(`sensor.${DOMAIN}_`)
      );
    });
  }

  // Filter by location if specified (and not manual mode). Registry discovery
  // has already narrowed the set to one location when it matched.
  if (!located && config.location && config.location !== "manual") {
    const wantedLocation = slugify(config.location as string);

    if (debug) {
      console.debug(
        `[Kleenex] Filtering sensors for location: ${config.location} (normalized: ${wantedLocation})`,
      );
    }

    kleenexSensors = kleenexSensors.filter((entity) => {
      const eid = entity.entity_id.replace(`sensor.${DOMAIN}_`, "");
      const locPart = eid.replace(/_[^_]+$/, ""); // Remove the last part (allergen/type)
      const matches = locPart === wantedLocation;

      if (debug && matches) {
        console.debug(
          `[Kleenex] Location match: ${entity.entity_id} -> locPart: ${locPart}`,
        );
      }

      return matches;
    });

    if (debug) {
      console.debug(
        `[Kleenex] After location filtering: ${kleenexSensors.length} sensors for location '${wantedLocation}'`,
      );
    }
  }

  if (debug) {
    console.debug(
      "[Kleenex] Sensors found:",
      kleenexSensors.map((s) => s.entity_id),
    );
  }

  // Effective last token of an entity_id, accounting for manual-mode
  // entity_suffix (e.g. `..._trees_v2` should resolve to `trees`). Shared by
  // both passes and the NA warning so they cannot disagree about what a given
  // entity is.
  const effectiveLastToken = (entityId: string): string => {
    let id = entityId;
    const entitySuffix =
      typeof config.entity_suffix === "string" ? config.entity_suffix : "";
    if (
      config.location === "manual" &&
      entitySuffix &&
      id.endsWith(entitySuffix)
    ) {
      id = id.slice(0, -entitySuffix.length);
    }
    return id.split("_").pop() as string;
  };

  // The category an entity ID names through its localized last token
  // ("trees"/"bomen"/"arbres"...), or null when it names none.
  const categoryFromEntityToken = (entityId: string): string | null => {
    const entityToken = effectiveLastToken(entityId);
    for (const [localizedPrefix, canonicalCategory] of Object.entries(
      KLEENEX_LOCALIZED_CATEGORY_NAMES,
    )) {
      if (entityToken.startsWith(localizedPrefix)) return canonicalCategory;
    }
    return null;
  };

  // True when the entity is a category sensor: registry classification first,
  // localized entity-ID suffix as fallback.
  const isCategorySensorEntity = (entityId: string): boolean => {
    const key = keyByEntityId.get(entityId);
    if (key) return CATEGORY_KEYS.has(key);
    return categoryFromEntityToken(entityId) !== null;
  };

  // --- NA/US category fallback (issue #313) ---
  //
  // The NA endpoint hardcodes empty details[] (api.py:__decode_raw_data_na), so
  // a US/Canada location only ever reports the three category totals. The stub
  // config ships individual allergens, which left every US card empty even
  // though the category sensors carried data. When the resolved location shows
  // that fingerprint, the category allergens stand in for the per-allergen rows
  // the zone cannot deliver.
  //
  // All-or-nothing on purpose. A single category with empty details is not the
  // NA fingerprint -- EU zones deliver details for all three, down to entries
  // whose value is 0 -- so one anomalous payload would otherwise splice a
  // category row in among the individual ones and silently change what an EU
  // card shows. Requiring every category sensor to be detail-less keeps this to
  // the zone it was written for.
  //
  // Both category shapes count as "the user configured categories": `trees_cat`
  // and bare `trees` are valid category configs here, and either means the user
  // has already decided what to show, so nothing is added behind their back.
  const configuredAllergens = Array.isArray(allergens) ? allergens : [];
  const categoryAllergenKeys = [
    "trees_cat",
    "grass_cat",
    "weeds_cat",
    "trees",
    "grass",
    "weeds",
  ];
  // The set the fallback adds, and the one the warning recommends: NA users
  // belong on *_cat, not on the raw category names.
  const recommendedCategoryKeys = ["trees_cat", "grass_cat", "weeds_cat"];
  const requestedIndividual = configuredAllergens.filter(
    (a) => !categoryAllergenKeys.includes(a),
  );
  // Only evaluated over category sensors that were actually found, so an empty
  // sensor set (location mismatch) cannot satisfy the fingerprint vacuously.
  const categorySensorsFound = kleenexSensors.filter((sensor) =>
    isCategorySensorEntity(sensor.entity_id),
  );
  // Attribute arrays arrive from HA exactly as the integration wrote them, so
  // the fingerprint has to survive a `forecast` that is not an array and a
  // forecast day that is null. This check runs before the collection passes and
  // outside their try blocks: a throw here would reject the whole fetch and
  // blank a card that has nothing wrong with it.
  const isItemArray = (value: unknown): value is KleenexItem[] =>
    Array.isArray(value) &&
    value.every((item) => !!item && typeof item === "object");
  // "No details" means absent or an empty array. Anything else is either real
  // per-allergen data or a shape we do not recognise; neither is the NA zone.
  const hasNoDetails = (value: unknown): boolean =>
    value === null ||
    value === undefined ||
    (isItemArray(value) && value.length === 0);
  const naDetailsFingerprint =
    categorySensorsFound.length > 0 &&
    categorySensorsFound.every((sensor) => {
      const attrs = sensor.attributes || {};
      const forecast = attrs.forecast;
      // NA always returns a forecast of well-formed days; requiring one keeps
      // synthetic/empty fixtures and malformed payloads from tripping the
      // fingerprint.
      if (!isItemArray(forecast) || forecast.length === 0) return false;
      return (
        hasNoDetails(attrs.details) &&
        forecast.every((day) => hasNoDetails(day.details))
      );
    });
  const categoryConfigured = configuredAllergens.some((a) =>
    categoryAllergenKeys.includes(a),
  );
  // The config key a category sensor answers to: `<category>_cat` when the
  // allergen list asks for that, otherwise the bare category name -- both are
  // valid category configs in this adapter.
  const categoryConfigName = (category: string, list: string[]): string =>
    list.includes(`${category}_cat`) ? `${category}_cat` : category;

  let sensors: PollenSensor[] = [];
  const allergenData = new Map<string, KleenexAllergenEntry>(); // Map to collect data by allergen name

  // Collect one category sensor's state and forecast under the given allergen
  // key. Shared by the normal pass and the NA fallback below, so the two cannot
  // drift apart in how a category row is built.
  const collectCategorySensor = (
    sensor: HassEntity,
    configAllergenName: string,
  ): void => {
    const forecastData: KleenexItem[] = sensor.attributes?.forecast || [];

    if (!allergenData.has(configAllergenName)) {
      allergenData.set(configAllergenName, {
        levels: [],
        entity_id: sensor.entity_id,
        source: "category_sensor", // Track data source
      });
    }

    const allergenEntry = allergenData.get(configAllergenName)!;

    // Today's data from sensor state - prioritize numeric value over level text.
    // A non-numeric state (`unavailable`, `unknown`) is an outage, not a
    // reading: it becomes the -1 no-information sentinel, the same way the
    // DetailSensor pass treats one. Reading it as 0 ppm would turn a dead
    // entity into "no pollen", or -- with the default threshold -- drop the row
    // without a word.
    const parsedState = Number(sensor.state);
    const hasReading = Number.isFinite(parsedState);
    const sensorValue = hasReading ? parsedState : -1;
    const currentLevel = testVal(
      hasReading ? ppmToLevel(sensorValue, configAllergenName) : -1,
    );

    if (debug) {
      console.debug(
        `[Kleenex] CATEGORY ${configAllergenName} TODAY: sensor_state=${sensor.state}, parsed_value=${sensorValue}, clamped_level=${currentLevel}, text_level=${sensor.attributes?.level}`,
      );
    }

    allergenEntry.levels[0] = {
      date: new Date(today),
      level: currentLevel, // Store raw level (0-4)
      value: sensorValue,
    };

    forecastData.forEach((forecastItem, dayIndex) => {
      const forecastValue = Number(forecastItem.value) || 0;
      const forecastLevel = testVal(
        ppmToLevel(forecastValue, configAllergenName),
      );

      if (debug) {
        console.debug(
          `[Kleenex] CATEGORY ${configAllergenName} FORECAST day ${dayIndex + 1}: value=${forecastValue}, clamped_level=${forecastLevel}, text_level=${forecastItem.level}`,
        );
      }

      allergenEntry.levels[dayIndex + 1] = {
        date: new Date(today.getTime() + (dayIndex + 1) * 86400000),
        level: forecastLevel, // Store raw level (0-4)
        value: forecastValue,
      };
    });
  };

  if (debug) {
    console.debug(
      `[Kleenex] Processing ${kleenexSensors.length} sensors for allergens:`,
      config.allergens,
    );
  }

  // Process each kleenex sensor to extract allergen data
  for (const sensor of kleenexSensors) {
    if (debug) {
      console.debug(`[Kleenex] === PROCESSING SENSOR: ${sensor.entity_id} ===`);
    }

    const attributes = sensor.attributes || {};
    const details: KleenexItem[] = attributes.details || [];
    const forecastData: KleenexItem[] = attributes.forecast || [];

    // Determine the sensor category: registry classification when discovery
    // resolved this entity, otherwise the localized entity-ID token. The token
    // must be the *effective* one, i.e. with any manual-mode entity_suffix
    // removed -- `..._trees_v2` yields "v2" otherwise, and a category-only
    // (NA-zone) config would collect nothing here while pass 2 correctly skips
    // the same entity as a category sensor.
    const discoveredKey = keyByEntityId.get(sensor.entity_id);
    const sensorCategory: string | null = discoveredKey
      ? CATEGORY_KEYS.has(discoveredKey)
        ? discoveredKey
        : null
      : categoryFromEntityToken(sensor.entity_id);

    if (debug) {
      console.debug(
        `[Kleenex] Processing sensor ${sensor.entity_id}, category: ${sensorCategory}, details count: ${details.length}, forecast days: ${forecastData.length}`,
      );
    }

    // Process general category sensor (trees, grass, weeds) - only if category is requested
    if (sensorCategory) {
      const configAllergenName = categoryConfigName(
        sensorCategory,
        configuredAllergens,
      );

      if (debug) {
        console.debug(
          `[Kleenex] Category sensor mapping: ${sensorCategory} -> ${configAllergenName}, included in config: ${configuredAllergens.includes(configAllergenName)}`,
        );
      }

      // Only process if the config allergen name is requested
      if (configuredAllergens.includes(configAllergenName)) {
        collectCategorySensor(sensor, configAllergenName);
      } else if (debug) {
        console.debug(
          `[Kleenex] SKIPPING category sensor ${sensorCategory} -> ${configAllergenName}: not in config.allergens [${configuredAllergens.join(", ")}]`,
        );
      }
    }

    // Extract individual allergens from current details - only if specific allergen is requested
    if (debug) {
      console.debug(
        `[Kleenex] Processing ${details.length} individual allergen details for sensor: ${sensor.entity_id}`,
      );
    }

    try {
      for (const detail of details) {
        const allergenName = normalizeDetailName(detail.name);
        if (!allergenName) continue;

        const canonicalName =
          KLEENEX_ALLERGEN_MAP[allergenName] || allergenName;

        // Skip if this allergen is not in the config
        if (!configuredAllergens.includes(canonicalName)) {
          if (debug && detail.value !== undefined) {
            console.debug(
              `[Kleenex] SKIPPING individual allergen ${canonicalName} (${allergenName}): not in config allergens`,
            );
          }
          continue;
        }

        if (debug) {
          console.debug(
            `[Kleenex] Processing INDIVIDUAL allergen: ${canonicalName} (original: ${allergenName})`,
          );
        }

        if (!allergenData.has(canonicalName)) {
          allergenData.set(canonicalName, {
            levels: [],
            entity_id: sensor.entity_id,
            source: "individual_details", // Track data source
          });
        }

        const allergenEntry = allergenData.get(canonicalName)!;

        // Today's data - prioritize numeric value over level text
        const detailValue = Number(detail.value) || 0;
        const rawLevel = ppmToLevel(detailValue, canonicalName); // Calculate raw level (0-4)
        const currentLevel = testVal(rawLevel); // Validate and clamp level (0-4)

        if (debug) {
          console.debug(
            `[Kleenex] INDIVIDUAL ${canonicalName} TODAY: detail_value=${detail.value}, parsed_value=${detailValue}, raw_level=${rawLevel}, clamped_level=${currentLevel}, text_level=${detail.level}, source=${sensor.entity_id}`,
          );
        }

        // Only set if not already set by category processing (avoid overwriting)
        if (
          !allergenEntry.levels[0] ||
          allergenEntry.source === "individual_details"
        ) {
          allergenEntry.levels[0] = {
            date: new Date(today),
            level: currentLevel, // Store raw level (0-4)
            value: detailValue,
          };
        }
      }
    } catch (error) {
      if (debug) {
        console.warn(
          `[Kleenex] Error processing individual allergens for sensor ${sensor.entity_id}:`,
          error,
        );
      }
    }

    // Extract forecast data for each day (individual allergens)
    try {
      forecastData.forEach((forecastItem, dayIndex) => {
        const forecastDate = new Date(
          today.getTime() + (dayIndex + 1) * 86400000,
        );
        const forecastDetails: KleenexItem[] =
          (forecastItem.details as KleenexItem[]) || [];

        if (debug && forecastDetails.length > 0) {
          console.debug(
            `[Kleenex] Processing forecast day ${dayIndex + 1} with ${forecastDetails.length} allergen details`,
          );
        }

        for (const detail of forecastDetails) {
          const allergenName = normalizeDetailName(detail.name);
          if (!allergenName) continue;

          const canonicalName =
            KLEENEX_ALLERGEN_MAP[allergenName] || allergenName;

          // Skip if this allergen is not in the config
          if (!configuredAllergens.includes(canonicalName)) continue;

          if (!allergenData.has(canonicalName)) {
            allergenData.set(canonicalName, {
              levels: [],
              entity_id: sensor.entity_id,
              source: "individual_forecast", // Track data source
            });
          }

          const allergenEntry = allergenData.get(canonicalName)!;
          const forecastValue = Number(detail.value) || 0;
          const rawLevel = ppmToLevel(forecastValue, canonicalName); // Calculate raw level (0-4)
          const forecastLevel = testVal(rawLevel); // Validate and clamp level (0-4)

          if (debug) {
            console.debug(
              `[Kleenex] INDIVIDUAL ${canonicalName} FORECAST day ${dayIndex + 1}: detail_value=${detail.value}, parsed_value=${forecastValue}, raw_level=${rawLevel}, clamped_level=${forecastLevel}, text_level=${detail.level}`,
            );
          }

          // Only set if not already set by category processing (avoid overwriting)
          const dayIdx = dayIndex + 1;
          if (
            !allergenEntry.levels[dayIdx] ||
            allergenEntry.source === "individual_forecast" ||
            allergenEntry.source === "individual_details"
          ) {
            allergenEntry.levels[dayIdx] = {
              date: forecastDate,
              level: forecastLevel, // Store raw level (0-4)
              value: forecastValue,
            };
          }
        }
      });
    } catch (error) {
      if (debug) {
        console.warn(
          `[Kleenex] Error processing forecast data for sensor ${sensor.entity_id}:`,
          error,
        );
      }
    }
  }

  // --- Pass 2: DetailSensor fallback ---
  // For zones where category sensor details[] is empty (e.g. NA/US endpoint hardcodes
  // empty details — see api.py:__decode_raw_data_na), try individually-enabled
  // DetailSensor entities (disabled by default in HA registry).

  for (const sensor of kleenexSensors) {
    // Only consider sensors that were NOT identified as category sensors.
    if (isCategorySensorEntity(sensor.entity_id)) continue;

    // Registry-classified detail sensors carry their canonical allergen already.
    const discoveredAllergen = keyByEntityId.get(sensor.entity_id);

    // Derive the allergen suffix from the entity_id.
    let allergenSuffix: string;
    if (config.location === "manual" && config.entity_prefix) {
      // Manual mode: user-supplied entity_prefix already covers the whole prefix
      // up to <allergen>; strip it from the full entity_id.
      const fullPrefix = `sensor.${normalizeManualPrefix(config.entity_prefix)}`;
      if (!sensor.entity_id.startsWith(fullPrefix)) continue;
      allergenSuffix = sensor.entity_id.slice(fullPrefix.length);
      // Discovery builds entity_ids as `${prefix}${aliasSlug}${entity_suffix}` —
      // strip the same trailing suffix here so the alias lookup matches.
      const entitySuffix = config.entity_suffix as string | undefined;
      if (entitySuffix && allergenSuffix.endsWith(entitySuffix)) {
        allergenSuffix = allergenSuffix.slice(0, -entitySuffix.length);
      }
    } else {
      // Standard mode: strip domain prefix, then the configured location slug.
      const domainPrefix = `sensor.${DOMAIN}_`;
      allergenSuffix = sensor.entity_id.startsWith(domainPrefix)
        ? sensor.entity_id.slice(domainPrefix.length)
        : sensor.entity_id;
      if (config.location && config.location !== "manual") {
        const locationSlug = slugify(config.location as string);
        if (allergenSuffix.startsWith(locationSlug + "_")) {
          allergenSuffix = allergenSuffix.slice(locationSlug.length + 1);
        }
      }
    }

    let derivedName: string | undefined = discoveredAllergen;
    if (!derivedName) {
      // Skip diagnostic entities (single-token like `date`, `region`,
      // multi-token like `last_updated`, and any `<allergen>_level` variant).
      if (DIAGNOSTIC_SUFFIXES.has(allergenSuffix)) continue;
      if (allergenSuffix.endsWith("_level")) continue;

      // Check whether this suffix matches a known allergen alias (by slug). When
      // config.location is unset, the location segment couldn't be stripped
      // above, so the helper also tries progressively shorter trailing slug
      // candidates.
      derivedName = canonicalAllergenFromSlug(allergenSuffix);
    }
    if (!derivedName) continue;
    const canonicalName = derivedName;

    // Skip allergens not requested in config.
    if (!configuredAllergens.includes(canonicalName)) continue;

    // Only fill slots not already populated by category-sensor pass.
    if (allergenData.has(canonicalName)) continue;

    // Skip when the sensor reports a non-numeric state (`unknown`,
    // `unavailable`, etc.) — treating those as 0 ppm would mask real
    // outages and falsely suppress the NA warning.
    const parsedState = Number(sensor.state);
    if (!Number.isFinite(parsedState)) continue;

    if (debug) {
      console.debug(
        `[Kleenex] DetailSensor fallback: ${sensor.entity_id} -> ${canonicalName}`,
      );
    }

    allergenData.set(canonicalName, {
      levels: [],
      entity_id: sensor.entity_id,
      source: "detail_sensor",
    });

    const allergenEntry = allergenData.get(canonicalName)!;
    const rawLevel = ppmToLevel(parsedState, canonicalName);
    const currentLevel = testVal(rawLevel);

    allergenEntry.levels[0] = {
      date: new Date(today),
      level: currentLevel,
      value: parsedState,
    };

    // DetailSensor forecast: [{date, value}] — no per-allergen level field.
    // Non-numeric forecast values are treated as missing-day sentinels (-1).
    const detailForecast: KleenexItem[] = sensor.attributes?.forecast || [];
    detailForecast.forEach((forecastItem, dayIndex) => {
      const parsedForecast = Number(forecastItem.value);
      const forecastValue = Number.isFinite(parsedForecast)
        ? parsedForecast
        : -1;
      const fRawLevel =
        forecastValue < 0 ? -1 : ppmToLevel(forecastValue, canonicalName);
      const forecastLevel = testVal(fRawLevel);
      allergenEntry.levels[dayIndex + 1] = {
        date: new Date(today.getTime() + (dayIndex + 1) * 86400000),
        level: forecastLevel,
        value: forecastValue,
      };
    });
  }

  // --- Pass 3: NA/US category fallback (issue #313) ---
  // Every configured allergen came back empty, and the location carries the NA
  // fingerprint: the category sensors have the data, the zone simply has no
  // per-allergen breakdown to give. Show the category totals rather than an
  // empty card.
  //
  // Decided here rather than up front on purpose: passes 1 and 2 must be given
  // their chance first, so an install that has enabled the per-allergen
  // DetailSensor entities keeps rendering exactly those and never grows a
  // category row it did not ask for.
  const individualAllEmpty = requestedIndividual.every(
    (a) => !allergenData.has(a),
  );
  const naFallbackActive =
    naDetailsFingerprint &&
    !categoryConfigured &&
    requestedIndividual.length > 0 &&
    individualAllEmpty;
  const effectiveAllergens = naFallbackActive
    ? [...configuredAllergens, ...recommendedCategoryKeys]
    : configuredAllergens;
  if (naFallbackActive) {
    for (const sensor of categorySensorsFound) {
      const category = keyByEntityId.get(sensor.entity_id);
      const resolved =
        category && CATEGORY_KEYS.has(category)
          ? category
          : categoryFromEntityToken(sensor.entity_id);
      if (!resolved) continue;
      collectCategorySensor(sensor, `${resolved}_cat`);
    }
    if (debug) {
      console.debug(
        "[Kleenex] NA zone: no per-allergen data, showing category totals instead",
        Array.from(allergenData.keys()),
      );
    }
  }

  // --- NA-zone notice ---
  // The user asked for individual allergens and the zone had none to give.
  // Worth one line in the console either way: the fallback stepped in (say so,
  // so rows the user never configured are not a mystery), or it stood aside
  // because the user had configured category allergens themselves.
  const naNoticeApplies =
    requestedIndividual.length > 0 &&
    categorySensorsFound.length > 0 &&
    naDetailsFingerprint &&
    !recommendedCategoryKeys.some((k) => configuredAllergens.includes(k)) &&
    individualAllEmpty;
  if (naNoticeApplies) {
    const warnKey = `${config.location || ""}|${config.entity_prefix || ""}|${config.entity_suffix || ""}`;
    if (!NA_WARNED_KEYS.has(warnKey)) {
      NA_WARNED_KEYS.add(warnKey);
      console.warn(
        naFallbackActive
          ? "[Kleenex] No per-allergen data found. The Kleenex API for North America (US/Canada) zones only provides category totals (trees/grass/weeds), not per-allergen breakdowns, so the card is showing those totals instead of the individual allergens you configured. Set allergens: ['trees_cat', 'grass_cat', 'weeds_cat'] to make that explicit, or enable the per-allergen DetailSensor entities (disabled by default) for EU/UK zones. See https://github.com/krissen/pollenprognos-card/blob/master/docs/troubleshooting.md#kleenex"
          : "[Kleenex] No per-allergen data found. The Kleenex API for North America (US/Canada) zones only provides category totals (trees/grass/weeds), not per-allergen breakdowns. Configure your card with allergens: ['trees_cat', 'grass_cat', 'weeds_cat'] for these zones, or enable the per-allergen DetailSensor entities (disabled by default) for EU/UK zones. See https://github.com/krissen/pollenprognos-card/blob/master/docs/troubleshooting.md#kleenex",
      );
    }
  }

  if (debug) {
    console.debug(`[Kleenex] === ALLERGEN DATA COLLECTION COMPLETE ===`);
    console.debug(
      `[Kleenex] Collected data for ${allergenData.size} allergens:`,
      Array.from(allergenData.keys()),
    );

    if (allergenData.size === 0) {
      console.debug(
        "[Kleenex] WARNING: No allergen data collected! This will result in empty sensors array.",
      );
      console.debug("[Kleenex] Checking config:", {
        allergens: config.allergens,
        location: config.location,
        filteredSensorCount: kleenexSensors.length,
      });
      console.debug(
        "[Kleenex] Sensor entity IDs processed:",
        kleenexSensors.map((s) => s.entity_id),
      );
      console.debug(
        "[Kleenex] Was any category sensor found that matches config allergens?",
      );
    } else {
      console.debug("[Kleenex] DETAILED ALLERGEN DATA ANALYSIS:");
      allergenData.forEach((data, allergen) => {
        const isCategory = ["trees_cat", "grass_cat", "weeds_cat"].includes(
          allergen,
        );
        console.debug(
          `[Kleenex] === ${allergen.toUpperCase()} (${isCategory ? "CATEGORY" : "INDIVIDUAL"}) ===`,
        );
        console.debug(`[Kleenex] Source: ${data.source}`);
        console.debug(`[Kleenex] Entity: ${data.entity_id}`);
        console.debug(`[Kleenex] Levels array length: ${data.levels.length}`);
        console.debug(
          `[Kleenex] Valid levels count (>= 0): ${data.levels.filter((l) => l.level >= 0).length}`,
        );

        // Show detailed day-by-day data
        data.levels.forEach((level, i) => {
          const dayName = i === 0 ? "TODAY" : `DAY+${i}`;
          console.debug(
            `[Kleenex] ${allergen} ${dayName}: date=${level.date?.toISOString().split("T")[0]}, level=${level.level}, value=${level.value}`,
          );
        });

        // Check if today has valid data
        const todayLevel = data.levels[0]?.level;
        const hasValidToday = todayLevel !== undefined && todayLevel >= 0;
        console.debug(
          `[Kleenex] ${allergen} TODAY DATA CHECK: hasValidToday=${hasValidToday}, todayLevel=${todayLevel}`,
        );
      });
    }
  }

  // Build sensor data for each allergen
  if (debug) {
    console.debug(
      `[Kleenex] === BUILDING SENSORS FROM ${allergenData.size} COLLECTED ALLERGENS ===`,
    );
    console.debug(`[Kleenex] pollen_threshold = ${pollen_threshold}`);
    allergenData.forEach((data, allergen) => {
      console.debug(
        `[Kleenex] Building sensor for: ${allergen}, source: ${data.source}, levels_count: ${data.levels.length}`,
      );
      if (data.levels[0]) {
        console.debug(
          `[Kleenex] ${allergen} today data: level=${data.levels[0].level}, value=${data.levels[0].value}`,
        );
      } else {
        console.debug(`[Kleenex] ${allergen} WARNING: No today data found!`);
      }
    });
  }

  // Build sensors array in the correct order
  const allergenKeys =
    config.sort === "none"
      ? effectiveAllergens.filter((allergen) => allergenData.has(allergen))
      : Array.from(allergenData.keys());

  if (debug) {
    console.debug(
      `[Kleenex] Building sensors array ${config.sort === "none" ? "in config order" : "in discovery order"}:`,
      allergenKeys,
    );
  }

  for (const allergenKey of allergenKeys) {
    const allergenInfo = allergenData.get(allergenKey);
    if (!allergenInfo) continue;

    try {
      const dict = {} as PollenSensor;
      dict.allergenReplaced = allergenKey;
      dict.entity_id = allergenInfo.entity_id;
      dict.days = []; // Initialize days array

      // Allergen name resolution
      const { allergenCapitalized, allergenShort } = resolveAllergenNames(
        allergenKey,
        {
          fullPhrases,
          shortPhrases,
          abbreviated: config.allergens_abbreviated as boolean,
          lang,
        },
      );
      dict.allergenCapitalized = allergenCapitalized;
      dict.allergenShort = allergenShort;

      // Pad levels array to match days_to_show
      const levels = allergenInfo.levels;
      while (levels.length < days_to_show) {
        const idx = levels.length;
        levels.push({
          date: new Date(today.getTime() + idx * 86400000),
          level: -1,
          value: -1,
        });
      }

      // Fill missing days with -1 values
      for (let i = 0; i < days_to_show; i++) {
        if (!levels[i]) {
          levels[i] = {
            date: new Date(today.getTime() + i * 86400000),
            level: -1,
            value: -1,
          };
        }
      }

      // Levels from Kleenex are reported as 0-4 but scaled to 0-6 in the card.
      // Accept either five or seven custom names and map them to the 0-6 scale.
      const defaultNumLevels = 5; // original kleenex scale (none, low, moderate, high, very-high)
      const levelNamesDefault = Array.from({ length: 7 }, (_, i) =>
        t(`card.levels.${i}`, lang),
      );
      let levelNames = levelNamesDefault.slice();
      if (Array.isArray(userLevels)) {
        if (userLevels.length === 7) {
          levelNames = buildLevelNames(
            userLevels as Array<string | null | undefined>,
            lang,
          );
        } else if (userLevels.length === defaultNumLevels) {
          const map = [0, 1, 3, 5, 6];
          map.forEach((lvl, idx) => {
            const val = userLevels[idx];
            if (val != null && val !== "") levelNames[lvl] = val as string;
          });
        }
      }

      // Build day objects for card display
      for (let i = 0; i < days_to_show; i++) {
        // levels was padded to days_to_show entries above.
        const dayData = levels[i]!;
        const d = dayData.date;
        const diff = Math.round((d.getTime() - today.getTime()) / 86400000);

        const dayLabel = buildDayLabel(d, diff, {
          daysRelative,
          dayAbbrev,
          daysUppercase,
          userDays,
          lang,
          locale,
        });

        // Scale level for display (keep raw 0-4 for state, but scale for level names like PEU)
        const level = dayData.level; // Raw level (0-4)
        // Calculate scaled level for level names (like PEU does)
        let scaledLevel: number;
        if (level < 0) {
          scaledLevel = level; // Keep -1 as is
        } else if (level < 2) {
          scaledLevel = Math.floor((level * 6) / 4);
        } else {
          scaledLevel = Math.ceil((level * 6) / 4);
        }

        const dayObj: ForecastDay = {
          name: dict.allergenCapitalized,
          day: dayLabel,
          state: level, // Raw level for sorting and threshold checking
          // display_state mirrors state: kleenex has no separate display value,
          // so the contract's always-present display_state carries the level.
          display_state: level,
          state_text:
            scaledLevel < 0
              ? noInfoLabel
              : levelNames[scaledLevel] ||
                t(`card.levels.${scaledLevel}`, lang),
          value: dayData.value,
          // Raw ppm measurement, surfaced only when the user opts into
          // numeric_value_raw (resolveNumericValue). state stays the level.
          raw_value:
            dayData.value != null && Number.isFinite(Number(dayData.value))
              ? Number(dayData.value)
              : null,
          description:
            scaledLevel < 0
              ? noInfoLabel
              : levelNames[scaledLevel] ||
                t(`card.levels.${scaledLevel}`, lang),
        };

        dict.days.push(dayObj);
      }

      // Check threshold
      const shouldAdd = meetsThreshold(dict.days, pollen_threshold);

      if (debug) {
        const isCategory = ["trees_cat", "grass_cat", "weeds_cat"].includes(
          allergenKey,
        );
        console.debug(
          `[Kleenex] === THRESHOLD CHECK for ${allergenKey} (${isCategory ? "CATEGORY" : "INDIVIDUAL"}) ===`,
        );
        console.debug(`[Kleenex] pollen_threshold = ${pollen_threshold}`);
        console.debug(`[Kleenex] days.length = ${dict.days.length}`);

        // Show detailed level values for debugging
        dict.days.forEach((day, i) => {
          console.debug(
            `[Kleenex] ${allergenKey} day${i}: state=${day.state}, value=${day.value}, day=${day.day}, meets_threshold=${day.state >= pollen_threshold}`,
          );
        });

        console.debug(
          `[Kleenex] shouldAdd = ${shouldAdd} (any day >= ${pollen_threshold}, or threshold===0)`,
        );

        if (isCategory && !shouldAdd) {
          console.debug(
            `[Kleenex] ❌ CATEGORY ALLERGEN ${allergenKey} FILTERED OUT BY THRESHOLD!`,
          );
          console.debug(
            `[Kleenex] Highest level found: ${Math.max(...dict.days.map((d) => d.state))}`,
          );
        } else if (isCategory && shouldAdd) {
          console.debug(
            `[Kleenex] ✅ CATEGORY ALLERGEN ${allergenKey} PASSES THRESHOLD CHECK`,
          );
        }
      }

      if (shouldAdd) {
        sensors.push(dict);
        if (debug) {
          console.debug(
            `[Kleenex] SENSOR ADDED for ${allergenKey}: today_state=${dict.days?.[0]?.state}, entity_id=${dict.entity_id}`,
          );
        }
      } else {
        if (debug) {
          console.debug(
            `[Kleenex] SENSOR FILTERED OUT for ${allergenKey}: threshold not met (highest level: ${Math.max(...dict.days.map((d) => d.state))})`,
          );
        }
      }
    } catch (e) {
      console.warn(`[Kleenex] Adapter error for allergen ${allergenKey}:`, e);
    }
  }

  // Sort sensors - implement two-tiered sorting for kleenex when sort_category_allergens_first is true
  if (config.sort !== "none") {
    if (config.sort_category_allergens_first) {
      const categoryAllergens = sensors.filter((s) =>
        ["trees_cat", "grass_cat", "weeds_cat"].includes(s.allergenReplaced),
      );
      const individualAllergens = sensors.filter(
        (s) =>
          !["trees_cat", "grass_cat", "weeds_cat"].includes(s.allergenReplaced),
      );
      sortSensors(categoryAllergens, config.sort as string);
      sortSensors(individualAllergens, config.sort as string);
      sensors = [...categoryAllergens, ...individualAllergens];

      if (debug) {
        console.debug(
          `[Kleenex] Two-tiered sorting: ${categoryAllergens.length} category + ${individualAllergens.length} individual allergens`,
        );
      }
    } else {
      sortSensors(sensors, config.sort as string);

      if (debug) {
        console.debug(
          `[Kleenex] Standard sorting: ${sensors.length} allergens sorted together`,
        );
      }
    }
  } else if (debug) {
    console.debug(
      `[Kleenex] No sorting applied: ${sensors.length} allergens kept in config order`,
    );
  }

  if (debug) {
    console.debug("[Kleenex] === FINAL ADAPTER RESULTS ===");
    console.debug(`[Kleenex] Total sensors returning: ${sensors.length}`);

    if (sensors.length === 0) {
      console.debug("[Kleenex] ❌ NO SENSORS RETURNED! Checking why:");
      console.debug(`[Kleenex] - allergenData.size: ${allergenData.size}`);
      console.debug(`[Kleenex] - pollen_threshold: ${pollen_threshold}`);
      console.debug(`[Kleenex] - config.allergens: [${allergens.join(", ")}]`);

      // Check if any allergens were filtered by threshold
      let thresholdFiltered = 0;
      allergenData.forEach((data, allergen) => {
        const hasValidLevel = data.levels.some(
          (l) => l.level >= pollen_threshold,
        );
        if (!hasValidLevel) {
          thresholdFiltered++;
          console.debug(
            `[Kleenex] - ${allergen} filtered by threshold (max level: ${Math.max(...data.levels.map((l) => l.level))})`,
          );
        }
      });
      console.debug(
        `[Kleenex] - allergens filtered by threshold: ${thresholdFiltered}`,
      );
    } else {
      console.debug("[Kleenex] ✅ SENSORS FOUND:");
      sensors.forEach((sensor, i) => {
        const isCategory = ["trees_cat", "grass_cat", "weeds_cat"].includes(
          sensor.allergenReplaced,
        );
        console.debug(
          `[Kleenex] ${i + 1}. ${sensor.allergenReplaced} (${isCategory ? "CATEGORY" : "INDIVIDUAL"}): day0_state=${sensor.days?.[0]?.state}, entity_id=${sensor.entity_id}`,
        );
      });
    }

    console.debug("[Kleenex] Adapter fetchForecast complete.");
  }

  return sensors;
}
