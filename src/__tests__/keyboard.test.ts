import { shouldSubmitOnEnter } from "../chat/keyboard";

describe("shouldSubmitOnEnter", () => {
  it("submits a plain Enter key", () => {
    expect(shouldSubmitOnEnter({ key: "Enter" })).toBe(true);
  });

  it("keeps Shift+Enter as a newline", () => {
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
  });

  it("does not submit while an IME is composing", () => {
    expect(shouldSubmitOnEnter({ key: "Enter", isComposing: true })).toBe(false);
    expect(shouldSubmitOnEnter({ key: "Enter", keyCode: 229 })).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(shouldSubmitOnEnter({ key: "a" })).toBe(false);
  });
});
