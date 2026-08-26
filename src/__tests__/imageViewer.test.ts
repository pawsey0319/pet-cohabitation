import { clampImageScale, imageViewerReducer, initialImageViewerTransform } from "../chat/imageViewerState";

describe("image viewer transform", () => {
  it("clamps zoom between one and four", () => {
    expect(clampImageScale(0.4)).toBe(1);
    expect(clampImageScale(2.25)).toBe(2.25);
    expect(clampImageScale(7)).toBe(4);
  });

  it("resets translation when returning to one-times zoom or closing", () => {
    const zoomed = imageViewerReducer(initialImageViewerTransform, { type: "zoom", scale: 3 });
    const moved = imageViewerReducer(zoomed, { type: "pan", dx: 80, dy: -30 });
    expect(moved).toEqual({ scale: 3, translateX: 80, translateY: -30 });
    expect(imageViewerReducer(moved, { type: "zoom", scale: 1 })).toEqual(initialImageViewerTransform);
    expect(imageViewerReducer(moved, { type: "reset" })).toEqual(initialImageViewerTransform);
  });
});
