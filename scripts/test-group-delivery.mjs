import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL;
if(!url || !["127.0.0.1","localhost"].includes(new URL(url).hostname)) throw new Error("Use the isolated local Supabase fixture.");
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const ids=[],clients=[]; let space;
const ok=(r)=>{if(r.error)throw new Error(r.error.message);return r.data;};
async function account(label){
 const email=`delivery-${label}-${randomUUID()}@example.test`,password=`Aa1!${randomUUID()}`;
 const id=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user.id;ids.push(id);
 ok(await service.from("profiles").insert({id,email,nickname:label}));
 const client=createClient(url,process.env.SUPABASE_ANON_KEY,options);clients.push(client);
 ok(await client.auth.signInWithPassword({email,password}));return {id,client};
}
try{
 const owner=await account("owner"),other=await account("outsider");
 space=ok(await owner.client.rpc("create_relationship_space",{space_name:"事务验收群",space_kind:"friend_circle"}));
 const body={message_client_id:randomUUID(),target_space_id:space,message_kind:"text",message_text:"普通聊天无需等待 AI"};
 const start=performance.now();
 const first=ok(await owner.client.rpc("send_space_message_v2",body));
 const ms=performance.now()-start;
 assert.equal(first.message.text,body.message_text);assert.ok(first.job_id);
 const job=ok(await service.from("agent_jobs").select("status,source_message_id").eq("id",first.job_id).single());
 assert.equal(job.status,"queued");assert.equal(job.source_message_id,first.message.id);
 const duplicates=await Promise.all(Array.from({length:8},()=>owner.client.rpc("send_space_message_v2",body)));
 assert.ok(duplicates.every((r)=>ok(r).message.id===first.message.id));
 assert.match((await owner.client.rpc("send_space_message_v2",{...body,message_text:"换内容"})).error?.message??"",/message_request_conflict/);
 assert.equal(ok(await owner.client.rpc("send_space_message",body)),first.message.id);
 assert.match((await other.client.rpc("list_space_messages_v2",{target_space_id:space})).error?.message??"",/not_space_member/);
 assert.match((await other.client.rpc("send_space_message_v2",body)).error?.message??"",/not_space_member/);
 console.log("PASS immutable send + legacy contract + transactional durable job + account isolation");

 const durations=[];
 const sent=await Promise.all(Array.from({length:12},async(_,i)=>{
   const t=performance.now(); const r=ok(await owner.client.rpc("send_space_message_v2",{...body,message_client_id:randomUUID(),message_text:`同一时间 ${i}`}));durations.push(performance.now()-t);return r.message;
 }));
 const timestamp=new Date().toISOString();
 assert.ok(sent.every((m)=>/^[0-9a-f-]{36}$/.test(m.id)) && /^[0-9a-f-]{36}$/.test(owner.id));
 execFileSync("docker",["exec","-i",process.env.SUPABASE_TEST_DB_CONTAINER??"supabase_db_android-companion-validation","psql","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],{windowsHide:true,input:`begin; select set_config('request.jwt.claim.sub','${owner.id}',true); update public.messages set created_at='${timestamp}' where id in (${sent.map((m)=>"'"+m.id+"'").join(",")}); commit;`,stdio:["pipe","ignore","pipe"]});
 let cursor=null,found=[];
 for(;;){
   const page=ok(await owner.client.rpc("list_space_messages_v2",{target_space_id:space,page_size:4,...(cursor?{before_at:cursor.created_at,before_id:cursor.id}:{})}));
   found.push(...page.map((m)=>m.id)); if(page.length<4)break;cursor=page.at(-1);
 }
 assert.equal(new Set(found).size,13);assert.equal(found.length,13);
 console.log("PASS stable (time,ID) pagination with 12 identical timestamps");

 const current=ok(await service.from("messages").select("id,updated_at").eq("space_id",space).order("updated_at",{ascending:false}).order("id",{ascending:false}).limit(1))[0];
 ok(await service.from("space_members").insert({space_id:space,user_id:other.id,role:"member"}));
 ok(await other.client.rpc("toggle_message_reaction",{target_message_id:first.message.id,reaction_emoji:"👍"}));
 const change=ok(await owner.client.rpc("sync_space_messages_v2",{target_space_id:space,after_at:current.updated_at,after_id:current.id}));
 assert.ok(change.some((m)=>m.id===first.message.id && m.message_reactions.some((r)=>r.emoji==="👍")));
 const changed=change.at(-1);
 ok(await service.from("messages").delete().eq("id",sent[0].id));
 const deleted=ok(await owner.client.rpc("sync_space_messages_v2",{target_space_id:space,after_at:changed.updated_at,after_id:changed.id}));
 assert.ok(deleted.some((m)=>m.id===sent[0].id && m.deleted_at));
 console.log("PASS incremental reactions and physical deletion tombstones");

 const firstClaim=ok(await service.rpc("claim_space_route_job",{p_job_id:first.job_id}));assert.ok(firstClaim.lease_token);
 assert.equal(ok(await service.rpc("claim_space_route_job",{p_job_id:first.job_id})),null);
 ok(await service.from("agent_jobs").update({lease_until:"2000-01-01T00:00:00Z"}).eq("id",first.job_id));
 const reclaimed=ok(await service.rpc("claim_space_route_job",{p_job_id:first.job_id}));
 assert.notEqual(reclaimed.lease_token,firstClaim.lease_token);
 assert.equal(ok(await service.rpc("check_space_route_lease",{p_job_id:first.job_id,p_token:firstClaim.lease_token})),false);
 assert.equal(ok(await service.rpc("check_space_route_lease",{p_job_id:first.job_id,p_token:reclaimed.lease_token})),true);
 ok(await service.from("space_members").delete().eq("space_id",space).eq("user_id",owner.id));
 assert.equal(ok(await service.rpc("check_space_route_lease",{p_job_id:first.job_id,p_token:reclaimed.lease_token})),false);
 assert.match((await owner.client.rpc("sync_space_messages_v2",{target_space_id:space,after_at:timestamp,after_id:first.message.id})).error?.message??"",/not_space_member/);
 console.log("PASS lease takeover, stale worker fencing and revoked membership");
 durations.sort((a,b)=>a-b);
 console.log(JSON.stringify({environment:"isolated local fixture",firstAckMs:Math.round(ms),samples:durations.length,p50Ms:Math.round(durations[5]),p95Ms:Math.round(durations[11]),modelCalled:false}));
}finally{
 if(space)ok(await service.from("spaces").delete().eq("id",space));
 for(const id of ids){await service.from("profiles").delete().eq("id",id);await service.auth.admin.deleteUser(id);}
 await Promise.all(clients.map((c)=>c.removeAllChannels()));
}
