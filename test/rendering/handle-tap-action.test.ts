import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LevelCircleMixin,
  resolveTapActionType,
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

  it("more-info falls back to sun.sun when no entity is given", () => {
    el.tapAction = { type: "more-info" };
    el._handleTapAction(makeEvent());
    expect(el.dispatched[0].detail).toEqual({ entityId: "sun.sun" });
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
    globalThis.window = { history: { pushState: vi.fn() } } as any;
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
      globalThis.window = { history: { pushState: vi.fn() } } as any;
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

    it("does nothing without a navigation path", () => {
      el.tapAction = { type: "navigate" };
      el._handleTapAction(makeEvent());
      expect(window.history.pushState).not.toHaveBeenCalled();
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
    });
  });
});

describe("resolveTapActionType", () => {
  it("resolves supported explicit types (with their required fields)", () => {
    expect(resolveTapActionType({ type: "more-info" })).toBe("more-info");
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
    expect(resolveTapActionType({ action: "more-info" })).toBe("more-info");
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
    expect(resolveTapActionType({ type: "call-service" })).toBeNull();
    expect(resolveTapActionType({ action: "perform-action" })).toBeNull();
    expect(
      resolveTapActionType({ type: "call-service", service: "notadomain" }),
    ).toBeNull();
    // A valid service id is exactly domain.service; multi-dot is rejected.
    expect(
      resolveTapActionType({ type: "call-service", service: "foo.bar.baz" }),
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
