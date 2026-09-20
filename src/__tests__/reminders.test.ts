jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@react-native-community/netinfo", () => ({ __esModule: true, default: { fetch: jest.fn() } }));
jest.mock("../lib/uuid", () => ({ createRequestId: () => "mock-request-1" }));
jest.mock("../lib/supabase", () => ({ requireSupabase: () => mockClient }));
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { isQuietTime, pendingReminders, submitReminder, syncPendingReminders, validateReminder, type ReminderCommand } from "../notifications/reminders";
const mockClient = { auth: { getSession: jest.fn() }, rpc: jest.fn() };
const command = (request_id: string): ReminderCommand => ({ action: "create", request_id, input: { content: "交材料", start_local: "2050-01-31T09:00", timezone: "Asia/Shanghai", rule: { frequency: "monthly", day: 31 } } });
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks();
  mockClient.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "a" } } } });
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
  mockClient.rpc.mockResolvedValue({ data: { series: { id: "series-1" }, outcome: "created" }, error: null });
});
test("quiet boundaries and invalid calendar input are explicit", () => {
  expect(isQuietTime("22:59")).toBe(false); expect(isQuietTime("23:00")).toBe(true);
  expect(isQuietTime("07:59")).toBe(true); expect(isQuietTime("08:00")).toBe(false);
  expect(isQuietTime("09:00", "09:00", "09:00")).toBe(false);
  expect(validateReminder({ content: "x", start_local: "2026-02-30T09:00", timezone: "Asia/Shanghai", rule: { frequency: "once" } })).toMatch("存在");
});
test("offline save preserves immutable request and does not change cloud", async () => {
  expect(await submitReminder("a", command("offline-1"))).toEqual({ outcome: "pending_sync" });
  expect(mockClient.rpc).not.toHaveBeenCalled();
  await expect(submitReminder("a", { ...command("offline-1"), input: { content: "different" } })).rejects.toThrow("request_content_mismatch");
  expect((await pendingReminders("a"))[0].command.input?.content).toBe("交材料");
});
test("concurrent offline requests do not overwrite each other", async () => {
  await Promise.all([submitReminder("a", command("concurrent-1")), submitReminder("a", command("concurrent-2"))]);
  expect((await pendingReminders("a")).map(row => row.command.request_id)).toEqual(["concurrent-1", "concurrent-2"]);
});
test("reconnect replays original request once, keeping conflicts for the user", async () => {
  await submitReminder("a", command("replay-1"));
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true });
  await Promise.all([syncPendingReminders("a"), syncPendingReminders("a")]);
  expect(mockClient.rpc).toHaveBeenCalledTimes(1);
  expect(mockClient.rpc).toHaveBeenCalledWith("manage_reminder", { command: command("replay-1") });
  expect(await pendingReminders("a")).toHaveLength(0);
  mockClient.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "version_conflict" } });
  await expect(submitReminder("a", command("conflict-1"))).rejects.toThrow("version_conflict");
  expect((await pendingReminders("a"))[0].state).toBe("conflict");
  await syncPendingReminders("a");
  expect(mockClient.rpc).toHaveBeenCalledTimes(2);
});
test("account switching blocks old queued requests", async () => {
  await submitReminder("a", command("account-1"));
  mockClient.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "b" } } } });
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
  await syncPendingReminders("a");
  expect(mockClient.rpc).not.toHaveBeenCalled();
  expect(await pendingReminders("b")).toHaveLength(0);
});
