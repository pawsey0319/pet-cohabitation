import { requireSupabase } from "../lib/supabase";
import { readMediaForUpload } from "../chat/mediaFile";
import type { VisionAsset, VisionAttachment, VisionMemoryDraft } from "./types";
export async function visionRequest<T>(ownerId: string, body: Record<string, unknown>): Promise<T> {
 const client = requireSupabase(); const session = await client.auth.getSession(); if (session.data.session?.user.id !== ownerId) throw new Error("account_changed");
 const result = await client.functions.invoke("vision-assets", { body, headers: { Authorization: `Bearer ${session.data.session.access_token}` } });
 if (result.error) { let code = "network_error"; try { code = (await (result.error as unknown as { context: Response }).context.json()).error ?? code; } catch {} throw new Error(code); }
 if ((await client.auth.getSession()).data.session?.user.id !== ownerId) throw new Error("account_changed");
 return result.data as T;
}
/** Called before the single text+image send. The caller retains this draft if upload fails. */
export async function prepareVisionAttachment(ownerId: string, draft: VisionAttachment): Promise<VisionAttachment & { asset: VisionAsset }> {
 const client = requireSupabase(); if ((await client.auth.getSession()).data.session?.user.id !== ownerId) throw new Error("account_changed");
 if (draft.asset) return { ...draft, asset: draft.asset };
 const media = await readMediaForUpload(draft.uri, 8 * 1024 * 1024);
 const result = await client.storage.from("pet-vision").upload(`${ownerId}/${draft.uploadId}.jpg`, media.body, { contentType: "image/jpeg", upsert: false });
 if (result.error && !/duplicate|already exists/i.test(result.error.message)) throw result.error;
 const saved = await visionRequest<{ asset: VisionAsset }>(ownerId, { action: "register", request_id: draft.uploadId }); return { ...draft, asset: saved.asset };
}
export async function readVisionImage(ownerId: string, assetId: string) { return visionRequest<{ asset: VisionAsset; url: string }>(ownerId, { action: "read", asset_id: assetId }); }
export async function previewVisionMemory(ownerId: string, asset: VisionAsset, sourceId: string, content: string, requestId: string) { return visionRequest<{ outcome: "waiting_confirmation"; draft: VisionMemoryDraft }>(ownerId, { action: "prepare_memory", asset_id: asset.id, expected_version: asset.version, source_message_id: sourceId, content, request_id: requestId }); }
export { clearVisionLocalData } from "./localFiles";
