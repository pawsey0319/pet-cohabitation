import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { LivingPetPortrait } from "../components/LivingPetPortrait";

describe("LivingPetPortrait", () => {
  it.each([
    ["idle", "自在呼吸"],
    ["thinking", "正在想"],
    ["eating", "认真进食"],
    ["playing", "正在玩耍"],
    ["sleeping", "安心休息"],
  ] as const)("exposes the %s state accessibly", async (state, label) => {
    const view = await render(<LivingPetPortrait state={state}><Text>portrait</Text></LivingPetPortrait>);
    expect(screen.getByLabelText(`异宠状态：${label}`)).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
    view.unmount();
  });
});
