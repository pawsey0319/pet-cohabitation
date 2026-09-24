import { readMediaForUpload } from "../chat/mediaFile";
import { requireSupabase } from "../lib/supabase";
import { AVATAR_BUCKET, MAX_AVATAR_BYTES, avatarAssetId, petAvatarId, type AvatarAsset, type AvatarJob, type AvatarRead, type AvatarState, type AvatarTarget, type SpaceAvatarState } from "./types";
import { avatarCacheGeneration, cachedSpaceAvatar, clearAvatarCache, resolveCachedAvatar, saveSpaceAvatar } from "./cache";
export { cachedAvatarUri, cachedSpaceAvatar, hydrateAvatar, hydrateSpaceAvatar, subscribeAvatarCache, invalidateAvatar, discardAvatarImage } from "./cache";

export async function avatarRequest<T>(ownerId: string, body: Record<string, unknown>): Promise<T> {
  const client = requireSupabase();
  const session = await client.auth.getSession();
  if (session.error || session.data.session?.user.id !== ownerId) throw new Error("account_changed");
  const result = await client.functions.invoke("avatar-assets", { body, headers: { Authorization: `Bearer ${session.data.session.access_token}` } });
  if (result.error) {
    let code = "network_error";
    try { const payload = await (result.error as unknown as { context: Response }).context.json(); code = payload.error ?? code; } catch { /* Ambiguous replies retain the caller's request ID. */ }
    throw new Error(code);
  }
  const current = await client.auth.getSession();
  if (current.data.session?.user.id !== ownerId) throw new Error("account_changed");
  if (result.data?.error) throw new Error(result.data.error);
  return result.data as T;
}
export async function getAvatarState(ownerId: string, target: AvatarTarget): Promise<AvatarState> {
  return avatarRequest(ownerId, { action: "state", target });
}
export async function uploadAvatar(ownerId: string, uri: string, requestId: string): Promise<AvatarAsset> {
  const client = requireSupabase();
  const session = await client.auth.getSession();
  if (session.data.session?.user.id !== ownerId) throw new Error("account_changed");
  const media = await readMediaForUpload(uri, MAX_AVATAR_BYTES);
  const path = `${ownerId}/${requestId}.jpg`;
  const uploaded = await client.storage.from(AVATAR_BUCKET).upload(path, media.body, { contentType: "image/jpeg", upsert: false });
  // A lost response can leave this immutable path uploaded. The server validates
  // ownership and records the same asset on the retry instead of replacing it.
  if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) throw uploaded.error;
  return (await avatarRequest<{ asset: AvatarAsset }>(ownerId, { action: "register", request_id: requestId })).asset;
}
export async function applyAvatar(ownerId: string, target: AvatarTarget, assetId: string | null, version: number, requestId: string): Promise<AvatarState> {
  const state = await avatarRequest<AvatarState>(ownerId, { action: "apply", target, asset_id: assetId, expected_version: version, request_id: requestId });
  if (target.kind === "space") {
    const cached = cachedSpaceAvatar(ownerId, target.id);
    if (cached) await saveSpaceAvatar(ownerId, target.id, { ...cached, ...state });
  }
  return state;
}
type PendingRead = { reference: string; space_id: string | null; resolve(value: AvatarRead): void; reject(reason: unknown): void };
const pending = new Map<string, PendingRead[]>();
function readBatched(ownerId: string, reference: string, spaceId?: string): Promise<AvatarRead> {
  return new Promise((resolve, reject) => {
    const queue = pending.get(ownerId);
    const item: PendingRead = { reference, space_id: spaceId ?? null, resolve, reject };
    if (queue) { queue.push(item); return; }
    pending.set(ownerId, [item]);
    // The same render mounts multiple human/pet/mosaic images. One auth and
    // signing request serves them; resolveCachedAvatar also coalesces duplicates.
    queueMicrotask(() => {
      const batch = pending.get(ownerId) ?? []; pending.delete(ownerId);
      for (let offset = 0; offset < batch.length; offset += 50) {
        const part = batch.slice(offset, offset + 50);
        void avatarRequest<{ entries: AvatarRead[] }>(ownerId, { action: "read_batch", references: part.map(({ reference, space_id }) => ({ reference, space_id })) })
          .then(result => part.forEach((task, index) => {
            const entry = result.entries[index];
            if (!entry || entry.reference !== task.reference || entry.space_id !== task.space_id) task.reject(new Error("avatar_response_invalid"));
            else task.resolve(entry);
          }))
          .catch(reason => part.forEach(task => task.reject(reason)));
      }
    });
  });
}
export async function resolveAvatarUrl(ownerId: string, reference: string | null | undefined, options: { spaceId?: string; force?: boolean } = {}): Promise<string | null> {
  if (!reference) return null;
  if (!avatarAssetId(reference) && !petAvatarId(reference)) return /^https?:\/\//.test(reference) ? reference : null;
  return resolveCachedAvatar(ownerId, reference, options.spaceId, () => readBatched(ownerId, reference, options.spaceId), options.force);
}
export async function prefetchAvatars(ownerId: string, references: readonly (string | null | undefined)[], spaceId?: string): Promise<void> {
  await Promise.allSettled([...new Set(references.filter((value): value is string => !!value))].map(reference => resolveAvatarUrl(ownerId, reference, { spaceId })));
}
const spaceRequests = new Map<string, Promise<SpaceAvatarState>>();
export async function getSpaceAvatarState(ownerId: string, spaceId: string): Promise<SpaceAvatarState> {
  const generation = avatarCacheGeneration(ownerId, spaceId), key = `${ownerId}:${spaceId}:${generation}`;
  const running = spaceRequests.get(key); if (running) return running;
  const work = (async () => {
    try {
      const state = await avatarRequest<SpaceAvatarState>(ownerId, { action: "space_state", space_id: spaceId });
      if (generation !== avatarCacheGeneration(ownerId, spaceId)) throw new Error("avatar_scope_forbidden");
      if (!state.members.some(member => member.id === ownerId)) throw new Error("avatar_scope_forbidden");
      await saveSpaceAvatar(ownerId, spaceId, state);
      void prefetchAvatars(ownerId, [state.reference, ...state.members.slice(0, 9).map(member => member.avatarUrl)], spaceId);
      return state;
    } catch (reason) {
      if (/forbidden|membership_revoked/.test(reason instanceof Error ? reason.message : "")) await clearAvatarCache(ownerId, spaceId);
      throw reason;
    }
  })();
  spaceRequests.set(key, work);
  try { return await work; } finally { if (spaceRequests.get(key) === work) spaceRequests.delete(key); }
}
export async function generateAvatar(ownerId: string, requestId: string, prompt: string): Promise<AvatarJob> {
  return (await avatarRequest<{ job: AvatarJob }>(ownerId, { action: "generate", request_id: requestId, prompt })).job;
}
export async function getAvatarJob(ownerId: string, requestId?: string): Promise<AvatarJob | null> {
  return (await avatarRequest<{ job: AvatarJob | null }>(ownerId, { action: "status", ...(requestId ? { request_id: requestId } : {}) })).job;
}
// Invalidate memory synchronously; asynchronous cleanup removes only this
// account/scope's immutable thumbnails and references, never another account.
export async function clearAvatarLocalData(ownerId?: string, spaceId?: string): Promise<void> { await clearAvatarCache(ownerId, spaceId); }
