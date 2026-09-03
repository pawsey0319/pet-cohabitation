import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text, View } from "react-native";
import { useNotificationInbox } from "../notifications/inbox";

const mockListeners = new Map<string, { subscribed: boolean; callback: () => void; on: jest.Mock; subscribe: jest.Mock }>();
const mockQuery = jest.fn().mockResolvedValue({ data: [], error: null });
const mockRemove = jest.fn(async (channel) => {
  for (const [key, value] of mockListeners) if (channel === value) mockListeners.delete(key);
});
jest.mock("../auth/SessionProvider", () => ({ useSession: () => ({ profile: { id: "owner" }, isLocalDemo: false }) }));
jest.mock("../lib/supabase", () => ({ requireSupabase: () => ({
  from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => mockQuery() }) }) }) }),
  channel: (name: string) => {
    if (mockListeners.has(name)) return mockListeners.get(name);
    const channel: { subscribed: boolean; callback: () => void; on: jest.Mock; subscribe: jest.Mock } = {
      subscribed: false,
      callback: () => undefined,
      on: jest.fn((_type, _filter, callback) => {
        if (channel.subscribed) throw new Error("cannot add callbacks after subscribe");
        channel.callback = callback;
        return channel;
      }),
      subscribe: jest.fn(() => { channel.subscribed = true; return channel; }),
    };
    mockListeners.set(name, channel);
    return channel;
  },
  removeChannel: (channel: unknown) => mockRemove(channel),
}) }));

function Inbox({ label }: { label: string }) {
  const { loading, error } = useNotificationInbox();
  return <Text>{label}: {error ?? (loading ? "loading" : "ready")}</Text>;
}
function Screens({ open }: { open: boolean }) {
  return <View><Inbox label="chats" />{open ? <Inbox label="notifications" /> : null}</View>;
}

beforeEach(() => { mockListeners.clear(); mockRemove.mockClear(); mockQuery.mockReset().mockResolvedValue({ data: [], error: null }); });
it("retains the chat inbox while repeatedly opening and closing notifications", async () => {
  const view = await render(<Screens open={false} />);
  await waitFor(() => expect(screen.getByText("chats: ready")).toBeTruthy());
  const originalChannel = [...mockListeners.values()][0];
  for (let i = 0; i < 3; i++) {
    await view.rerender(<Screens open />);
    await waitFor(() => expect(screen.getByText("notifications: ready")).toBeTruthy());
    expect(mockListeners.size).toBe(2);
    await view.rerender(<Screens open={false} />);
    expect(mockListeners.size).toBe(1);
    expect([...mockListeners.values()][0]).toBe(originalChannel);
  }
  const before = mockQuery.mock.calls.length;
  await act(async () => originalChannel.callback());
  expect(mockQuery.mock.calls.length).toBe(before + 1);
  await view.unmount();
  expect(mockListeners.size).toBe(0);
});
it("shows a recoverable error when the notification query rejects", async () => {
  mockQuery.mockRejectedValue(new Error("offline"));
  await render(<Inbox label="notifications" />);
  await waitFor(() => expect(screen.getByText("notifications: 通知暂时加载失败，请重试。")).toBeTruthy());
});
