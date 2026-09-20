import { z } from "npm:zod@4";
import { json } from "../_shared/responses.ts";
import { requirePost, serviceClient } from "../_shared/supabase.ts";
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("lease") }),
  z.object({ action: z.literal("complete"), job_id: z.string().uuid(), lease_token: z.string().uuid(), png_base64: z.string().max(12 * 1024 * 1024), source_sha256: z.string().regex(/^[0-9a-f]{64}$/), model_md5: z.literal("fc16ebd8b0c10d971d3513d564d01e29") }),
  z.object({ action: z.literal("fail"), job_id: z.string().uuid(), lease_token: z.string().uuid(), error_code: z.enum(["source_invalid", "processing_timeout", "mask_invalid", "worker_processing_failed"]) }),
]);
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map(v => v.toString(16).padStart(2, "0")).join("");
async function authorized(request: Request): Promise<boolean> {
  const expected = Deno.env.get("PET_TRANSPARENT_WORKER_TOKEN"); const actual = request.headers.get("x-pet-worker-token");
  if (!expected || expected.length < 32 || !actual || actual.length > 512) return false;
  const [a, b] = await Promise.all([digest(new TextEncoder().encode(expected)), digest(new TextEncoder().encode(actual))]);
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i); return difference === 0;
}
Deno.serve(async request => {
  try {
    requirePost(request); if (!await authorized(request)) return json(request, { error: "unauthenticated" }, 401);
    if (Number(request.headers.get("content-length") ?? 0) > 12 * 1024 * 1024) return json(request, { error: "worker_input_too_large" }, 413);
    const raw = await request.text(); if (raw.length > 12 * 1024 * 1024) return json(request, { error: "worker_input_too_large" }, 413);
    const input = Input.parse(JSON.parse(raw)); const client = serviceClient();
    if (input.action === "lease") {
      const result = await client.rpc("lease_pet_transparent"); if (result.error) throw result.error;
      if (!result.data) return json(request, { job: null });
      const job = result.data;
      const source = await client.from("pet_visual_assets").select("storage_path").eq("id", job.source_asset_id).eq("owner_id", job.owner_id).single(); if (source.error) throw source.error;
      const url = await client.storage.from("pet-portraits").createSignedUrl(source.data.storage_path, 300); if (url.error) throw url.error;
      const signed = new URL(url.data.signedUrl); const publicBase = Deno.env.get("PET_TRANSPARENT_PUBLIC_URL");
      const sourceUrl = publicBase ? new URL(signed.pathname + signed.search, publicBase).toString() : signed.toString();
      return json(request, { job: { id: job.id, lease_token: job.lease_token, source_url: sourceUrl, model_name: job.model_name } });
    }
    const result = await client.from("pet_transparent_jobs").select("*").eq("id", input.job_id).eq("lease_token", input.lease_token).maybeSingle(); if (result.error) throw result.error;
    const job = result.data; if (!job) return json(request, { error: "worker_lease_expired" }, 409);
    if (input.action === "fail") {
      const failed = await client.from("pet_transparent_jobs").update({ status: "failed", error_code: input.error_code, completed_at: new Date().toISOString() }).eq("id", job.id).eq("lease_token", input.lease_token).in("status", ["running", "uploading"]);
      if (failed.error) throw failed.error; return json(request, { recorded: true });
    }
    if (job.status === "succeeded") return json(request, { committed: true });
    const binary = atob(input.png_base64); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    // Require actual PNG RGBA, not a JPEG/checkerboard renamed as PNG. Worker
    // additionally verifies nontrivial alpha and exact original RGB preservation.
    if (bytes.byteLength > 8 * 1024 * 1024 || bytes.byteLength < 33 || ![137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value) || bytes[25] !== 6) throw new Error("worker_png_invalid");
    const header = new DataView(bytes.buffer); const width = header.getUint32(16); const height = header.getUint32(20);
    if (!width || !height || width * height > 16_000_000) throw new Error("worker_png_invalid");
    const source = await client.from("pet_visual_assets").select("storage_path").eq("id", job.source_asset_id).eq("owner_id", job.owner_id).single(); if (source.error) throw source.error;
    const original = await client.storage.from("pet-portraits").download(source.data.storage_path); if (original.error) throw original.error;
    if (original.data.size > 12 * 1024 * 1024 || await digest(new Uint8Array(await original.data.arrayBuffer())) !== input.source_sha256) throw new Error("worker_source_changed");
    const permitted = await client.rpc("begin_pet_transparent_upload", { p_job_id: job.id, p_lease_token: input.lease_token }); if (permitted.error) throw permitted.error;
    if (!permitted.data) return json(request, { error: "worker_lease_expired" }, 409);
    const path = `${job.owner_id}/${input.lease_token}.png`; const hash = await digest(bytes);
    const uploaded = await client.storage.from("pet-transparent").upload(path, bytes, { contentType: "image/png", upsert: false });
    if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) throw uploaded.error;
    // Derivative paths include lease identity: a retired worker must never
    // overwrite the next worker's bytes. See unique path assignment below.
    const committed = await client.rpc("complete_pet_transparent", { p_job_id: job.id, p_lease_token: input.lease_token, p_path: path, p_sha256: hash });
    if (committed.error) throw committed.error;
    if (!committed.data) await client.storage.from("pet-transparent").remove([path]);
    return json(request, { committed: !!committed.data }, committed.data ? 200 : 409);
  } catch {
    // Never log image bytes, source URLs, credentials, or user identifiers.
    return json(request, { error: "worker_request_failed" }, 400);
  }
});
