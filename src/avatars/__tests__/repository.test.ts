import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearAvatarLocalData, getSpaceAvatarState, resolveAvatarUrl } from "../repository";
import { readAvatarThumbnail, saveAvatarThumbnail } from "../thumbnailStore";
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../thumbnailStore", () => ({ readAvatarThumbnail: jest.fn(), saveAvatarThumbnail: jest.fn(), deleteAvatarThumbnails: jest.fn(), deleteAvatarThumbnail: jest.fn() }));
const mockInvoke = jest.fn(); const mockGetSession = jest.fn();
jest.mock("../../lib/supabase", () => ({ requireSupabase: () => ({ auth: { getSession: mockGetSession }, functions: { invoke: mockInvoke } }) }));
const owner = "owner-a", scope = "group-a";
const first = "avatar://11111111-1111-4111-8111-111111111111", pet = "pet-avatar://22222222-2222-4222-8222-222222222222";
beforeEach(async () => {
  await clearAvatarLocalData(); await AsyncStorage.clear(); jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: owner }, access_token: "test-session" } }, error: null });
  jest.mocked(readAvatarThumbnail).mockResolvedValue(null); jest.mocked(saveAvatarThumbnail).mockResolvedValue("file:///thumb.png");
});
test("human, pet and duplicate requests resolve through one authorized batch", async () => {
  mockInvoke.mockImplementation(async (_name, options) => ({ data: { entries: options.body.references.map((reference: object) => ({ ...reference, url: "https://test/image", version: "one", published: true })) }, error: null }));
  const result = await Promise.all([resolveAvatarUrl(owner, first, { spaceId: scope }), resolveAvatarUrl(owner, pet, { spaceId: scope }), resolveAvatarUrl(owner, first, { spaceId: scope })]);
  expect(result).toEqual(["file:///thumb.png", "file:///thumb.png", "file:///thumb.png"]);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke.mock.calls[0][1].body).toEqual({ action: "read_batch", references: [{ reference: first, space_id: scope }, { reference: pet, space_id: scope }] });
});
test("sharing a group snapshot request does not repeat its state round trip", async () => {
  const state = { reference: null, version: 0, members: [{ id: owner, nickname: "本人" }] };
  mockInvoke.mockResolvedValue({ data: state, error: null });
  expect(await Promise.all([getSpaceAvatarState(owner, scope), getSpaceAvatarState(owner, scope)])).toEqual([state, state]);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
});
test("a changed account never receives or persists the signed response", async () => {
  mockInvoke.mockImplementation(async (_name, options) => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: "owner-b" } } } });
    return { data: { entries: options.body.references.map((reference: object) => ({ ...reference, url: "https://test/image", version: "one", published: true })) }, error: null };
  });
  expect(await resolveAvatarUrl(owner, first, { spaceId: scope })).toBeNull();
  expect(saveAvatarThumbnail).not.toHaveBeenCalled(); expect(await AsyncStorage.getAllKeys()).toEqual([]);
});
