import { runBackgroundGeneration } from "../_shared/imageGenerationWorkers.ts";
import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { runInBackground } from "../_shared/background.ts";
import { json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { ImageModelAdapter, imageExtension } from "../_shared/modelAdapters.ts";
import { backgroundErrorCode, buildChatBackgroundPrompt, validateBackgroundImage } from "../_shared/chatBackgroundPrompt.ts";
import { backgroundDesignError, backgroundEditingAvailable, designBackground } from "../_shared/backgroundEditing.ts";

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), request_id: z.string().uuid(), prompt: z.string().trim().min(4).max(600), parent_asset_id: z.string().uuid().nullable().optional(), parent_asset_version: z.number().int().positive().nullable().optional() }),
  z.object({ action: z.literal("status"), request_id: z.string().uuid() }),
  z.object({ action: z.literal("capabilities") }),
]);
type Work = { id: string; owner_id: string; request_id: string; prompt: string; parent_asset_id: string | null; parent_asset_version: number | null; lease_token: string };
const publicJob = (row: Record<string,unknown>) => ({ request_id:row.request_id,prompt:row.prompt,status:row.status,asset_id:row.asset_id,error_code:row.error_code,created_at:row.created_at,parent_asset_id:row.parent_asset_id??null,parent_asset_version:row.parent_asset_version??null });

const generate = (work: Work) => runBackgroundGeneration(work.id);

Deno.serve(async(request)=>{
  if(request.method==="OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user=await authenticatedUser(request);
    if(Number(request.headers.get("content-length")??0)>8192) return json(request,{error:"background_prompt_invalid"},400);
    const raw=await request.text(); if(raw.length>8192) return json(request,{error:"background_prompt_invalid"},400);
    const parsed=Input.safeParse(JSON.parse(raw));
    if(!parsed.success) return json(request,{error:"background_prompt_invalid"},400);
    const input=parsed.data; const client=serviceClient();
    if(input.action==="capabilities")return json(request,{editing_available:backgroundEditingAvailable()});
    if(input.action==="status") {
      await client.from("chat_background_generations").update({status:"failed",error_code:"background_generation_timeout",completed_at:new Date().toISOString()}).eq("owner_id",user.id).eq("request_id",input.request_id).in("status",["queued","running","uploading"]).lt("created_at",new Date(Date.now()-15*60_000).toISOString());
      const row=await client.from("chat_background_generations").select("*").eq("owner_id",user.id).eq("request_id",input.request_id).maybeSingle();
      if(row.error) throw row.error;
      if(!row.data) return json(request,{error:"background_not_found"},404);
      if(Deno.env.get("MODEL_MOCK_MODE")!=="true"&&["queued","running","uploading"].includes(row.data.status))runInBackground(generate(row.data as Work));
      return json(request,{job:publicJob(row.data)});
    }
    // Health status or local demo assets are never accepted as real AI generation.
    if(Deno.env.get("MODEL_MOCK_MODE")==="true") throw new Error("background_mock_disabled");
    if(input.parent_asset_id&&!backgroundEditingAvailable())throw new Error("background_edit_unavailable");
    const claim=await client.rpc("claim_background_design",{p_owner_id:user.id,p_request_id:input.request_id,p_prompt:input.prompt,p_model:ImageModelAdapter.modelName(),p_parent_id:input.parent_asset_id??null,p_parent_version:input.parent_asset_version??null});
    if(claim.error) throw claim.error;
    if(["queued","running","uploading"].includes(claim.data.job.status)) runInBackground(generate(claim.data.job as Work));
    return json(request,{job:publicJob(claim.data.job)},claim.data.job.status==="succeeded"?200:202);
  } catch(reason) {
    const code=backgroundDesignError(reason)??backgroundErrorCode(reason);
    return json(request,{error:code},code==="unauthenticated"?401:/limit|quota|busy|conflict/.test(code)?409:code==="method_not_allowed"?405:400);
  }
});
