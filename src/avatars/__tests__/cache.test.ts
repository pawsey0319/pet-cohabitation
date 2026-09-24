import AsyncStorage from "@react-native-async-storage/async-storage";
import { cachedAvatarUri, cachedSpaceAvatar, clearAvatarCache, hydrateAvatar, hydrateSpaceAvatar, resolveCachedAvatar, saveSpaceAvatar } from "../cache";
import { deleteAvatarThumbnails, readAvatarThumbnail, saveAvatarThumbnail } from "../thumbnailStore";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../thumbnailStore", () => ({ readAvatarThumbnail: jest.fn(), saveAvatarThumbnail: jest.fn(), deleteAvatarThumbnails: jest.fn(), deleteAvatarThumbnail: jest.fn() }));
const owner = "owner-a", scope = "group-a", ref = "avatar://11111111-1111-4111-8111-111111111111";
const value = { reference: ref, space_id: scope, url: "https://storage.test/avatar?token=secret", version: "version-one", published: true, expires_at: Date.now() + 100_000 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(async () => {
  await clearAvatarCache(); await AsyncStorage.clear(); jest.clearAllMocks();
  jest.mocked(readAvatarThumbnail).mockResolvedValue(null);
  jest.mocked(saveAvatarThumbnail).mockResolvedValue("file:///avatar-thumb.png");
  jest.mocked(deleteAvatarThumbnails).mockResolvedValue();
});
test("concurrent mounts share a read and reuse the thumbnail without persisting signed URLs", async () => {
  const gate = deferred<typeof value>(), read = jest.fn(() => gate.promise);
  const one = resolveCachedAvatar(owner, ref, scope, read), two = resolveCachedAvatar(owner, ref, scope, read);
  gate.resolve(value);
  expect(await one).toBe("file:///avatar-thumb.png"); expect(await two).toBe("file:///avatar-thumb.png");
  expect(read).toHaveBeenCalledTimes(1);
  expect(await resolveCachedAvatar(owner, ref, scope, read)).toBe("file:///avatar-thumb.png");
  expect(read).toHaveBeenCalledTimes(1);
  const stored = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
  expect(JSON.stringify(stored)).not.toContain("token=secret");
  expect(JSON.stringify(stored)).not.toContain("https://");
});
test("offline refresh retains a previously authorized image, explicit permission denial removes it", async () => {
  await resolveCachedAvatar(owner, ref, scope, async () => value);
  await expect(resolveCachedAvatar(owner, ref, scope, async () => { throw new Error("network_error"); }, true)).resolves.toBe("file:///avatar-thumb.png");
  expect(cachedAvatarUri(owner, ref, scope)).toBe("file:///avatar-thumb.png");
  await resolveCachedAvatar(owner, ref, scope, async () => ({ ...value, error: "avatar_forbidden" }), true);
  expect(cachedAvatarUri(owner, ref, scope)).toBeNull();
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});
test("a late signing reply cannot restore a scope revoked while in flight", async () => {
  const gate = deferred<typeof value>(); const started = deferred<boolean>();
  const pending = resolveCachedAvatar(owner, ref, scope, () => { started.resolve(true); return gate.promise; });
  await started.promise; await clearAvatarCache(owner, scope); gate.resolve(value);
  expect(await pending).toBeNull(); expect(cachedAvatarUri(owner, ref, scope)).toBeNull();
  expect(saveAvatarThumbnail).not.toHaveBeenCalled();
});
test("account logout during thumbnail download cannot persist or show late bytes", async () => {
  const gate = deferred<string | null>(); const started = deferred<boolean>();
  jest.mocked(saveAvatarThumbnail).mockImplementation(async () => { started.resolve(true); return gate.promise; });
  const pending = resolveCachedAvatar(owner, ref, scope, async () => value);
  await started.promise; await clearAvatarCache(owner); gate.resolve("file:///late.png");
  expect(await pending).toBeNull(); expect(cachedAvatarUri(owner, ref, scope)).toBeNull();
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});
test("scope and account cache boundaries do not share images or clear another account", async () => {
  await resolveCachedAvatar(owner, ref, scope, async () => value);
  expect(cachedAvatarUri(owner, ref, "group-b")).toBeNull();
  expect(cachedAvatarUri("owner-b", ref, scope)).toBeNull();
  await resolveCachedAvatar("owner-b", ref, scope, async () => value);
  await clearAvatarCache(owner);
  expect(cachedAvatarUri(owner, ref, scope)).toBeNull();
  expect(cachedAvatarUri("owner-b", ref, scope)).toBe("file:///avatar-thumb.png");
});
test("unpublished own drafts never enter persistent thumbnail storage", async () => {
  expect(await resolveCachedAvatar(owner, ref, undefined, async () => ({ ...value, space_id: null, published: false }))).toBe(value.url);
  expect(saveAvatarThumbnail).not.toHaveBeenCalled(); expect(await AsyncStorage.getAllKeys()).toEqual([]);
});
test("disk thumbnail hydration can display before signing and expired temporary URLs disappear", async () => {
  const storageKey = `avatar-cache-v1:${owner}/${scope}/${encodeURIComponent(ref)}`;
  await AsyncStorage.setItem(storageKey, JSON.stringify({ version: "version-one", validatedAt: Date.now() }));
  jest.mocked(readAvatarThumbnail).mockResolvedValue("file:///disk.png");
  expect(await hydrateAvatar(owner, ref, scope)).toBe("file:///disk.png");
  expect(cachedAvatarUri(owner, ref, scope)).toBe("file:///disk.png");
  await resolveCachedAvatar(owner, "avatar://temporary", undefined, async () => ({ ...value, published: false, expires_at: Date.now() - 1 }));
  expect(cachedAvatarUri(owner, "avatar://temporary")).toBeNull();
});
test("membership snapshots and all scope thumbnails clear together", async () => {
  const state = { reference: ref, version: 1, members: [{ id: owner, nickname: "本人" }] };
  await saveSpaceAvatar(owner, scope, state);
  await resolveCachedAvatar(owner, ref, scope, async () => value);
  expect(cachedSpaceAvatar(owner, scope)).toEqual(state);
  await clearAvatarCache(owner, scope);
  expect(cachedSpaceAvatar(owner, scope)).toBeNull(); expect(cachedAvatarUri(owner, ref, scope)).toBeNull();
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});
test("mounting while revocation cleans disk cannot resurrect the old group snapshot", async () => {
  await saveSpaceAvatar(owner, scope, { reference: ref, version: 1, members: [{ id: owner, nickname: "本人" }] });
  const gate = deferred<boolean>(), removalStarted = deferred<boolean>();
  const remove = AsyncStorage.multiRemove.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, "multiRemove").mockImplementationOnce(async keys => {
    removalStarted.resolve(true); await gate.promise; await remove(keys);
  });
  const clearing = clearAvatarCache(owner, scope); await removalStarted.promise;
  let hydrated = false;
  const reading = hydrateSpaceAvatar(owner, scope).then(value => { hydrated = true; return value; });
  await Promise.resolve(); expect(hydrated).toBe(false); expect(cachedSpaceAvatar(owner, scope)).toBeNull();
  gate.resolve(true); await clearing;
  expect(await reading).toBeNull(); expect(cachedSpaceAvatar(owner, scope)).toBeNull();
});
