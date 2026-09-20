import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { json,errorResponse } from "../_shared/responses.ts";
import { authenticatedUser,requirePost,serviceClient } from "../_shared/supabase.ts";
import { validateCompanionActionInput } from "../_shared/companionActions.ts";
const Input=z.object({action:z.enum(["confirm","dismiss"]),plan_id:z.string().uuid(),request_id:z.string().uuid(),expected_version:z.number().int().positive(),input:z.record(z.string(),z.unknown()).optional()}).strict();
Deno.serve(async(request)=>{
 if(request.method==="OPTIONS")return optionsResponse(request);
 try{requirePost(request);const user=await authenticatedUser(request);const body=Input.parse(await request.json());const client=serviceClient();
  const saved=await client.from("pet_companion_action_plans").select("plan").eq("id",body.plan_id).eq("owner_id",user.id).single();if(saved.error)throw new Error("companion_action_forbidden");
  const input=body.input?validateCompanionActionInput(saved.data.plan.domain,saved.data.plan.action,body.input):null;
  const result=await client.rpc("execute_companion_action",{p_owner:user.id,p_plan_id:body.plan_id,p_request:body.request_id,p_expected_version:body.expected_version,p_confirmed:body.action==="confirm",p_input:input,p_dismiss:body.action==="dismiss"});if(result.error)throw result.error;return json(request,result.data);
 }catch(reason){return errorResponse(request,reason,reason&&typeof reason==="object"&&"message"in reason&&/conflict|excluded/.test(String(reason.message))?409:400);}
});
