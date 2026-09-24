import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Pressable, Text, View } from "react-native";

const mockUser = {
  id: "00000000-0000-4000-8000-000000000055",
  email: "fast-login@example.test",
  user_metadata: { nickname: "会话昵称" },
  app_metadata: {}, aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(),
};
const mockGetSession = jest.fn();
const mockSignIn = jest.fn();
const mockSignOut = jest.fn();
const mockSetSession = jest.fn();
const mockMaybeSingle = jest.fn();
const mockUnsubscribe = jest.fn();
const mockStartAutoRefresh = jest.fn();
const mockStopAutoRefresh = jest.fn();
const mockDesktopRunning = jest.fn();
const mockStopDesktop = jest.fn();
const mockUnregisterPush = jest.fn();
const mockStopDelivery = jest.fn();
const mockClearDelivery = jest.fn();
let mockAuthListener: ((event: string, session: { user: typeof mockUser } | null) => void) | null = null;

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../desktopPet/native", () => ({
  desktopPetKeepsSessionActive: () => mockDesktopRunning(),
  stopDesktopPetForAccount: (...args: unknown[]) => mockStopDesktop(...args),
  getDesktopPetModule: () => null,
}));
jest.mock("../chat/deliveryRuntime", () => ({ stopChatDelivery: (...args: unknown[]) => mockStopDelivery(...args), clearChatDelivery: (...args: unknown[]) => mockClearDelivery(...args) }));
jest.mock("../notifications/lifecycle", () => ({
  unregisterCurrentPushDevice: (...args: unknown[]) => mockUnregisterPush(...args),
  clearNotificationLocalData: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../lib/supabase", () => {
  const auth = {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    signInWithPassword: (...args: unknown[]) => mockSignIn(...args),
    signOut: (...args: unknown[]) => mockSignOut(...args),
    setSession: (...args: unknown[]) => mockSetSession(...args),
    startAutoRefresh: (...args: unknown[]) => mockStartAutoRefresh(...args),
    stopAutoRefresh: (...args: unknown[]) => mockStopAutoRefresh(...args),
    onAuthStateChange: (listener: typeof mockAuthListener) => {
      mockAuthListener = listener;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    },
  };
  return {
    isLocalDemoMode: false,
    supabase: { auth },
    requireSupabase: () => ({ auth, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => mockMaybeSingle() }) }) }) }),
  };
});

import { SessionProvider, useSession } from "../auth/SessionProvider";

function Probe() {
  const session = useSession();
  return <View>
    <Text>{session.isLoading ? "loading" : `ready:${session.profile?.nickname ?? "signed-out"}:${session.profile?.isAdmin ? "admin" : "member"}`}</Text>
    <Pressable accessibilityRole="button" onPress={() => void session.login(mockUser.email, "password")}><Text>登录测试</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => void session.logout().catch(() => undefined)}><Text>退出测试</Text></Pressable>
  </View>;
}

beforeEach(() => {
  mockAuthListener = null;
  mockGetSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  mockSignIn.mockReset(); mockSignOut.mockReset().mockResolvedValue({ error: null }); mockSetSession.mockReset();
  mockMaybeSingle.mockReset(); mockUnsubscribe.mockClear();
  mockStartAutoRefresh.mockClear(); mockStopAutoRefresh.mockClear();
  mockDesktopRunning.mockReset().mockResolvedValue(false);
  mockStopDesktop.mockReset().mockResolvedValue(undefined);
  mockUnregisterPush.mockReset().mockResolvedValue(undefined);
  mockStopDelivery.mockClear(); mockClearDelivery.mockReset().mockResolvedValue(undefined);
});

it("keeps auth active for the desktop pet and ignores a late background check after foregrounding", async () => {
  let handle!: (state: string) => void;
  const listener = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, callback: typeof handle) => {
    handle = callback; return { remove: jest.fn() };
  }) as typeof AppState.addEventListener);
  const view = await render(<SessionProvider><Probe /></SessionProvider>);
  mockDesktopRunning.mockResolvedValue(true);
  await act(async () => handle("background"));
  expect(mockStopAutoRefresh).not.toHaveBeenCalled();
  let finish!: (running: boolean) => void;
  mockDesktopRunning.mockReturnValue(new Promise<boolean>(resolve => { finish = resolve; }));
  await act(async () => handle("background"));
  await act(async () => handle("active"));
  await act(async () => finish(false));
  expect(mockStopAutoRefresh).not.toHaveBeenCalled();
  await act(async () => view.unmount());
  listener.mockRestore();
});

it("waits for the old desktop window to close even if the next account emits several auth events", async () => {
  mockGetSession.mockResolvedValue({ data: { session: { user: mockUser } }, error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  let finish!: () => void;
  mockStopDesktop.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  await render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(screen.getByText("ready:会话昵称:member")).toBeTruthy());
  const next = { ...mockUser, id: "00000000-0000-4000-8000-000000000056", user_metadata: { nickname: "新账号" } };
  await act(async () => { mockAuthListener!("SIGNED_IN", { user: next }); mockAuthListener!("TOKEN_REFRESHED", { user: next }); });
  expect(screen.queryByText("ready:新账号:member")).toBeNull();
  expect(mockStopDesktop).toHaveBeenCalledWith(mockUser.id);
  await act(async () => finish());
  await waitFor(() => expect(screen.getByText("ready:新账号:member")).toBeTruthy());
});

it("does not restore a stale boot session after a newer auth event", async () => {
  let finishBoot!: (value: unknown) => void;
  mockGetSession.mockReturnValue(new Promise(resolve => { finishBoot = resolve; }));
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  await render(<SessionProvider><Probe /></SessionProvider>);
  const next = { ...mockUser, id: "00000000-0000-4000-8000-000000000057", user_metadata: { nickname: "最新账号" } };
  await act(async () => { mockAuthListener!("SIGNED_IN", { user: next }); });
  await act(async () => finishBoot({ data: { session: { user: mockUser } } }));
  await waitFor(() => expect(screen.getByText("ready:最新账号:member")).toBeTruthy());
  expect(mockStopDesktop).not.toHaveBeenCalled();
});

it("does not strand the signed-in sender when push unbinding prevents logout", async () => {
  mockGetSession.mockResolvedValue({ data: { session: { user: mockUser } }, error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockUnregisterPush.mockRejectedValue(new Error("offline"));
  await render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(screen.getByText("ready:会话昵称:member")).toBeTruthy());
  await fireEvent.press(screen.getByRole("button", { name: "退出测试" }));
  await waitFor(() => expect(mockUnregisterPush).toHaveBeenCalled());
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockStopDelivery).not.toHaveBeenCalled();
  expect(mockClearDelivery).not.toHaveBeenCalled();
  expect(screen.getByText("ready:会话昵称:member")).toBeTruthy();
});

it("refreshes the native auth session only while the app is active", async () => {
  let handleAppState!: (state: string) => void;
  const remove = jest.fn();
  const appStateListener = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (state: string) => void) => {
    handleAppState = listener;
    return { remove };
  }) as typeof AppState.addEventListener);

  const view = await render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(screen.getByText("ready:signed-out:member")).toBeTruthy());
  expect(mockStartAutoRefresh).toHaveBeenCalledTimes(1);

  await act(async () => handleAppState("background"));
  expect(mockStopAutoRefresh).toHaveBeenCalledTimes(1);
  await act(async () => handleAppState("active"));
  expect(mockStartAutoRefresh).toHaveBeenCalledTimes(2);

  await act(async () => view.unmount());
  expect(remove).toHaveBeenCalledTimes(1);
  expect(mockStopAutoRefresh).toHaveBeenCalledTimes(2);
  appStateListener.mockRestore();
});

it("shows a persisted session before the remote profile request finishes", async () => {
  let resolveProfile!: (value: unknown) => void;
  mockGetSession.mockResolvedValue({ data: { session: { user: mockUser } }, error: null });
  mockMaybeSingle.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));
  await render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(screen.getByText("ready:会话昵称:member")).toBeTruthy());
  await act(async () => resolveProfile({ data: { nickname: "云端昵称", is_admin: true }, error: null }));
  await waitFor(() => expect(screen.getByText("ready:云端昵称:admin")).toBeTruthy());
});

it("navigates with the Auth user immediately instead of waiting for a second database round trip", async () => {
  let resolveProfile!: (value: unknown) => void;
  mockMaybeSingle.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));
  mockSignIn.mockResolvedValue({ data: { user: mockUser }, error: null });
  await render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(screen.getByText("ready:signed-out:member")).toBeTruthy());
  await fireEvent.press(screen.getByRole("button", { name: "登录测试" }));
  await waitFor(() => expect(screen.getByText("ready:会话昵称:member")).toBeTruthy());
  await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalledTimes(1));
  await act(async () => resolveProfile({ data: { nickname: "云端昵称", is_admin: false }, error: null }));
});
