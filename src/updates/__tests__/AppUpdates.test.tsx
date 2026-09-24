import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { AppUpdatePanel } from "../AppUpdates";
import manifest from "../../../public/releases/android-preview.json";
let mockDark = false;
jest.mock("../../theme/ThemeProvider", () => ({ useAppTheme: () => ({ theme: { isDark: mockDark } }) }));

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  actual.Platform.OS = "android";
  return actual;
});
jest.mock("expo-modules-core", () => ({ ...jest.requireActual("expo-modules-core"), requireOptionalNativeModule: () => ({ nativeApplicationVersion: "1.0.7", nativeBuildVersion: "9", applicationId: "com.pawsey.petcohabitation" }) }));
jest.mock("expo-updates", () => ({ runtimeVersion: "1.0.7", channel: "preview", isEnabled: true, checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn() }));
// Exercise the production controller and rendered actions, without a native install.
jest.mock("../controller", () => {
  const actual = jest.requireActual("../controller");
  return { ...actual, createUpdateController: (deps: unknown) => actual.createUpdateController({ ...(deps as object), supported: true }) };
});

test("old installed app offers an update and reports browser handoff accurately", async () => {
  const original = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, headers: { get: () => "application/json" }, text: async () => JSON.stringify(manifest) });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  try {
    await render(<AppUpdatePanel />);
    expect(screen.getByText("当前安装版本 1.0.7（9）")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "检查更新" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下载并更新" })).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: "下载并更新" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(manifest.latest.url));
    expect(screen.getByText(/已打开下载页面/)).toBeTruthy();
    expect(screen.queryByText("安装成功")).toBeNull();
  } finally { global.fetch = original; open.mockRestore(); }
});

test("manual dark theme is honored even when the system uses light colors", async () => {
  mockDark = true;
  try {
    await render(<AppUpdatePanel />);
    expect(screen.getByText("应用更新")).toHaveStyle({ color: "#F4F3EF" });
  } finally { mockDark = false; }
});
