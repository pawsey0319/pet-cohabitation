import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,anon=process.env.SUPABASE_ANON_KEY;
if(!url||!key||!anon||!["localhost","127.0.0.1"].includes(new URL(url).hostname))throw new Error("Isolated fixture required");
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),users=[],files=[];
const N=1007,now=new Date().toISOString(); let group;
const ok=async query=>{const value=await query;if(value.error)throw value.error;return value.data;};
const insert=async(table,rows,db=client)=>{for(let i=0;i<rows.length;i+=200)await ok(db.from(table).insert(rows.slice(i,i+200)));};
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA/8AAAAASUVORK5CYII=","base64");
async function upload(bucket,path){await ok(client.storage.from(bucket).upload(path,png,{contentType:"image/png",upsert:false}));files.push({bucket,path});return path;}
async function makeUser(label){const email=`account-${label}-${randomUUID()}@example.test`,password=`Temporary-${randomUUID()}!`;const created=await ok(client.auth.admin.createUser({email,password,email_confirm:true}));const id=created.user.id;users.push(id);await ok(client.from("profiles").insert({id,email,nickname:`Fixture ${label}`}));const caller=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const login=await ok(caller.auth.signInWithPassword({email,password}));return {id,password,caller,token:login.session.access_token};}
async function invoke(name,token,body={}){let response=await fetch(`${url}/functions/v1/${name}`,{method:"POST",headers:{apikey:anon,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});if(response.status===503){await new Promise(resolve=>setTimeout(resolve,1000));response=await fetch(`${url}/functions/v1/${name}`,{method:"POST",headers:{apikey:anon,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});}const result=await response.json();assert.equal(response.status,200,`${name}: ${JSON.stringify(result)}`);return result;}
try{
 const a=await makeUser("a"),b=await makeUser("b");
 const pet=(await ok(client.from("pets").insert({owner_id:a.id,name:"Data fixture"}).select("id").single())).id;
 group=await ok(a.caller.rpc("create_relationship_space",{space_name:"Account data fixture",space_kind:"friend_circle"}));
 await ok(client.from("space_members").insert({space_id:group,user_id:b.id,role:"member"}));
 const mids=Array.from({length:N},()=>randomUUID()),privateIds=Array.from({length:N},()=>randomUUID()),workIds=Array.from({length:N},()=>randomUUID());
 await insert("messages",mids.map((id,i)=>({id,client_id:id,actor_kind:"human",space_id:group,sender_id:a.id,actor_name:"Fixture A",kind:"text",text:`Synthetic group message ${i}`})),a.caller);
 const reply=randomUUID();await ok(b.caller.from("messages").insert({id:reply,client_id:reply,actor_kind:"human",space_id:group,sender_id:b.id,actor_name:"Fixture B",kind:"text",text:"Synthetic reply",reply_to_message_id:mids[N-1],reply_preview:"Synthetic old preview"}));
 await insert("pet_private_threads",privateIds.map((id,i)=>({id,pet_id:pet,owner_id:a.id,role:"owner",content:`Synthetic personal history ${i}`,conversation_kind:"companion"})));
 await insert("work_items",workIds.map((id,i)=>({id,owner_id:a.id,kind:"task",title:`Synthetic private task ${i}`})));
 await insert("pet_life_facts",privateIds.map((source_message_id,i)=>({pet_id:pet,owner_id:a.id,source_message_id,kind:"experience",label:`Synthetic event ${i}`,quote:`Synthetic personal history ${i}`,phase:"happened",source_date:now})));
 await insert("reminder_series",workIds.map((work_item_id,i)=>({owner_id:a.id,work_item_id,content:`Synthetic reminder ${i}`,timezone:"Asia/Shanghai",start_local:"2028-01-01T09:00:00",next_at:"2028-01-01T01:00:00Z"})));
 const avatarIds=Array.from({length:N},()=>randomUUID());await insert("avatar_assets",avatarIds.map(id=>({id,owner_id:a.id,storage_path:`${a.id}/${id}.png`,source:"upload",content_sha256:"a".repeat(64)})));
 const backgroundIds=Array.from({length:N},()=>randomUUID());await insert("chat_background_assets",backgroundIds.map(id=>({id,owner_id:a.id,storage_path:`${a.id}/${id}.png`,source:"upload"})));
 const claims=Array.from({length:N},()=>randomUUID());await insert("personal_image_design_claims",claims.flatMap(request_id=>["avatar","background"].map(kind=>({owner_id:a.id,request_id,kind}))));
 const shared=randomUUID();await ok(client.from("work_items").insert({id:shared,owner_id:a.id,space_id:group,kind:"task",title:"Retained shared history",publication:"published"}));
 const privatePath=await upload("work-materials",`${a.id}/${workIds[0]}/${randomUUID()}.png`),sharedPath=await upload("work-materials",`${a.id}/${shared}/${randomUUID()}.png`),orphanWorkPath=await upload("work-materials",`${a.id}/${randomUUID()}/${randomUUID()}.png`);
 await insert("work_item_materials",[{item_id:workIds[0],author_id:a.id,kind:"image",content:privatePath},{item_id:shared,author_id:a.id,kind:"image",content:sharedPath}]);
 await upload("avatars",`${a.id}/${avatarIds[0]}.png`);await upload("chat-backgrounds",`${a.id}/${backgroundIds[0]}.png`);await upload("pet-portraits",`${a.id}/${randomUUID()}/${randomUUID()}.png`);await upload("chat-media",`${group}/${a.id}/${randomUUID()}.png`);
 const visionId=randomUUID(),visionPath=await upload("pet-vision",`${a.id}/${visionId}.png`);await ok(client.from("pet_vision_assets").insert({id:visionId,owner_id:a.id,storage_path:visionPath,sha256:"a".repeat(64),mime_type:"image/png",byte_size:png.length,state:"excluded"}));
 await ok(client.from("work_items").insert({owner_id:b.id,kind:"task",title:"Other account private sentinel"}));
 const exported=await invoke("export-my-data",a.token);
 const count=(rows,expected,label)=>{assert.equal(rows.length,expected,label);assert.equal(new Set(rows.map(row=>row.id??`${row.request_id}/${row.kind}`)).size,expected,`${label} unique`);};
 count(exported.authored_messages,N,"group history >1000");count(exported.pet_private_thread,N,"private history >1000");count(exported.work.items,N+1,"private and authorized shared work >1000");count(exported.memory_evolution.pet_life_facts,N,"life facts >1000");count(exported.reminders.series,N,"reminders >1000");count(exported.avatars.avatar_assets,N,"avatars >1000");count(exported.chat_backgrounds.assets,N,"backgrounds >1000");count(exported.avatars.personal_image_design_claims,N*2,"composite image claims >2000");
 assert.equal(exported.vision.pet_vision_assets[0].state,"excluded");assert.ok(!JSON.stringify(exported).includes("Other account private sentinel"));
 console.log("PASS real export Edge: 1007 rows in seven data families, 2014 composite claims, exact unique counts, no other account private data.");
 // No model inference in this storage-only maintenance acceptance.
 const soft=randomUUID(),softPath=await upload("chat-backgrounds",`${a.id}/${soft}.png`);await ok(client.from("chat_background_assets").insert({id:soft,owner_id:a.id,storage_path:softPath,source:"upload",deleted_at:now}));
 const maintenance=await invoke("image-maintenance",key,{generations:false});assert.equal(maintenance.generation_attempts_started,0);assert.ok(maintenance.cleaned>=1);assert.ok((await client.storage.from("chat-backgrounds").download(softPath)).error);assert.ok(!(await client.storage.from("pet-vision").download(visionPath)).error);
 const deleted=await invoke("delete-account",a.token,{password:a.password});assert.equal(deleted.deleted,true);assert.equal(deleted.storage_cleanup,"complete");
 assert.equal((await client.auth.admin.getUserById(a.id)).data.user,null);
 for(const table of ["pet_private_threads","pet_life_facts","reminder_series","avatar_assets","chat_background_assets","pet_vision_assets"]){const query=await client.from(table).select("*",{count:"exact",head:true}).eq("owner_id",a.id);assert.ifError(query.error);assert.equal(query.count,0,`${table} removed`);}
 const remaining=await ok(client.from("work_items").select("id,owner_id").in("id",[workIds[0],workIds[N-1],shared]));assert.deepEqual(remaining,[{id:shared,owner_id:null}]);
 assert.equal((await ok(client.from("spaces").select("created_by").eq("id",group).single())).created_by,b.id);assert.equal((await ok(client.from("space_members").select("role").eq("space_id",group).eq("user_id",b.id).single())).role,"owner");
 const redacted=await client.from("messages").select("id",{count:"exact",head:true}).eq("space_id",group).not("deleted_at","is",null);assert.ifError(redacted.error);assert.equal(redacted.count,N);assert.equal((await ok(client.from("messages").select("reply_preview").eq("id",reply).single())).reply_preview,"[已删除消息]");
 for(const file of files.filter(file=>file.path!==sharedPath)){assert.ok((await client.storage.from(file.bucket).download(file.path)).error,`private storage removed: ${file.bucket}`);}
 assert.ok(!(await b.caller.storage.from("work-materials").download(sharedPath)).error,"remaining member can read shared material");
 assert.ok((await client.storage.from("work-materials").upload(orphanWorkPath,png,{contentType:"image/png"})).error,"late upload rejected after account deletion");
 console.log("PASS real maintenance and deletion Edges: explicit soft-delete cleanup, excluded-image retention, no model calls, full redaction, deterministic group succession, private/nested/orphan storage removed, shared work material retained, late upload rejected.");
} finally {
 for(const file of files)await client.storage.from(file.bucket).remove([file.path]);
 if(group)await client.from("spaces").delete().eq("id",group);
 for(const id of users)await client.auth.admin.deleteUser(id);
}
