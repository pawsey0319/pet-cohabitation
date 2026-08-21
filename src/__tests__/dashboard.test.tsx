jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import App from "../../App";
import { PetStatusPill } from "../screens/HomeScreen";

const notchedPhoneMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, right: 12, bottom: 34, left: 11 },
} as const;

describe("dual-core dashboard", () => {
  it("renders the four dual-core dashboard regions", async () => {
    await render(<App />);

    expect(screen.getByText("今天的异宠")).toBeTruthy();
    expect(screen.getByText("关系空间")).toBeTruthy();
    expect(screen.getByText("待你确认")).toBeTruthy();
    expect(screen.getByText("今晚碰个面")).toBeTruthy();
  });

  it("renders the localized label for a non-default pet status", async () => {
    await render(<PetStatusPill status="exploring_spaces" />);

    expect(screen.getByText("正在串门")).toBeTruthy();
  });

  it("keeps content and navigation inside deterministic safe-area insets", async () => {
    await render(<App initialSafeAreaMetrics={notchedPhoneMetrics} />);

    expect(StyleSheet.flatten(screen.getByTestId("app-safe-area").props.style)).toMatchObject({
      paddingLeft: 11,
      paddingRight: 12,
    });
    expect(StyleSheet.flatten(screen.getByTestId("app-safe-top").props.style)).toMatchObject({
      paddingTop: 47,
    });
    expect(StyleSheet.flatten(screen.getByTestId("app-safe-bottom").props.style)).toMatchObject({
      paddingBottom: 34,
    });
  });

  it("keeps the local-demo reset card constrained inside the narrow pet screen grid", async () => {
    await render(<App />);
    await fireEvent.press(screen.getByRole("tab", { name: "异宠" }));

    expect(StyleSheet.flatten(screen.getByTestId("local-demo-reset-card").props.style)).toMatchObject({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 360,
      minWidth: 0,
    });
  });
});
