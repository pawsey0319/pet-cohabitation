import { requirePost, serviceClient } from "../_shared/supabase.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { runAvatarGeneration, runBackgroundGeneration } from "../_shared/imageGenerationWorkers.ts";

Deno.serve(async request => {
  try {
    requirePost(request);
    const secret = Deno.env.get("IMAGE_MAINTENANCE_CRON_SECRET"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!(secret && request.headers.get("x-cron-secret") === secret) && !(serviceKey && request.headers.get("authorization") === `Bearer ${serviceKey}`)) throw new Error("service_role_required");
    const input = await request.json().catch(() => ({}));
    const client = serviceClient();
    const enqueued = await client.rpc("enqueue_media_maintenance"); if (enqueued.error) throw enqueued.error;
    const claimed = await client.rpc("claim_media_cleanup"); if (claimed.error) throw claimed.error;
    let cleaned = 0, failed = 0;
    for (const job of claimed.data ?? []) {
      try {
        const allowed = await client.rpc("media_object_cleanup_allowed", { p_bucket: job.bucket, p_path: job.path, p_object: job.object_id }); if (allowed.error) throw allowed.error;
        if (!allowed.data) { const done = await client.rpc("finish_media_cleanup", { p_id: job.id, p_token: job.lease_token, p_outcome: "cancelled" }); if (done.error) throw done.error; continue; }
        const removed = await client.storage.from(job.bucket).remove([job.path]); if (removed.error) throw removed.error;
        const done = await client.rpc("finish_media_cleanup", { p_id: job.id, p_token: job.lease_token, p_outcome: "succeeded" }); if (done.error) throw done.error; cleaned++;
      } catch { failed++; await client.rpc("finish_media_cleanup", { p_id: job.id, p_token: job.lease_token, p_outcome: "failed", p_error: "storage_cleanup_failed" }); }
    }
    let resumed = 0;
    if (input.generations !== false && Deno.env.get("MODEL_MOCK_MODE") !== "true") {
      const now = new Date().toISOString();
      const jobs = await Promise.all([client.from("avatar_generations").select("id").or(`status.eq.queued,and(status.eq.running,lease_until.lt.${now})`).order("created_at").limit(1),
        client.from("chat_background_generations").select("id").or(`status.eq.queued,and(status.in.(running,uploading),lease_until.lt.${now})`).order("created_at").limit(1)]);
      for (const row of jobs) if (row.error) throw row.error;
      const pending = [...(jobs[0].data ?? []).map(row => runAvatarGeneration(row.id)), ...(jobs[1].data ?? []).map(row => runBackgroundGeneration(row.id))];
      resumed = pending.length; await Promise.allSettled(pending);
    }
    return json(request, { cleanup_enqueued: enqueued.data, cleaned, failed, generation_attempts_started: resumed, transparency: "independent_worker" });
  } catch (reason) { return errorResponse(request, reason); }
});
