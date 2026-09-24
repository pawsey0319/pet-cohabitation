import { act, render, screen } from "@testing-library/react-native";
import { SpaceAvatar } from "../SpaceAvatar";
const mockRefresh = jest.fn(), mockClear = jest.fn(), mockListeners = new Set<() => void>();
let mockSnapshot: null | { reference: string; members: { id: string; nickname: string }[] };
const mockEvents: Record<string, (event: any) => void> = {};
let mockStatus: (value: string) => void;
jest.mock("../../auth/SessionProvider", () => ({ useSession: () => ({ profile: { id: "owner-a" }, isLocalDemo: false }) }));
jest.mock("../../lib/uuid", () => ({ createRequestId: () => "request" }));
jest.mock("../../lib/supabase", () => ({ requireSupabase: () => ({
  channel: () => { const channel = {
    on: (_type: string, filter: { table: string }, callback: (event: any) => void) => { mockEvents[filter.table] = callback; return channel; },
    subscribe: (callback: (value: string) => void) => { mockStatus = callback; return channel; },
  }; return channel; }, removeChannel: jest.fn(),
}) }));
jest.mock("../repository", () => ({
  cachedSpaceAvatar: () => mockSnapshot,
  hydrateSpaceAvatar: () => Promise.resolve(mockSnapshot),
  getSpaceAvatarState: (...args: unknown[]) => mockRefresh(...args),
  clearAvatarLocalData: (...args: unknown[]) => { mockClear(...args); mockSnapshot = null; for (const listener of mockListeners) listener(); return Promise.resolve(); },
  subscribeAvatarCache: (listener: () => void) => { mockListeners.add(listener); return () => mockListeners.delete(listener); },
}));
jest.mock("../AvatarImage", () => ({
  GroupAvatar: () => { const React = require("react"); const { Text } = require("react-native"); return React.createElement(Text, {}, "cached collage"); },
  AvatarImage: () => { const React = require("react"); const { Text } = require("react-native"); return React.createElement(Text, {}, "safe placeholder"); },
}));
beforeEach(() => {
  mockSnapshot = { reference: "avatar://known", members: [{ id: "owner-a", nickname: "本人" }] };
  mockClear.mockReset(); mockRefresh.mockReset().mockRejectedValue(new Error("network_error"));
});
test("remount and transient connection failures preserve cached member collage", async () => {
  const view = await render(<SpaceAvatar spaceId="group-a" name="群聊" />);
  expect(screen.getByText("cached collage")).toBeTruthy();
  await act(async () => { mockStatus("TIMED_OUT"); });
  expect(screen.getByText("cached collage")).toBeTruthy(); expect(mockClear).not.toHaveBeenCalled();
  await view.unmount(); await render(<SpaceAvatar spaceId="group-a" name="群聊" />);
  expect(screen.getByText("cached collage")).toBeTruthy();
});
test("DELETE without user_id clears the whole scope before revalidation, even offline", async () => {
  await render(<SpaceAvatar spaceId="group-a" name="群聊" />);
  await act(async () => { mockEvents.space_members({ eventType: "DELETE", old: {} }); });
  expect(mockClear).toHaveBeenCalledWith("owner-a", "group-a");
  expect(screen.queryByText("cached collage")).toBeNull(); expect(screen.getByText("safe placeholder")).toBeTruthy();
});
