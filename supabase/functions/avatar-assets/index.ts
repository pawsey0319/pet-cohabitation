import { runAvatarGeneration } from "../_shared/imageGenerationWorkers.ts";
import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { runInBackground } from "../_shared/background.ts";
import { ImageModelAdapter, imageExtension } from "../_shared/modelAdapters.ts";
import { validateBackgroundImage } from "../_shared/chatBackgroundPrompt.ts";
const Target = z.object({ kind: z.enum(["profile", "space"]), id: z.string().uuid() });
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state"), target: Target }),
  z.object({ action: z.literal("read"), asset_id: z.string().uuid() }),
  z.object({ action: z.literal("register"), request_id: z.string().uuid() }),
  z.object({ action: z.literal("apply"), target: Target, request_id: z.string().uuid(), expected_version: z.number().int().nonnegative(), asset_id: z.string().uuid().nullable() }),
  z.object({ action: z.literal("generate"), request_id: z.string().uuid(), prompt: z.string().trim().min(4).max(600) }),
  z.object({ action: z.literal("status"), request_id: z.string().uuid().optional() }),
]);
type Job = { id: string; owner_id: string; request_id: string; prompt: string; status: string; lease_token: string; asset_id: string | null; error_code: string | null };
const publicJob = (job: Job | null) => job ? ({ request_id: job.request_id, prompt: job.prompt, status: job.status, asset_id: job.asset_id, error_code: job.error_code }) : null;
const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map(v => v.toString(16).padStart(2, "0")).join("");
const safeError = (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? "avatar_unavailable");
  return message.match(/(?:avatar|image|demo)_[a-z_]+|unauthenticated|method_not_allowed/)?.[0] ?? "avatar_unavailable";
};
const generate = runAvatarGeneration;
async function canReadTarget(owner: string, target: z.infer<typeof Target>): Promise<boolean> {
  const client = serviceClient();
  if (target.kind === "space") {
    const member = await client.from("space_members").select("user_id").eq("space_id", target.id).eq("user_id", owner).maybeSingle();
    if (member.error) throw member.error; return !!member.data;
  }
  if (target.id === owner) return true;
  const mine = await client.from("space_members").select("space_id").eq("user_id", owner); if (mine.error) throw mine.error;
  if (!mine.data?.length) return false;
  const peer = await client.from("space_members").select("space_id").eq("user_id", target.id).in("space_id", mine.data.map(row => row.space_id)).limit(1);
  if (peer.error) throw peer.error; return !!peer.data?.length;
}
Deno.serve(async request => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request); const user = await authenticatedUser(request);
    const raw = await request.text(); if (raw.length > 8192) throw new Error("avatar_input_invalid");
    const parsed = Input.safeParse(JSON.parse(raw)); if (!parsed.success) throw new Error("avatar_input_invalid");
    const input = parsed.data; const client = serviceClient();
    if (input.action === "read") {
      const allowed = await client.rpc("can_read_avatar", { p_asset_id: input.asset_id, p_viewer: user.id }); if (allowed.error) throw allowed.error;
      if (!allowed.data) return json(request, { error: "avatar_forbidden" }, 403);
      const row = await client.from("avatar_assets").select("storage_path").eq("id", input.asset_id).single(); if (row.error) throw row.error;
      const signed = await client.storage.from("avatars").createSignedUrl(row.data.storage_path, 120); if (signed.error) throw signed.error;
      return json(request, { url: signed.data.signedUrl });
    }
    if (input.action === "state") {
      if (!await canReadTarget(user.id, input.target)) return json(request, { error: "avatar_forbidden" }, 403);
      const row = await client.from("avatar_bindings").select("asset_id,version").eq("target_kind", input.target.kind).eq("target_id", input.target.id).maybeSingle(); if (row.error) throw row.error;
      let reference = row.data?.asset_id ? `avatar://${row.data.asset_id}` : null;
      if (!row.data && input.target.kind === "profile") {
        const legacy = await client.from("profiles").select("avatar_url").eq("id", input.target.id).maybeSingle(); if (legacy.error) throw legacy.error; reference = legacy.data?.avatar_url ?? null;
      }
      return json(request, { reference, version: row.data?.version ?? 0 });
    }
    if (input.action === "register") {
      const path = `${user.id}/${input.request_id}.jpg`;
      const file = await client.storage.from("avatars").download(path); if (file.error) throw file.error;
      if (file.data.size > 5 * 1024 * 1024) throw new Error("avatar_image_too_large");
      const bytes = new Uint8Array(await file.data.arrayBuffer());
      if (validateBackgroundImage(bytes) !== "image/jpeg") throw new Error("avatar_image_invalid");
      const saved = await client.rpc("register_avatar_upload", { p_owner_id: user.id, p_request_id: input.request_id, p_sha256: await sha256(bytes) }); if (saved.error) throw saved.error;
      return json(request, { asset: saved.data });
    }
    if (input.action === "apply") {
      const result = await client.rpc("apply_avatar", { p_owner_id: user.id, p_request_id: input.request_id, p_target_kind: input.target.kind, p_target_id: input.target.id, p_asset_id: input.asset_id, p_expected_version: input.expected_version });
      if (result.error) throw result.error; return json(request, result.data);
    }
    if (input.action === "generate") {
      if (Deno.env.get("MODEL_MOCK_MODE") === "true") throw new Error("avatar_mock_disabled");
      const result = await client.rpc("claim_avatar_generation", { p_owner_id: user.id, p_request_id: input.request_id, p_prompt: input.prompt, p_model: ImageModelAdapter.modelName() }); if (result.error) throw result.error;
      if (["queued", "running"].includes(result.data.status)) runInBackground(generate(result.data.id));
      return json(request, { job: publicJob(result.data) }, result.data.status === "succeeded" ? 200 : 202);
    }
    let query = client.from("avatar_generations").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1);
    if (input.request_id) query = query.eq("request_id", input.request_id);
    const result = await query.maybeSingle(); if (result.error) throw result.error;
    if (result.data && ["queued", "running"].includes(result.data.status)) runInBackground(generate(result.data.id));
    return json(request, { job: publicJob(result.data) });
  } catch (reason) {
    const code = safeError(reason);
    return json(request, { error: code }, code === "unauthenticated" ? 401 : /forbidden|owner_required/.test(code) ? 403 : /conflict|limit|quota/.test(code) ? 409 : 400);
  }
});
