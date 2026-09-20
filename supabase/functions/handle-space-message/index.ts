import { z } from "npm:zod@4";
import { runInBackground } from "../_shared/background.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { runSpaceRouteJob } from "../_shared/spaceMessageRouter.ts";
const Input = z.object({ message_id: z.string().uuid(), cue_pet_ids: z.array(z.string().uuid()).max(3).optional().default([]) });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const caller = await authenticatedUser(request);
    const input = Input.parse(await request.json());
    const client = serviceClient();
    const message = await client.from("messages").select("space_id,sender_id,actor_kind").eq("id", input.message_id).single();
    if (message.error) throw message.error;
    if (message.data.actor_kind !== "human" || !message.data.sender_id) throw new Error("only_human_messages_are_routed");
    const membership = await client.rpc("is_space_member", { target_space_id: message.data.space_id, target_user_id: caller.id });
    if (membership.error || !membership.data) throw new Error("not_space_member");
    const inserted = await client.from("agent_jobs").insert({ job_kind: "route_space_pets", scope_kind: "space", scope_id: message.data.space_id, requested_by: caller.id, source_message_id: input.message_id, status: "queued", stage: "queued", progress_label: "等待异宠处理", idempotency_key: `route_space_pets:${input.message_id}:${message.data.space_id}`, input }).select("id,status").single();
    if (inserted.error?.code === "23505") {
      const existing = await client.from("agent_jobs").select("id,status,attempts,retryable,error_code").eq("job_kind", "route_space_pets").eq("source_message_id", input.message_id).eq("scope_id", message.data.space_id).single();
      if (existing.error) throw existing.error;
      if (existing.data.error_code === "legacy_route_review_required") {
        return json(request, { job_id: existing.data.id, status: existing.data.status, duplicate: true, retryable: false, error_code: existing.data.error_code }, 202);
      }
      if ((existing.data.status === "failed" || existing.data.status === "blocked") && existing.data.attempts < 3) {
        const requeued = await client.from("agent_jobs").update({ status: "queued", stage: "queued", progress_label: "等待手动重试处理", retryable: true, error_code: null, completed_at: null }).eq("id", existing.data.id).in("status", ["failed", "blocked"]).or("error_code.is.null,error_code.neq.legacy_route_review_required").select("id").maybeSingle();
        if (requeued.error) throw requeued.error;
        if (requeued.data) {
          runInBackground(runSpaceRouteJob(existing.data.id, caller.id, input));
          return json(request, { job_id: existing.data.id, status: "queued", duplicate: true }, 202);
        }
        const refreshed = await client.from("agent_jobs").select("status,retryable,error_code").eq("id", existing.data.id).single();
        if (refreshed.error) throw refreshed.error;
        return json(request, { job_id: existing.data.id, status: refreshed.data.status, duplicate: true, retryable: refreshed.data.retryable, error_code: refreshed.data.error_code }, 202);
      }
      if (existing.data.status === "queued") runInBackground(runSpaceRouteJob(existing.data.id, caller.id, input));
      return json(request, { job_id: existing.data.id, status: existing.data.status, duplicate: true }, 202);
    }
    if (inserted.error) throw inserted.error;
    runInBackground(runSpaceRouteJob(inserted.data.id, caller.id, input));
    return json(request, { job_id: inserted.data.id, status: "queued" }, 202);
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
