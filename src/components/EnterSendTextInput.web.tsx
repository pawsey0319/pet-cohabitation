import { useLayoutEffect, useRef, type CSSProperties, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import { StyleSheet } from "react-native";
import { shouldSubmitOnEnter } from "../chat/keyboard";
import type { EnterSendTextInputProps } from "./EnterSendTextInput";

export function EnterSendTextInput(props: EnterSendTextInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.dataset.enterListener = "attached";
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const shouldSubmit = shouldSubmitOnEnter({ key: event.key, shiftKey: event.shiftKey, isComposing: event.isComposing, keyCode: event.keyCode });
      if (!shouldSubmit) return;
      event.preventDefault();
      input.dataset.enterSubmit = "handled";
      const currentValue = input.value;
      flushSync(() => propsRef.current.onSend(currentValue));
    };
    input.addEventListener("keydown", handleKeyDown);
    return () => { input.removeEventListener("keydown", handleKeyDown); delete input.dataset.enterListener; };
  }, []);
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => props.onChangeText(event.currentTarget.value);
  const flattened = StyleSheet.flatten(props.style) as unknown as CSSProperties;

  return <textarea
    ref={inputRef}
    aria-label={props.accessibilityLabel}
    value={props.value}
    onChange={handleChange}
    maxLength={props.maxLength}
    placeholder={props.placeholder}
    rows={1}
    style={{ ...flattened, resize: "none", outline: "none", boxSizing: "border-box" }}
  />;
}
