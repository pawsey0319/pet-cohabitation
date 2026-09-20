import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL;
if(!url||new URL(url).hostname!=="127.0.0.1"||new URL(url).port!=="47321")throw new Error("Use the isolated companion fixture.");
const opts={auth:{persistSession:false,autoRefreshToken:false}},service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,opts);const accounts=[];let checks=0;
const ok=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
const pass=(condition,label)=>{assert.ok(condition,label);checks++;};
async function call(client,body){const result=await client.functions.invoke("background-management",{body});if(result.error){let code="request_failed";try{code=(await result.error.context.json()).error??code;}catch{}throw new Error(code);}return result.data;}
async function account(){const email=`background-versions-${randomUUID()}@example.test`,password=`Test-${randomUUID()}!`;const id=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user.id;const client=createClient(url,process.env.SUPABASE_ANON_KEY,opts);accounts.push({id,client});ok(await service.from("profiles").insert({id,email,nickname:"背景版本验收"}));ok(await client.auth.signInWithPassword({email,password}));return {id,client};}
try{
 const [a,b]=await Promise.all([account(),account()]);const bytes=await readFile("assets/brand/icon.png");const createdAt=new Date().toISOString();
 const assets=[];for(let i=0;i<3;i++){const id=randomUUID(),path=`${a.id}/${id}.png`;ok(await a.client.storage.from("chat-backgrounds").upload(path,bytes,{contentType:"image/png"}));assets.push(ok(await a.client.from("chat_background_assets").insert({id,owner_id:a.id,storage_path:path,source:"upload",created_at:createdAt}).select().single()));}
 const parent=assets[0],other=assets[1];
 const first=await call(a.client,{action:"list",limit:2}),second=await call(a.client,{action:"list",limit:2,cursor:first.cursor});
 pass(first.assets.length===2&&second.assets.length===1&&new Set([...first.assets,...second.assets].map(x=>x.id)).size===3,"stable time+id pagination with tied timestamps");
 pass((await call(b.client,{action:"list"})).assets.length===0,"library is private");
 const rename={action:"rename",request_id:randomUUID(),asset_id:parent.id,expected_version:1,name:"平静的下午"};
 const named=await call(a.client,rename);pass(named.asset.name==="平静的下午"&&named.asset.version===2&&named.asset.content_version===1,"metadata edits preserve immutable source version");
 pass((await call(a.client,rename)).asset.version===2,"rename retry returns same version");
 await assert.rejects(()=>call(a.client,{...rename,name:"另一个名字"}),/request_conflict/);checks++;
 await assert.rejects(()=>call(b.client,{...rename,request_id:randomUUID()}),/asset_deleted/);checks++;
 const starred=await call(a.client,{action:"favorite",request_id:randomUUID(),asset_id:parent.id,expected_version:2,favorite:true});pass(starred.asset.favorite&&starred.asset.version===3,"favorite is versioned");
 pass((await call(a.client,{action:"list",favorite_only:true})).assets.length===1,"favorites filter is server-side");
 ok(await a.client.from("chat_background_settings").upsert({owner_id:a.id,thread_key:"global",asset_id:parent.id,preset_id:null,palette:"sage"}));
 ok(await a.client.from("chat_background_settings").upsert({owner_id:a.id,thread_key:"companion",asset_id:other.id,preset_id:null,palette:"warm"}));
 const preview=await call(a.client,{action:"impact",asset_id:parent.id});pass(preview.is_global&&preview.affected.some(x=>x.thread_key==="steward")&&!preview.affected.some(x=>x.thread_key==="companion"),"impact resolves per-chat overrides and inheritance");
 ok(await a.client.from("chat_background_settings").upsert({owner_id:a.id,thread_key:"steward",asset_id:parent.id,preset_id:null,palette:"sage"}));
 await assert.rejects(()=>call(a.client,{action:"delete",request_id:randomUUID(),asset_id:parent.id,expected_version:3,settings_version:preview.settings_version}),/impact_changed/);checks++;
 const capability=ok(await a.client.functions.invoke("generate-chat-background",{body:{action:"capabilities"}}));pass(capability.editing_available===false,"unverified real image editing remains disabled");
 const claim={p_owner_id:a.id,p_request_id:randomUUID(),p_prompt:"把背景变成浅蓝色",p_model:"synthetic-test",p_parent_id:parent.id,p_parent_version:1};
 const job=ok(await service.rpc("claim_background_design",claim)).job;pass(job.parent_asset_id===parent.id,"editing request binds exact parent");
 pass(ok(await service.rpc("claim_background_design",claim)).job.id===job.id,"editing retry reuses request");
 pass(!!(await service.rpc("claim_background_design",{...claim,p_parent_id:other.id})).error,"same request cannot swap parent");
 const leased=ok(await service.rpc("lease_background_design",{p_job_id:job.id}));pass(!!leased.lease_token,"design work leased");
 pass(ok(await service.rpc("lease_background_design",{p_job_id:job.id}))===null,"active lease not stolen");
 pass(ok(await service.rpc("begin_background_design_upload",{p_job_id:job.id,p_lease_token:leased.lease_token}))===true,"authorized original allows upload");
 const childId=randomUUID(),childPath=`${a.id}/${childId}.png`;ok(await service.storage.from("chat-backgrounds").upload(childPath,bytes,{contentType:"image/png"}));
 const completion={p_job_id:job.id,p_lease_token:leased.lease_token,p_asset_id:childId,p_path:childPath};
 pass(ok(await service.rpc("complete_background_design",completion))===true,"child version and successful job commit together");
 pass(ok(await service.rpc("complete_background_design",completion))===true,"completion retry is idempotent");
 const child=ok(await a.client.from("chat_background_assets").select("*").eq("id",childId).single());pass(child.parent_asset_id===parent.id&&child.parent_asset_version===1,"completed child retains exact source version");
 pass(ok(await service.from("personal_image_design_claims").select("request_id").eq("owner_id",a.id)).length===1,"same generation retries consume one shared design claim");
 const lateJob=ok(await service.rpc("claim_background_design",{...claim,p_request_id:randomUUID()})).job;const lateLease=ok(await service.rpc("lease_background_design",{p_job_id:lateJob.id}));
 pass(ok(await service.rpc("begin_background_design_upload",{p_job_id:lateJob.id,p_lease_token:lateLease.lease_token}))===true,"second source edit enters upload before deletion");
 const fresh=await call(a.client,{action:"impact",asset_id:parent.id});const deletion={action:"delete",request_id:randomUUID(),asset_id:parent.id,expected_version:3,settings_version:fresh.settings_version};
 pass((await call(a.client,deletion)).outcome==="deleted","confirmed deletion recorded");
 pass((await call(a.client,deletion)).outcome==="deleted","deletion retry returns receipt");
 pass(ok(await service.rpc("complete_background_design",{p_job_id:lateJob.id,p_lease_token:lateLease.lease_token,p_asset_id:randomUUID(),p_path:`${a.id}/${randomUUID()}.png`}))===false,"deleted source rejects in-flight completion");
 pass(ok(await a.client.from("chat_background_assets").select("id").eq("id",parent.id)).length===0,"deleted background hidden in client rows");
 pass(!!(await a.client.storage.from("chat-backgrounds").createSignedUrl(parent.storage_path,60)).error,"deleted image unavailable in storage");
 pass(ok(await a.client.from("chat_background_assets").select("id").eq("id",childId)).length===1,"parent deletion keeps generated child");
 pass(ok(await a.client.from("chat_background_settings").select("thread_key").eq("owner_id",a.id)).every(x=>x.thread_key==="companion"),"deleted applications restore default/inheritance");
 pass(!!(await a.client.from("chat_background_settings").upsert({owner_id:a.id,thread_key:"global",asset_id:parent.id,preset_id:null,palette:"warm"})).error,"old clients cannot reapply deleted asset");
 console.log(`PASS: ${checks} real Supabase background name/favorite/paging/deletion impact/parent fencing and compatibility checks.`);
}finally{
 for(const a of accounts){const files=await service.storage.from("chat-backgrounds").list(a.id);const paths=(files.data??[]).filter(x=>x.id).map(x=>`${a.id}/${x.name}`);if(paths.length)ok(await service.storage.from("chat-backgrounds").remove(paths));ok(await service.auth.admin.deleteUser(a.id));}
}
