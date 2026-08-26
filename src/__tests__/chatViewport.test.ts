import { shouldAutoScroll, updateNearBottom } from "../chat/viewportPolicy";

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
});
