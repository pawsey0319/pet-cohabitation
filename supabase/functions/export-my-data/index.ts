import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

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
    const [memberships, messages, privateThread, signals, assets, experiences, evolutions, personalMemories, companionState] = await Promise.all([
      client.from("space_members").select("space_id,role,joined_at,spaces(name,kind,created_at)").eq("user_id", user.id),
      client.from("messages").select("id,space_id,actor_name,kind,text,media_duration_seconds,reply_to_message_id,created_at,deleted_at").eq("sender_id", user.id).order("created_at"),
      client.from("pet_private_threads").select("id,role,content,created_at").eq("owner_id", user.id).order("created_at"),
      client.from("pet_style_signals").select("id,tendency,rationale,source_kind,source_label,confidence,active,created_at").eq("owner_id", user.id).order("created_at"),
      client.from("pet_visual_assets").select("id,parent_asset_id,evolution_event_id,is_draft,created_at").eq("owner_id", user.id).order("created_at"),
      client.from("pet_experiences").select("id,category,summary,space_id,occurred_at").eq("owner_id", user.id).order("occurred_at"),
      client.from("pet_evolution_events").select("id,parent_asset_id,owner_blessing,experience_sources,style_snapshot,status,failed_attempts,official_asset_id,continuity_repair_used,created_at,completed_at").eq("owner_id", user.id).order("created_at"),
      client.from("pet_personal_memories").select("id,content,source_message_id,created_at,updated_at").eq("owner_id", user.id).order("created_at"),
      client.from("pet_companion_states").select("context_started_at,revision,updated_at").eq("owner_id", user.id).maybeSingle(),
    ]);
    for (const result of [memberships, messages, privateThread, signals, assets, experiences, evolutions, personalMemories, companionState]) if (result.error) throw result.error;
    const ownedPages = async (table: string, order: string) => {
      const rows: Record<string, unknown>[] = [];
      for (let offset=0;;offset+=500) {
        const page=await client.from(table).select("*").eq("owner_id",user.id).order(order).range(offset,offset+499);
        if(page.error) throw page.error;
        rows.push(...(page.data??[])); if((page.data?.length??0)<500) break;
      }
      return rows;
    };
    const [evidence,preferenceControls,memoryVersions,contextExclusions]=await Promise.all([
      ownedPages("pet_memory_evidence","id"),ownedPages("pet_preference_controls","preference_key"),
      ownedPages("pet_personal_memory_versions","id"),ownedPages("pet_private_context_exclusions","message_id"),
    ]);
    return json(request, {
      exported_at: new Date().toISOString(),
      profile: profile.data,
      pet: pet.data,
      memberships: memberships.data ?? [],
      authored_messages: messages.data ?? [],
      pet_private_thread: privateThread.data ?? [],
      style_signals: signals.data ?? [],
      visual_lineage: assets.data ?? [],
      experiences: experiences.data ?? [],
      evolution_events: evolutions.data ?? [],
      personal_memories: personalMemories.data ?? [],
      companion_state: companionState.data,
      preference_evidence: evidence,
      preference_controls: preferenceControls,
      manual_memory_versions: memoryVersions,
      excluded_private_context: contextExclusions,
    });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
