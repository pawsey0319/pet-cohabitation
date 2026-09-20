import assert from "node:assert/strict";
import {loadBackgroundParent} from "../../../supabase/functions/_shared/backgroundSource.ts";
const bytes=new Uint8Array(16);bytes.set([255,216,255]);
for(const reason of ["deleted","account_deleting","valid"]){
 let downloaded=false;
 const client={from:table=>{const query={select:()=>query,eq:()=>query,is:()=>query,single:async()=>({data:downloaded&&reason==="deleted"?null:{storage_path:"owner/source.jpg"},error:null}),maybeSingle:async()=>({data:{deleting:reason==="account_deleting"},error:null})};return query;},storage:{from:()=>({download:async()=>({data:{size:bytes.length,arrayBuffer:async()=>{downloaded=true;return bytes.buffer;}},error:null})})}};
 const load=()=>loadBackgroundParent(client,{owner_id:"owner",parent_asset_id:"source",parent_asset_version:1});
 if(reason==="valid")assert.equal((await load()).mimeType,"image/jpeg");else await assert.rejects(load,reason==="deleted"?/background_parent_deleted/:/background_account_deleting/);
}
console.log("PASS: deleted parent and closing account cannot supply late source pixels; valid parent still works.");
