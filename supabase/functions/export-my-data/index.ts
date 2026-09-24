import { exportPetLearningData } from "../_shared/personalityLearning.ts";
import { readAccountPages } from "../_shared/dataPagination.ts";
import {exportVisionData} from "../_shared/visionData.ts";
import { exportMemoryEvolutionData } from "../_shared/companionMemoryEvolution.ts";
import { exportReminderData } from "../reminder-management/data.ts";
import { exportWorkData } from "../work-items/accountData.ts";
import { exportAvatarData } from "../_shared/avatarData.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { exportChatBackgroundData } from "../_shared/chatBackgroundData.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const client = serviceClient();
    const profile = await client.from("profiles").select("id,email,nickname,avatar_url,created_at,updated_at").eq("id", user.id).single();
    if (profile.error) throw profile.error;
    const pet = await client.from("pets").select("*").eq("owner_id", user.id).maybeSingle();
    if (pet.error) throw pet.error;
    const ownedPages = (table:string,key="id",ownerColumn="owner_id",select="*") => readAccountPages(client,table,user.id,{key,ownerColumn,select});
    const [memberships,messages,signals,assets,experiences,evolutions,personalMemories,companionState] = await Promise.all([
      ownedPages("space_members","space_id","user_id","space_id,role,joined_at,spaces(name,kind,created_at)"),
      ownedPages("messages","id","sender_id"),ownedPages("pet_style_signals"),ownedPages("pet_visual_assets"),
      ownedPages("pet_experiences"),ownedPages("pet_evolution_events"),ownedPages("pet_personal_memories"),
      client.from("pet_companion_states").select("context_started_at,revision,updated_at").eq("owner_id",user.id).maybeSingle(),
    ]);
    if(companionState.error) throw companionState.error;
    const [privateRequests,privateStreams,privateCancellations,extractionJobs,generationSessions,agentJobs] = await Promise.all([
      ownedPages("pet_private_requests","client_request_id"),ownedPages("pet_private_streams","request_id"),ownedPages("pet_private_cancellations","request_id"),
      ownedPages("pet_memory_extraction_jobs","source_message_id"),ownedPages("pet_generation_sessions"),ownedPages("agent_jobs","id","requested_by"),
    ]);
    const [evidence,preferenceControls,memoryVersions,contextExclusions,allPrivateMessages]=await Promise.all([
      ownedPages("pet_memory_evidence","id"),ownedPages("pet_preference_controls","preference_key"),
      ownedPages("pet_personal_memory_versions","id"),ownedPages("pet_private_context_exclusions","message_id"),ownedPages("pet_private_threads","id"),
    ]);
    const vision=await exportVisionData(client,user.id);
    const mediaMaintenance=await ownedPages("media_cleanup_jobs");
    const personalityLearning=await exportPetLearningData(client,user.id);
    const memoryEvolution=await exportMemoryEvolutionData(client,user.id);
    const work = await exportWorkData(client,user.id);
    const reminders = await exportReminderData(client,user.id);
    const avatars = await exportAvatarData(client,user.id);
    const chatBackgrounds = await exportChatBackgroundData(client, user.id);
    // Also retain legacy personal records and new durable request receipts.
    const accountOwned: Record<string, unknown[]> = {};
    for (const [table,column,cursor] of [
      ["pet_memories","owner_id","id"],["pet_style_feedback","owner_id","id"],
      ["pet_expectation_drafts","owner_id","pet_id"],["pet_runtime_states","owner_id","pet_id"],
      ["pet_memory_cursors","owner_id","space_id"],["scheduled_reminders","owner_id","id"],
      ["space_message_requests","owner_id","client_id"],["delegated_actions","owner_id","id"],
      ["agent_requests","requested_by","id"],["agent_message_feedback","user_id","id"],
      ["agent_proposal_votes","user_id","proposal_id"],["user_preferences","user_id","user_id"],
      ["model_runs","owner_id","id"],
      ["pet_delegation_grants","owner_id","id"],["pet_action_receipts","owner_id","id"],["pet_action_plans","owner_id","id"],
    ]) accountOwned[table] = await ownedPages(table,cursor,column);
    const available = await client.from("profiles").select("id").eq("id",user.id).maybeSingle();
    const blocked = await client.from("notification_owner_blocks").select("owner_id").eq("owner_id",user.id).maybeSingle();
    if (available.error || blocked.error || !available.data || blocked.data) throw new Error("account_deleting");
    return json(request, {
      account_owned_records:accountOwned,
      private_requests:privateRequests,private_streams:privateStreams,private_cancellations:privateCancellations,
      memory_extraction_jobs:extractionJobs,generation_sessions:generationSessions,requested_agent_jobs:agentJobs,
      vision,
      media_maintenance:mediaMaintenance,
      memory_evolution:memoryEvolution,
      personality_learning:personalityLearning,
      exported_at: new Date().toISOString(),
      profile: profile.data,
      pet: pet.data,
      memberships: memberships,
      authored_messages: messages,
      pet_private_thread: allPrivateMessages,
      style_signals: signals,
      visual_lineage: assets,
      experiences: experiences,
      evolution_events: evolutions,
      personal_memories: personalMemories,
      companion_state: companionState.data,
      preference_evidence: evidence,
      preference_controls: preferenceControls,
      manual_memory_versions: memoryVersions,
      excluded_private_context: contextExclusions,
      work, reminders, avatars, chat_backgrounds: chatBackgrounds,
    });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
