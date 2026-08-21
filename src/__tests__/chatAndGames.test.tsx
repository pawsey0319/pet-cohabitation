jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

import { fireEvent, render, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import App from "../../App";

describe("traceable chat metadata and safe co-created games", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it("sends a reply with mood and communication intent plus honest local media placeholders", async () => {
    await render(<App />);
    await fireEvent.press(screen.getByRole("button", { name: "进入空间：老友小圈" }));

    await fireEvent.press(screen.getByRole("button", { name: "引用最近一条消息" }));
    await fireEvent.press(screen.getByRole("button", { name: "心情：平静" }));
    await fireEvent.press(screen.getByRole("button", { name: "沟通意图：分享" }));
    await fireEvent.changeText(screen.getByPlaceholderText("给老友小圈发消息"), "我也想继续");
    await fireEvent.press(screen.getByRole("button", { name: "发送消息" }));

    expect(screen.getByText("引用消息：周末想继续接力游戏吗？")).toBeTruthy();
    expect(screen.getAllByText("心情：开心").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("沟通意图：寻求安慰")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "添加图片演示占位" }));
    await fireEvent.press(screen.getByRole("button", { name: "添加短语音演示占位" }));
    expect(screen.getByText("图片 · 本地演示占位 · 未上传")).toBeTruthy();
    expect(screen.getByText("短语音 · 本地演示占位 · 未上传")).toBeTruthy();
    expect(screen.queryByText(/上传成功/)).toBeNull();
  });

  it("runs three deterministic co-created game components under the space main agent", async () => {
    await render(<App />);
    await fireEvent.press(screen.getByRole("button", { name: "进入空间：老友小圈" }));

    await fireEvent.press(screen.getByRole("button", { name: "玩同题揭晓" }));
    expect(screen.getByText(/主持同题揭晓/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "玩猜测选择" }));
    expect(screen.getByText(/主持猜测选择/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "玩接力" }));
    expect(screen.getByText(/主持接力/)).toBeTruthy();

    expect(screen.getAllByText("空间主 Agent · 游戏主持")).toHaveLength(3);
    expect(screen.getAllByText(/人类素材/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText(/异宠素材/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/仅组合预设安全素材，不执行任意代码/)).toBeTruthy();
  });
});
