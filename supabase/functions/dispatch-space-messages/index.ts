import { errorResponse, json } from "../_shared/responses.ts";
import { requirePost, serviceClient } from "../_shared/supabase.ts";
import { runSpaceRouteJob } from "../_shared/spaceMessageRouter.ts";

// Invoked by cloud scheduling. A closed app cannot lose a committed route job.
Deno.serve(async (request) => {
  try {
    requirePost(request);
    const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const keys = [Deno.env.get("SPACE_MESSAGE_CRON_SECRET"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")].filter(Boolean);
    if (!supplied || !keys.includes(supplied)) throw new Error("service_role_required");
    const client = serviceClient();
    const expired = await client.from("agent_jobs").update({status:"failed",stage:"failed",lease_until:null,retryable:false,error_code:"route_attempts_exhausted",completed_at:new Date().toISOString()})
      .eq("job_kind","route_space_pets").eq("status","running").gte("attempts",3).lt("lease_until",new Date().toISOString());
    if(expired.error) throw expired.error;
    const result=await client.from("agent_jobs").select("id,requested_by,source_message_id,input")
      .eq("job_kind","route_space_pets").lt("attempts",3)
      .or(`status.eq.queued,and(status.eq.running,lease_until.lt.${new Date().toISOString()})`)
      .order("created_at").limit(4);
    if(result.error) throw result.error;
    await Promise.allSettled((result.data ?? []).map((job) => runSpaceRouteJob(job.id,job.requested_by,{message_id:job.source_message_id,cue_pet_ids:job.input?.cue_pet_ids ?? []})));
    return json(request,{processed:result.data?.length ?? 0});
  } catch(reason) { return errorResponse(request,reason); }
});
