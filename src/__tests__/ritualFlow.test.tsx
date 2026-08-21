jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import App from "../../App";

describe("tonight ritual settings", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it("persists time frequency and timezone, lets the pet invite, and can be disabled", async () => {
    await render(<App />);

    await fireEvent.changeText(screen.getByPlaceholderText("碰面时间"), "20:45");
    await fireEvent.press(screen.getByRole("button", { name: "频率：每天" }));
    await fireEvent.changeText(screen.getByPlaceholderText("时区"), "Asia/Shanghai");
    await fireEvent.press(screen.getByRole("button", { name: "保存碰面设置" }));
    expect(screen.getByText("已保存：每周 · 20:45 · Asia/Shanghai")).toBeTruthy();
    await waitFor(() => {
      const payload = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1]);
      expect(payload.ritualSettings).toMatchObject({
        enabled: true,
        time: "20:45",
        frequency: "weekly",
        timezone: "Asia/Shanghai",
      });
    });

    await fireEvent.press(screen.getByRole("button", { name: "请灯灯发出邀请" }));
    await fireEvent.press(screen.getByRole("tab", { name: "空间" }));
    expect(screen.getByText("异宠视角 · 主观回顾")).toBeTruthy();
    expect(screen.getByText(/20:45.*Asia\/Shanghai/)).toBeTruthy();
    expect(screen.getByText(/仅是邀请，不代表任何成员确认真实见面/)).toBeTruthy();

    await fireEvent.press(screen.getByRole("tab", { name: "共生" }));
    await fireEvent.press(screen.getByRole("button", { name: "关闭碰面邀请" }));
    expect(screen.getByText("碰面邀请已关闭")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "请灯灯发出邀请" })).toBeNull();
  });
});
