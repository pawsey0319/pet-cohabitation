import { act, renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNotificationPreferences } from "../notifications/preferences";
let mockOwner = "notification-owner-a";
const mockRead = jest.fn(), mockWrite = jest.fn();
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../auth/SessionProvider", () => ({ useSession: () => ({ profile: { id: mockOwner }, isLocalDemo: false }) }));
jest.mock("../lib/supabase", () => ({ requireSupabase: () => ({ from: () => { const chain = { select: () => chain, eq: () => chain, maybeSingle: mockRead, upsert: mockWrite }; return chain; } }) }));
const cloud = { messages_enabled: false, mentions_enabled: true, proposals_enabled: false, reminders_enabled: true, agent_results_enabled: false, show_content_preview: false, quiet_start: "23:00:00", quiet_end: "08:00:00", timezone: "Asia/Shanghai" };
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
beforeEach(async () => { mockOwner = "notification-owner-a"; await AsyncStorage.clear(); mockRead.mockReset().mockResolvedValue({ data: cloud, error: null }); mockWrite.mockReset().mockResolvedValue({ error: null }); });
test("saving only edited fields preserves existing explicit notification choices", async () => {
  const { result } = await renderHook(useNotificationPreferences);
  await waitFor(() => expect(result.current.preferences.messages).toBe(false));
  await act(() => result.current.update({ quietStart: "22:00" }));
  await act(() => result.current.save());
  expect(mockWrite.mock.calls[0][0]).toMatchObject({ messages_enabled: false, proposals_enabled: false, agent_results_enabled: false, quiet_start: "22:00" });
  expect(result.current.dirty).toBe(false);
});
test("failed cloud save retains the edit without replacing local effective settings", async () => {
  const { result } = await renderHook(useNotificationPreferences);
  await waitFor(() => expect(result.current.preferences.messages).toBe(false));
  await act(() => result.current.update({ showContentPreview: true })); mockWrite.mockResolvedValueOnce({ error: new Error("offline") });
  await act(async () => { await expect(result.current.save()).rejects.toThrow("offline"); });
  expect(result.current.dirty).toBe(true);
  expect(await AsyncStorage.getItem(`pet-cohabitation-notifications-v1:${mockOwner}`)).toBeNull();
});
test("editing while an earlier save is in flight remains dirty and visible", async () => {
  const { result } = await renderHook(useNotificationPreferences);
  await waitFor(() => expect(result.current.preferences.messages).toBe(false));
  await act(() => result.current.update({ quietStart: "22:00" })); const pending = deferred(); mockWrite.mockReturnValueOnce(pending.promise);
  let saved!: Promise<void>; await act(() => { saved = result.current.save(); }); await waitFor(() => expect(mockWrite).toHaveBeenCalled());
  await act(() => result.current.update({ showContentPreview: true })); await act(async () => { pending.resolve({ error: null }); await saved; });
  expect(result.current.dirty).toBe(true); expect(result.current.preferences.showContentPreview).toBe(true);
});
test("a delayed initial read merges pending edits and retains unrelated server choices", async () => {
  const pending = deferred(); mockRead.mockReturnValueOnce(pending.promise); const { result } = await renderHook(useNotificationPreferences);
  await waitFor(() => expect(mockRead).toHaveBeenCalled()); await act(() => result.current.update({ showContentPreview: true }));
  await act(async () => pending.resolve({ data: cloud, error: null }));
  expect(result.current.preferences.messages).toBe(false); expect(result.current.preferences.showContentPreview).toBe(true); expect(result.current.dirty).toBe(true);
});
