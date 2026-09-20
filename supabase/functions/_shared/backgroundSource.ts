import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { validateBackgroundImage } from "./chatBackgroundPrompt.ts";
type Source = {owner_id:string;parent_asset_id:string;parent_asset_version:number};
/** Revalidate after downloading, before the original can leave for image editing. */
export async function loadBackgroundParent(client:SupabaseClient,job:Source){
 const query=()=>client.from("chat_background_assets").select("storage_path").eq("id",job.parent_asset_id).eq("owner_id",job.owner_id).eq("content_version",job.parent_asset_version).is("deleted_at",null).single();
 const source=await query();if(source.error||!source.data)throw new Error("background_parent_deleted");
 const image=await client.storage.from("chat-backgrounds").download(source.data.storage_path);if(image.error||image.data.size>8*1024*1024)throw new Error("background_invalid_image");
 const bytes=new Uint8Array(await image.data.arrayBuffer()),mimeType=validateBackgroundImage(bytes);
 const [current,owner]=await Promise.all([query(),client.from("chat_background_owner_controls").select("deleting").eq("owner_id",job.owner_id).maybeSingle()]);
 if(current.error||!current.data||current.data.storage_path!==source.data.storage_path)throw new Error("background_parent_deleted");
 if(owner.error||owner.data?.deleting)throw new Error("background_account_deleting");
 return{bytes,mimeType};
}
