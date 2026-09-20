import { z } from "npm:zod@4";
import { createClient } from "npm:@supabase/supabase-js@2";
import { optionsResponse } from "../_shared/cors.ts";
import { json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { validateBackgroundImage } from "../_shared/chatBackgroundPrompt.ts";
import { imageSha256 } from "../_shared/visionData.ts";
import { visionAvailable } from "../_shared/visionAdapter.ts";
const Input = z.discriminatedUnion("action", [
 z.object({ action: z.literal("capabilities") }),
 z.object({ action: z.literal("register"), request_id: z.string().uuid() }),
 z.object({ action: z.literal("read"), asset_id: z.string().uuid() }),
 z.object({ action: z.literal("delete"), request_id: z.string().uuid(), asset_id: z.string().uuid(), expected_version: z.number().int().positive() }),
 z.object({ action: z.literal("prepare_memory"), request_id: z.string().uuid(), asset_id: z.string().uuid(), expected_version: z.number().int().positive(), source_message_id: z.string().uuid(), content: z.string().trim().min(1).max(400) }),
 z.object({ action: z.literal("confirm_memory"), request_id: z.string().uuid(), draft_id: z.string().uuid(), expected_version: z.number().int().positive() }),
]);
Deno.serve(async request => {
 if (request.method === "OPTIONS") return optionsResponse(request);
 try {
  requirePost(request); const user = await authenticatedUser(request); const raw = await request.text(); if (raw.length > 8192) throw new Error("vision_input_invalid");
  const input = Input.parse(JSON.parse(raw)); const client = serviceClient();
  if (input.action === "capabilities") return json(request, { available: visionAvailable() });
  if (input.action === "register") {
   const path = `${user.id}/${input.request_id}.jpg`; const file = await client.storage.from("pet-vision").download(path);
   if (file.error || file.data.size > 8 * 1024 * 1024) throw new Error("vision_image_invalid");
   const bytes = new Uint8Array(await file.data.arrayBuffer()); const mime = validateBackgroundImage(bytes);
   if (!["image/png", "image/jpeg"].includes(mime)) throw new Error("vision_image_invalid");
   const result = await client.rpc("register_pet_vision_asset", { p_owner: user.id, p_id: input.request_id, p_hash: await imageSha256(bytes), p_mime: mime, p_bytes: bytes.length }); if (result.error) throw result.error;
   return json(request, { asset: { id: result.data.id, version: result.data.version, state: result.data.state } });
  }
  if (input.action === "read") {
   const asset = await client.from("pet_vision_assets").select("id,version,state,storage_path").eq("id", input.asset_id).eq("owner_id", user.id).neq("state", "deleted").single(); if (asset.error) throw new Error("vision_asset_unavailable");
   const signed = await client.storage.from("pet-vision").createSignedUrl(asset.data.storage_path, 120); if (signed.error) throw new Error("vision_image_unavailable");
   return json(request, { asset: { id: asset.data.id, version: asset.data.version, state: asset.data.state }, url: signed.data.signedUrl });
  }
  if (input.action === "prepare_memory") {
   const result = await client.rpc("prepare_pet_vision_memory", { p_owner: user.id, p_request: input.request_id, p_asset: input.asset_id, p_version: input.expected_version, p_source: input.source_message_id, p_content: input.content }); if (result.error) throw result.error;
   return json(request, { outcome: "waiting_confirmation", draft: result.data });
  }
  if (input.action === "confirm_memory") {
   const owner = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: request.headers.get("authorization")! } }, auth: { persistSession: false, autoRefreshToken: false } });
   const result = await owner.rpc("confirm_pet_vision_memory", { p_request: input.request_id, p_draft: input.draft_id, p_version: input.expected_version }); if (result.error) throw result.error;
   return json(request, result.data);
  }
  const result = await client.rpc("delete_pet_vision_asset", { p_owner: user.id, p_request: input.request_id, p_asset: input.asset_id, p_version: input.expected_version }); if (result.error) throw result.error;
  const removed = await client.storage.from("pet-vision").remove([result.data.storage_path]); return json(request, { outcome: result.data.outcome, asset_id: result.data.asset_id, version: result.data.version, storage_cleanup: removed.error ? "pending" : "removed" });
 } catch (reason) {
  const message = reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? ""); const code = message.match(/vision_[a-z_]+|personal_memory_limit|unauthenticated/)?.[0] ?? "vision_unavailable";
  return json(request, { error: code }, code === "unauthenticated" ? 401 : /conflict|changed/.test(code) ? 409 : 400);
 }
});
