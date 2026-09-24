import { z } from "npm:zod@4";
import { triggerAutomaticEvolution } from "../_shared/autoEvolution.ts";
import { runInBackground } from "../_shared/background.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { sha256 } from "../_shared/hash.ts";
import { processMemoryJobs } from "../_shared/memoryWorker.ts";
import { scorePreference, selectPreferences, type PreferenceFacts } from "../_shared/preferenceMemory.ts";
import { TextModelAdapter } from "../_shared/modelAdapters.ts";
import { buildPetRecallContext } from "../_shared/petRecall.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ content: z.string().trim().min(1).max(4000), request_id: z.string().uuid().optional() });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  let runId: string | null = null; let requestClaim: { petId:string;requestId:string;token:string } | null = null; const startedAt = Date.now();
  try {
    requirePost(request); const user = await authenticatedUser(request); const input = Input.parse(await request.json()); const client = serviceClient();
    const { data: pet, error: petError } = await client.from("pets").select("id,name,status,personality_summary").eq("owner_id", user.id).single();
    if (petError) throw petError;
    const requestId = input.request_id ?? crypto.randomUUID();
    const ownerInsert = await client.rpc("claim_pet_private_request", {target_pet_id:pet.id,request_id:requestId,owner_content:input.content});
    if(ownerInsert.error) throw ownerInsert.error;
    if(ownerInsert.data.reply_id) {
      const existing=await client.from("pet_private_threads").select("id,content,created_at,recall_sources").eq("id",ownerInsert.data.reply_id).eq("pet_id",pet.id).single();
      if(existing.error) throw existing.error;
      runInBackground(processMemoryJobs(client,pet.id).catch(()=>undefined));
      return json(request,existing.data);
    }
    const turn=ownerInsert.data as {message_id:string;created_at:string;revision:number;context_started_at:string|null;token:string};
    requestClaim={petId:pet.id,requestId,token:turn.token};
    const promptHash = await sha256(`${pet.id}:${input.content}`);
    runId = await reserveModelRun(client, { runKind: "pet_private_reply", dailyLimit: 50, ownerId: user.id, petId: pet.id, promptHash, model: TextModelAdapter.modelName() });
    await client.from("pet_runtime_states").upsert({ pet_id: pet.id, owner_id: user.id, state: "thinking", source_kind: "private_chat", source_id: turn.message_id, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
    let threadQuery = client.from("pet_private_threads").select("id,role,content,created_at,context_message_ids").eq("pet_id", pet.id).lte("created_at", turn.created_at).order("created_at", { ascending: false }).limit(20);
    if (turn.context_started_at) threadQuery = threadQuery.gte("created_at", turn.context_started_at);
    const { data: rawThread, error: threadError } = await threadQuery;
    const [excluded, preferenceFacts] = await Promise.all([client.rpc("get_pet_excluded_message_ids",{target_pet_id:pet.id}),client.rpc("get_pet_preference_facts",{target_pet_id:pet.id})]);
    if(excluded.error) throw excluded.error; if(preferenceFacts.error) throw preferenceFacts.error;
    const excludedIds = new Set<string>(excluded.data??[]);
    const thread=(rawThread??[]).filter((row)=>!excludedIds.has(row.id) && (row.role==="owner" || row.context_message_ids?.length));
    if(threadError) throw threadError;
    if(!thread.some((row)=>row.id===turn.message_id)) throw new Error("private_request_topic_changed");
    const preferences=((preferenceFacts.data??[]) as PreferenceFacts[]).map((fact)=>scorePreference(fact));
    const selectedPreferences=selectPreferences(preferences,input.content);
    let signalQuery = client.from("pet_style_signals").select("tendency,rationale,source_message_ids").eq("pet_id", pet.id).eq("active", true).order("created_at", { ascending: false }).limit(10);
    if (turn.context_started_at) signalQuery = signalQuery.gte("created_at", turn.context_started_at);
    const { data: signals, error: signalError } = await signalQuery;
    if (signalError) throw signalError;
    const { data: loadedMemories, error: memoryError } = await client.from("pet_personal_memories").select("id,content,updated_at,source_message_id").eq("pet_id", pet.id).eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(20);
    if (memoryError) throw memoryError;
    const personalMemories=(loadedMemories??[]).filter((item)=>!item.source_message_id || !excludedIds.has(item.source_message_id));
    const adapter = new TextModelAdapter();
    const recall = await buildPetRecallContext(client, { ownerId: user.id, petId: pet.id, question: input.content, adapter });
    const safeSignals=(signals??[]).filter((signal)=>signal.source_message_ids?.length && !signal.source_message_ids.some((id:string)=>excludedIds.has(id)));
    const reply = await adapter.generatePrivateCompanionReply({
      petName: pet.name, personality: pet.personality_summary ?? "正在形成",
      styles: safeSignals.map((signal) => `${signal.tendency}：${signal.rationale}`),
      memories: personalMemories ?? [], recalledMessages: recall.messages,
      messages: [...thread].reverse(), contextStartedAt: turn.context_started_at, preferences, excludedMessageIds:[...excludedIds],
    });
    const { data: inserted, error: insertError } = await client.rpc("commit_pet_private_request", { target_pet_id: pet.id, request_id:requestId, target_token:turn.token, expected_revision: turn.revision, reply_content: reply.content, target_model_run_id: runId, reply_recall_sources: recall.sources, evidence_ids:selectedPreferences.map((item)=>item.latestEvidenceId), manual_ids:(personalMemories??[]).map((item)=>item.id), context_ids:[...new Set([...thread.map((item)=>item.id),...safeSignals.flatMap((signal)=>signal.source_message_ids)])] });
    if (insertError) throw insertError;
    await client.from("pet_runtime_states").upsert({ pet_id: pet.id, owner_id: user.id, state: "speaking", source_kind: "private_chat", source_id: inserted.id, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 8_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
    runInBackground(processMemoryJobs(client,pet.id,turn.message_id).catch(()=>undefined));
    const ownerTurns = (thread ?? []).filter((message) => message.role === "owner").length;
    if (ownerTurns >= 3 && ownerTurns % 3 === 0) {
      runInBackground((async()=>{try {
        const extracted = await adapter.extractStyleSignals({ ownerMessage: input.content, context: [...(thread ?? [])].reverse().map((message) => ({ actor: message.role, content: message.content })), sourceLabel: "异宠私聊" });
        if (extracted.length) await client.from("pet_style_signals").insert(extracted.map((signal) => ({ pet_id: pet.id, owner_id: user.id, source_kind: "pet_private", source_label: "异宠私聊", source_message_ids:thread.map((item)=>item.id), created_at: turn.created_at, ...signal })));
      } catch { /* A style extraction failure must not hide the valid pet reply. */ }})());
    }
    if (pet.status === "confirmed") {
      await client.from("pet_experiences").insert({ pet_id: pet.id, owner_id: user.id, category: "shared", summary: `主人和${pet.name}聊了一段只属于彼此的话：${input.content.slice(0, 180)}`, interaction_key: `private:${turn.message_id}` });
      runInBackground(triggerAutomaticEvolution(client, pet.id).catch(() => null));
    }
    await client.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("id", user.id);
    await finishModelRun(client, runId, { status: "succeeded", startedAt });
    return json(request, { id: inserted.id, content: inserted.content, created_at: inserted.created_at, recall_sources: inserted.recall_sources ?? [] });
  } catch (reason) {
    if(requestClaim) await serviceClient().rpc("fail_pet_private_request",{target_pet_id:requestClaim.petId,request_id:requestClaim.requestId,target_token:requestClaim.token});
    if (runId) await finishModelRun(serviceClient(), runId, { status: "failed", startedAt, errorCode: reason instanceof Error ? reason.message.slice(0, 120) : "unknown" });
    return errorResponse(request, reason);
  }
});
