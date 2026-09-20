import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { DeviceEventEmitter, Platform, StyleSheet, View } from "react-native";
import { KeyboardScreen } from "../components/KeyboardLayout";

it("reduces the Android conversation viewport when the keyboard covers its bottom and restores it on hide", async () => {
  const platform = jest.replaceProperty(Platform, "OS", "android");
  try {
    await render(<KeyboardScreen testID="viewport" style={{ flex: 1 }}><View testID="composer" /></KeyboardScreen>);
    await fireEvent(screen.getByTestId("viewport"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } }, persist: () => undefined });
    await act(() => DeviceEventEmitter.emit("keyboardDidShow", { endCoordinates: { screenY: 500, screenX: 0, width: 390, height: 300 }, duration: 0 }));
    await waitFor(() => expect(StyleSheet.flatten(screen.getByTestId("viewport").props.style).height).toBe(500));
    expect(screen.getByTestId("composer")).toBeTruthy();
    await act(() => DeviceEventEmitter.emit("keyboardDidHide", { endCoordinates: { screenY: 800, screenX: 0, width: 390, height: 0 }, duration: 0 }));
    await waitFor(() => expect(StyleSheet.flatten(screen.getByTestId("viewport").props.style).height).toBeUndefined());
  } finally { platform.restore(); }
});
