import { fireEvent, render, screen } from "@testing-library/react-native";
import { JoinSpaceSheet } from "../components/JoinSpaceSheet";
import { RouteErrorBoundary } from "../ui/RouteErrorBoundary";

jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { publicAppUrl: "https://pet-cohabitation-public.vercel.app" } } } }));
jest.mock("../theme/ThemeProvider", () => ({ useAppTheme: () => ({ theme: { page: "#16142D", card: "#24203D", radius: 18, primary: "#FF806F", controlHeight: 48 } }) }));

it("opens a valid group invitation inside the app, without joining automatically", async () => {
  const close = jest.fn(); const open = jest.fn();
  await render(<JoinSpaceSheet visible onClose={close} onOpenInvite={open} />);
  await fireEvent.changeText(screen.getByLabelText("群邀请链接"), "https://pet-cohabitation-public.vercel.app/invite/cfd54a31-09b4-4e40-b605-9f0ea751da13");
  await fireEvent.press(screen.getByRole("button", { name: "打开群邀请" }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith("cfd54a31-09b4-4e40-b605-9f0ea751da13");
});
it("explains the difference from a signup code and preserves the input on failure", async () => {
  const open = jest.fn();
  await render(<JoinSpaceSheet visible onClose={() => undefined} onOpenInvite={open} />);
  await fireEvent.changeText(screen.getByLabelText("群邀请链接"), "ABCDEF123456");
  await fireEvent.press(screen.getByRole("button", { name: "打开群邀请" }));
  expect(screen.getByText("请粘贴完整的群邀请链接，不是注册邀请码。")).toBeTruthy();
  expect(screen.getByDisplayValue("ABCDEF123456")).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
});
it("renders a recoverable route failure without exposing the error contents", async () => {
  const retry = jest.fn();
  await render(<RouteErrorBoundary error={new Error("private internal details")} retry={retry} />);
  expect(screen.queryByText("private internal details")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "重试页面" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
