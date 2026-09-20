import assert from "node:assert/strict";
import {imageSha256,loadVisionInput} from "../../../supabase/functions/_shared/visionData.ts";
const bytes=new Uint8Array([1,2,3]),question="合成问题",hash=await imageSha256(bytes),contentHash=await imageSha256(new TextEncoder().encode(question));
let invalidated=false,assertions=0;
const client={
 rpc:async()=>{assertions++;return{data:null,error:invalidated?{message:"vision_source_changed"}:null};},
 from:table=>{const query={select:()=>query,eq:()=>query,single:async()=>({data:table==="pet_vision_requests"?{asset_id:"image",asset_version:1,asset_sha256:hash,content_sha256:contentHash}:{storage_path:"owner/image.jpg",mime_type:"image/jpeg",byte_size:bytes.length},error:null})};return query;},
 storage:{from:()=>({download:async()=>({data:{size:bytes.length,arrayBuffer:async()=>{invalidated=true;return bytes.buffer;}},error:null})})},
};
await assert.rejects(()=>loadVisionInput(client,{ownerId:"owner",petId:"pet",requestId:"request",question}),/vision_source_changed/);
assert.equal(assertions,2);
console.log("PASS: deleting/forgetting while downloading prevents returning image bytes to the model.");
