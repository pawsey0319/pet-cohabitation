import { readMediaForUpload } from "../chat/mediaFile";
import { requireSupabase } from "../lib/supabase";
import { AVATAR_BUCKET, MAX_AVATAR_BYTES, avatarAssetId, type AvatarAsset, type AvatarJob, type AvatarState, type AvatarTarget } from "./types";

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
  return avatarRequest(ownerId, { action: "apply", target, asset_id: assetId, expected_version: version, request_id: requestId });
}
export async function resolveAvatarUrl(ownerId: string, reference: string | null | undefined): Promise<string | null> {
  if (!reference) return null;
  const assetId = avatarAssetId(reference);
  if (!assetId) return /^https?:\/\//.test(reference) ? reference : null;
  const result = await avatarRequest<{ url: string }>(ownerId, { action: "read", asset_id: assetId });
  return result.url;
}
export async function generateAvatar(ownerId: string, requestId: string, prompt: string): Promise<AvatarJob> {
  return (await avatarRequest<{ job: AvatarJob }>(ownerId, { action: "generate", request_id: requestId, prompt })).job;
}
export async function getAvatarJob(ownerId: string, requestId?: string): Promise<AvatarJob | null> {
  return (await avatarRequest<{ job: AvatarJob | null }>(ownerId, { action: "status", ...(requestId ? { request_id: requestId } : {}) })).job;
}
// No signed URL or private draft is persisted locally. Account changes unmount the editor.
export function clearAvatarLocalData(): void { /* The module keeps only scoped component state. */ }
