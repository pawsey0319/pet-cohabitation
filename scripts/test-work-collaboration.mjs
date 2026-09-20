// Full Supabase Auth/RLS/RPC/Edge acceptance with synthetic accounts only.
// Invoke through scripts/with-companion-env.ps1. Does not replace Android/offline UI acceptance.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anon||!serviceKey)throw new Error("Supabase test environment required");
if(!["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname)&&new URL(url).hostname!==process.env.WORK_TEST_HOST)throw new Error("Explicit WORK_TEST_HOST required for cloud validation");
const options={auth:{persistSession:false,autoRefreshToken:false}};const service=createClient(url,serviceKey,options);const users=[],spaces=[];let checks=0;
function ok(result){if(result.error)throw new Error(result.error.message);return result.data;}
async function user(label){const email=`work-${randomUUID()}@example.test`,password=`Work-${randomUUID()}-a1!`;const created=ok(await service.auth.admin.createUser({email,password,email_confirm:true}));users.push(created.user.id);ok(await service.from("profiles").insert({id:created.user.id,email,nickname:`事项验收${label}`}));const client=createClient(url,anon,options);ok(await client.auth.signInWithPassword({email,password}));return {id:created.user.id,client};}
async function invoke(actor,body,fn="work-items"){const session=await actor.client.auth.getSession();const result=await actor.client.functions.invoke(fn,{body,headers:{Authorization:`Bearer ${session.data.session.access_token}`}});if(result.error){let code=result.error.name;try{code=(await result.error.context.json()).error??code;}catch{}throw new Error(code);}if(result.data?.error)throw new Error(result.data.error);return result.data;}
async function mutate(actor,action,item,input={},requestId=randomUUID()){return invoke(actor,{action,request_id:requestId,...(item?{item_id:item.id,expected_version:item.version}:{}),input});}
async function create(actor,input){return (await mutate(actor,"create",null,input)).item;}
async function reread(item){return ok(await service.from("work_items").select("*").eq("id",item.id).single());}
async function rejected(promise,pattern){await assert.rejects(promise,pattern);checks++;}
async function group(owner,members){const row=ok(await service.from("spaces").insert({name:"事项隔离验收",kind:"friend_circle",created_by:owner.id}).select("id").single());spaces.push(row.id);ok(await service.from("space_members").insert(members.map(m=>({space_id:row.id,user_id:m.id,role:m.id===owner.id?"owner":"member"}))));return row.id;}
async function rpc(name,args){return ok(await service.rpc(name,args));}
try{
 const A=await user("甲"),B=await user("乙"),C=await user("丙"),D=await user("丁");const sid=await group(A,[A,B,C]);
 const requestId=randomUUID();const request={action:"create",request_id:requestId,input:{kind:"task",title:"明确个人任务"}};
 const first=await invoke(A,request),retry=await invoke(A,request);assert.equal(first.item.id,retry.item.id);assert.equal(first.item.due_at,null);assert.equal(first.item.status,"not_started");checks++;
 await rejected(invoke(A,{...request,input:{kind:"task",title:"同 ID 换内容"}}),/work_request_conflict/);
 assert.equal(ok(await B.client.from("work_items").select("*").eq("id",first.item.id)).length,0);checks++;
 await rejected(invoke(B,{action:"get",item_id:first.item.id}),/work_forbidden/);
 await rejected(B.client.rpc("mutate_work_item",{p_actor:A.id,p_action:"cancel",p_request_id:randomUUID(),p_item_id:first.item.id,p_expected_version:1,p_input:{}}).then(ok),/permission denied/);
 const concurrent=await Promise.allSettled([mutate(A,"edit",first.item,{title:"同时编辑一"}),mutate(A,"edit",first.item,{title:"同时编辑二"})]);assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);assert.equal(concurrent.filter(r=>r.status==="rejected").length,1);checks++;
 let personal=await reread(first.item);personal=(await mutate(A,"complete",personal,{completion_note:"已提交"})).item;assert.equal(personal.status,"completed");assert.equal(personal.terms_version,1);checks++;
 const goal=await create(A,{kind:"goal",title:"完成验收目标"}),milestone=await create(A,{kind:"milestone",parent_id:goal.id,title:"第一阶段"});let one=await create(A,{kind:"task",parent_id:milestone.id,title:"步骤一"}),two=await create(A,{kind:"task",parent_id:milestone.id,title:"步骤二"});
 one=(await mutate(A,"complete",one)).item;two=(await mutate(A,"cancel",two)).item;
 await rejected(mutate(A,"complete",goal),/work_goal_has_uncompleted_tasks/);
 await rejected(create(B,{kind:"milestone",title:"越权子事项",parent_id:goal.id}),/work_invalid_parent/);
 let draft=await create(A,{kind:"task",space_id:sid,title:"群内材料整理",assignee_id:B.id,review_required:true});assert.equal(draft.publication,"draft");assert.equal(ok(await B.client.from("work_items").select("*").eq("id",draft.id)).length,0);checks++;
 await rejected(mutate(A,"publish",draft),/work_publish_confirmation_required/);
 draft=(await mutate(A,"publish",draft,{confirmed:true})).item;assert.equal(draft.status,"pending_acceptance");assert.equal(ok(await B.client.from("work_items").select("*").eq("id",draft.id)).length,1);checks++;
 await rejected(mutate(B,"complete",draft),/work_agreement_required/);
 await rejected(mutate(C,"accept",draft),/work_assignee_required/);
 draft=(await mutate(B,"accept",draft)).item;assert.equal(draft.status,"not_started");const acceptedTerms=draft.terms_version;
 draft=(await mutate(B,"progress",draft,{completion_note:"已整理一半"})).item;assert.equal(draft.status,"in_progress");assert.equal(draft.terms_version,acceptedTerms);checks++;
 draft=(await mutate(A,"edit",draft,{description:"交付要求增加目录"})).item;assert.equal(draft.terms_version,acceptedTerms+1);assert.equal(draft.status,"pending_acceptance");checks++;
 draft=(await mutate(B,"accept",draft)).item;assert.equal(draft.status,"pending_acceptance");draft=(await mutate(A,"confirm",draft)).item;assert.equal(draft.status,"not_started");checks++;
 draft=(await mutate(B,"complete",draft,{completion_note:"附件已补齐"})).item;assert.equal(draft.status,"pending_review");draft=(await mutate(A,"review",draft,{approved:false})).item;assert.equal(draft.status,"in_progress");draft=(await mutate(B,"complete",draft)).item;draft=(await mutate(A,"review",draft,{approved:true})).item;assert.equal(draft.status,"completed");checks++;
 const detail=await invoke(B,{action:"get",item_id:draft.id});assert.ok(detail.activity.some(event=>event.detail.terms?.description==="交付要求增加目录"));checks++;
 let rejectedTask=await create(A,{space_id:sid,title:"待分配",assignee_id:B.id});rejectedTask=(await mutate(A,"publish",rejectedTask,{confirmed:true})).item;rejectedTask=(await mutate(B,"reject",rejectedTask)).item;assert.equal(rejectedTask.status,"pending_acceptance");assert.equal(rejectedTask.terms_valid,false);checks++;
 let proposal=await create(A,{kind:"goal",space_id:sid,title:"普通讨论方案",approval:"majority"});proposal=(await mutate(A,"publish",proposal,{confirmed:true})).item;assert.equal(proposal.status,"pending_acceptance");proposal=(await mutate(B,"confirm",proposal)).item;assert.equal(proposal.status,"not_started");checks++;
 let schedule=await create(A,{kind:"goal",space_id:sid,title:"共同讨论时间",approval:"all",participants:[A.id,B.id,C.id]});schedule=(await mutate(A,"publish",schedule,{confirmed:true})).item;schedule=(await mutate(B,"confirm",schedule)).item;assert.equal(schedule.status,"pending_acceptance");checks++;
 ok(await service.from("space_members").delete().eq("space_id",sid).eq("user_id",C.id));schedule=await reread(schedule);assert.equal(schedule.terms_valid,false);assert.equal(schedule.status,"pending_acceptance");await rejected(mutate(A,"confirm",schedule),/work_confirmation_expired/);checks++;
 assert.equal(ok(await C.client.from("work_items").select("*").eq("space_id",sid)).length,0);await rejected(invoke(C,{action:"get",item_id:draft.id}),/work_forbidden/);
 // Quiet batching and source/consent checks are driven with synthetic timestamps, without model fiction.
 let auth=await rpc("set_group_work_consent",{p_actor:A.id,p_space:sid,p_version:ok(await service.from("group_work_authorizations").select("version").eq("space_id",sid).single()).version,p_consented:true});assert.equal(auth.active_since,null);
 auth=await rpc("set_group_work_consent",{p_actor:B.id,p_space:sid,p_version:auth.version,p_consented:true});assert.ok(auth.active_since);checks++;
 const sourceTime=new Date(Date.now()-5*60*1000).toISOString();ok(await service.from("group_work_authorizations").update({active_since:new Date(Date.now()-10*60*1000).toISOString()}).eq("space_id",sid));
 const message=ok(await A.client.from("messages").insert({client_id:randomUUID(),space_id:sid,sender_id:A.id,actor_kind:"human",actor_name:"验收甲",kind:"text",text:"明天请整理材料目录",created_at:sourceTime}).select("id").single());
 assert.equal(await rpc("claim_group_work_batch",{}),null);checks++;
 ok(await service.from("group_work_batches").update({ready_at:new Date(Date.now()-1000).toISOString()}).eq("space_id",sid).eq("status","queued"));
 const claim=await rpc("claim_group_work_batch",{});assert.ok(claim.batch.lease_token);assert.equal(claim.sources[0].id,message.id);assert.equal(await rpc("claim_group_work_batch",{}),null);checks++;
 const suggestions=[{title:"整理材料目录",description:"请相关成员确认",sources:[{message_id:message.id,quote:"明天请整理材料目录"}]}];
 await rejected(rpc("finish_group_work_batch",{p_batch:claim.batch.id,p_token:claim.batch.lease_token,p_suggestions:[{...suggestions[0],sources:[{message_id:message.id,quote:"源消息没有这句话"}]}],p_error:null}),/work_invalid_suggestion_source/);
 assert.equal(await rpc("finish_group_work_batch",{p_batch:claim.batch.id,p_token:claim.batch.lease_token,p_suggestions:suggestions,p_error:null}),true);checks++;
 const suggestion=ok(await service.from("group_work_suggestions").select("*").eq("space_id",sid).single());const countBefore=ok(await service.from("work_items").select("id").eq("space_id",sid)).length;
 await invoke(A,{action:"dismiss",suggestion_id:suggestion.id,request_id:randomUUID()},"group-work-suggestions");assert.equal((await invoke(A,{action:"list",space_id:sid},"group-work-suggestions")).suggestions.length,0);assert.equal((await invoke(B,{action:"list",space_id:sid},"group-work-suggestions")).suggestions.length,1);assert.equal(ok(await service.from("work_items").select("id").eq("space_id",sid)).length,countBefore);checks++;
 const acceptBody={action:"accept",suggestion_id:suggestion.id,request_id:randomUUID(),input:{confirmed:true,title:"整理材料目录",assignee_id:B.id}};const accepted=await invoke(B,acceptBody,"group-work-suggestions"),acceptedRetry=await invoke(B,acceptBody,"group-work-suggestions");assert.equal(accepted.item.id,acceptedRetry.item.id);assert.equal(accepted.item.publication,"published");assert.equal(accepted.item.status,"pending_acceptance");checks++;
 await rejected(invoke(B,{...acceptBody,input:{...acceptBody.input,title:"更改同 ID 内容"}},"group-work-suggestions"),/work_request_conflict/);
 // Worker lease expiration can be reclaimed; revocation rejects even a valid late token.
 const secondMessage=ok(await A.client.from("messages").insert({client_id:randomUUID(),space_id:sid,sender_id:A.id,actor_kind:"human",actor_name:"验收甲",kind:"text",text:"请确认下一份目录",created_at:new Date(Date.now()-4*60*1000).toISOString()}).select("id").single());
 ok(await service.from("group_work_batches").update({ready_at:new Date(Date.now()-1000).toISOString()}).eq("space_id",sid).eq("status","queued"));const firstLease=await rpc("claim_group_work_batch",{});assert.ok(firstLease.batch.id);
 ok(await service.from("group_work_batches").update({lease_until:new Date(Date.now()-1000).toISOString()}).eq("id",firstLease.batch.id));const recovery=await rpc("claim_group_work_batch",{});assert.equal(recovery.batch.id,firstLease.batch.id);assert.notEqual(recovery.batch.lease_token,firstLease.batch.lease_token);assert.equal(await rpc("finish_group_work_batch",{p_batch:firstLease.batch.id,p_token:firstLease.batch.lease_token,p_suggestions:[],p_error:null}),false);checks++;
 auth=await rpc("set_group_work_consent",{p_actor:A.id,p_space:sid,p_version:auth.version,p_consented:false});assert.equal(auth.active_since,null);assert.equal(await rpc("finish_group_work_batch",{p_batch:recovery.batch.id,p_token:recovery.batch.lease_token,p_suggestions:[{title:"下一份目录",sources:[{message_id:secondMessage.id,quote:"请确认下一份目录"}]}],p_error:null}),false);checks++;
 // New membership revokes detection and never inherits an accepted task.
 ok(await service.from("space_members").insert({space_id:sid,user_id:D.id,role:"member"}));const afterJoin=ok(await service.from("group_work_authorizations").select("*").eq("space_id",sid).single());assert.equal(afterJoin.active_since,null);assert.ok(afterJoin.version>auth.version);assert.equal(ok(await service.from("work_item_confirmations").select("*").eq("item_id",accepted.item.id).eq("user_id",D.id)).length,0);checks++;
 // Authenticated users cannot issue worker claims, table writes or cross-scope source materials.
 await rejected(A.client.rpc("claim_group_work_batch",{}).then(ok),/permission denied/);
 await rejected(A.client.from("work_items").update({status:"completed"}).eq("id",accepted.item.id).select().then(result=>{if(result.error)throw new Error(result.error.message);if(!result.data.length)throw new Error("write_denied");}),/permission denied|write_denied/);
 // Forgot sources remain readable in the original private conversation but never in work search.
 const pet=ok(await service.from("pets").insert({owner_id:A.id,name:"验收异宠",status:"incubating"}).select("id").single());
 const privateSource=ok(await service.from("pet_private_threads").insert({pet_id:pet.id,owner_id:A.id,role:"owner",content:"我要准备私人验收材料",conversation_kind:"companion"}).select("id").single());
 const memoryGoal=await create(A,{kind:"goal",title:"私人验收目标",source_private_message_id:privateSource.id});const memoryStage=await create(A,{kind:"milestone",title:"私人验收阶段",parent_id:memoryGoal.id});
 assert.equal((await rpc("search_work_items",{p_actor:A.id,p_query:"私人验收"})).length,2);checks++;
 ok(await service.from("pet_private_context_exclusions").insert({pet_id:pet.id,owner_id:A.id,message_id:privateSource.id}));assert.equal((await rpc("search_work_items",{p_actor:A.id,p_query:"私人验收"})).length,0);assert.equal((await rpc("search_work_items",{p_actor:B.id,p_query:"私人验收"})).length,0);assert.ok((await invoke(A,{action:"get",item_id:memoryStage.id})).item);checks++;
 await rejected(create(A,{title:"试图恢复忘记来源",source_private_message_id:privateSource.id}),/work_source_forbidden/);
 console.log(`PASS: ${checks} Supabase Auth/RLS/Edge/RPC work collaboration scenario groups. Android/offline UI and live extraction model remain separate acceptance gates.`);
}finally{
 for(const sid of spaces){const result=await service.from("spaces").delete().eq("id",sid);if(result.error){console.error("Synthetic space cleanup failed:",result.error.message);process.exitCode=1;}}
 for(const id of users.reverse()){const result=await service.auth.admin.deleteUser(id);if(result.error){console.error("Synthetic user cleanup failed:",result.error.message);process.exitCode=1;}}
}

