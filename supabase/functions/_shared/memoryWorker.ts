import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { TextModelAdapter } from "./modelAdapters.ts";
import { finishModelRun, reserveModelRun } from "./quota.ts";
import { processCompanionLifeJobs } from "./companionMemoryEvolution.ts";

export async function processMemoryJobs(client: SupabaseClient, petId: string, sourceId?: string): Promise<void> {
  try {
  const query = client.from("pet_memory_extraction_jobs").select("source_message_id").eq("pet_id",petId).in("status",["queued","failed","running"]).lt("attempts",3).order("created_at").limit(3);
  const rows = await query;
  if (rows.error) throw rows.error;
  const ids = [...new Set([...(sourceId ? [sourceId] : []),...(rows.data??[]).map((row)=>row.source_message_id)])].slice(0,3);
  for (const id of ids) {
    const claim = await client.rpc("claim_pet_memory_extraction",{target_source_id:id});
    if (claim.error) throw claim.error;
    if (!claim.data) continue;
    const { token, source } = claim.data;
    const startedAt=Date.now(); let runId:string|null=null;
    try {
      runId=await reserveModelRun(client,{runKind:"pet_memory_extract",dailyLimit:150,ownerId:source.owner_id,petId,model:TextModelAdapter.modelName()});
      const candidates = await new TextModelAdapter().extractPersonalPreferences(source.content);
      const result = await client.rpc("finish_pet_memory_extraction",{target_source_id:id,target_token:token,candidates});
      if (result.error) throw result.error;
      await finishModelRun(client,runId,{status:"succeeded",startedAt});
    } catch (error) {
      if(runId) await finishModelRun(client,runId,{status:"failed",startedAt,errorCode:error instanceof Error ? error.message.slice(0,120) : "memory_extraction_failed"});
      await client.rpc("finish_pet_memory_extraction",{target_source_id:id,target_token:token,candidates:[],error_code_value:error instanceof Error ? error.message.slice(0,120) : "memory_extraction_failed"});
    }
  }
  } finally {
  // Independent jobs and leases: a failed preference extraction must not erase
  // owner-stated life facts, and neither extraction blocks the chat receipt.
  await processCompanionLifeJobs(client, petId, sourceId);
  }
}
