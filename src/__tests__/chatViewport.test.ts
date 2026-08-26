import {
  contentSizeAction,
  createViewportIntent,
  shouldAutoScroll,
  updateNearBottom,
} from "../chat/viewportPolicy";

describe("chat viewport policy", () => {
  it("only auto-scrolls for first load, own messages, or readers already at bottom", () => {
    expect(shouldAutoScroll({ reason: "initial", wasNearBottom: false })).toBe(true);
    expect(shouldAutoScroll({ reason: "own_message", wasNearBottom: false })).toBe(true);
    expect(shouldAutoScroll({ reason: "incoming", wasNearBottom: true })).toBe(true);
    expect(shouldAutoScroll({ reason: "incoming", wasNearBottom: false })).toBe(false);
    expect(shouldAutoScroll({ reason: "layout_change", wasNearBottom: true })).toBe(false);
  });

  it("uses a stable distance threshold for bottom detection", () => {
    expect(updateNearBottom({ contentHeight: 1000, viewportHeight: 500, offsetY: 470 })).toBe(true);
    expect(updateNearBottom({ contentHeight: 1000, viewportHeight: 500, offsetY: 300 })).toBe(false);
  });

  it("waits for the optimistic own message to be measured before scrolling to the new bottom", () => {
    const intent = createViewportIntent("own_message", 1200, 640);

    expect(contentSizeAction(intent, 1200)).toEqual({ kind: "wait" });
    expect(contentSizeAction(intent, 1284)).toEqual({ kind: "scroll_to_end", animated: false });
  });

  it("restores the previous reading position after older messages are prepended", () => {
    const intent = createViewportIntent("history_loaded", 1200, 240);

    expect(contentSizeAction(intent, 1560)).toEqual({ kind: "scroll_to_offset", offset: 600 });
  });
});
