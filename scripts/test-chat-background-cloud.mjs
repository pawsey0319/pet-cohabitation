// Explicitly selected cloud/local integration target; only synthetic accounts
// created by this invocation are removed. No existing chat data is read.
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL;
if(!url||new URL(url).hostname!==(process.env.MOBILE_TEST_HOST??"127.0.0.1"))throw new Error("Set explicit MOBILE_TEST_HOST and Supabase credentials.");
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const anon=process.env.SUPABASE_ANON_KEY;
const out="test-results/background-release";await mkdir(out,{recursive:true});
const accounts=[],checks=[];let generatedSummary;
const ok=result=>{if(result.error)throw new Error(result.error.message);return result.data;};
const pass=(name)=>{checks.push(name);console.log("PASS: "+name);};
async function call(client,name,body){
 const result=await client.functions.invoke(name,{body});
 if(result.error){let code="network_or_function_error";try{code=(await result.error.context.json()).error??code;}catch{}throw new Error(`${name}: ${code}`);}
 if(result.data?.error)throw new Error(`${name}: ${result.data.error}`);return result.data;
}
async function account(label){
 const email=`background-${label}-${randomUUID()}@example.test`,password=`Test-${randomUUID()}!a1`;
 const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user;
 const client=createClient(url,anon,options),record={id:user.id,email,password,client,deleted:false};accounts.push(record);
 ok(await service.from("profiles").insert({id:user.id,email,nickname:`背景验收${label}`}));ok(await client.auth.signInWithPassword({email,password}));return record;
}
async function removeAccount(a){
 if(a.deleted)return;
 await call(a.client,"delete-account",{password:a.password});a.deleted=true;
 const files=ok(await service.storage.from("chat-backgrounds").list(a.id,{limit:100}));assert.equal(files.length,0,"account background files removed");
 assert.equal(ok(await service.from("chat_background_assets").select("id").eq("owner_id",a.id)).length,0);
}
try{
 const a=await account("A"),b=await account("B");pass("two temporary accounts authenticated");
 const denied=await b.client.rpc("claim_chat_background_generation",{p_owner_id:a.id,p_request_id:randomUUID(),p_prompt:"不应执行的请求",p_model:"none"});assert.ok(denied.error);pass("client cannot execute service-only generation claim");
 const requestId=randomUUID(),prompt="一张适合私人聊天的安静背景，灰绿竹影和柔和米白纸感，画面中央大量留白，无文字无人物。";
 const started=Date.now();const first=await call(a.client,"generate-chat-background",{action:"generate",request_id:requestId,prompt});assert.equal(first.job.request_id,requestId);
 const repeat=await call(a.client,"generate-chat-background",{action:"generate",request_id:requestId,prompt});assert.equal(repeat.job.request_id,requestId);
 await assert.rejects(()=>call(a.client,"generate-chat-background",{action:"generate",request_id:requestId,prompt:"另一段不同的背景描述"}),/request_conflict/);
 await assert.rejects(()=>call(b.client,"generate-chat-background",{action:"status",request_id:requestId}),/not_found/);
 pass("same request reused, changed prompt rejected, other owner cannot inspect job");
 let job,lastStatus;const deadline=Date.now()+8*60_000;
 do{
  job=(await call(a.client,"generate-chat-background",{action:"status",request_id:requestId})).job;
  if(job.status!==lastStatus){console.log(`Generation: ${job.status}`);lastStatus=job.status;}
  if(job.status==="failed")throw new Error(`background generation: ${job.error_code}`);
  if(job.status==="succeeded")break;
  await new Promise(done=>setTimeout(done,2500));
 }while(Date.now()<deadline);
 assert.equal(job.status,"succeeded","real image generation deadline");
 const asset=ok(await a.client.from("chat_background_assets").select("id,storage_path,source").eq("id",job.asset_id).single());assert.equal(asset.source,"ai");
 const signed=ok(await a.client.storage.from("chat-backgrounds").createSignedUrl(asset.storage_path,60));
 const image=await fetch(signed.signedUrl,{signal:AbortSignal.timeout(30_000)});assert.equal(image.status,200);
 const bytes=Buffer.from(await image.arrayBuffer());assert.ok(bytes.length>1000);const type=image.headers.get("content-type");assert.match(type,/image\/(png|jpeg|webp)/);
 const ext=type.includes("png")?"png":type.includes("webp")?"webp":"jpg";
 await writeFile(`${out}/generated-background.${ext}`,bytes);
 generatedSummary={milliseconds:Date.now()-started,bytes:bytes.length,mimeType:type,sha256:createHash("sha256").update(bytes).digest("hex")};
 pass("real configured image model generated a downloadable private image");
 assert.equal(ok(await b.client.from("chat_background_assets").select("id").eq("id",asset.id)).length,0);
 assert.ok((await b.client.storage.from("chat-backgrounds").createSignedUrl(asset.storage_path,60)).error);
 const publicUrl=a.client.storage.from("chat-backgrounds").getPublicUrl(asset.storage_path).data.publicUrl;
 assert.equal((await fetch(publicUrl,{signal:AbortSignal.timeout(15_000)})).ok,false);pass("other account and public URL cannot access private background");
 ok(await a.client.from("chat_background_settings").upsert({owner_id:a.id,thread_key:"global",preset_id:"mist",asset_id:null,palette:"sage"}));
 ok(await a.client.from("chat_background_settings").upsert({owner_id:a.id,thread_key:"companion",preset_id:null,asset_id:asset.id,palette:"warm"}));
 assert.ok((await b.client.from("chat_background_settings").upsert({owner_id:b.id,thread_key:"companion",preset_id:null,asset_id:asset.id,palette:"warm"})).error);
 assert.equal(ok(await b.client.from("chat_background_settings").select("thread_key").eq("owner_id",a.id)).length,0);
 const second=createClient(url,anon,options);ok(await second.auth.signInWithPassword({email:a.email,password:a.password}));
 const restored=ok(await second.from("chat_background_settings").select("thread_key,preset_id,asset_id").eq("owner_id",a.id));assert.equal(restored.find(row=>row.thread_key==="companion").asset_id,asset.id);assert.equal(restored.find(row=>row.thread_key==="global").preset_id,"mist");pass("global and single-chat settings restore in a second session with owner isolation");
 const uploadId=randomUUID(),path=`${a.id}/${uploadId}.${ext}`;
 ok(await a.client.storage.from("chat-backgrounds").upload(path,bytes,{contentType:type,upsert:false}));
 ok(await a.client.from("chat_background_assets").insert({id:uploadId,owner_id:a.id,storage_path:path,source:"upload",prompt:null}));
 ok(await a.client.from("chat_background_settings").upsert({owner_id:a.id,thread_key:"steward",preset_id:null,asset_id:uploadId,palette:"sage"}));pass("uploaded image path, metadata and application accepted by private storage policies");
 const exported=await call(a.client,"export-my-data",{});
 assert.ok(JSON.stringify(exported).includes(asset.id)&&JSON.stringify(exported).includes(uploadId));pass("owner export includes generated and uploaded background metadata");
 const replay=await call(a.client,"generate-chat-background",{action:"generate",request_id:requestId,prompt});assert.equal(replay.job.asset_id,asset.id);
 assert.equal(ok(await a.client.from("chat_background_generations").select("id").eq("request_id",requestId)).length,1);pass("successful generation replay does not create another image or task");
 await removeAccount(a);await removeAccount(b);pass("account deletion clears background objects, settings and assets");
 await writeFile(`${out}/verification.json`,JSON.stringify({checkedAt:new Date().toISOString(),host:new URL(url).hostname,checks,generated:generatedSummary,cleanup:"passed",physicalAndroid:"pending"},null,2));
 console.log(`PASS: ${checks.length} cloud scenario groups; temporary accounts and media removed.`);
}finally{
 for(const a of accounts){try{await removeAccount(a);}catch(error){console.error(`Cleanup requires attention for synthetic account ${a.id}: ${error.message}`);process.exitCode=1;}}
}
