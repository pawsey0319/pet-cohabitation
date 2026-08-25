import { z } from "npm:zod@4";
import { triggerAutomaticEvolution } from "../_shared/autoEvolution.ts";
import { runInBackground } from "../_shared/background.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { sha256 } from "../_shared/hash.ts";
import { TextModelAdapter } from "../_shared/modelAdapters.ts";
import { buildPetRecallContext } from "../_shared/petRecall.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ content: z.string().trim().min(1).max(4000) });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  let runId: string | null = null; const startedAt = Date.now();
  try {
    requirePost(request); const user = await authenticatedUser(request); const input = Input.parse(await request.json()); const client = serviceClient();
    const { data: pet, error: petError } = await client.from("pets").select("id,name,status,personality_summary").eq("owner_id", user.id).single();
    if (petError) throw petError;
    const promptHash = await sha256(`${pet.id}:${input.content}`);
    runId = await reserveModelRun(client, { runKind: "pet_private_reply", dailyLimit: 50, ownerId: user.id, petId: pet.id, promptHash, model: TextModelAdapter.modelName() });
    const ownerInsert = await client.from("pet_private_threads").insert({ pet_id: pet.id, owner_id: user.id, role: "owner", content: input.content }).select("id").single();
    if (ownerInsert.error) throw ownerInsert.error;
    await client.from("pet_runtime_states").upsert({ pet_id: pet.id, owner_id: user.id, state: "thinking", source_kind: "private_chat", source_id: ownerInsert.data.id, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
    const { data: thread, error: threadError } = await client.from("pet_private_threads").select("role,content,created_at").eq("pet_id", pet.id).order("created_at", { ascending: false }).limit(20);
    if (threadError) throw threadError;
    const { data: signals } = await client.from("pet_style_signals").select("tendency,rationale").eq("pet_id", pet.id).eq("active", true).order("created_at", { ascending: false }).limit(10);
    const adapter = new TextModelAdapter();
    const recall = await buildPetRecallContext(client, { ownerId: user.id, petId: pet.id, question: input.content, adapter });
    const reply = await adapter.generatePetReply({
      petName: pet.name, personality: pet.personality_summary ?? "正在形成",
      styleSignals: (signals ?? []).map((signal) => `${signal.tendency}：${signal.rationale}`).join("；"),
      messages: [...recall.messages, ...(thread ?? []).reverse().map((message) => ({ actor: message.role === "owner" ? "主人" : pet.name, content: message.content }))],
      currentMessage: input.content, ownerPolicy: "pet_only", contextPolicy: "owner_private_cross_space",
    });
    const { data: inserted, error: insertError } = await client.from("pet_private_threads").insert({ pet_id: pet.id, owner_id: user.id, role: "pet", content: reply.content, model_run_id: runId, recall_sources: recall.sources }).select("id,content,created_at,recall_sources").single();
    if (insertError) throw insertError;
    await client.from("pet_runtime_states").upsert({ pet_id: pet.id, owner_id: user.id, state: "speaking", source_kind: "private_chat", source_id: inserted.id, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 8_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
    const ownerTurns = (thread ?? []).filter((message) => message.role === "owner").length;
    if (ownerTurns >= 3 && ownerTurns % 3 === 0) {
      try {
        const extracted = await adapter.extractStyleSignals({ ownerMessage: input.content, context: [...(thread ?? [])].reverse().map((message) => ({ actor: message.role, content: message.content })), sourceLabel: "异宠私聊" });
        if (extracted.length) await client.from("pet_style_signals").insert(extracted.map((signal) => ({ pet_id: pet.id, owner_id: user.id, source_kind: "pet_private", source_label: "异宠私聊", ...signal })));
      } catch { /* A style extraction failure must not hide the valid pet reply. */ }
    }
    if (pet.status === "confirmed") {
      await client.from("pet_experiences").insert({ pet_id: pet.id, owner_id: user.id, category: "shared", summary: `主人和${pet.name}聊了一段只属于彼此的话：${input.content.slice(0, 180)}`, interaction_key: `private:${ownerInsert.data.id}` });
      runInBackground(triggerAutomaticEvolution(client, pet.id).catch(() => null));
    }
    await client.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("id", user.id);
    await finishModelRun(client, runId, { status: "succeeded", startedAt });
    return json(request, { id: inserted.id, content: inserted.content, created_at: inserted.created_at, recall_sources: inserted.recall_sources ?? [] });
  } catch (reason) {
    if (runId) await finishModelRun(serviceClient(), runId, { status: "failed", startedAt, errorCode: reason instanceof Error ? reason.message.slice(0, 120) : "unknown" });
    return errorResponse(request, reason);
  }
});
