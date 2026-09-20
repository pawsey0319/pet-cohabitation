// Synthetic process/planner evaluation. Credentials are read from the local test environment only.
import {createClient} from "npm:@supabase/supabase-js@2";
import {processCompanionAction} from "../_shared/companionActions.ts";
const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw new Error("Supabase test environment required");
if(!["localhost","127.0.0.1"].includes(new URL(url).hostname))throw new Error("Use the isolated local Supabase fixture");
const live=Deno.env.get("WORK_ACTION_LIVE")==="true";
if(live&&!Deno.env.get("TEXT_API_KEY"))throw new Error("Live planner requires the explicitly supplied TEXT_API_* environment");
Deno.env.set("MODEL_MOCK_MODE",live?"false":"true");
// Diagnostic mode is restricted to these synthetic fixtures. Never install this in an Edge handler.
if(live&&Deno.env.get("WORK_ACTION_DEBUG")==="true"){
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{const result=await originalFetch(input,init);if(String(input).endsWith("/chat/completions")){const payload=await result.clone().json();console.log("Synthetic model structure:",payload?.choices?.[0]?.message?.content);}return result;};
}
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});let owner:string|undefined;let checks=0;
function ok(result:any){if(result.error)throw new Error(result.error.message);return result.data;}
function assert(condition:unknown,label:string){if(!condition)throw new Error(`Assertion failed: ${label}`);checks++;}
try{
 const email=`planner-${crypto.randomUUID()}@example.test`;owner=ok(await client.auth.admin.createUser({email,password:`Planner-${crypto.randomUUID()}-1!`,email_confirm:true})).user.id;
 ok(await client.from("profiles").insert({id:owner,email,nickname:"规划器合成验收"}));const pet=ok(await client.from("pets").insert({owner_id:owner,name:"规划器验收宠",status:"incubating"}).select("id").single());
 const process=async(content:string)=>{const source=ok(await client.from("pet_private_threads").insert({pet_id:pet.id,owner_id:owner,role:"owner",conversation_kind:"companion",content}).select("id").single());const context={ownerId:owner!,petId:pet.id,sourceMessageId:source.id,requestId:crypto.randomUUID(),expectedRevision:0,timezone:"Asia/Shanghai",content};return {result:await processCompanionAction(client,context),context};};
 const workCount=async()=>ok(await client.from("work_items").select("id").eq("owner_id",owner)).length;
 const reminderCount=async()=>ok(await client.from("reminder_series").select("id").eq("owner_id",owner)).length;
 if(Deno.env.get("WORK_ACTION_LIVE_WORK_ONLY")!=="true"){
 assert(!(await process("今天有点累，只想安静坐一会儿")).result.handled,"ordinary chat does not require a planner model");
 await process("我想以后每天运动，先随便想想");assert(await workCount()===0&&await reminderCount()===0,"wish never creates formal work");
 const mixed=await process("累死了，明早九点提醒我交材料");assert(mixed.result.handled&&mixed.result.reminderVersions.length===1,"mixed feeling + exact reminder executes");assert(/辛苦|累|安顿/.test(mixed.result.replyText??""),"mixed reply responds to feeling");assert(await reminderCount()===1,"real reminder exists");
 const retry=await processCompanionAction(client,mixed.context);assert(retry.reminderVersions[0].id===mixed.result.reminderVersions[0].id&&await reminderCount()===1,"same request recovers receipt without duplicate action");
 const vague=await process("明天提醒我交材料");assert(vague.result.handled&&vague.result.reminderVersions.length===0&&await reminderCount()===1,"missing clock time clarifies");
 await process("他说：明早九点提醒我交材料，这只是举个例子");assert(await reminderCount()===1&&await workCount()===0,"quoted example never auto-executes");
 const missingGroup=await process("帮我在群里创建周末聚餐任务");assert(missingGroup.result.handled&&/群/.test(missingGroup.result.replyText??"")&&await workCount()===0,"group context must be explicit");
 await process("明天提醒我交短答验收材料");const followup=await process("九点");assert(followup.result.reminderVersions.length===1&&await reminderCount()===2,"short clock answer resumes the original reminder");
 const shortSeries=ok(await client.from("reminder_series").select("content,start_local").eq("id",followup.result.reminderVersions[0].id).single());assert(shortSeries.content.includes("短答验收材料")&&shortSeries.start_local.includes("09:00"),"short answer fills only time and retains original content");
 const followupRetry=await processCompanionAction(client,followup.context);assert(followupRetry.reminderVersions[0].id===followup.result.reminderVersions[0].id&&await reminderCount()===2,"short-answer retry preserves receipt and request identity");
 const original=ok(await client.from("pet_companion_action_plans").select("context_source_ids").eq("request_id",followup.context.requestId).single()).context_source_ids[0];
 ok(await client.from("pet_private_context_exclusions").insert({owner_id:owner,pet_id:pet.id,message_id:original}));assert(ok(await client.from("pet_private_context_exclusions").select("message_id").eq("message_id",followup.context.sourceMessageId)).length===1,"forgetting original instruction also excludes its dependent short answer");
 }
 const createdWork=await process("帮我创建任务合成资料验收");assert(createdWork.result.workVersions.length===1&&await workCount()===1,"explicit personal task instruction creates one canonical item");
 const completedWork=await process("把「合成资料验收」标记为完成");assert(completedWork.result.workVersions[0]?.id===createdWork.result.workVersions[0].id&&ok(await client.from("work_items").select("status").eq("id",createdWork.result.workVersions[0].id).single()).status==="completed","explicit completion updates the existing task with a real receipt");
 if(!live){
  const expired=await process("明天提醒我做过期验收");ok(await client.from("pet_companion_clarifications").update({expires_at:new Date(Date.now()-1000).toISOString()}).eq("request_id",expired.context.requestId));const noExpired=await process("九点");assert(!noExpired.result.handled&&await reminderCount()===2,"expired clarification cannot consume a short answer");
  const forgotten=await process("明天提醒我做忘记验收");ok(await client.from("pet_private_context_exclusions").insert({owner_id:owner,pet_id:pet.id,message_id:forgotten.context.sourceMessageId}));assert(!(await process("九点")).result.handled&&await reminderCount()===2,"forgotten pending instruction cannot be revived");
  const changed=await process("明天提醒我做正文变化验收");ok(await client.from("pet_private_threads").update({content:"变更后的内容"}).eq("id",changed.context.sourceMessageId));assert(!(await process("九点")).result.handled,"source text fingerprint invalidates an edited original");
  await process("明天提醒我做换话题验收");await process("换个话题，聊电影吧");assert(!(await process("九点")).result.handled,"new unrelated topic abandons earlier missing field");
  await process("明天提醒我做话题边界验收");ok(await client.from("pet_companion_states").upsert({pet_id:pet.id,owner_id:owner,revision:0,context_started_at:new Date().toISOString()}));assert(!(await process("九点")).result.handled,"server topic boundary invalidates pending clarification");
  const late=await process("明天提醒我做迟到执行验收");const pending=ok(await client.from("pet_companion_clarifications").select("*").eq("request_id",late.context.requestId).single());const answer=ok(await client.from("pet_private_threads").insert({pet_id:pet.id,owner_id:owner,role:"owner",conversation_kind:"companion",content:"九点"}).select("id").single());
  const actionRequest=crypto.randomUUID();const prepared=ok(await client.rpc("prepare_companion_action",{p_owner:owner,p_pet:pet.id,p_request:actionRequest,p_source:answer.id,p_revision:0,p_allow_auto:true,p_plan:{...pending.plan,mode:"execute",input:{...pending.plan.input,start_local:"2026-12-20T09:00"},clarification_id:pending.id,clarification_version:pending.version}}));
  ok(await client.from("pet_companion_clarifications").update({expires_at:new Date(Date.now()-1000).toISOString()}).eq("id",pending.id));const rejected=await client.rpc("execute_companion_action",{p_owner:owner,p_plan_id:prepared.id,p_request:actionRequest,p_expected_version:prepared.version});assert(rejected.error?.message.includes("companion_clarification_expired")&&await reminderCount()===2,"expiry between prepare and execute rolls the reminder transaction back");
  const newer=await process("明天提醒我做版本验收");ok(await client.from("pet_companion_states").update({revision:1}).eq("pet_id",pet.id));
  const newSource=ok(await client.from("pet_private_threads").insert({pet_id:pet.id,owner_id:owner,role:"owner",conversation_kind:"companion",content:"九点"}).select("id").single());const latest=await processCompanionAction(client,{...newer.context,sourceMessageId:newSource.id,requestId:crypto.randomUUID(),content:"九点",expectedRevision:1});assert(!latest.handled,"changed memory revision never resumes stale clarification");
 }
 console.log(`PASS: ${checks} ${live?"live configured model":"fixture planner"} companion process assertions.`);
}finally{if(owner){const deleted=await client.auth.admin.deleteUser(owner);if(deleted.error)throw deleted.error;}}
