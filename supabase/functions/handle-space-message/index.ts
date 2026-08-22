import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { sha256 } from "../_shared/hash.ts";
import { TextModelAdapter } from "../_shared/modelAdapters.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ message_id: z.string().uuid(), cue_pet_ids: z.array(z.string().uuid()).max(3).optional().default([]) });
const HIGH_RISK = /(见面|分手|复合|承诺|同意|立场|地址|位置|定位|生病|健康|医院|钱|转账|消费|购买|密码|身份证)/;

type Candidate = Readonly<{
  id: string; name: string; owner_id: string; personality_summary: string | null;
  ownerName: string; ownerLastActiveAt: string; implicit_cooldown_until: string | null;
}>;

function explicitCue(text: string, candidate: Candidate, replyPetId: string | null, selected: readonly string[]): boolean {
  return selected.includes(candidate.id) || replyPetId === candidate.id || text.includes(`@${candidate.name}`) || (text.includes(candidate.name) && /[?？]|你(觉得|会|能|想)/.test(text));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  let routeJobId: string | null = null;
  try {
    requirePost(request); const caller = await authenticatedUser(request); const input = Input.parse(await request.json()); const client = serviceClient();
    const { data: message, error: messageError } = await client.from("messages").select("id,space_id,sender_id,actor_kind,text,reply_to_message_id,created_at").eq("id", input.message_id).single();
    if (messageError) throw messageError; if (message.actor_kind !== "human" || !message.sender_id) throw new Error("only_human_messages_are_routed");
    const membership = await client.rpc("is_space_member", { target_space_id: message.space_id, target_user_id: caller.id });
    if (membership.error || !membership.data) throw new Error("not_space_member");
    const { data: routeJob, error: jobError } = await client.from("agent_jobs").insert({ job_kind: "route_space_pets", scope_kind: "space", scope_id: message.space_id, requested_by: caller.id, source_message_id: message.id, status: "running", input }).select("id").single();
    if (jobError?.code === "23505") return json(request, { accepted: true, duplicate: true });
    if (jobError) throw jobError; routeJobId = routeJob.id;
    const { data: permissionRows, error: permissionError } = await client.from("space_pet_permissions").select("pet_id,participation_enabled,proactive_paused,paused_by_vote").eq("space_id", message.space_id);
    if (permissionError) throw permissionError;
    const petIds = (permissionRows ?? []).map((row) => row.pet_id);
    if (!petIds.length) { await client.from("agent_jobs").update({ status: "succeeded", result: { selected: [] }, completed_at: new Date().toISOString() }).eq("id", routeJobId); return json(request, { accepted: true, selected: [] }); }
    const { data: pets, error: petError } = await client.from("pets").select("id,name,owner_id,personality_summary,implicit_cooldown_until").in("id", petIds);
    if (petError) throw petError;
    const ownerIds = [...new Set((pets ?? []).map((pet) => pet.owner_id))];
    const { data: owners, error: ownerError } = await client.from("profiles").select("id,nickname,last_active_at").in("id", ownerIds); if (ownerError) throw ownerError;
    const ownerById = new Map((owners ?? []).map((owner) => [owner.id, owner]));
    const allCandidates: Candidate[] = (pets ?? []).map((pet) => ({ ...pet, ownerName: ownerById.get(pet.owner_id)?.nickname ?? "主人", ownerLastActiveAt: ownerById.get(pet.owner_id)?.last_active_at ?? "1970-01-01T00:00:00Z" }));
    const activeIds = new Set((permissionRows ?? []).filter((row) => row.participation_enabled && !row.proactive_paused && !row.paused_by_vote).map((row) => row.pet_id));
    const candidates = allCandidates.filter((candidate) => activeIds.has(candidate.id));
    const pausedCandidates = allCandidates.filter((candidate) => !activeIds.has(candidate.id));
    let replyPetId: string | null = null;
    if (message.reply_to_message_id) {
      const parent = await client.from("messages").select("actor_kind,actor_id").eq("id", message.reply_to_message_id).maybeSingle();
      if (parent.data?.actor_kind === "pet") replyPetId = parent.data.actor_id;
    }
    const text = message.text ?? "";
    const pausedCue = pausedCandidates.some((candidate) => explicitCue(text, candidate, replyPetId, input.cue_pet_ids));
    if (pausedCue) {
      const notice = await client.from("messages").insert({ client_id: `paused-${message.id}`, space_id: message.space_id, sender_id: null, actor_kind: "space_agent", actor_id: message.space_id, actor_name: "空间主 Agent", kind: "system", text: "当前异宠参与已暂停。空间成员仍可正常聊天，也可以在“观察授权”中查看或调整权限。", reply_to_message_id: message.id, reply_preview: text.slice(0, 160), permission_source: "pet_participation_paused" });
      if (notice.error) throw notice.error;
    }
    const explicitCandidates = candidates.filter((candidate) => explicitCue(text, candidate, replyPetId, input.cue_pet_ids)).slice(0, 3);
    let selected: Array<Candidate & { explicit: boolean }> = explicitCandidates.map((candidate) => ({ ...candidate, explicit: true }));
    if (!selected.length) {
      const available = candidates.filter((candidate) => !candidate.implicit_cooldown_until || candidate.implicit_cooldown_until <= new Date().toISOString());
      if (available.length) {
        const started = Date.now(); const promptHash = await sha256(JSON.stringify({ text, candidates: available.map(({ id, name, ownerName }) => ({ id, name, ownerName })) }));
        const runId = await reserveModelRun(client, { runKind: "relevance_route", dailyLimit: 100, spaceId: message.space_id, promptHash, model: TextModelAdapter.modelName() });
        try {
          const selectedIds = await new TextModelAdapter().routePetRelevance({ message: text, candidates: available.map((candidate) => ({ petId: candidate.id, petName: candidate.name, ownerName: candidate.ownerName })) });
          selected = available.filter((candidate) => selectedIds.includes(candidate.id)).slice(0, 1).map((candidate) => ({ ...candidate, explicit: false }));
          await finishModelRun(client, runId, { status: "succeeded", startedAt: started });
        } catch (reason) { await finishModelRun(client, runId, { status: "failed", startedAt: started, errorCode: reason instanceof Error ? reason.message : "router_error" }); }
      }
    }
    const { data: recentRows } = await client.from("messages").select("actor_name,text,kind").eq("space_id", message.space_id).order("created_at", { ascending: false }).limit(20);
    const recent = [...(recentRows ?? [])].reverse().map((row) => ({ actor: row.actor_name, content: row.text ?? `[${row.kind}]` }));
    const replied: string[] = [];
    for (const candidate of selected) {
      const concernsOwner = text.includes(candidate.ownerName);
      const ownerOnline = Date.now() - Date.parse(candidate.ownerLastActiveAt) <= 5 * 60_000;
      const highRisk = concernsOwner && HIGH_RISK.test(text);
      if (!candidate.explicit && concernsOwner && (ownerOnline || highRisk)) continue;
      const replyKind = candidate.explicit ? "explicit_pet_reply" : "implicit_pet_reply";
      const limit = candidate.explicit ? 30 : 10;
      const promptHash = await sha256(`${candidate.id}:${message.id}:${concernsOwner ? "owner" : "pet"}`); const started = Date.now();
      const runId = await reserveModelRun(client, { runKind: replyKind, dailyLimit: limit, ownerId: candidate.owner_id, spaceId: message.space_id, petId: candidate.id, promptHash, model: TextModelAdapter.modelName() });
      const { data: petJob, error: petJobError } = await client.from("agent_jobs").insert({ job_kind: replyKind, scope_kind: "pet", scope_id: candidate.id, requested_by: caller.id, source_message_id: message.id, status: "running", input: { explicit: candidate.explicit } }).select("id").single();
      if (petJobError?.code === "23505") { await finishModelRun(client, runId, { status: "blocked", startedAt: started, errorCode: "duplicate_agent_job" }); continue; }
      if (petJobError) { await finishModelRun(client, runId, { status: "failed", startedAt: started, errorCode: petJobError.message }); throw petJobError; }
      const policy = concernsOwner ? (ownerOnline || highRisk ? "wait_for_owner" : "guess_low_risk") : "pet_only";
      const { data: signals } = await client.from("pet_style_signals").select("tendency,rationale").eq("pet_id", candidate.id).eq("active", true).limit(10);
      try {
        const reply = await new TextModelAdapter().generatePetReply({ petName: candidate.name, personality: candidate.personality_summary ?? "正在形成", styleSignals: (signals ?? []).map((signal) => `${signal.tendency}：${signal.rationale}`).join("；"), messages: recent, currentMessage: text, ownerPolicy: policy });
        const content = policy === "wait_for_owner" && !/主人|本人|自己/.test(reply.content) ? `这件事要等主人本人回答。${reply.content}` : reply.content;
        await client.from("messages").insert({ client_id: `agent-${petJob.id}`, space_id: message.space_id, sender_id: null, actor_kind: "pet", actor_id: candidate.id, actor_name: candidate.name, kind: "text", text: content, reply_to_message_id: message.id, reply_preview: text.slice(0, 160), permission_source: candidate.explicit ? "explicit_pet_cue" : "implicit_relevance_router" });
        if (!candidate.explicit) await client.from("pets").update({ implicit_cooldown_until: new Date(Date.now() + 10 * 60_000).toISOString() }).eq("id", candidate.id);
        await client.from("agent_jobs").update({ status: "succeeded", result: { replied: true, policy }, completed_at: new Date().toISOString() }).eq("id", petJob.id);
        await finishModelRun(client, runId, { status: "succeeded", startedAt: started }); replied.push(candidate.id);
      } catch (reason) {
        await client.from("agent_jobs").update({ status: "failed", error_code: reason instanceof Error ? reason.message.slice(0, 120) : "reply_error", completed_at: new Date().toISOString() }).eq("id", petJob.id);
        await finishModelRun(client, runId, { status: "failed", startedAt: started, errorCode: reason instanceof Error ? reason.message : "reply_error" });
      }
    }
    const senderPet = candidates.find((candidate) => candidate.owner_id === message.sender_id);
    if (senderPet) {
      const consent = await client.rpc("is_observation_enabled", { target_space_id: message.space_id, target_pet_id: senderPet.id });
      if (!consent.error && consent.data) {
        try {
          const extracted = await new TextModelAdapter().extractStyleSignals({ ownerMessage: text, context: recent, sourceLabel: "已获全体同意的关系空间" });
          if (extracted.length) await client.from("pet_style_signals").insert(extracted.map((signal) => ({ pet_id: senderPet.id, owner_id: senderPet.owner_id, source_kind: "space", source_space_id: message.space_id, source_label: "已授权关系空间", observed_after: message.created_at, ...signal })));
        } catch { /* Observation must never block chat or pet replies. */ }
      }
    }
    await client.from("agent_jobs").update({ status: "succeeded", result: { selected: selected.map((item) => item.id), replied }, completed_at: new Date().toISOString() }).eq("id", routeJobId);
    return json(request, { accepted: true, selected: selected.map((item) => item.id), replied });
  } catch (reason) {
    if (routeJobId) await serviceClient().from("agent_jobs").update({ status: "failed", error_code: reason instanceof Error ? reason.message.slice(0, 120) : "routing_error", completed_at: new Date().toISOString() }).eq("id", routeJobId);
    return errorResponse(request, reason);
  }
});
