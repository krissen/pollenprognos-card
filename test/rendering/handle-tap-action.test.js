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
  constructor() {
    this.dispatched = [];
  }
  dispatchEvent(ev) {
    this.dispatched.push(ev);
    return true;
  }
}

class TapElement extends LevelCircleMixin(FakeBase) {}

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
  let el;
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

  it("call-service splits domain.service and forwards service_data", () => {
    el.tapAction = {
      type: "call-service",
      service: "light.turn_on",
      service_data: { brightness: 255 },
    };
    el._handleTapAction(makeEvent());
    expect(el._hass.callService).toHaveBeenCalledWith("light", "turn_on", {
      brightness: 255,
    });
    expect(el.dispatched).toHaveLength(0);
  });

  it("call-service tolerates missing service_data", () => {
    el.tapAction = { type: "call-service", service: "script.run" };
    el._handleTapAction(makeEvent());
    expect(el._hass.callService).toHaveBeenCalledWith("script", "run", {});
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
    let prevWindow;
    beforeEach(() => {
      prevWindow = globalThis.window;
      globalThis.window = { history: { pushState: vi.fn() } };
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
  it("resolves supported explicit types", () => {
    expect(resolveTapActionType({ type: "more-info" })).toBe("more-info");
    expect(resolveTapActionType({ type: "navigate" })).toBe("navigate");
    expect(resolveTapActionType({ type: "call-service" })).toBe("call-service");
  });

  it("defaults a typeless object to more-info", () => {
    expect(resolveTapActionType({ entity: "sensor.x" })).toBe("more-info");
  });

  it("returns null for none, unknown, and non-objects", () => {
    expect(resolveTapActionType({ type: "none" })).toBeNull();
    expect(resolveTapActionType({ type: "weird" })).toBeNull();
    expect(resolveTapActionType(null)).toBeNull();
    expect(resolveTapActionType(undefined)).toBeNull();
    expect(resolveTapActionType("more-info")).toBeNull();
    expect(resolveTapActionType([{ type: "more-info" }])).toBeNull();
  });
});
