import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, type KeyboardAvoidingViewProps, type ScrollViewProps, type TextInputProps } from "react-native";

// Keep the composer in a flex sibling of the scrollable conversation.
// Android's existing APK needs JS avoidance too; no native rebuild is required.
export function KeyboardScreen(props: KeyboardAvoidingViewProps) {
  return <KeyboardAvoidingView {...props} behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined} />;
}

const RevealInput = createContext<(input: TextInput) => void>(() => undefined);
export function KeyboardScrollView(props: ScrollViewProps) {
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput | null>(null);
  const frame = useRef<number | null>(null);
  const reveal = useCallback((target?: TextInput) => {
    if (target) input.current = target;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!input.current?.isFocused()) return;
      if (Platform.OS === "web") {
        (input.current as unknown as HTMLElement).scrollIntoView?.({block:"nearest",inline:"nearest"});
      } else scroll.current?.scrollResponderScrollNativeHandleToKeyboard(input.current, 16, true);
    });
  }, []);
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () => reveal());
    const resize=()=>reveal();
    if(Platform.OS === "web")window.addEventListener("resize",resize);
    return () => { subscription.remove(); if(Platform.OS === "web")window.removeEventListener("resize",resize); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [reveal]);
  return <RevealInput.Provider value={reveal}>
    <ScrollView {...props} ref={scroll} keyboardShouldPersistTaps="handled"
      onLayout={(event) => { props.onLayout?.(event); if (Platform.OS === "web" || Keyboard.isVisible()) reveal(); }} />
  </RevealInput.Provider>;
}

export function KeyboardTextInput(props: TextInputProps) {
  const input = useRef<TextInput>(null);
  const reveal = useContext(RevealInput);
  return <TextInput {...props} ref={input}
    onFocus={(event) => { props.onFocus?.(event); if (input.current) reveal(input.current); }}
    onContentSizeChange={(event) => { props.onContentSizeChange?.(event); if (input.current?.isFocused()) reveal(input.current); }} />;
}
