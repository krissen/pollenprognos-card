import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LevelCircleMixin,
  resolveTapActionType,
  iconMoreInfoEnabled,
} from "../../src/rendering/level-circle-mixin.js";

// The shared element-level tap_action handler lives in LevelCircleMixin so the
// card and the badge share one implementation. Test it against a minimal base
// that records dispatched events, exercising every action branch plus the
// no-op guards. The card feeds the action via this.tapAction; the badge via
// this.config.tap_action — the handler must resolve from either.

class FakeBase {
  dispatched: any[];
  constructor() {
    this.dispatched = [];
  }
  dispatchEvent(ev: any) {
    this.dispatched.push(ev);
    return true;
  }
}

class TapElement extends LevelCircleMixin(FakeBase as any) {}

function makeEvent() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

function makeHass() {
  return { callService: vi.fn() };
}

describe("LevelCircleMixin._handleTapAction", () => {
  let el: any;
  beforeEach(() => {
    el = new TapElement();
    el._hass = makeHass();
  });

  it("no-ops when no action is configured", () => {
    const e = makeEvent();
    el._handleTapAction(e);
    expect(el.dispatched).toHaveLength(0);
    expect(el._hass.callService).not.toHaveBeenCalled();
    // Guard returns before consuming the event.
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("no-ops when hass is absent", () => {
    el._hass = undefined;
    el.tapAction = { type: "more-info", entity: "sensor.x" };
    el._handleTapAction(makeEvent());
    expect(el.dispatched).toHaveLength(0);
  });

  it("more-info dispatches hass-more-info with the configured entity (card path)", () => {
    el.tapAction = { type: "more-info", entity: "sensor.pollen" };
    const e = makeEvent();
    el._handleTapAction(e);
    expect(el.dispatched).toHaveLength(1);
    expect(el.dispatched[0].type).toBe("hass-more-info");
    expect(el.dispatched[0].detail).toEqual({ entityId: "sensor.pollen" });
    expect(el.dispatched[0].bubbles).toBe(true);
    expect(el.dispatched[0].composed).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it("does not dispatch for an entity that is not an entity id", () => {
    // The three shapes YAML can deliver that pass a truthiness test.
    for (const entity of ["   ", 123, ["sensor.a"]]) {
      el.dispatched.length = 0;
      el.tapAction = { type: "more-info", entity } as any;
      el._handleTapAction(makeEvent());
      expect(el.dispatched, `dispatched for ${JSON.stringify(entity)}`).toEqual(
        [],
      );
    }
  });

  it("dispatches a padded entity id trimmed", () => {
    el.tapAction = { type: "more-info", entity: " sensor.pollen " };
    el._handleTapAction(makeEvent());
    expect(el.dispatched[0].detail).toEqual({ entityId: "sensor.pollen" });
  });

  it("does nothing for more-info without an entity", () => {
    // This used to open sun.sun, so `tap_action: {type: more-info}` on its own
    // made every click on the card show the sun -- and suppressed the
    // per-allergen dialogs at the same time, since a bound tap_action takes
    // precedence over per-icon more-info.
    el.tapAction = { type: "more-info" };
    el._handleTapAction(makeEvent());
    expect(el.dispatched).toEqual([]);
  });

  it("defaults a typeless action to more-info", () => {
    el.tapAction = { entity: "sensor.y" };
    el._handleTapAction(makeEvent());
    expect(el.dispatched[0].type).toBe("hass-more-info");
    expect(el.dispatched[0].detail).toEqual({ entityId: "sensor.y" });
  });

  it("resolves the action from this.config.tap_action (badge path)", () => {
    el.config = { tap_action: { type: "more-info", entity: "sensor.badge" } };
    el._handleTapAction(makeEvent());
    expect(el.dispatched[0].detail).toEqual({ entityId: "sensor.badge" });
  });

  it("honours the Lovelace-standard `action` key (navigate)", () => {
    const prev = globalThis.window;
    globalThis.window = {
      history: { pushState: vi.fn() },
      dispatchEvent: vi.fn(),
    } as any;
    el.tapAction = { action: "navigate", navigation_path: "/lovelace/2" };
    el._handleTapAction(makeEvent());
    expect(window.history.pushState).toHaveBeenCalledWith(null, "", "/lovelace/2");
    globalThis.window = prev;
  });

  it("treats `{ action: 'none' }` as inert (does not default to more-info)", () => {
    el.tapAction = { action: "none" };
    const e = makeEvent();
    el._handleTapAction(e);
    expect(el.dispatched).toHaveLength(0);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("maps HA's perform-action to a service call and forwards the target", () => {
    el.tapAction = {
      action: "perform-action",
      perform_action: "light.turn_on",
      data: { brightness: 128 },
      target: { entity_id: "light.kitchen" },
    };
    el._handleTapAction(makeEvent());
    expect(el._hass.callService).toHaveBeenCalledWith(
      "light",
      "turn_on",
      { brightness: 128 },
      { entity_id: "light.kitchen" },
    );
  });

  it("calls the right service when the id carries whitespace", () => {
    // `" light.turn_on "` used to split into a domain of `" light"`, so the
    // call reached a domain Home Assistant does not have and nothing happened.
    el.tapAction = {
      type: "call-service",
      service: " light.turn_on ",
      service_data: { brightness: 10 },
    };
    el._handleTapAction(makeEvent());
    expect(el._hass.callService).toHaveBeenCalledWith(
      "light",
      "turn_on",
      { brightness: 10 },
      undefined,
    );
  });

  it("call-service splits domain.service and forwards service_data", () => {
    el.tapAction = {
      type: "call-service",
      service: "light.turn_on",
      service_data: { brightness: 255 },
    };
    el._handleTapAction(makeEvent());
    expect(el._hass.callService).toHaveBeenCalledWith(
      "light",
      "turn_on",
      { brightness: 255 },
      undefined,
    );
    expect(el.dispatched).toHaveLength(0);
  });

  it("call-service tolerates missing service_data", () => {
    el.tapAction = { type: "call-service", service: "script.run" };
    el._handleTapAction(makeEvent());
    expect(el._hass.callService).toHaveBeenCalledWith(
      "script",
      "run",
      {},
      undefined,
    );
  });

  it("call-service ignores a non-string service", () => {
    el.tapAction = { type: "call-service", service: { bad: true } };
    el._handleTapAction(makeEvent());
    expect(el._hass.callService).not.toHaveBeenCalled();
  });

  it("call-service ignores a service string without a dot", () => {
    el.tapAction = { type: "call-service", service: "notadomain" };
    el._handleTapAction(makeEvent());
    expect(el._hass.callService).not.toHaveBeenCalled();
  });

  it("call-service ignores a multi-dot service string", () => {
    el.tapAction = { type: "call-service", service: "foo.bar.baz" };
    el._handleTapAction(makeEvent());
    expect(el._hass.callService).not.toHaveBeenCalled();
  });

  it("does not consume the event for an unsupported action type", () => {
    el.tapAction = { type: "totally-unknown" };
    const e = makeEvent();
    el._handleTapAction(e);
    expect(el.dispatched).toHaveLength(0);
    expect(el._hass.callService).not.toHaveBeenCalled();
    // Inert action must not swallow the click.
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it('does not consume the event for type "none"', () => {
    el.tapAction = { type: "none" };
    const e = makeEvent();
    el._handleTapAction(e);
    expect(el.dispatched).toHaveLength(0);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores an array tap_action", () => {
    el.tapAction = [{ type: "more-info" }];
    const e = makeEvent();
    el._handleTapAction(e);
    expect(el.dispatched).toHaveLength(0);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  describe("navigate", () => {
    let prevWindow: any;
    beforeEach(() => {
      prevWindow = globalThis.window;
      globalThis.window = {
        history: { pushState: vi.fn() },
        dispatchEvent: vi.fn(),
      } as any;
    });
    afterEach(() => {
      globalThis.window = prevWindow;
    });

    it("pushes the navigation path", () => {
      el.tapAction = { type: "navigate", navigation_path: "/lovelace/0" };
      el._handleTapAction(makeEvent());
      expect(window.history.pushState).toHaveBeenCalledWith(
        null,
        "",
        "/lovelace/0",
      );
    });

    it("dispatches location-changed so HA's router re-resolves the panel", () => {
      // A bare pushState updates the URL but never re-renders the panel; HA's
      // router listens on window for "location-changed". Mirror the frontend
      // navigate() helper's fireEvent form (#279).
      el.tapAction = { type: "navigate", navigation_path: "/lovelace/3" };
      el._handleTapAction(makeEvent());
      expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
      const ev = (window.dispatchEvent as any).mock.calls[0][0];
      expect(ev.type).toBe("location-changed");
      expect(ev.bubbles).toBe(true);
      expect(ev.composed).toBe(true);
      expect(ev.detail).toEqual({ replace: false });
      // Fires after the URL is updated.
      expect(window.history.pushState).toHaveBeenCalled();
    });

    it("does nothing without a navigation path", () => {
      el.tapAction = { type: "navigate" };
      el._handleTapAction(makeEvent());
      expect(window.history.pushState).not.toHaveBeenCalled();
      expect(window.dispatchEvent).not.toHaveBeenCalled();
    });

    it("navigates even without hass (navigate needs only the History API)", () => {
      el._hass = undefined;
      el.tapAction = { type: "navigate", navigation_path: "/lovelace/1" };
      el._handleTapAction(makeEvent());
      expect(window.history.pushState).toHaveBeenCalledWith(
        null,
        "",
        "/lovelace/1",
      );
      expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    });
  });
});

describe("iconMoreInfoEnabled", () => {
  // Without a tap_action, per-icon more-info is the default (on unless
  // link_to_sensors is explicitly false).
  it("defaults on with no tap_action", () => {
    expect(iconMoreInfoEnabled(undefined, false)).toBe(true);
    expect(iconMoreInfoEnabled(true, false)).toBe(true);
    expect(iconMoreInfoEnabled(false, false)).toBe(false);
  });

  // With a tap_action, the element runs it and per-icon more-info is suppressed
  // unless the user explicitly opted in with link_to_sensors: true (#279).
  it("yields to a configured tap_action unless explicitly opted in", () => {
    expect(iconMoreInfoEnabled(undefined, true)).toBe(false);
    expect(iconMoreInfoEnabled(false, true)).toBe(false);
    expect(iconMoreInfoEnabled(true, true)).toBe(true);
  });
});

describe("resolveTapActionType", () => {
  it("resolves supported explicit types (with their required fields)", () => {
    expect(resolveTapActionType({ type: "more-info", entity: "sensor.x" })).toBe(
      "more-info",
    );
    expect(
      resolveTapActionType({ type: "navigate", navigation_path: "/x" }),
    ).toBe("navigate");
    expect(
      resolveTapActionType({ type: "call-service", service: "light.toggle" }),
    ).toBe("call-service");
  });

  it("defaults a typeless object to more-info", () => {
    expect(resolveTapActionType({ entity: "sensor.x" })).toBe("more-info");
  });

  it("honours the Lovelace `action` key and the perform-action alias", () => {
    expect(
      resolveTapActionType({ action: "navigate", navigation_path: "/x" }),
    ).toBe("navigate");
    expect(
      resolveTapActionType({ action: "more-info", entity: "sensor.x" }),
    ).toBe("more-info");
    expect(
      resolveTapActionType({
        action: "perform-action",
        perform_action: "light.toggle",
      }),
    ).toBe("call-service");
    // action wins over a stale type.
    expect(
      resolveTapActionType({
        action: "navigate",
        type: "more-info",
        navigation_path: "/x",
      }),
    ).toBe("navigate");
  });

  it("returns null for actionable types missing their required fields", () => {
    // navigate needs navigation_path; call-service needs a valid domain.service.
    // Without them the handler would no-op, so binding must not treat them as
    // actionable (keeps the pointer cursor and click listener in lockstep).
    expect(resolveTapActionType({ type: "navigate" })).toBeNull();
    expect(resolveTapActionType({ action: "navigate" })).toBeNull();
    // more-info needs an entity for the same reason.
    expect(resolveTapActionType({ type: "more-info" })).toBeNull();
    expect(resolveTapActionType({ action: "more-info" })).toBeNull();
    // ...and one that is actually an entity id. YAML hands over numbers, lists
    // and blank strings, all of which are truthy: testing the raw value would
    // bind a click and then dispatch something HA cannot open.
    expect(resolveTapActionType({ type: "more-info", entity: "   " })).toBeNull();
    expect(
      resolveTapActionType({ type: "more-info", entity: 123 } as any),
    ).toBeNull();
    expect(
      resolveTapActionType({ type: "more-info", entity: ["sensor.a"] } as any),
    ).toBeNull();
    // Surrounding whitespace is dropped, not treated as a broken value.
    expect(
      resolveTapActionType({ type: "more-info", entity: " sensor.a " }),
    ).toBe("more-info");
    expect(resolveTapActionType({ type: "call-service" })).toBeNull();
    expect(resolveTapActionType({ action: "perform-action" })).toBeNull();
    expect(
      resolveTapActionType({ type: "call-service", service: "notadomain" }),
    ).toBeNull();
    // A valid service id is exactly domain.service; multi-dot is rejected.
    expect(
      resolveTapActionType({ type: "call-service", service: "foo.bar.baz" }),
    ).toBeNull();
    // Whitespace is not what makes an id invalid, though: it is trimmed, the
    // same way a padded entity id is.
    expect(
      resolveTapActionType({ type: "call-service", service: " light.toggle " }),
    ).toBe("call-service");
    expect(
      resolveTapActionType({ type: "call-service", service: "light . toggle" }),
    ).toBe("call-service");
    // Trimming cannot rescue an id that has no halves to begin with.
    expect(
      resolveTapActionType({ type: "call-service", service: " . " }),
    ).toBeNull();
  });

  it("returns null for none (both shapes), unknown, and non-objects", () => {
    expect(resolveTapActionType({ type: "none" })).toBeNull();
    expect(resolveTapActionType({ action: "none" })).toBeNull();
    expect(resolveTapActionType({ type: "weird" })).toBeNull();
    expect(resolveTapActionType(null)).toBeNull();
    expect(resolveTapActionType(undefined)).toBeNull();
    expect(resolveTapActionType("more-info")).toBeNull();
    expect(resolveTapActionType([{ type: "more-info" }])).toBeNull();
  });
});

/**
 * The pair that bit a user (owner, live in hass-test): a `tap_action` the
 * handler could not act on still counted as "the element has a tap_action",
 * which suppressed the per-icon more-info the card gives by default. So
 * configuring `tap_action: {type: more-info}` without an entity both opened the
 * wrong dialog and removed the right ones.
 */
describe("an unactionable tap_action leaves the per-icon dialogs alone", () => {
  const perIconEnabled = (tapAction: unknown, linkToSensors?: unknown) =>
    iconMoreInfoEnabled(linkToSensors, resolveTapActionType(tapAction) !== null);

  it("keeps per-icon more-info on for more-info without an entity", () => {
    // Identical to having configured no tap_action at all.
    expect(perIconEnabled({ type: "more-info" })).toBe(true);
    expect(perIconEnabled({ action: "more-info" })).toBe(true);
    expect(perIconEnabled(undefined)).toBe(true);
  });

  it("still suppresses per-icon more-info for an actionable tap_action", () => {
    expect(perIconEnabled({ type: "more-info", entity: "sensor.x" })).toBe(
      false,
    );
    expect(perIconEnabled({ type: "navigate", navigation_path: "/x" })).toBe(
      false,
    );
  });

  it("leaves link_to_sensors as the global off switch either way", () => {
    expect(perIconEnabled({ type: "more-info" }, false)).toBe(false);
    expect(perIconEnabled({ type: "more-info", entity: "sensor.x" }, true)).toBe(
      true,
    );
  });
});
