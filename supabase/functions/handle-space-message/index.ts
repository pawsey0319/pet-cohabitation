import { z } from "npm:zod@4";
import { triggerAutomaticEvolution } from "../_shared/autoEvolution.ts";
import { runInBackground } from "../_shared/background.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { loadDemoSettings } from "../_shared/demoSettings.ts";
import { sha256 } from "../_shared/hash.ts";
import { TextModelAdapter } from "../_shared/modelAdapters.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ message_id: z.string().uuid(), cue_pet_ids: z.array(z.string().uuid()).max(3).optional().default([]) });
const HIGH_RISK = /(见面|分手|复合|承诺|同意|立场|地址|位置|定位|生病|健康|医院|钱|转账|消费|购买|密码|身份证)/;

type Candidate = Readonly<{
  id: string;
  name: string;
  owner_id: string;
  personality_summary: string | null;
  ownerName: string;
  ownerLastActiveAt: string;
  implicit_cooldown_until: string | null;
}>;

function explicitCue(text: string, candidate: Candidate, replyPetId: string | null, selected: readonly string[]): boolean {
  return selected.includes(candidate.id) || replyPetId === candidate.id || text.includes(`@${candidate.name}`) || (text.includes(candidate.name) && /[?？]|你(觉得|会|能|想)/.test(text));
}

async function finishJob(jobId: string, result: unknown): Promise<void> {
  await serviceClient().from("agent_jobs").update({ status: "succeeded", result, completed_at: new Date().toISOString() }).eq("id", jobId);
}

async function runRouteJob(jobId: string, requestedBy: string, input: z.infer<typeof Input>): Promise<void> {
  const client = serviceClient();
  try {
    const currentJob = await client.from("agent_jobs").select("attempts,status").eq("id", jobId).single();
    if (currentJob.error) throw currentJob.error;
    if (currentJob.data.status === "succeeded") return;
    const claimed = await client.from("agent_jobs").update({ status: "running", started_at: new Date().toISOString(), attempts: Math.min(3, Number(currentJob.data.attempts) + 1), error_code: null }).eq("id", jobId).eq("status", "queued").select("id").maybeSingle();
    if (claimed.error) throw claimed.error;
    if (!claimed.data) return;
    const messageResult = await client.from("messages").select("id,space_id,sender_id,actor_kind,text,reply_to_message_id,created_at").eq("id", input.message_id).single();
    if (messageResult.error) throw messageResult.error;
    const message = messageResult.data;
    if (message.actor_kind !== "human" || !message.sender_id) throw new Error("only_human_messages_are_routed");
    const permissionResult = await client.from("space_pet_permissions").select("pet_id,participation_enabled,proactive_paused,paused_by_vote").eq("space_id", message.space_id);
    if (permissionResult.error) throw permissionResult.error;
    const petIds = (permissionResult.data ?? []).map((row) => row.pet_id);
    if (!petIds.length) {
      await finishJob(jobId, { selected: [], replied: [] });
      return;
    }

    const petResult = await client.from("pets").select("id,name,owner_id,personality_summary,implicit_cooldown_until").in("id", petIds);
    if (petResult.error) throw petResult.error;
    const ownerIds = [...new Set((petResult.data ?? []).map((pet) => pet.owner_id))];
    const ownerResult = await client.from("profiles").select("id,nickname,last_active_at").in("id", ownerIds);
    if (ownerResult.error) throw ownerResult.error;
    const ownerById = new Map((ownerResult.data ?? []).map((owner) => [owner.id, owner]));
    const allCandidates: Candidate[] = (petResult.data ?? []).map((pet) => ({ ...pet, ownerName: ownerById.get(pet.owner_id)?.nickname ?? "主人", ownerLastActiveAt: ownerById.get(pet.owner_id)?.last_active_at ?? "1970-01-01T00:00:00Z" }));
    const activeIds = new Set((permissionResult.data ?? []).filter((row) => row.participation_enabled && !row.proactive_paused && !row.paused_by_vote).map((row) => row.pet_id));
    const candidates = allCandidates.filter((candidate) => activeIds.has(candidate.id));
    const pausedCandidates = allCandidates.filter((candidate) => !activeIds.has(candidate.id));

    let replyPetId: string | null = null;
    if (message.reply_to_message_id) {
      const parent = await client.from("messages").select("actor_kind,actor_id").eq("id", message.reply_to_message_id).maybeSingle();
      if (parent.data?.actor_kind === "pet") replyPetId = parent.data.actor_id;
    }
    const text = message.text ?? "";
    if (pausedCandidates.some((candidate) => explicitCue(text, candidate, replyPetId, input.cue_pet_ids))) {
      const notice = await client.from("messages").insert({ client_id: `paused-${message.id}`, space_id: message.space_id, sender_id: null, actor_kind: "space_agent", actor_id: message.space_id, actor_name: "空间主 Agent", kind: "system", text: "当前异宠参与已暂停。空间成员仍可正常聊天，也可以在“观察授权”中查看或调整权限。", reply_to_message_id: message.id, reply_preview: text.slice(0, 160), permission_source: "pet_participation_paused" });
      if (notice.error && notice.error.code !== "23505") throw notice.error;
    }

    const explicitCandidates = candidates.filter((candidate) => explicitCue(text, candidate, replyPetId, input.cue_pet_ids)).slice(0, 3);
    let selected: Array<Candidate & { explicit: boolean }> = explicitCandidates.map((candidate) => ({ ...candidate, explicit: true }));
    const settings = await loadDemoSettings(client);
    if (!selected.length && settings.implicit_pet_replies_enabled) {
      const available = candidates.filter((candidate) => !candidate.implicit_cooldown_until || candidate.implicit_cooldown_until <= new Date().toISOString());
      if (available.length) {
        const started = Date.now();
        const promptHash = await sha256(JSON.stringify({ text, candidates: available.map(({ id, name, ownerName }) => ({ id, name, ownerName })) }));
        const runId = await reserveModelRun(client, { runKind: "relevance_route", dailyLimit: 100, spaceId: message.space_id, promptHash, model: TextModelAdapter.modelName() });
        try {
          const selectedIds = await new TextModelAdapter().routePetRelevance({ message: text, candidates: available.map((candidate) => ({ petId: candidate.id, petName: candidate.name, ownerName: candidate.ownerName })) });
          selected = available.filter((candidate) => selectedIds.includes(candidate.id)).slice(0, 1).map((candidate) => ({ ...candidate, explicit: false }));
          await finishModelRun(client, runId, { status: "succeeded", startedAt: started });
        } catch (reason) {
          await finishModelRun(client, runId, { status: "failed", startedAt: started, errorCode: reason instanceof Error ? reason.message : "router_error" });
        }
      }
    }

    const recentRows = await client.from("messages").select("actor_name,text,kind").eq("space_id", message.space_id).order("created_at", { ascending: false }).limit(20);
    if (recentRows.error) throw recentRows.error;
    const recent = [...(recentRows.data ?? [])].reverse().map((row) => ({ actor: row.actor_name, content: row.text ?? `[${row.kind}]` }));
    const replied: string[] = [];
    let failedReplies = 0;
    for (const candidate of selected) {
      const concernsOwner = text.includes(candidate.ownerName);
      const ownerOnline = Date.now() - Date.parse(candidate.ownerLastActiveAt) <= 5 * 60_000;
      const highRisk = concernsOwner && HIGH_RISK.test(text);
      if (!candidate.explicit && concernsOwner && (ownerOnline || highRisk)) continue;
      const replyKind = candidate.explicit ? "explicit_pet_reply" : "implicit_pet_reply";
      const started = Date.now();
      const promptHash = await sha256(`${candidate.id}:${message.id}:${concernsOwner ? "owner" : "pet"}`);
      const runId = await reserveModelRun(client, { runKind: replyKind, dailyLimit: candidate.explicit ? 30 : 10, ownerId: candidate.owner_id, spaceId: message.space_id, petId: candidate.id, promptHash, model: TextModelAdapter.modelName() });
      const petJob = await client.from("agent_jobs").insert({ job_kind: replyKind, scope_kind: "pet", scope_id: candidate.id, requested_by: requestedBy, source_message_id: message.id, status: "running", started_at: new Date().toISOString(), attempts: 1, input: { explicit: candidate.explicit } }).select("id").single();
      let petJobId = petJob.data?.id as string | undefined;
      if (petJob.error?.code === "23505") {
        const existingPetJob = await client.from("agent_jobs").select("id,status,attempts").eq("job_kind", replyKind).eq("source_message_id", message.id).eq("scope_id", candidate.id).single();
        if (existingPetJob.error) throw existingPetJob.error;
        if (existingPetJob.data.status === "succeeded") {
          await finishModelRun(client, runId, { status: "blocked", startedAt: started, errorCode: "reply_already_succeeded" });
          replied.push(candidate.id);
          continue;
        }
        if (existingPetJob.data.status !== "failed" || existingPetJob.data.attempts >= 2) {
          await finishModelRun(client, runId, { status: "blocked", startedAt: started, errorCode: "reply_retry_not_available" });
          failedReplies += 1;
          continue;
        }
        const requeued = await client.from("agent_jobs").update({ status: "running", attempts: existingPetJob.data.attempts + 1, started_at: new Date().toISOString(), completed_at: null, error_code: null }).eq("id", existingPetJob.data.id).eq("status", "failed").select("id").maybeSingle();
        if (requeued.error) throw requeued.error;
        if (!requeued.data) {
          await finishModelRun(client, runId, { status: "blocked", startedAt: started, errorCode: "reply_retry_claimed_elsewhere" });
          continue;
        }
        petJobId = requeued.data.id;
      }
      if (petJob.error && petJob.error.code !== "23505") {
        await finishModelRun(client, runId, { status: "failed", startedAt: started, errorCode: petJob.error.message });
        throw petJob.error;
      }
      if (!petJobId) throw new Error("pet_reply_job_missing");
      const policy = concernsOwner ? (ownerOnline || highRisk ? "wait_for_owner" : "guess_low_risk") : "pet_only";
      const signals = await client.from("pet_style_signals").select("tendency,rationale").eq("pet_id", candidate.id).eq("active", true).limit(10);
      try {
        await client.from("pet_runtime_states").upsert({ pet_id: candidate.id, owner_id: candidate.owner_id, state: "thinking", source_kind: "space_chat", source_id: petJobId, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
        const reply = await new TextModelAdapter().generatePetReply({ petName: candidate.name, personality: candidate.personality_summary ?? "正在形成", styleSignals: (signals.data ?? []).map((signal) => `${signal.tendency}：${signal.rationale}`).join("；"), messages: recent, currentMessage: text, ownerPolicy: policy });
        const content = policy === "wait_for_owner" && !/主人|本人|自己/.test(reply.content) ? `这件事要等主人本人回答。${reply.content}` : reply.content;
        const inserted = await client.from("messages").insert({ client_id: `agent-${petJobId}`, space_id: message.space_id, sender_id: null, actor_kind: "pet", actor_id: candidate.id, actor_name: candidate.name, kind: "text", text: content, reply_to_message_id: message.id, reply_preview: text.slice(0, 160), permission_source: candidate.explicit ? "explicit_pet_cue" : "implicit_relevance_router" }).select("id").single();
        if (inserted.error) throw inserted.error;
        await client.from("pet_runtime_states").upsert({ pet_id: candidate.id, owner_id: candidate.owner_id, state: "speaking", source_kind: "space_chat", source_id: inserted.data.id, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 8_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
        const experience = await client.from("pet_experiences").insert({ pet_id: candidate.id, owner_id: candidate.owner_id, space_id: message.space_id, category: "social", summary: `${candidate.name}在关系空间里认真参与了一次对话：${content.slice(0, 180)}`, source_message_id: message.id, interaction_key: `space-reply:${petJobId}` });
        if (!experience.error) runInBackground(triggerAutomaticEvolution(client, candidate.id).catch(() => null));
        if (!candidate.explicit) await client.from("pets").update({ implicit_cooldown_until: new Date(Date.now() + 10 * 60_000).toISOString() }).eq("id", candidate.id);
        await client.from("agent_jobs").update({ status: "succeeded", result: { replied: true, policy }, completed_at: new Date().toISOString() }).eq("id", petJobId);
        await finishModelRun(client, runId, { status: "succeeded", startedAt: started });
        replied.push(candidate.id);
      } catch (reason) {
        await client.from("pet_runtime_states").upsert({ pet_id: candidate.id, owner_id: candidate.owner_id, state: "idle", source_kind: "system", source_id: null, started_at: new Date().toISOString(), expires_at: null, updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
        const errorCode = reason instanceof Error ? reason.message.slice(0, 120) : "reply_error";
        await client.from("agent_jobs").update({ status: "failed", error_code: errorCode, completed_at: new Date().toISOString() }).eq("id", petJobId);
        await finishModelRun(client, runId, { status: "failed", startedAt: started, errorCode });
        failedReplies += 1;
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
    if (failedReplies > 0 && selected.some((item) => item.explicit) && replied.length === 0) {
      await client.from("agent_jobs").update({ status: "failed", error_code: "pet_reply_failed", result: { selected: selected.map((item) => item.id), replied }, completed_at: new Date().toISOString() }).eq("id", jobId);
      return;
    }
    await finishJob(jobId, { selected: selected.map((item) => item.id), replied });
  } catch (reason) {
    await client.from("agent_jobs").update({ status: "failed", error_code: reason instanceof Error ? reason.message.slice(0, 120) : "routing_error", completed_at: new Date().toISOString() }).eq("id", jobId);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const caller = await authenticatedUser(request);
    const input = Input.parse(await request.json());
    const client = serviceClient();
    const message = await client.from("messages").select("space_id,sender_id,actor_kind").eq("id", input.message_id).single();
    if (message.error) throw message.error;
    if (message.data.actor_kind !== "human" || !message.data.sender_id) throw new Error("only_human_messages_are_routed");
    const membership = await client.rpc("is_space_member", { target_space_id: message.data.space_id, target_user_id: caller.id });
    if (membership.error || !membership.data) throw new Error("not_space_member");
    const inserted = await client.from("agent_jobs").insert({ job_kind: "route_space_pets", scope_kind: "space", scope_id: message.data.space_id, requested_by: caller.id, source_message_id: input.message_id, status: "queued", input }).select("id,status").single();
    if (inserted.error?.code === "23505") {
      const existing = await client.from("agent_jobs").select("id,status,attempts").eq("job_kind", "route_space_pets").eq("source_message_id", input.message_id).eq("scope_id", message.data.space_id).single();
      if (existing.error) throw existing.error;
      if ((existing.data.status === "failed" || existing.data.status === "blocked") && existing.data.attempts < 3) {
        const requeued = await client.from("agent_jobs").update({ status: "queued", error_code: null, completed_at: null }).eq("id", existing.data.id).in("status", ["failed", "blocked"]).select("id").maybeSingle();
        if (requeued.error) throw requeued.error;
        if (requeued.data) {
          runInBackground(runRouteJob(existing.data.id, caller.id, input));
          return json(request, { job_id: existing.data.id, status: "queued", duplicate: true }, 202);
        }
        const refreshed = await client.from("agent_jobs").select("status").eq("id", existing.data.id).single();
        if (refreshed.error) throw refreshed.error;
        return json(request, { job_id: existing.data.id, status: refreshed.data.status, duplicate: true }, 202);
      }
      return json(request, { job_id: existing.data.id, status: existing.data.status, duplicate: true }, 202);
    }
    if (inserted.error) throw inserted.error;
    runInBackground(runRouteJob(inserted.data.id, caller.id, input));
    return json(request, { job_id: inserted.data.id, status: "queued" }, 202);
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
