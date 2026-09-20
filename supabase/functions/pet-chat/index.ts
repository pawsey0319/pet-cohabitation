import {VisionModelAdapter,visionAvailable,visionModelName} from "../_shared/visionAdapter.ts";
import {loadVisionInput} from "../_shared/visionData.ts";
import { z } from "npm:zod@4";

import { runInBackground } from "../_shared/background.ts";

import { streamPrivateCompanionReply } from "../_shared/modelStream.ts";

import { corsHeaders } from "../_shared/cors.ts";

import { optionsResponse } from "../_shared/cors.ts";

import { sha256 } from "../_shared/hash.ts";

import { processMemoryJobs } from "../_shared/memoryWorker.ts";

import { scorePreference, selectPreferences, type PreferenceFacts } from "../_shared/preferenceMemory.ts";

import { processCompanionAction } from "../_shared/companionActions.ts";

import { buildPetRecallContext } from "../_shared/petRecall.ts";

import type { LifeFact, InteractionSettings } from "../_shared/companionMemoryTypes.ts";

import { RECALL_RESPONSE_BUDGET_MS, TextModelAdapter } from "../_shared/modelAdapters.ts";

import { generateStewardReply } from "../_shared/petSteward.ts";
import { fallbackRecallAnswer, isUninformativeRecall } from "../_shared/answerQuality.ts";

import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";

import { errorResponse, json } from "../_shared/responses.ts";

import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";



const Input = z.object({ content: z.string().trim().min(1).max(4000), request_id: z.string().uuid().optional(), mode: z.enum(["companion", "steward"]).optional(), stream: z.boolean().optional(), timezone: z.string().min(1).max(80).optional(), image_asset_id:z.string().uuid().optional(),image_asset_version:z.number().int().positive().optional() });

type Turn = {message_id:string;created_at:string;revision:number;context_started_at:string|null;token:string};

type ThreadRow = {id:string;role:string;content:string;created_at:string;context_message_ids:string[]};



async function handlePetChat(request: Request, emit?: (event:Record<string,unknown>)=>void): Promise<Response> {

  if (request.method === "OPTIONS") return optionsResponse(request);

  const client=serviceClient(); const startedAt=Date.now();

  let runId:string|null=null; let claim:{petId:string;requestId:string;token:string;messageId:string}|null=null;
  let recallTiming:{lookup_ms:number;generation_ms:number;source_count:number;context_chars:number}|null=null;

  try {

    requirePost(request); const user=await authenticatedUser(request); const input=Input.parse(await request.json());

    const mode=input.mode??"legacy";
    if(Boolean(input.image_asset_id)!==Boolean(input.image_asset_version)||input.image_asset_id&&mode!=="companion")throw new Error("vision_input_invalid");
    if(input.image_asset_id&&!visionAvailable())throw new Error("vision_unavailable");

    const petResult=await client.from("pets").select("id,name,status,personality_summary").eq("owner_id",user.id).single();

    if(petResult.error) throw petResult.error; const pet=petResult.data;

    const requestId=input.request_id??crypto.randomUUID();

    const claimed=input.image_asset_id?await client.rpc("claim_pet_vision_request",{target_pet_id:pet.id,request_id:requestId,owner_content:input.content,image_asset_id:input.image_asset_id,image_asset_version:input.image_asset_version}):await client.rpc("claim_pet_private_request",{target_pet_id:pet.id,request_id:requestId,owner_content:input.content,request_mode:mode});

    if(claimed.error) throw claimed.error;

    if(claimed.data.reply_id){

      const result=await client.from("pet_private_threads").select("*").eq("id",claimed.data.reply_id).eq("owner_id",user.id).single();

      if(result.error) throw result.error;

      if(mode==="companion"&&!input.image_asset_id) runInBackground(processMemoryJobs(client,pet.id).catch(()=>undefined));

      return json(request,result.data);

    }

    const turn=claimed.data as Turn;

    let streamSequence=0;

    emit?.({type:"accepted",request_id:requestId,message_id:turn.message_id,revision:turn.revision});

    claim={petId:pet.id,requestId,token:turn.token,messageId:turn.message_id};

    const setPhase=async(phase:"classifying"|"retrieving"|"thinking")=>{

      const result=await client.rpc("set_pet_private_request_phase",{target_pet_id:pet.id,request_id:requestId,target_token:turn.token,phase});

      if(result.error) throw result.error;

      emit?.({type:"phase",request_id:requestId,phase});

    };

    const promptHash=await sha256(`${pet.id}:${requestId}:${mode}:${input.content}`);

    const prior=await client.from("model_runs").select("id,status").eq("owner_id",user.id).eq("run_kind","pet_private_reply").eq("prompt_hash",promptHash).order("created_at",{ascending:false}).limit(1).maybeSingle();

    if(prior.error) throw prior.error;

    if(prior.data?.status==="failed"){

      runId=prior.data.id;

      const reset=await client.from("model_runs").update({status:"running",error_code:null,completed_at:null,latency_ms:null}).eq("id",runId);

      if(reset.error) throw reset.error;

    } else runId=await reserveModelRun(client,{runKind:"pet_private_reply",dailyLimit:50,ownerId:user.id,petId:pet.id,promptHash,model:input.image_asset_id?visionModelName():TextModelAdapter.modelName()});

    await setPhase("classifying");

    await client.from("pet_runtime_states").upsert({pet_id:pet.id,owner_id:user.id,state:"thinking",source_kind:"private_chat",source_id:turn.message_id,started_at:new Date().toISOString(),expires_at:new Date(Date.now()+45_000).toISOString(),updated_at:new Date().toISOString()},{onConflict:"pet_id"});

    const excluded=await client.rpc("get_pet_excluded_message_ids",{target_pet_id:pet.id});

    if(excluded.error) throw excluded.error; const excludedIds=new Set<string>(excluded.data??[]);

    let query=client.from("pet_private_threads").select("id,role,content,created_at,context_message_ids").eq("pet_id",pet.id).lte("created_at",turn.created_at).in("conversation_kind",mode==="companion"?["companion"]:["steward","legacy"]).order("created_at",{ascending:false}).limit(20);

    if(mode==="companion"&&turn.context_started_at) query=query.gte("created_at",turn.context_started_at);

    const rows=await query; if(rows.error) throw rows.error;

    const thread=((rows.data??[]) as ThreadRow[]).filter(row=>!excludedIds.has(row.id)&&!row.context_message_ids?.some(id=>excludedIds.has(id)));

    if(!thread.some(row=>row.id===turn.message_id)) throw new Error("private_request_topic_changed");

    let workVersions:{id:string;version:number}[]=[]; let reminderVersions:{id:string;version:number}[]=[]; let extraContextIds:string[]=[];

    let content:string; let recallSources:unknown[]=[]; let evidenceIds:string[]=[]; let manualIds:string[]=[];

    let modelStartedAt=0; let modelFinishedAt=0;

    let agentRequestId:string|null=null; let targetSpaceName:string|null=null;

    if(input.image_asset_id){
      await setPhase("retrieving");
      const visionInput=await loadVisionInput(client,{ownerId:user.id,petId:pet.id,requestId,question:input.content});
      await setPhase("thinking");
      modelStartedAt=Date.now();
      const answer=await new VisionModelAdapter().analyze(visionInput);
      content=answer.content;
      modelFinishedAt=Date.now();
    } else if(mode==="companion"){

      modelStartedAt=Date.now();

      const wantsGroupQuery=/(?:群里|群聊|群消息|哪个群|哪个空间)/.test(input.content) && /查|找|总结|回顾|说|聊|消息|安排|讨论|什么时候|谁/.test(input.content);

      let groupReply:{content:string;sources:unknown[]}|null=null;

      if(wantsGroupQuery){

        const memberships=await client.from("space_members").select("space_id,spaces(name)").eq("user_id",user.id);

        if(memberships.error)throw memberships.error;

        const spaces=(memberships.data??[]).map((row:any)=>({id:row.space_id,name:row.spaces?.name??""}));

        const named=spaces.filter(row=>row.name&&input.content.includes(row.name));

        if(named.length!==1)groupReply={content:"你想查哪个群的消息？请告诉我群名。",sources:[]};

        else {

          await setPhase("retrieving");

          const lookupStarted=Date.now();
          const recall=await buildPetRecallContext(client,{ownerId:user.id,petId:pet.id,question:input.content,adapter:new TextModelAdapter(),requiredSpaceId:named[0].id});
          recallTiming={lookup_ms:Date.now()-lookupStarted,generation_ms:0,source_count:recall.sources.length,context_chars:recall.messages.reduce((n,item)=>n+item.actor.length+item.content.length,0)};

          await setPhase("thinking");

          const recallModel=TextModelAdapter.recallModelName();
          if(recall.messages.length){const recorded=await client.from("model_runs").update({model:recallModel}).eq("id",runId!).eq("owner_id",user.id);if(recorded.error)throw recorded.error;}
          modelStartedAt=Date.now();
          const result=recall.messages.length?await new TextModelAdapter().generatePetReply({petName:pet.name,personality:pet.personality_summary??"正在形成",styleSignals:"",messages:recall.messages,currentMessage:input.content,ownerPolicy:"pet_only",contextPolicy:"owner_private_cross_space",responseStyle:"concise",model:recallModel,deadlineAt:modelStartedAt+RECALL_RESPONSE_BUDGET_MS,coverageNote:recall.coverage?.note}):{content:"在这个群本次可查询的记录中，没有找到相关内容。可以换一个关键词或日期。"};
          recallTiming.generation_ms=Date.now()-modelStartedAt;

          groupReply={content:isUninformativeRecall(result.content,recall.messages.length>0)?fallbackRecallAnswer(recall.messages):result.content,sources:[...recall.sources]}; targetSpaceName=named[0].name;

        }

      }

      const action=groupReply?null:await processCompanionAction(client,{ownerId:user.id,petId:pet.id,requestId,sourceMessageId:turn.message_id,expectedRevision:turn.revision,content:input.content,timezone:input.timezone??"Asia/Shanghai",contextStartedAt:turn.context_started_at});

      if(groupReply){content=groupReply.content;recallSources=groupReply.sources;}

      else if(action?.handled){content=action.replyText!;workVersions=action.workVersions;reminderVersions=action.reminderVersions;}

      else {

      const [facts,memories,evolved,style]=await Promise.all([

        client.rpc("get_pet_preference_facts",{target_pet_id:pet.id}),

        client.from("pet_personal_memories").select("id,content,updated_at,source_message_id").eq("pet_id",pet.id).eq("owner_id",user.id).order("updated_at",{ascending:false}).limit(20),

        client.rpc("get_companion_memory_context",{target_pet_id:pet.id,topic_started_at:turn.context_started_at,query_text:input.content}),

        client.from("user_preferences").select("pet_reply_style").eq("user_id",user.id).maybeSingle(),

      ]);

      if(facts.error) throw facts.error; if(memories.error) throw memories.error; if(evolved.error)throw evolved.error; if(style.error)throw style.error;

      extraContextIds=evolved.data?.source_ids??[];

      const preferences=((facts.data??[]) as PreferenceFacts[]).map(fact=>scorePreference(fact));

      const selected=selectPreferences(preferences,input.content);

      const safeMemories=(memories.data??[]).filter(row=>!row.source_message_id||!excludedIds.has(row.source_message_id));

      await setPhase("thinking");

      modelStartedAt=Date.now();

      const prompt={petName:pet.name,personality:pet.personality_summary??"正在形成",styles:[],memories:safeMemories,recalledMessages:[],messages:[...thread].reverse(),contextStartedAt:turn.context_started_at,preferences,excludedMessageIds:[...excludedIds],lifeFacts:(evolved.data?.facts??[]) as LifeFact[],interactionSettings:(evolved.data?.settings??{}) as InteractionSettings,responseStyle:(["balanced","detailed"].includes(style.data?.pet_reply_style)?style.data!.pet_reply_style:"concise") as "concise"|"balanced"|"detailed"};

      const reply=input.stream && emit ? await streamPrivateCompanionReply(prompt,async(partial)=>{

        const appended=await client.rpc("append_pet_private_stream",{p_pet:pet.id,p_request:requestId,p_token:turn.token,p_revision:turn.revision,p_sequence:++streamSequence,p_content:partial});

        if(appended.error)throw appended.error;

        if(!appended.data)throw new Error("companion_context_changed");

        emit({type:"text",request_id:requestId,message_id:turn.message_id,revision:turn.revision,sequence:streamSequence,content:partial});

      }) : await new TextModelAdapter().generatePrivateCompanionReply(prompt);

      modelFinishedAt=Date.now();

      content=reply.content; evidenceIds=selected.map(item=>item.latestEvidenceId); manualIds=safeMemories.map(item=>item.id);

      }

      modelFinishedAt=Date.now();

    } else {

      modelStartedAt=Date.now();

      const reply=await generateStewardReply(client,{ownerId:user.id,pet,content:input.content,ownerMessageId:turn.message_id,thread,setReplyStatus:setPhase,setModel:async(model)=>{const updated=await client.from("model_runs").update({model}).eq("id",runId!).eq("owner_id",user.id);if(updated.error)throw updated.error;}});

      modelFinishedAt=Date.now();

      content=reply.content; recallSources=[...reply.recallSources]; agentRequestId=reply.agentRequestId; targetSpaceName=reply.targetSpaceName;

    }

    const contextIds=input.image_asset_id||mode!=="companion"?[turn.message_id]:[...new Set([...thread.map(item=>item.id),...extraContextIds])];
    const committed=await client.rpc("commit_pet_private_delivery",{target_pet_id:pet.id,request_id:requestId,target_token:turn.token,expected_revision:turn.revision,reply_content:content,target_model_run_id:runId,reply_recall_sources:recallSources,evidence_ids:evidenceIds,manual_ids:manualIds,context_ids:contextIds,target_agent_request_id:agentRequestId,work_versions:workVersions,reminder_versions:reminderVersions});

    if(committed.error) throw committed.error;

    await client.from("pet_private_streams").update({status:"committed",content:"",updated_at:new Date().toISOString()}).eq("pet_id",pet.id).eq("request_id",requestId).eq("token",turn.token);

    claim=null;

    const reply=committed.data;

    // Optional bookkeeping cannot undo an already committed reply.

    runInBackground((async()=>{

      await client.from("pet_runtime_states").update({state:"speaking",source_id:reply.id,expires_at:new Date(Date.now()+8_000).toISOString(),updated_at:new Date().toISOString()}).eq("pet_id",pet.id).eq("source_id",turn.message_id);

      await finishModelRun(client,runId!,{status:"succeeded",startedAt});

      await client.from("profiles").update({last_active_at:new Date().toISOString()}).eq("id",user.id);

    })().catch(()=>undefined));

    if(mode==="companion"&&!input.image_asset_id) runInBackground(processMemoryJobs(client,pet.id,turn.message_id).catch(()=>undefined));

    const response=json(request,{...reply,target_space_name:targetSpaceName});
    if(recallTiming)console.info(JSON.stringify({event:"private_group_recall",...recallTiming,status:"succeeded"}));

    response.headers.set("Server-Timing",`context;dur=${modelStartedAt-startedAt},generation;dur=${modelFinishedAt-modelStartedAt},commit;dur=${Date.now()-modelFinishedAt}`);

    return response;

  } catch(reason){

    const detail=reason instanceof Error?reason.message:typeof reason==="object"&&reason&&"message" in reason?String(reason.message):"private_reply_failed";

    const errorCode=/^[a-z0-9_:]+$/.test(detail)?detail.slice(0,120):"private_reply_failed";
    if(recallTiming)console.info(JSON.stringify({event:"private_group_recall",...recallTiming,total_ms:Date.now()-startedAt,status:"failed",error_code:errorCode}));

    if(claim){

      await client.from("pet_private_streams").update({status:"failed",content:"",updated_at:new Date().toISOString()}).eq("pet_id",claim.petId).eq("request_id",claim.requestId).eq("token",claim.token).eq("status","streaming");

      await client.rpc("fail_pet_private_request",{target_pet_id:claim.petId,request_id:claim.requestId,target_token:claim.token,failure_code:errorCode});

      await client.from("pet_runtime_states").update({state:"idle",expires_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("pet_id",claim.petId).eq("source_id",claim.messageId);

    }

    if(runId&&claim) await finishModelRun(client,runId,{status:"failed",startedAt,errorCode});

    return errorResponse(request,new Error(errorCode));

  }

}



Deno.serve(async(request)=>{

  if(request.method==="OPTIONS")return optionsResponse(request);

  let wantsStream=false;

  try { const input=await request.clone().json();wantsStream=input.stream===true && input.mode==="companion"; } catch { return handlePetChat(request); }

  if(!wantsStream)return handlePetChat(request);

  const encoder=new TextEncoder();let connected=true;

  const stream=new ReadableStream<Uint8Array>({

    start(controller){

      const emit=(event:Record<string,unknown>)=>{if(connected)controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));};

      const work=handlePetChat(request,emit).then(async(response)=>{

        const result=await response.json();

        emit(response.ok?{type:"done",message:result}:{type:"error",error:result.error??"private_reply_failed"});

      }).catch(()=>emit({type:"error",error:"private_reply_failed"})).finally(()=>{if(connected){connected=false;controller.close();}});

      runInBackground(work);

    },

    cancel(){connected=false;},

  });

  return new Response(stream,{headers:{...corsHeaders(request),"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store","X-Accel-Buffering":"no"}});

});

