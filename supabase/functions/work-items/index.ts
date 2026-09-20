import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const ItemInput = z.object({
  kind:z.enum(["goal","milestone","task"]).optional(),title:z.string().trim().min(1).max(200).optional(),description:z.string().max(4000).optional(),
  space_id:z.string().uuid().nullable().optional(),parent_id:z.string().uuid().nullable().optional(),assignee_id:z.string().uuid().nullable().optional(),
  due_at:z.string().datetime({offset:true}).nullable().optional(),approval:z.enum(["none","all","majority"]).optional(),participants:z.array(z.string().uuid()).max(20).optional(),review_required:z.boolean().optional(),
  terms_expires_at:z.string().datetime({offset:true}).nullable().optional(),source_private_message_id:z.string().uuid().nullable().optional(),
  completion_note:z.string().max(4000).optional(),confirmed:z.boolean().optional(),approved:z.boolean().optional(),
  material:z.object({kind:z.enum(["note","link","image","message"]),content:z.string().min(1).max(4000),source_message_id:z.string().uuid().nullable().optional(),is_completion:z.boolean().optional()}).optional(),
}).strict();
const RequestInput=z.object({action:z.enum(["list","get","create","publish","edit","accept","reject","confirm","decline","progress","complete","review","cancel","attach"]),request_id:z.string().uuid().optional(),item_id:z.string().uuid().optional(),expected_version:z.number().int().positive().optional(),input:ItemInput.default({}),space_id:z.string().uuid().optional(),cursor:z.object({updated_at:z.string().datetime({offset:true}),id:z.string().uuid()}).optional()});

/** This endpoint never depends on a model provider. Reads use the user's JWT/RLS. */
Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return optionsResponse(request);
  try {
    requirePost(request);const user=await authenticatedUser(request);const body=RequestInput.parse(await request.json());const client=serviceClient();
    if(body.action==="list") {
      const memberships=await client.from("space_members").select("space_id").eq("user_id",user.id);if(memberships.error)throw memberships.error;
      const spaces=(memberships.data??[]).map(m=>m.space_id);
      if(body.space_id&&!spaces.includes(body.space_id))throw new Error("not_space_member");
      let query=client.from("work_items").select("*").or(`and(owner_id.eq.${user.id},space_id.is.null)${spaces.length?`,and(space_id.in.(${spaces.join(",")}),or(publication.eq.published,owner_id.eq.${user.id}))`:""}`).order("updated_at",{ascending:false}).order("id",{ascending:false}).limit(100);
      if(body.space_id)query=query.eq("space_id",body.space_id);
      if(body.cursor)query=query.or(`updated_at.lt.${body.cursor.updated_at},and(updated_at.eq.${body.cursor.updated_at},id.lt.${body.cursor.id})`);
      const result=await query;if(result.error)throw result.error;const rows=result.data??[];const last=rows.at(-1);
      return json(request,{items:rows,cursor:rows.length===100&&last?{updated_at:last.updated_at,id:last.id}:null,authorized_space_ids:spaces});
    }
    if(body.action==="get") {
      if(!body.item_id)throw new Error("work_item_required");
      const allowed=await client.rpc("can_read_work_item",{target_id:body.item_id,viewer:user.id});if(allowed.error)throw allowed.error;if(!allowed.data)throw new Error("work_forbidden");
      const results=await Promise.all([
        client.from("work_items").select("*").eq("id",body.item_id).single(),
        client.from("work_item_confirmations").select("*").eq("item_id",body.item_id).order("terms_version",{ascending:false}),
        client.from("work_item_materials").select("*").eq("item_id",body.item_id).order("created_at"),
        client.from("work_item_activity").select("*").eq("item_id",body.item_id).order("created_at",{ascending:false}).limit(100),
        client.from("work_items").select("*").eq("parent_id",body.item_id).or(`publication.eq.published,owner_id.eq.${user.id}`).order("created_at"),
      ]);for(const result of results)if(result.error)throw result.error;
      // Source quotes are read from current authorized messages, never trusted attachment captions.
      const materials=await Promise.all((results[2].data??[]).map(async(material:any)=>{
        if(material.kind==="image") {const signed=await client.storage.from("work-materials").createSignedUrl(material.content,300);return {...material,url:signed.data?.signedUrl};}
        if(material.kind==="message") {const source=await client.from("messages").select("text,space_id,deleted_at").eq("id",material.source_message_id).maybeSingle();if(source.error)throw source.error;
          const member=source.data?await client.from("space_members").select("user_id").eq("space_id",source.data.space_id).eq("user_id",user.id).maybeSingle():null;
          return {...material,content:source.data&&!source.data.deleted_at&&member?.data?source.data.text:"来源已删除或当前无权查看",source_message_id:member?.data?material.source_message_id:null};}
        return material;
      }));
      // Membership can change while materials are resolved: authorize again before committing a response.
      const recheck=await client.rpc("can_read_work_item",{target_id:body.item_id,viewer:user.id});if(recheck.error||!recheck.data)throw new Error("work_forbidden");
      return json(request,{item:results[0].data,confirmations:results[1].data,materials,activity:results[3].data,children:results[4].data});
    }
    if(!body.request_id)throw new Error("work_request_id_required");
    const result=await client.rpc("mutate_work_item",{p_actor:user.id,p_action:body.action,p_request_id:body.request_id,p_item_id:body.item_id??null,p_expected_version:body.expected_version??null,p_input:body.input});
    if(result.error)throw result.error;return json(request,result.data);
  } catch(reason) {return errorResponse(request,reason,reason&&typeof reason==="object"&&"message"in reason&&/conflict|expired|already/.test(String(reason.message))?409:400);}
});
