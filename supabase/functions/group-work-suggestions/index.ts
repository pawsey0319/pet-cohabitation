import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { json,errorResponse } from "../_shared/responses.ts";
import { authenticatedUser,requirePost,serviceClient } from "../_shared/supabase.ts";
import { extractGroupWork } from "./model.ts";

const Input=z.object({action:z.enum(["list","consent","dismiss","accept","sweep"]),space_id:z.string().uuid().optional(),suggestion_id:z.string().uuid().optional(),request_id:z.string().uuid().optional(),expected_version:z.number().int().positive().optional(),consented:z.boolean().optional(),input:z.record(z.string(),z.unknown()).default({})});
Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return optionsResponse(request);
  try {
    requirePost(request);const body=Input.parse(await request.json());const client=serviceClient();
    if(body.action==="sweep") {
      const secret=Deno.env.get("GROUP_WORK_CRON_SECRET");const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if(!(secret&&request.headers.get("x-cron-secret")===secret)&&!(serviceKey&&request.headers.get("authorization")===`Bearer ${serviceKey}`))throw new Error("service_role_required");
      const claimed=await client.rpc("claim_group_work_batch");if(claimed.error)throw claimed.error;if(!claimed.data)return json(request,{claimed:false});
      const {batch,sources}=claimed.data;
      try {const suggestions=await extractGroupWork(sources);const done=await client.rpc("finish_group_work_batch",{p_batch:batch.id,p_token:batch.lease_token,p_suggestions:suggestions,p_error:null});if(done.error)throw done.error;return json(request,{claimed:true,committed:done.data});}
      catch(reason) {const code=reason instanceof Error&&/^work_[a-z_]+(?:\d+)?$/.test(reason.message)?reason.message:"work_extraction_failed";await client.rpc("finish_group_work_batch",{p_batch:batch.id,p_token:batch.lease_token,p_suggestions:[],p_error:code});return json(request,{claimed:true,committed:false,error:code},503);}
    }
    const user=await authenticatedUser(request);
    if(body.action==="list"||body.action==="consent") {
      if(!body.space_id)throw new Error("work_space_required");
      const member=await client.from("space_members").select("user_id").eq("space_id",body.space_id).eq("user_id",user.id).maybeSingle();if(member.error)throw member.error;if(!member.data)throw new Error("not_space_member");
      if(body.action==="consent") {if(body.expected_version===undefined||body.consented===undefined)throw new Error("work_consent_required");const result=await client.rpc("set_group_work_consent",{p_actor:user.id,p_space:body.space_id,p_version:body.expected_version,p_consented:body.consented});if(result.error)throw result.error;return json(request,{authorization:result.data});}
      const results=await Promise.all([client.from("group_work_authorizations").select("*").eq("space_id",body.space_id).single(),client.from("group_work_consents").select("*").eq("space_id",body.space_id),client.from("group_work_suggestions").select("*").eq("space_id",body.space_id).eq("invalidated",false).is("accepted_item_id",null).order("updated_at",{ascending:false}).limit(50),client.from("group_work_dismissals").select("suggestion_id").eq("user_id",user.id)]);
      for(const result of results)if(result.error)throw result.error;
      const hidden=new Set((results[3].data??[]).map((row:any)=>row.suggestion_id));
      return json(request,{authorization:results[0].data,consents:results[1].data,suggestions:(results[2].data??[]).filter((row:any)=>!hidden.has(row.id))});
    }
    if(!body.suggestion_id||!body.request_id)throw new Error("work_request_id_required");
    const result=await client.rpc("act_group_work_suggestion",{p_actor:user.id,p_id:body.suggestion_id,p_action:body.action,p_request:body.request_id,p_input:body.input});if(result.error)throw result.error;return json(request,result.data);
  } catch(reason) {return errorResponse(request,reason);}
});
