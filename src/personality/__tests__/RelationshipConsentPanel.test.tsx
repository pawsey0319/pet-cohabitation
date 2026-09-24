import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { RelationshipConsentPanel } from "../RelationshipConsentPanel";
const mockRequest = jest.fn();
jest.mock("../client", () => ({ personalityRequest: (...args: unknown[]) => mockRequest(...args), personalityError: () => "暂未取得确认" }));
jest.mock("../../theme/ThemeProvider", () => ({ useAppTheme: () => ({ theme: { text: "#111", muted: "#666", accent: "#a3563c", danger: "#b00", card: "#fff", line: "#ddd", radius: 8 } }) }));
const state = (name = "小陶") => ({ pet: { name }, scope: { epoch: 2 }, votes: [{ member_id: "owner", epoch: 1, consented: true }], members: [{ user_id: "owner", profiles: { nickname: "本人" } }, { user_id: "peer", profiles: { nickname: "朋友" } }], enabled: false });
beforeEach(() => { mockRequest.mockReset().mockResolvedValue(state()); });
test("opening authorization does not agree automatically and previous-epoch votes remain pending", async () => {
  await render(<RelationshipConsentPanel ownerId="owner" petId="pet" spaceId="group" />);
  await waitFor(() => expect(screen.getByText("尚未启用，等待全体成员确认")).toBeTruthy());
  expect(screen.getAllByText("待确认")).toHaveLength(2);
  expect(mockRequest).toHaveBeenCalledTimes(1); expect(mockRequest.mock.calls[0][1].action).toBe("state");
  await fireEvent.press(screen.getByText("我同意此授权"));
  await waitFor(() => expect(mockRequest).toHaveBeenCalledWith("owner", { action: "decide", pet_id: "pet", space_id: "group", decision: true }, "space-relationship-consent"));
  expect(screen.getByText("尚未启用，等待全体成员确认")).toBeTruthy();
});
test("a late old-group response cannot replace a newly selected group's permission state", async () => {
  let finish!: (value: unknown) => void; mockRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(state("新群异宠"));
  const view = await render(<RelationshipConsentPanel ownerId="owner" petId="old-pet" spaceId="old-group" />);
  await view.rerender(<RelationshipConsentPanel ownerId="owner" petId="new-pet" spaceId="new-group" />);
  await waitFor(() => expect(screen.getByText("新群异宠的群关系学习")).toBeTruthy());
  await act(async () => { finish(state("旧群异宠")); });
  expect(screen.queryByText("旧群异宠的群关系学习")).toBeNull(); expect(screen.getByText("新群异宠的群关系学习")).toBeTruthy();
});
