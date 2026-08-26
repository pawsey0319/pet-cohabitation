export type AutoScrollReason = "initial" | "own_message" | "incoming" | "layout_change" | "history_loaded";

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
