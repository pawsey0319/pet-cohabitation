export type AutoScrollReason = "initial" | "own_message" | "incoming" | "layout_change" | "history_loaded";

export type ViewportIntent = Readonly<{
  reason: Extract<AutoScrollReason, "initial" | "own_message" | "incoming" | "history_loaded">;
  previousContentHeight: number;
  previousOffsetY: number;
}>;

export type ContentSizeAction =
  | Readonly<{ kind: "wait" }>
  | Readonly<{ kind: "scroll_to_end"; animated: boolean }>
  | Readonly<{ kind: "scroll_to_offset"; offset: number }>;

export function createViewportIntent(
  reason: ViewportIntent["reason"],
  previousContentHeight: number,
  previousOffsetY: number,
): ViewportIntent {
  return { reason, previousContentHeight, previousOffsetY };
}

export function contentSizeAction(intent: ViewportIntent, nextContentHeight: number): ContentSizeAction {
  if (nextContentHeight <= intent.previousContentHeight) return { kind: "wait" };
  if (intent.reason === "history_loaded") {
    return {
      kind: "scroll_to_offset",
      offset: Math.max(0, intent.previousOffsetY + nextContentHeight - intent.previousContentHeight),
    };
  }
  return { kind: "scroll_to_end", animated: intent.reason === "incoming" };
}

export function shouldAutoScroll(input: Readonly<{ reason: AutoScrollReason; wasNearBottom: boolean }>): boolean {
  return input.reason === "initial" || input.reason === "own_message" || (input.reason === "incoming" && input.wasNearBottom);
}

export function updateNearBottom(input: Readonly<{
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
  threshold?: number;
}>): boolean {
  const distance = input.contentHeight - input.viewportHeight - input.offsetY;
  return distance <= (input.threshold ?? 48);
}
