export type EnterKeyEvent = Readonly<{
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}>;

export function shouldSubmitOnEnter(event: EnterKeyEvent): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
