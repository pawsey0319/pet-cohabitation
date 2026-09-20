import {z} from "npm:zod@4";
import {optionsResponse} from "../_shared/cors.ts";
import {json,errorResponse} from "../_shared/responses.ts";
import {authenticatedUser,requirePost,serviceClient} from "../_shared/supabase.ts";
const Input=z.union([z.object({action:z.enum(["confirm","dismiss"]),preview_id:z.string().uuid(),request_id:z.string().uuid(),expected_version:z.number().int().positive()}).strict(),z.object({action:z.literal("prepare"),space_id:z.string().uuid(),request_id:z.string().uuid(),exact_content:z.string().min(1).max(3800)}).strict()]);
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return optionsResponse(request);
 try{requirePost(request);const user=await authenticatedUser(request);const body=Input.parse(await request.json());
  const result=body.action==="prepare"?await serviceClient().rpc("prepare_space_steward_preview",{p_owner:user.id,p_request:body.request_id,p_space:body.space_id,p_exact:body.exact_content}):await serviceClient().rpc("decide_steward_preview",{p_owner:user.id,p_preview:body.preview_id,p_request:body.request_id,p_expected_version:body.expected_version,p_action:body.action});
  if(result.error)throw result.error;return json(request,result.data);
 }catch(reason){return errorResponse(request,reason,reason&&typeof reason==="object"&&"message"in reason&&/conflict|excluded|expired|changed/.test(String(reason.message))?409:400);}
});
