import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fallbackRecallAnswer, isUninformativeRecall } from "./answerQuality.ts";
import { RECALL_RESPONSE_BUDGET_MS, TextModelAdapter } from "./modelAdapters.ts";
import { buildPetRecallContext } from "./petRecall.ts";
import { recallSpaceMatches } from "./petRecallQuery.ts";

type Space = { id:string;name:string;joinedAt:string };
/** Model-selected names cannot supply missing user intent. Ambiguous aliases require clarification. */
export function resolveStewardSpace(content:string,spaces:readonly Space[],explicitSpaceId?:string):Space|null {
 const exact=spaces.filter(space=>space.name&&content.includes(space.name));
 if(exact.length)return exact.length===1?exact[0]:null;
 const aliases=spaces.filter(space=>recallSpaceMatches(content,space.name));
 if(aliases.length)return aliases.length===1?aliases[0]:null;
 return explicitSpaceId?spaces.find(space=>space.id===explicitSpaceId)??null:null;
}

export async function generateStewardReply(client:SupabaseClient,args:{
 ownerId:string;pet:{id:string;name:string;personality_summary:string|null};content:string;ownerMessageId:string;
 // Kept for old callers; private conversation content is never sent to the steward model.
 thread:{id:string;role:string;content:string;created_at:string}[];explicitSpaceId?:string;
 setReplyStatus(phase:"classifying"|"retrieving"|"thinking"):Promise<void>;
 setModel?(model:string):Promise<void>;
},dependencies:{adapter?:TextModelAdapter;recall?:typeof buildPetRecallContext}={}) {
 const adapter=dependencies.adapter??new TextModelAdapter();
 const assertSource=async()=>{
  const source=await client.from("pet_private_threads").select("id,content,reply_error_code").eq("id",args.ownerMessageId).eq("owner_id",args.ownerId).eq("pet_id",args.pet.id).eq("role","owner").maybeSingle();
  if(source.error)throw source.error;
  const excluded=await client.from("pet_private_context_exclusions").select("message_id").eq("message_id",args.ownerMessageId).maybeSingle();
  if(excluded.error)throw excluded.error;
  if(!source.data||excluded.data||source.data.content!==args.content)throw new Error("steward_source_excluded");
  if(source.data.reply_error_code==="private_request_stopped")throw new Error("private_request_stopped");
 };
 await assertSource();
 const memberships=await client.from("space_members").select("space_id,joined_at,spaces!inner(name)").eq("user_id",args.ownerId);
 if(memberships.error)throw memberships.error;
 const spaces=(memberships.data??[]).map((row:Record<string,unknown>)=>{const space=Array.isArray(row.spaces)?row.spaces[0]:row.spaces;return{id:String(row.space_id),joinedAt:String(row.joined_at),name:String((space as {name?:string}|null)?.name??"")};});
 const target=resolveStewardSpace(args.content,spaces,args.explicitSpaceId);
 const finish=async(content:string)=>{await assertSource();await args.setReplyStatus("thinking");return{content,recallSources:[],agentRequestId:null,targetSpaceName:target?.name??null};};
 const possibleAction=/代发|帮我发|替我发|发到|创建|新建|添加|安排.{0,8}(?:待办|任务|日程)|提醒我|设置提醒|到点提醒|制定.{0,8}计划|计划一下/.test(args.content);
 if(possibleAction){
  const intent=await adapter.planPetManagerAction({message:args.content,spaces:target?[{name:target.name}]:[]});
  if(intent.mode!=="query"){
   if(intent.request_kind==="personal_reminder")return finish("可以在“异宠”陪伴入口说出提醒内容和时间，那里会显示可查看和修改的真实提醒回执。");
   if(!target)return finish("你想操作哪个群？请告诉我群名。");
   if(intent.mode==="clarify")return finish(intent.clarification??"请补充要逐字发送的内容。");
   if(intent.request_kind==="delegated_message"){
    if(!intent.exact_content||!args.content.includes(intent.exact_content))return finish("请给出要逐字代发的原文，例如“发到旅行群：我周六下午有空”。");
    const preview=await client.rpc("prepare_steward_preview",{p_owner:args.ownerId,p_pet:args.pet.id,p_request:args.ownerMessageId,p_source:args.ownerMessageId,p_space:target.id,p_exact:intent.exact_content});
    if(preview.error)throw preview.error;
    return finish(preview.data.status==="confirmed"?`已按你的确认发布到“${target.name}”。可在代发卡片查看原消息。`:preview.data.status==="dismissed"?"这份代发预览已取消。":`待你确认后才会发到“${target.name}”：\n${intent.exact_content}\n\n请在下方代发卡片确认；旧版本请更新后操作。`);
   }
   // Old group-task/reminder routes published proposal notices before owner preview.
   return finish("请在“异宠”陪伴入口提出这个事项，并写明群名；那里可以编辑安排、确认发布，再由相关成员回应。");
  }
 }
 if(!target)return finish("你想查哪个群的消息？请告诉我群名。");
 const assertScope=async()=>{const member=await client.from("space_members").select("joined_at").eq("space_id",target.id).eq("user_id",args.ownerId).maybeSingle();if(member.error)throw member.error;if(!member.data||member.data.joined_at!==target.joinedAt)throw new Error("not_space_member");await assertSource();};
 await assertScope();await args.setReplyStatus("retrieving");
 const recall=await(dependencies.recall??buildPetRecallContext)(client,{ownerId:args.ownerId,petId:args.pet.id,question:args.content,adapter,requiredSpaceId:target.id});
 await assertScope();
 if(!recall.messages.length)return finish(`在“${target.name}”本次可查询的记录中，没有找到相关内容。可以换一个关键词或日期。`);
 await args.setReplyStatus("thinking");
 const model=TextModelAdapter.recallModelName();await args.setModel?.(model);
 const input={petName:args.pet.name,personality:"群消息管家：简洁、准确，以实际消息为依据。",styleSignals:"",messages:recall.messages,currentMessage:args.content,ownerPolicy:"pet_only",contextPolicy:"owner_private_cross_space",responseStyle:"concise",model,deadlineAt:Date.now()+RECALL_RESPONSE_BUDGET_MS,coverageNote:recall.coverage?.note} as const;
 let reply=await adapter.generatePetReply(input);
 if(isUninformativeRecall(reply.content,true)&&Date.now()<input.deadlineAt){await assertScope();if(Date.now()<input.deadlineAt)reply=await adapter.generatePetReply({...input,requireDirectRecall:true});}
 await assertScope();
 return{content:isUninformativeRecall(reply.content,true)?fallbackRecallAnswer(recall.messages):reply.content,recallSources:recall.sources,agentRequestId:null,targetSpaceName:target.name};
}
