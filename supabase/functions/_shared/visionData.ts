import { readAccountPages } from "./dataPagination.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { VisionInput } from "./visionAdapter.ts";
export async function imageSha256(bytes: Uint8Array): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))).map(byte => byte.toString(16).padStart(2, "0")).join(""); }
/** Must be followed by assert_pet_vision_request again in the final DB commit. */
export async function loadVisionInput(client: SupabaseClient, input: { ownerId: string; petId: string; requestId: string; question: string }): Promise<VisionInput> {
  const valid = await client.rpc("assert_pet_vision_request", { p_pet: input.petId, p_request: input.requestId }); if (valid.error) throw new Error("vision_source_changed");
  const binding = await client.from("pet_vision_requests").select("asset_id,asset_version,asset_sha256,content_sha256").eq("pet_id", input.petId).eq("request_id", input.requestId).eq("owner_id", input.ownerId).single();
  if (binding.error || binding.data.content_sha256 !== await imageSha256(new TextEncoder().encode(input.question.trim()))) throw new Error("vision_request_conflict");
  const row = await client.from("pet_vision_assets").select("storage_path,mime_type,byte_size").eq("owner_id", input.ownerId).eq("id", binding.data.asset_id).eq("version", binding.data.asset_version).eq("state", "active").single();
  if (row.error) throw new Error("vision_asset_unavailable");
  const file = await client.storage.from("pet-vision").download(row.data.storage_path);
  if (file.error || file.data.size > 8 * 1024 * 1024 || file.data.size !== row.data.byte_size) throw new Error("vision_image_invalid");
  const bytes = new Uint8Array(await file.data.arrayBuffer()); if (await imageSha256(bytes) !== binding.data.asset_sha256) throw new Error("vision_image_changed");
  // Downloading may outlive a delete/forget request. Check again immediately
  // before handing private pixels to the model, in addition to the commit fence.
  const current = await client.rpc("assert_pet_vision_request", { p_pet: input.petId, p_request: input.requestId }); if (current.error) throw new Error("vision_source_changed");
  return { question: input.question, bytes, mimeType: row.data.mime_type };
}
export async function exportVisionData(client: SupabaseClient, ownerId: string) {
  const result: Record<string, unknown[]> = {};
  for (const [table, order] of [["pet_vision_assets", "id"], ["pet_vision_requests", "source_message_id"], ["pet_vision_memory_drafts", "id"], ["pet_vision_mutations", "request_id"]]) {
    result[table] = await readAccountPages(client,table,ownerId,{key:order});
  } return result;
}
export async function deleteVisionData(client: SupabaseClient, ownerId: string) {
  const block = await client.rpc("block_chat_background_owner", { p_owner_id: ownerId }); if (block.error) throw block.error;
  const stop = await client.from("pet_vision_assets").update({ state: "deleted" }).eq("owner_id", ownerId); if (stop.error) throw stop.error;
  for (;;) { const listed = await client.storage.from("pet-vision").list(ownerId, { limit: 100 }); if (listed.error) throw listed.error; const paths = (listed.data ?? []).filter(item => item.id).map(item => `${ownerId}/${item.name}`); if (!paths.length) return; const removed = await client.storage.from("pet-vision").remove(paths); if (removed.error) throw removed.error; }
}
