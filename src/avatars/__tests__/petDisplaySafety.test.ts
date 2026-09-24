import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { usePetDisplay } from "../petDisplay";

jest.mock("../../pets/PetWorkspaceProvider", () => ({ usePetWorkspace: () => null }));

const mockInvoke = jest.fn(); let mockOwner = "owner-a", mockRequest = 0;
const mockCreateChannel = jest.fn(), mockRemoveChannel = jest.fn();
const mockChannels: Array<{ events: Array<{ type: string; callback: (value: any) => void }>; status?: (value: string) => void }> = [];
const mockFocusEntries = new Set<{ callback: () => (() => void) | undefined; cleanup?: (() => void) | void }>();
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => (() => void) | undefined) => require("react").useEffect(() => {
  const entry = { callback, cleanup: callback() }; mockFocusEntries.add(entry);
  return () => { entry.cleanup?.(); mockFocusEntries.delete(entry); };
}, [callback]) }));
jest.mock("../../auth/SessionProvider", () => ({ useSession: () => ({ profile: { id: mockOwner }, isLocalDemo: false }) }));
jest.mock("../../theme/ThemeProvider", () => ({ useAppTheme: () => ({ theme: {} }) }));
jest.mock("../../lib/uuid", () => ({ createRequestId: () => `request-${++mockRequest}` }));
jest.mock("../../lib/supabase", () => ({ requireSupabase: () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: mockOwner }, access_token: "test-token" } } }) },
  functions: { invoke: mockInvoke },
  channel: (...args: unknown[]) => mockCreateChannel(...args), removeChannel: mockRemoveChannel,
}) }));

const status = (jobStatus: string, url: string | null) => ({
  preference: { version: 0, use_transparent: true }, source_asset_id: "source-a", url,
  job: { id: "job-a", status: jobStatus, error_code: jobStatus === "failed" ? "mask_invalid" : null },
});
const candidate = () => ({ ...status("succeeded", null), candidate_url: "https://fixture.invalid/candidate.png" });
const approved = () => ({ ...candidate(), url: "https://fixture.invalid/approved.png", preference: { version: 0, use_transparent: true, approved_job_id: "job-a", approved_source_asset_id: "source-a", approved_display_version: 0, approved_at: "2026-09-14T00:00:00Z" } });
beforeEach(() => {
  AppState.currentState = "active";
  mockInvoke.mockReset(); mockOwner = "owner-a"; mockRequest = 0; mockChannels.length = 0;
  mockRemoveChannel.mockReset(); mockCreateChannel.mockReset().mockImplementation(() => {
    const entry: typeof mockChannels[number] = { events: [] }; mockChannels.push(entry);
    const channel = { on: (type: string, _filter: unknown, callback: (value: any) => void) => { entry.events.push({ type, callback }); return channel; }, subscribe: (callback: (value: string) => void) => { entry.status = callback; return channel; } };
    return channel;
  });
});

// Regression from the 2026-09-14 real rembg fixture: valid RGBA and
// succeeded status can still mean a missing torso/arms/feet. Completion alone
// must not select this unreviewed derivative as the pet's displayed portrait.
test("completed transparent job remains a candidate until the owner confirms its preview", async () => {
  mockInvoke.mockResolvedValue({ data: status("succeeded", "https://fixture.invalid/unreviewed-head-only.png"), error: null });
  const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(result.current.state?.job?.status).toBe("succeeded"));
  expect(result.current.url).toBeNull();
  expect(result.current.candidateUrl).toBe("https://fixture.invalid/unreviewed-head-only.png");
});

test("a rejected mask leaves the main portrait empty", async () => {
  mockInvoke.mockResolvedValue({ data: status("failed", null), error: null });
  const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(result.current.state?.job?.status).toBe("failed"));
  expect(result.current.url).toBeNull();
});

test("new-server candidate is preview-only before approval", async () => {
  mockInvoke.mockResolvedValue({ data: candidate(), error: null });
  const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(result.current.candidateUrl).toBeTruthy());
  expect(result.current.url).toBeNull();
});

test("explicit confirmation uses exact job/source/version and survives remount through server state", async () => {
  let server = candidate() as ReturnType<typeof candidate> | ReturnType<typeof approved>;
  mockInvoke.mockImplementation(async (_name, { body }) => {
    if (body.action === "approve") { server = approved(); return { data: { preference: server.preference }, error: null }; }
    return { data: server, error: null };
  });
  const hook = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(hook.result.current.candidateUrl).toBeTruthy());
  await act(() => hook.result.current.approve());
  await waitFor(() => expect(hook.result.current.url).toBe(approved().url));
  expect(mockInvoke.mock.calls.find(([, options]) => options.body.action === "approve")?.[1].body).toMatchObject({ pet_id: "pet-a", job_id: "job-a", source_asset_id: "source-a", expected_version: 0 });
  await hook.unmount();
  const reopened = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(reopened.result.current.url).toBe(approved().url));
});

test.each([
  { approved_job_id: "previous-job" },
  { approved_source_asset_id: "previous-source" },
  { approved_display_version: 1 },
  { approved_at: null },
])("mismatched approval metadata suppresses main portrait: %j", async change => {
  const response = approved();
  mockInvoke.mockResolvedValue({ data: { ...response, preference: { ...response.preference, ...change } }, error: null });
  const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(result.current.state).toBeTruthy());
  expect(result.current.url).toBeNull();
});

test("approval failure leaves the main portrait empty and candidate available for review", async () => {
  mockInvoke.mockImplementation(async (_name, { body }) => body.action === "approve" ? { error: new Error("offline") } : { data: candidate(), error: null });
  const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(result.current.candidateUrl).toBeTruthy());
  await act(() => result.current.approve());
  expect(result.current.url).toBeNull(); expect(result.current.candidateUrl).toBeTruthy(); expect(result.current.error).toBeTruthy();
});

test("repeated enable of an approved result does not reset preference or regenerate", async () => {
  mockInvoke.mockResolvedValue({ data: approved(), error: null });
  const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(result.current.url).toBeTruthy());
  await act(() => result.current.change(true));
  expect(mockInvoke.mock.calls.every(([, options]) => options.body.action === "status")).toBe(true);
  expect(result.current.url).toBe(approved().url);
});

test("restore then re-enable requests a new version and cannot reuse earlier approval", async () => {
  let server: Record<string, any> = approved();
  mockInvoke.mockImplementation(async (_name, { body }) => {
    if (body.action === "set") { server = { ...server, preference: { ...server.preference, version: server.preference.version + 1, use_transparent: body.use_transparent }, url: null, candidate_url: null, job: null }; return { data: { preference: server.preference }, error: null }; }
    if (body.action === "request") { server = { ...server, job: { id: "new-job", status: "queued", error_code: null } }; return { data: { job: server.job }, error: null }; }
    return { data: server, error: null };
  });
  const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(result.current.url).toBeTruthy());
  await act(() => result.current.change(false));
  await waitFor(() => expect(result.current.state?.preference.version).toBe(1));
  expect(result.current.url).toBeNull();
  await act(() => result.current.change(true));
  await waitFor(() => expect(result.current.state?.preference.version).toBe(2));
  expect(result.current.url).toBeNull();
  expect(mockInvoke.mock.calls.find(([, options]) => options.body.action === "request")?.[1].body.expected_version).toBe(2);
});

test("a delayed approval cannot select a previous account/source after switching", async () => {
  let complete!: (value: unknown) => void;
  const pending = new Promise(resolve => { complete = resolve; });
  mockInvoke.mockImplementation(async (_name, { body }) => body.action === "approve" ? pending : { data: mockOwner === "owner-a" ? candidate() : { ...status("failed", null), source_asset_id: "source-b" }, error: null });
  const hook = await renderHook<ReturnType<typeof usePetDisplay>, { source: string }>(({ source }) => usePetDisplay("pet-a", source), { initialProps: { source: "source-a" } });
  await waitFor(() => expect(hook.result.current.candidateUrl).toBeTruthy());
  let saving!: Promise<void>;
  await act(() => { saving = hook.result.current.approve(); });
  mockOwner = "owner-b";
  await hook.rerender({ source: "source-b" });
  await act(async () => { complete({ data: { preference: approved().preference }, error: null }); await saving; });
  await waitFor(() => expect(hook.result.current.state?.source_asset_id).toBe("source-b"));
  expect(hook.result.current.url).toBeNull(); expect(hook.result.current.candidateUrl).toBeNull(); expect(hook.result.current.busy).toBe(false);
});

test("Realtime approval and restore on another client converge for the current owner/pet", async () => {
  let server: Record<string, any> = candidate();
  mockInvoke.mockImplementation(async () => ({ data: server, error: null }));
  const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(result.current.candidateUrl).toBeTruthy());
  const update = mockChannels.at(-1)!.events.find(event => event.type === "postgres_changes")!.callback;
  server = approved();
  await act(() => update({ new: { owner_id: "someone-else", pet_id: "pet-a" } }));
  expect(result.current.url).toBeNull();
  await act(() => update({ new: { owner_id: "owner-a", pet_id: "pet-a" } }));
  await waitFor(() => expect(result.current.url).toBe(approved().url));
  server = { ...approved(), preference: { ...approved().preference, version: 1, use_transparent: false }, url: null, candidate_url: null, job: null };
  await act(() => update({ new: { owner_id: "owner-a", pet_id: "pet-a" } }));
  await waitFor(() => expect(result.current.state?.preference.version).toBe(1));
  expect(result.current.url).toBeNull();
});

test("SUBSCRIBED and system-ready notifications revalidate changes missed during connection setup", async () => {
  let server: Record<string, any> = candidate();
  mockInvoke.mockImplementation(async () => ({ data: server, error: null }));
  const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
  await waitFor(() => expect(result.current.candidateUrl).toBeTruthy());
  const channel = mockChannels.at(-1)!;
  server = approved(); await act(() => channel.status!("SUBSCRIBED"));
  await waitFor(() => expect(result.current.url).toBeTruthy());
  server = candidate(); await act(() => channel.events.find(event => event.type === "system")!.callback({ status: "ok", extension: "postgres_changes" }));
  await waitFor(() => expect(result.current.url).toBeNull());
});

test("foreground and page reentry revalidate approved/restored state", async () => {
  let listener: (next: any) => void = () => undefined;
  const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => { listener = callback; return { remove: jest.fn() }; });
  let server: Record<string, any> = approved();
  mockInvoke.mockImplementation(async () => ({ data: server, error: null }));
  try {
    const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
    await waitFor(() => expect(result.current.url).toBeTruthy());
    await act(() => listener("background")); expect(result.current.url).toBe(approved().url);
    server = candidate(); await act(() => listener("active"));
    await waitFor(() => expect(result.current.candidateUrl).toBeTruthy()); expect(result.current.url).toBeNull();
    const focus = [...mockFocusEntries][0];
    await act(() => { focus.cleanup?.(); focus.cleanup = undefined; });
    server = approved();
    await act(() => { focus.cleanup = focus.callback(); });
    await waitFor(() => expect(result.current.url).toBeTruthy());
  } finally { spy.mockRestore(); }
});

describe("signed image URL renewal", () => {
  let appStateChange: (next: any) => void;
  let appStateSpy: jest.SpyInstance;
  const advance = async (milliseconds: number) => { await act(async () => { jest.advanceTimersByTime(milliseconds); }); };
  const freshCandidate = () => ({ ...candidate(), candidate_url: "https://fixture.invalid/candidate.png?signature=new" });
  const freshApproved = () => ({ ...approved(), candidate_url: freshCandidate().candidate_url, url: "https://fixture.invalid/approved.png?signature=new" });
  beforeEach(() => {
    jest.useFakeTimers();
    appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => { appStateChange = callback; return { remove: jest.fn() }; });
  });
  afterEach(async () => { await cleanup(); appStateSpy.mockRestore(); jest.useRealTimers(); });

  test.each([
    { name: "preview candidate", initial: candidate, renewed: freshCandidate },
    { name: "approved portrait", initial: approved, renewed: freshApproved },
    { name: "legacy preview URL", initial: () => status("succeeded", candidate().candidate_url), renewed: () => status("succeeded", freshCandidate().candidate_url) },
  ])("renews $name at 240 seconds, before its 300 second expiry", async ({ initial, renewed }) => {
    mockInvoke.mockResolvedValueOnce({ data: initial(), error: null }).mockResolvedValue({ data: renewed(), error: null });
    const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
    expect(result.current.candidateUrl).toBe(candidate().candidate_url);
    await advance(239999); expect(mockInvoke).toHaveBeenCalledTimes(1);
    await advance(1); expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result.current.candidateUrl).toBe(freshCandidate().candidate_url);
    expect(result.current.url).toBe(initial === approved ? freshApproved().url : null);
    await advance(239999); expect(mockInvoke).toHaveBeenCalledTimes(2);
    await advance(1); expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke.mock.calls.every(([, options]) => options.body.action === "status")).toBe(true);
  });

  test.each(["queued", "running", "uploading"])("keeps the 5 second %s poll and switches to URL renewal after completion", async jobStatus => {
    mockInvoke.mockResolvedValueOnce({ data: status(jobStatus, null), error: null }).mockResolvedValue({ data: candidate(), error: null });
    const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
    await advance(4999); expect(mockInvoke).toHaveBeenCalledTimes(1);
    await advance(1); expect(mockInvoke).toHaveBeenCalledTimes(2); expect(result.current.candidateUrl).toBeTruthy();
    await advance(239999); expect(mockInvoke).toHaveBeenCalledTimes(2);
    await advance(1); expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  test.each([
    { name: "a different source", data: { ...approved(), source_asset_id: "source-previous" } },
    { name: "a restored original", data: { ...approved(), preference: { ...approved().preference, use_transparent: false } } },
    { name: "no signed URL", data: status("succeeded", null) },
    { name: "a failed job", data: status("failed", approved().url) },
  ])("does not schedule renewal for $name", async ({ data }) => {
    mockInvoke.mockResolvedValue({ data, error: null });
    const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
    expect(result.current.url).toBeNull(); expect(result.current.candidateUrl).toBeNull();
    await advance(600000); expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  describe.each(["blur", "background"] as const)("%s isolation", departure => {
    const leave = async () => {
      const focus = [...mockFocusEntries][0];
      await act(() => {
        if (departure === "blur") { focus.cleanup?.(); focus.cleanup = undefined; }
        else appStateChange("background");
      });
      return async () => { await act(() => { if (departure === "blur") focus.cleanup = focus.callback(); else appStateChange("active"); }); };
    };
    test("cancels scheduled renewal and resumes with fresh authoritative state", async () => {
      let server = approved(); mockInvoke.mockImplementation(async () => ({ data: server, error: null }));
      const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
      await advance(100000);
      const reenter = await leave();
      expect(result.current.url).toBe(approved().url);
      await advance(600000); expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(result.current.url).toBeNull();
      server = freshApproved(); await reenter();
      expect(result.current.url).toBe(freshApproved().url); expect(mockInvoke).toHaveBeenCalledTimes(2);
      await advance(240000); expect(mockInvoke).toHaveBeenCalledTimes(3);
    });
    test("discards an in-flight renewal and cannot restart its timer", async () => {
      let complete!: (value: unknown) => void;
      mockInvoke.mockResolvedValueOnce({ data: approved(), error: null }).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue({ data: freshCandidate(), error: null });
      const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
      await advance(240000); expect(mockInvoke).toHaveBeenCalledTimes(2);
      const reenter = await leave();
      await act(() => complete({ data: freshApproved(), error: null }));
      expect(result.current.url).toBe(approved().url);
      await advance(600000); expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(result.current.url).toBeNull();
      await reenter(); expect(result.current.candidateUrl).toBe(freshCandidate().candidate_url); expect(result.current.url).toBeNull();
    });
  });

  test.each(["account", "source"])("ignores old renewal responses and listeners after a %s change", async changed => {
    let complete!: (value: unknown) => void;
    const nextSource = changed === "source" ? "source-b" : "source-a";
    mockInvoke.mockResolvedValueOnce({ data: approved(), error: null }).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue({ data: { ...status("failed", null), source_asset_id: nextSource }, error: null });
    const hook = await renderHook<ReturnType<typeof usePetDisplay>, { source: string }>(({ source }) => usePetDisplay("pet-a", source), { initialProps: { source: "source-a" } });
    const oldChannel = mockChannels.at(-1)!; const oldAppStateChange = appStateChange;
    await advance(240000); expect(mockInvoke).toHaveBeenCalledTimes(2);
    if (changed === "account") mockOwner = "owner-b";
    await hook.rerender({ source: nextSource });
    expect(hook.result.current.state?.job?.status).toBe("failed");
    await act(() => {
      complete({ data: freshApproved(), error: null });
      oldChannel.status!("SUBSCRIBED");
      oldChannel.events.find(event => event.type === "system")!.callback({ status: "ok", extension: "postgres_changes" });
      oldAppStateChange("active");
    });
    expect(hook.result.current.state?.job?.status).toBe("failed");
    expect(hook.result.current.url).toBeNull(); expect(hook.result.current.candidateUrl).toBeNull();
    await advance(600000); expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  test("a transient renewal error retains a valid approved URL and retries after five seconds", async () => {
    mockInvoke.mockResolvedValueOnce({ data: approved(), error: null }).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: freshCandidate(), error: null });
    const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
    await advance(240000);
    expect(result.current.url).toBe(approved().url);
    await advance(4999); expect(mockInvoke).toHaveBeenCalledTimes(2);
    await advance(1); expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(result.current.candidateUrl).toBe(freshCandidate().candidate_url); expect(result.current.url).toBeNull();
  });

  test.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])("%s retains valid approval while retrying the connection", async connectionStatus => {
    mockInvoke.mockResolvedValue({ data: approved(), error: null });
    const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
    await advance(100000);
    await act(() => mockChannels.at(-1)!.status!(connectionStatus));
    expect(result.current.url).toBe(approved().url);
    await advance(5000); expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  test("a late response after connection failure cannot replace the retained approval", async () => {
    let complete!: (value: unknown) => void;
    mockInvoke.mockResolvedValueOnce({ data: approved(), error: null }).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockRejectedValue(new Error("offline"));
    const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
    await advance(240000);
    await act(() => mockChannels.at(-1)!.status!("CHANNEL_ERROR"));
    await act(() => complete({ data: freshApproved(), error: null }));
    expect(result.current.url).toBe(approved().url);
    await advance(50000);
    expect(result.current.url).toBeNull(); expect(result.current.candidateUrl).toBeNull();
  });

  test("a remote restore supersedes an in-flight renewal and cancels future image refreshes", async () => {
    let complete!: (value: unknown) => void;
    const restored = { ...status("succeeded", null), preference: { version: 1, use_transparent: false }, job: null };
    mockInvoke.mockResolvedValueOnce({ data: approved(), error: null }).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue({ data: restored, error: null });
    const { result } = await renderHook(() => usePetDisplay("pet-a", "source-a"));
    await advance(240000);
    const update = mockChannels.at(-1)!.events.find(event => event.type === "postgres_changes")!.callback;
    await act(() => update({ new: { owner_id: "owner-a", pet_id: "pet-a" } }));
    expect(result.current.state?.preference.version).toBe(1);
    await act(() => complete({ data: freshApproved(), error: null }));
    expect(result.current.state?.preference.version).toBe(1); expect(result.current.url).toBeNull(); expect(result.current.candidateUrl).toBeNull();
    await advance(600000); expect(mockInvoke).toHaveBeenCalledTimes(3);
  });
});
