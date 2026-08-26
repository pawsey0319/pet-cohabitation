export type ImageViewerTransform = Readonly<{ scale: number; translateX: number; translateY: number }>;
export type ImageViewerAction =
  | Readonly<{ type: "zoom"; scale: number }>
  | Readonly<{ type: "pan"; dx: number; dy: number }>
  | Readonly<{ type: "reset" }>;

export const initialImageViewerTransform: ImageViewerTransform = { scale: 1, translateX: 0, translateY: 0 };

export function clampImageScale(scale: number): number {
  return Math.min(4, Math.max(1, scale));
}

export function imageViewerReducer(state: ImageViewerTransform, action: ImageViewerAction): ImageViewerTransform {
  if (action.type === "reset") return initialImageViewerTransform;
  if (action.type === "zoom") {
    const scale = clampImageScale(action.scale);
    return scale === 1 ? initialImageViewerTransform : { ...state, scale };
  }
  if (state.scale === 1) return state;
  return { ...state, translateX: state.translateX + action.dx, translateY: state.translateY + action.dy };
}
