import { readAccountPages } from "./dataPagination.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function deleteChatBackgroundData(client: SupabaseClient,userId:string):Promise<void> {
  // Mark pending workers terminal before removing files; late workers fail their
  // guarded commit and clean up their upload. Include abandoned upload objects.
  const stopped=await client.rpc("block_chat_background_owner",{p_owner_id:userId});if(stopped.error)throw stopped.error;
  const deadline=Date.now()+20_000;
  for(;;){
    const expired=await client.from("chat_background_generations").update({status:"failed",error_code:"background_generation_timeout",completed_at:new Date().toISOString()}).eq("owner_id",userId).eq("status","uploading").lt("created_at",new Date(Date.now()-8*60_000).toISOString());if(expired.error)throw expired.error;
    const pending=await client.from("chat_background_generations").select("id").eq("owner_id",userId).eq("status","uploading").limit(1);if(pending.error)throw pending.error;
    if(!pending.data?.length)break;
    if(Date.now()>=deadline)throw new Error("背景图片正在保存，请稍后重试注销。");
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  for(;;) {
    const listed=await client.storage.from("chat-backgrounds").list(userId,{limit:100});
    if(listed.error) throw listed.error;
    const paths=(listed.data??[]).filter(row=>row.id).map(row=>`${userId}/${row.name}`);
    if(!paths.length) break;
    const removed=await client.storage.from("chat-backgrounds").remove(paths); if(removed.error) throw removed.error;
  }
}

export async function exportChatBackgroundData(client:SupabaseClient,userId:string) {
  const page=(table:string,key:string)=>readAccountPages(client,table,userId,{key});
  const [settings,assets,generations,mutations]=await Promise.all([page("chat_background_settings","thread_key"),page("chat_background_assets","id"),page("chat_background_generations","id"),page("chat_background_mutations","request_id")]);
  return {settings,assets,generations,mutations};
}
