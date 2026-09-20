// Synthetic local/cloud action transaction validation. Uses real Auth/RLS/Edge/RPC.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anon||!key)throw new Error("Supabase test environment required");
if(!["127.0.0.1","localhost","[::1]"].includes(new URL(url).hostname)&&new URL(url).hostname!==process.env.WORK_TEST_HOST)throw new Error("Explicit WORK_TEST_HOST required");
const config={auth:{persistSession:false,autoRefreshToken:false}};const service=createClient(url,key,config);const users=[],spaces=[];let checks=0;
function ok(result){if(result.error)throw new Error(result.error.message);return result.data;}
const rpc=async(name,params)=>ok(await service.rpc(name,params));
async function createUser(){const email=`action-${randomUUID()}@example.test`,password=`Action-${randomUUID()}-a1!`;const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user;users.push(user.id);ok(await service.from("profiles").insert({id:user.id,email,nickname:"陪伴事项验收"}));const client=createClient(url,anon,config);ok(await client.auth.signInWithPassword({email,password}));return {...user,client};}
async function invoke(user,body){if(process.env.WORK_ACTION_RPC_ONLY==="true")return rpc("execute_companion_action",{p_owner:user.id,p_plan_id:body.plan_id,p_request:body.request_id,p_expected_version:body.expected_version,p_confirmed:body.action==="confirm",p_input:body.input??null,p_dismiss:body.action==="dismiss"});const response=await user.client.functions.invoke("companion-actions",{body});if(response.error){let code=response.error.name;try{const detail=await response.error.context.json();code=detail.error??detail.message??detail.code??code;}catch{}throw new Error(code);}return response.data;}
async function rejects(promise,pattern){await assert.rejects(promise,pattern);checks++;}
try{
 const A=await createUser(),B=await createUser();const pet=ok(await service.from("pets").insert({owner_id:A.id,name:"事务验收宠",status:"incubating"}).select("id").single());
 const prepare=async(plan,auto=true,content="创建一个任务：交材料")=>{const source=ok(await service.from("pet_private_threads").insert({pet_id:pet.id,owner_id:A.id,role:"owner",content,conversation_kind:"companion"}).select("id").single());const request=randomUUID();return rpc("prepare_companion_action",{p_owner:A.id,p_pet:pet.id,p_request:request,p_source:source.id,p_revision:0,p_plan:plan,p_allow_auto:auto});};
 const execute=(plan,args={})=>rpc("execute_companion_action",{p_owner:A.id,p_plan_id:plan.id,p_request:plan.request_id,p_expected_version:plan.version,...args});
 const workPlan={mode:"execute",domain:"work",action:"create",scope:"personal",space_id:null,input:{title:"交材料",kind:"task"}};
 const ready=await prepare(workPlan);assert.equal(ready.status,"ready");const first=await execute(ready),again=await execute(ready);assert.equal(first.item.id,again.item.id);assert.equal(first.item.due_at,null);assert.equal(first.outcome,"created");checks++;
 const plans=ok(await A.client.from("pet_companion_action_plans").select("*").eq("id",ready.id));assert.equal(plans.length,1);assert.equal(plans[0].status,"executed");assert.equal(ok(await B.client.from("pet_companion_action_plans").select("*").eq("id",ready.id)).length,0);checks++;
 await rejects(execute(ready,{p_input:{title:"同请求改内容"},p_confirmed:true}),/companion_action_request_conflict/);
 await rejects(B.client.rpc("execute_companion_action",{p_owner:A.id,p_plan_id:ready.id,p_request:randomUUID(),p_expected_version:1}).then(ok),/permission denied/);
 const suggestion=await prepare({...workPlan,mode:"suggest",input:{kind:"goal",title:"随口愿望计划"}},false,"我想以后每天多运动");assert.equal(suggestion.status,"suggested");assert.equal(ok(await service.from("work_items").select("id").eq("title","随口愿望计划")).length,0);checks++;
 await rejects(execute(suggestion),/companion_action_confirmation_required/);
 const decision={action:"confirm",plan_id:suggestion.id,request_id:randomUUID(),expected_version:1,input:{kind:"goal",title:"用户编辑后的小计划"}};
 const chosen=await invoke(A,decision),chosenRetry=await invoke(A,decision);assert.equal(chosen.item.title,"用户编辑后的小计划");assert.equal(chosen.item.id,chosenRetry.item.id);checks++;
 await rejects(invoke(B,decision),/companion_action_forbidden/);
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10)+"T09:00";
 const mixed=await prepare({mode:"execute",domain:"reminder",action:"create",scope:"personal",input:{content:"交材料",timezone:"Asia/Shanghai",start_local:tomorrow,rule:{frequency:"once"}}},true,"累死了，明早九点提醒我交材料");const reminder=await execute(mixed);assert.equal(reminder.outcome,"created");assert.equal(reminder.series.owner_id,A.id);assert.ok(reminder.series.next_at);assert.equal((await execute(mixed)).series.id,reminder.series.id);checks++;
 const combined=await prepare({...workPlan,input:{title:"任务与单独提醒",kind:"task"},reminder:{content:"准备材料",timezone:"Asia/Shanghai",start_local:tomorrow,rule:{frequency:"once"}}});const combinedResult=await execute(combined);assert.equal(combinedResult.reminder.series.work_item_id,combinedResult.item.id);assert.equal(combinedResult.item.due_at,null);checks++;
 const invalid=await prepare({...workPlan,input:{title:"失败要原子回滚",kind:"task"},reminder:{content:"失败提醒",timezone:"Asia/Shanghai",start_local:"2020-01-01T09:00",rule:{frequency:"once"}}});await rejects(execute(invalid),/reminder_time_must_be_future/);assert.equal(ok(await service.from("work_items").select("id").eq("id",invalid.id)).length,0);assert.equal(ok(await service.from("pet_companion_action_plans").select("status").eq("id",invalid.id).single()).status,"ready");checks++;
 const stopped=await prepare({...workPlan,input:{title:"回答停止后不得晚执行"}});ok(await service.from("pet_private_threads").update({reply_error_code:"private_request_stopped"}).eq("id",stopped.source_message_id));await rejects(execute(stopped),/private_request_stopped/);checks++;
 // Stopping after a committed action keeps the real created item and receipt.
 ok(await service.from("pet_private_threads").update({reply_error_code:"private_request_stopped"}).eq("id",ready.source_message_id));assert.equal((await execute(ready)).item.id,first.item.id);checks++;
 const forgotten=await prepare({...workPlan,input:{title:"忘记后旧计划不能执行"}});ok(await service.from("pet_private_context_exclusions").insert({pet_id:pet.id,owner_id:A.id,message_id:forgotten.source_message_id}));await rejects(execute(forgotten),/companion_action_source_excluded/);assert.equal(ok(await A.client.from("pet_companion_action_plans").select("*").eq("id",forgotten.id)).length,0);checks++;
 const sid=ok(await service.from("spaces").insert({name:"陪伴发布验收群",kind:"friend_circle",created_by:A.id}).select("id").single()).id;spaces.push(sid);ok(await service.from("space_members").insert([{space_id:sid,user_id:A.id,role:"owner"},{space_id:sid,user_id:B.id,role:"member"}]));
 const groupPlan=await prepare({...workPlan,scope:"group",space_id:sid,input:{title:"群材料分工",kind:"task",assignee_id:B.id}});assert.equal(groupPlan.status,"suggested");await rejects(execute(groupPlan),/companion_action_confirmation_required/);const published=await execute(groupPlan,{p_request:randomUUID(),p_confirmed:true});assert.equal(published.item.publication,"published");assert.equal(published.item.status,"pending_acceptance");assert.equal(published.item.assignee_id,B.id);checks++;
 // Account deletion fences all later work writes and material uploads before data removal.
 await rpc("block_chat_background_owner",{p_owner_id:A.id});await rejects(rpc("mutate_work_item",{p_actor:A.id,p_action:"create",p_request_id:randomUUID(),p_input:{title:"注销中的晚写"}}),/work_account_deleting/);
 console.log(`PASS: ${checks} companion action transaction/Auth/RLS${process.env.WORK_ACTION_RPC_ONLY==="true"?"":"/Edge"} scenario groups. Planner real-model evaluation remains separate.`);
}finally{
 for(const sid of spaces){const result=await service.from("spaces").delete().eq("id",sid);if(result.error){console.error("Synthetic group cleanup failed:",result.error.message);process.exitCode=1;}}
 for(const id of users.reverse()){const result=await service.auth.admin.deleteUser(id);if(result.error){console.error("Synthetic account cleanup failed:",result.error.message);process.exitCode=1;}}
}
