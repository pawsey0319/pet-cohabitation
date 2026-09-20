import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Keyset paging keeps inserts from shifting already-read items. Filters stay server-side. */
async function pages(client:SupabaseClient,table:string,filter:(query:any)=>any,key="id"):Promise<any[]>{
 const rows:any[]=[];let after:string|null=null;
 for(;;){let query=filter(client.from(table).select("*")).order(key).limit(200);if(after)query=query.gt(key,after);const result=await query;if(result.error)throw result.error;const next=result.data??[];rows.push(...next);if(next.length<200)return rows;after=next.at(-1)[key];}
}
export async function exportWorkData(client:SupabaseClient,ownerId:string){
 const memberships=await pages(client,"space_members",q=>q.eq("user_id",ownerId),"space_id");
 const items=await pages(client,"work_items",q=>q.eq("owner_id",ownerId).is("space_id",null));
 // Each group is authorized independently, avoiding oversized URL filters.
 for(const membership of memberships){const member=await client.from("space_members").select("user_id").eq("space_id",membership.space_id).eq("user_id",ownerId).maybeSingle();if(member.error)throw member.error;if(!member.data)continue;items.push(...await pages(client,"work_items",q=>q.eq("space_id",membership.space_id).or(`publication.eq.published,owner_id.eq.${ownerId}`)));}
 const result:Record<string,any[]>={items,work_item_materials:[],work_item_confirmations:[],work_item_activity:[],work_item_events:[],group_work_suggestions:[]};
 for(const membership of memberships)result.group_work_suggestions.push(...await pages(client,"group_work_suggestions",q=>q.eq("space_id",membership.space_id).eq("invalidated",false)));
 for(let offset=0;offset<items.length;offset+=50){const ids=items.slice(offset,offset+50).map(item=>item.id);
  for(const table of ["work_item_materials","work_item_activity","work_item_events"])result[table].push(...await pages(client,table,q=>q.in("item_id",ids)));
  let cursor:{item_id:string;terms_version:number;user_id:string}|null=null;
  for(;;){let q=client.from("work_item_confirmations").select("*").in("item_id",ids).order("item_id").order("terms_version").order("user_id").limit(200);
   if(cursor)q=q.or(`item_id.gt.${cursor.item_id},and(item_id.eq.${cursor.item_id},terms_version.gt.${cursor.terms_version}),and(item_id.eq.${cursor.item_id},terms_version.eq.${cursor.terms_version},user_id.gt.${cursor.user_id})`);
   const rows=await q;if(rows.error)throw rows.error;result.work_item_confirmations.push(...rows.data);if(rows.data.length<200)break;cursor=rows.data.at(-1)!;
  }
 }
 result.group_work_consents=await pages(client,"group_work_consents",q=>q.eq("user_id",ownerId),"space_id");
 result.group_work_dismissals=await pages(client,"group_work_dismissals",q=>q.eq("user_id",ownerId),"suggestion_id");
 result.work_item_requests=await pages(client,"work_item_requests",q=>q.eq("actor_id",ownerId),"request_id");
 result.companion_actions=await pages(client,"pet_companion_action_plans",q=>q.eq("owner_id",ownerId));
 result.companion_action_decisions=await pages(client,"pet_companion_action_decisions",q=>q.eq("owner_id",ownerId),"request_id");
 result.companion_clarifications=await pages(client,"pet_companion_clarifications",q=>q.eq("owner_id",ownerId));
 result.steward_previews=await pages(client,"pet_steward_previews",q=>q.eq("owner_id",ownerId));
 result.steward_decisions=await pages(client,"pet_steward_decisions",q=>q.eq("owner_id",ownerId),"request_id");
 const currentMemberships=await pages(client,"space_members",q=>q.eq("user_id",ownerId),"space_id");const allowedSpaces=new Set(currentMemberships.map(row=>row.space_id));
 result.items=result.items.filter(item=>!item.space_id||allowedSpaces.has(item.space_id));const allowedItems=new Set(result.items.map(item=>item.id));
 for(const table of ["work_item_materials","work_item_confirmations","work_item_activity","work_item_events"])result[table]=result[table].filter(row=>allowedItems.has(row.item_id));
 result.group_work_suggestions=result.group_work_suggestions.filter(row=>allowedSpaces.has(row.space_id));
 return result;
}

/** Fence writes first; private/draft deletion retains confirmed shared history. */
export async function deletePrivateWorkData(client:SupabaseClient,ownerId:string){
 const stopped=await client.rpc("block_chat_background_owner",{p_owner_id:ownerId});if(stopped.error)throw stopped.error;
 const privateItems=await pages(client,"work_items",q=>q.eq("owner_id",ownerId).or("space_id.is.null,publication.eq.draft"));
 for(const item of privateItems){const prefix=`${ownerId}/${item.id}`;
  for(;;){const listed=await client.storage.from("work-materials").list(prefix,{limit:100,sortBy:{column:"name",order:"asc"}});if(listed.error)throw listed.error;const paths=(listed.data??[]).filter(file=>file.id).map(file=>`${prefix}/${file.name}`);if(!paths.length)break;const removed=await client.storage.from("work-materials").remove(paths);if(removed.error)throw removed.error;}
 }
 const deleted=await client.from("work_items").delete().eq("owner_id",ownerId).or("space_id.is.null,publication.eq.draft");if(deleted.error)throw deleted.error;
}
