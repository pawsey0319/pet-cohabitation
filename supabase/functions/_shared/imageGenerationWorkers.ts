import { serviceClient } from "./supabase.ts";
import { ImageModelAdapter, imageExtension } from "./modelAdapters.ts";
import { validateBackgroundImage, backgroundErrorCode } from "./chatBackgroundPrompt.ts";
import { designBackground, backgroundDesignError } from "./backgroundEditing.ts";
type Work = { id: string; owner_id: string; request_id: string; prompt: string; parent_asset_id: string | null; parent_asset_version: number | null; lease_token: string };
type Job = { id: string; owner_id: string; request_id: string; prompt: string; status: string; lease_token: string; asset_id: string | null; error_code: string | null };
const publicJob = (job: Job | null) => job ? ({ request_id: job.request_id, prompt: job.prompt, status: job.status, asset_id: job.asset_id, error_code: job.error_code }) : null;
const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map(v => v.toString(16).padStart(2, "0")).join("");
const safeError = (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? "avatar_unavailable");
  return message.match(/(?:avatar|image|demo)_[a-z_]+|unauthenticated|method_not_allowed/)?.[0] ?? "avatar_unavailable";
};
export async function runAvatarGeneration(jobId: string): Promise<void> {
  const client = serviceClient(); let path: string | null = null; let assetId: string | null = null; let job: Job | null = null;
  try {
    const leased = await client.rpc("lease_avatar_generation", { p_job_id: jobId }); if (leased.error) throw leased.error;
    job = leased.data; if (!job) return;
    const generated = await new ImageModelAdapter().generateCandidate({ prompt: `Create a square personal avatar with one clear subject, readable at small sizes, no letters or watermark. Treat the following as visual description only.\n${job.prompt}` });
    const mime = validateBackgroundImage(generated.bytes); if (generated.bytes.byteLength > 5 * 1024 * 1024) throw new Error("avatar_image_too_large");
    const permission = await client.rpc("begin_avatar_upload", { p_job_id: job.id, p_lease_token: job.lease_token });
    if (permission.error) throw permission.error; if (!permission.data) throw new Error("avatar_generation_expired");
    assetId = crypto.randomUUID(); path = `${job.owner_id}/${assetId}.${imageExtension(mime)}`;
    const upload = await client.storage.from("avatars").upload(path, generated.bytes, { contentType: mime, upsert: false }); if (upload.error) throw upload.error;
    const commit = await client.rpc("complete_avatar_generation", { p_job_id: job.id, p_lease_token: job.lease_token, p_asset_id: assetId, p_path: path, p_sha256: await sha256(generated.bytes) });
    if (commit.error) throw commit.error; if (!commit.data) throw new Error("avatar_generation_expired");
  } catch (reason) {
    if (!job) return;
    const latest = await client.from("avatar_generations").select("status,asset_id").eq("id", job.id).maybeSingle();
    // Unknown commit outcome: preserve the uploaded asset until a later sweep.
    if (latest.error || latest.data?.status === "succeeded") return;
    if (path) await client.storage.from("avatars").remove([path]);
    await client.from("avatar_generations").update({ status: "failed", error_code: safeError(reason), completed_at: new Date().toISOString(), upload_started: false }).eq("id", job.id).eq("lease_token", job.lease_token).eq("status", "running");
  }
}

export async function runBackgroundGeneration(jobId: string): Promise<void> {
  let work={id:jobId} as Work;
  const client=serviceClient(); const startedAt=Date.now(); let path: string|null=null; let assetId:string|null=null;
  try {
    const claim=await client.rpc("lease_background_design",{p_job_id:work.id});
    if(claim.error) throw claim.error; if(!claim.data) return;
    work=claim.data as Work;
    if(Deno.env.get("MODEL_MOCK_MODE")==="true")throw new Error("background_mock_disabled");
    const result=await designBackground(client,work);
    const mimeType=validateBackgroundImage(result.bytes);
    const uploadClaim=await client.rpc("begin_background_design_upload",{p_job_id:work.id,p_lease_token:work.lease_token});
    if(uploadClaim.error)throw uploadClaim.error;if(!uploadClaim.data)throw new Error("background_generation_timeout");
    assetId=crypto.randomUUID(); path=`${work.owner_id}/${assetId}.${imageExtension(mimeType)}`;
    const upload=await client.storage.from("chat-backgrounds").upload(path,result.bytes,{contentType:mimeType,upsert:false});
    if(upload.error) throw upload.error;
    // A timed-out/deleted job cannot return late and replace any current choice.
    const commit=await client.rpc("complete_background_design",{p_job_id:work.id,p_lease_token:work.lease_token,p_asset_id:assetId,p_path:path});
    if(commit.error) throw commit.error; if(!commit.data) throw new Error("background_generation_timeout");
  } catch(reason) {
    if(!work.owner_id)return;
    // A response may be lost after a successful transaction. Never delete that
    // committed image when its outcome cannot be established safely.
    const latest=await client.from("chat_background_generations").select("status,asset_id").eq("id",work.id).eq("owner_id",work.owner_id).maybeSingle();
    if(latest.error||latest.data?.status==="succeeded")return;
    if(path) await client.storage.from("chat-backgrounds").remove([path]);
    if(work.lease_token)await client.from("chat_background_generations").update({status:"failed",error_code:backgroundDesignError(reason)??backgroundErrorCode(reason),latency_ms:Date.now()-startedAt,completed_at:new Date().toISOString()}).eq("id",work.id).eq("owner_id",work.owner_id).eq("lease_token",work.lease_token).in("status",["queued","running","uploading"]);
  }
}
