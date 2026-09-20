import { z } from "npm:zod@4";
import { triggerAutomaticEvolution } from "./autoEvolution.ts";
import { runInBackground } from "./background.ts";
import { sha256 } from "./hash.ts";
import { TextModelAdapter } from "./modelAdapters.ts";
import { finishModelRun, reserveModelRun } from "./quota.ts";
import { serviceClient } from "./supabase.ts";

const Input = z.object({ message_id: z.string().uuid(), cue_pet_ids: z.array(z.string().uuid()).max(3).optional().default([]) });
const HIGH_RISK = /(见面|分手|复合|承诺|同意|立场|地址|位置|定位|生病|健康|医院|钱|转账|消费|购买|密码|身份证)/;

type PetInteraction = Readonly<{ state: "happy" | "eating" | "playing" | "sleeping"; category: "care" | "social" | "shared"; label: string; durationSeconds: number }>;

function explicitPetInteraction(text: string): PetInteraction | null {
  if (/(投喂|喂你|给你.{0,12}(吃|苹果|零食|点心|食物)|吃点)/.test(text)) return { state: "eating", category: "care", label: "收到了一次投喂", durationSeconds: 12 };
  if (/(陪我?玩|一起玩|玩一会|做游戏|玩游戏)/.test(text)) return { state: "playing", category: "social", label: "和成员玩了一会儿", durationSeconds: 12 };
  if (/(摸摸|抱抱|抱一下|陪陪|陪我|安慰)/.test(text)) return { state: "happy", category: "care", label: "收到了一次陪伴", durationSeconds: 10 };
  if (/(早点休息|去休息|睡觉吧|晚安|好好睡)/.test(text)) return { state: "sleeping", category: "shared", label: "在成员的关心下进入休息状态", durationSeconds: 30 };
  return null;
}

type Candidate = Readonly<{
  id: string;
  name: string;
  owner_id: string;
  personality_summary: string | null;
  implicit_cooldown_until: string | null;
}>;

function explicitCue(text: string, candidate: Candidate, replyPetId: string | null, selected: readonly string[]): boolean {
  return selected.includes(candidate.id) || replyPetId === candidate.id || text.includes(`@${candidate.name}`) || (text.includes(candidate.name) && /[?？]|你(觉得|会|能|想)/.test(text));
}

async function finishJob(client: ReturnType<typeof serviceClient>, jobId: string, token: string, result: unknown): Promise<void> {
  await client.from("agent_jobs").update({ lease_until: null, status: "succeeded", stage: "completed", progress_label: "已完成", retryable: false, result, completed_at: new Date().toISOString() }).eq("id", jobId).eq("lease_token", token);
}

export async function runSpaceRouteJob(jobId: string, requestedBy: string, input: z.infer<typeof Input>, dependencies: { client?: ReturnType<typeof serviceClient>; adapter?: Pick<TextModelAdapter, "generatePetReply" | "extractStyleSignals"> } = {}): Promise<void> {
  const client = dependencies.client ?? serviceClient();
  const adapter = dependencies.adapter ?? new TextModelAdapter();
  const routeStarted = Date.now();
  let firstReplyMs: number | null = null;
  let token = "";
  try {
    const claimed = await client.rpc("claim_space_route_job", {p_job_id:jobId});
    if (claimed.error) throw claimed.error;
    if (!claimed.data) return;
    token=claimed.data.lease_token;
    requestedBy=claimed.data.requested_by;
    input={message_id:claimed.data.source_message_id,cue_pet_ids:claimed.data.input?.cue_pet_ids ?? []};
    const ensureLease = async () => {
      const checked=await client.rpc("check_space_route_lease",{p_job_id:jobId,p_token:token});
      if(checked.error || !checked.data) throw new Error("space_route_lease_changed");
    };
    const messageResult = await client.from("messages").select("id,space_id,sender_id,actor_kind,text,reply_to_message_id,created_at,deleted_at").eq("id", input.message_id).single();
    if (messageResult.error) throw messageResult.error;
    const message = messageResult.data;
    if (message.deleted_at) throw new Error("source_message_deleted");
    const membership = await client.rpc("is_space_member", { target_space_id: message.space_id, target_user_id: requestedBy });
    if (membership.error || !membership.data) throw new Error("not_space_member");
    if (message.actor_kind !== "human" || !message.sender_id) throw new Error("only_human_messages_are_routed");
    const [structuredMentions, permissionResult, parent] = await Promise.all([
      client.from("message_mentions").select("target_pet_id").eq("message_id", message.id).not("target_pet_id", "is", null),
      client.from("space_pet_permissions").select("pet_id,participation_enabled,proactive_paused,paused_by_vote").eq("space_id", message.space_id),
      message.reply_to_message_id
        ? client.from("messages").select("actor_kind,actor_id").eq("id", message.reply_to_message_id).eq("space_id", message.space_id).is("deleted_at", null).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    for (const result of [structuredMentions, permissionResult, parent]) if (result.error) throw result.error;
    const selectedPetIds = [...new Set([...input.cue_pet_ids, ...(structuredMentions.data ?? []).map((row) => row.target_pet_id).filter(Boolean)])];
    const replyPetId = parent.data?.actor_kind === "pet" ? parent.data.actor_id : null;
    const petIds = (permissionResult.data ?? []).map((row) => row.pet_id);
    if (!petIds.length) {
      await finishJob(client, jobId, token, { selected: [], replied: [] });
      return;
    }

    const petResult = await client.from("pets").select("id,name,owner_id,personality_summary,implicit_cooldown_until").in("id", petIds);
    if (petResult.error) throw petResult.error;
    const allCandidates: Candidate[] = petResult.data ?? [];
    const activeIds = new Set((permissionResult.data ?? []).filter((row) => row.participation_enabled && !row.proactive_paused && !row.paused_by_vote).map((row) => row.pet_id));
    const candidates = allCandidates.filter((candidate) => activeIds.has(candidate.id));
    const pausedCandidates = allCandidates.filter((candidate) => !activeIds.has(candidate.id));

    const text = message.text ?? "";
    if (pausedCandidates.some((candidate) => explicitCue(text, candidate, replyPetId, selectedPetIds))) {
      await ensureLease();
      const notice = await client.from("messages").insert({ client_id: `paused-${message.id}`, space_id: message.space_id, sender_id: null, actor_kind: "space_agent", actor_id: message.space_id, actor_name: "空间主 Agent", kind: "system", text: "当前异宠参与已暂停。空间成员仍可正常聊天，也可以在“观察授权”中查看或调整权限。", reply_to_message_id: message.id, reply_preview: text.slice(0, 160), permission_source: "pet_participation_paused" });
      if (notice.error && notice.error.code !== "23505") throw notice.error;
    }

    const explicitCandidates = candidates.filter((candidate) => explicitCue(text, candidate, replyPetId, selectedPetIds)).slice(0, 3);
    const selected: Array<Candidate & { explicit: boolean }> = explicitCandidates.map((candidate) => ({ ...candidate, explicit: true }));
    // Publish the routing decision before even waiting for observation consent.
    // A paused pet cue must not look like a pending reply during slow observation.
    const progress = await client.from("agent_jobs").update({ input: { ...claimed.data.input, reply_pet_ids: selected.map((candidate) => candidate.id) } }).eq("id", jobId).eq("lease_token", token).eq("status", "running");
    if (progress.error) throw progress.error;

    const senderPet = candidates.find((candidate) => candidate.owner_id === message.sender_id);
    const consentPromise = senderPet
      ? client.rpc("is_observation_enabled", { target_space_id: message.space_id, target_pet_id: senderPet.id })
      : Promise.resolve({ data: false, error: null });
    // Explicit replies do not wait for observation. Ordinary chat only needs
    // context when observation is authorized; work suggestions use their own batch.
    const consent = selected.length ? null : await consentPromise;
    if (!selected.length && (!consent?.data || consent.error)) {
      await finishJob(client, jobId, token, { selected: [], replied: [], timing_ms: { total: Date.now() - routeStarted } });
      return;
    }
    const ownerIds = [...new Set(selected.map((candidate) => candidate.owner_id))];
    const [ownerResult, recentRows] = await Promise.all([
      ownerIds.length ? client.from("profiles").select("id,nickname,last_active_at").in("id", ownerIds) : Promise.resolve({ data: [], error: null }),
      client.from("messages").select("actor_name,text,kind").eq("space_id", message.space_id).is("deleted_at", null).order("created_at", { ascending: false }).limit(20),
    ]);
    for (const result of [ownerResult, recentRows]) if (result.error) throw result.error;
    const ownerById = new Map((ownerResult.data ?? []).map((owner) => [owner.id, owner]));
    const recent = [...(recentRows.data ?? [])].reverse().map((row) => ({ actor: row.actor_name, content: row.text ?? `[${row.kind}]` }));
    const preparationMs = Date.now() - routeStarted;
    const replied: string[] = [];
    let failedReplies = 0;
    const outcomes = await Promise.allSettled(selected.map(async (candidate) => {
      await ensureLease();
      const interaction = candidate.explicit ? explicitPetInteraction(text) : null;
      const owner = ownerById.get(candidate.owner_id);
      const concernsOwner = text.includes(owner?.nickname ?? "主人");
      const ownerOnline = Date.now() - Date.parse(owner?.last_active_at ?? "1970-01-01T00:00:00Z") <= 5 * 60_000;
      const highRisk = concernsOwner && HIGH_RISK.test(text);
      if (!candidate.explicit && concernsOwner && (ownerOnline || highRisk)) return;
      const replyKind = candidate.explicit ? "explicit_pet_reply" : "implicit_pet_reply";
      const started = Date.now();
      const promptHash = await sha256(`${candidate.id}:${message.id}:${concernsOwner ? "owner" : "pet"}`);
      // Only group replies opt into this request-scoped model configuration.
      // Other adapters and authorized observation retain TEXT_MODEL unchanged.
      const replyModel = Deno.env.get("GROUP_TEXT_MODEL")?.trim() || TextModelAdapter.modelName();
      const runId = await reserveModelRun(client, { runKind: replyKind, dailyLimit: candidate.explicit ? 30 : 10, ownerId: candidate.owner_id, spaceId: message.space_id, petId: candidate.id, promptHash, model: replyModel });
      const petJob = await client.from("agent_jobs").insert({ job_kind: replyKind, scope_kind: "pet", scope_id: candidate.id, requested_by: requestedBy, source_message_id: message.id, lease_token: token, status: "running", stage: "calling_model", progress_label: `${candidate.name}正在思考`, provider_checked_at: new Date().toISOString(), idempotency_key: `${replyKind}:${message.id}:${candidate.id}`, started_at: new Date().toISOString(), attempts: 1, input: { explicit: candidate.explicit } }).select("id").single();
      let petJobId = petJob.data?.id as string | undefined;
      if (petJob.error?.code === "23505") {
        const existingPetJob = await client.from("agent_jobs").select("id,status,attempts,lease_token").eq("job_kind", replyKind).eq("source_message_id", message.id).eq("scope_id", candidate.id).single();
        if (existingPetJob.error) throw existingPetJob.error;
        if (existingPetJob.data.status === "succeeded") {
          await finishModelRun(client, runId, { status: "blocked", startedAt: started, errorCode: "reply_already_succeeded" });
          replied.push(candidate.id);
          return;
        }
        if ((!["failed","running"].includes(existingPetJob.data.status)) || existingPetJob.data.attempts >= 3) {
          await finishModelRun(client, runId, { status: "blocked", startedAt: started, errorCode: "reply_retry_not_available" });
          failedReplies += 1;
          return;
        }
        const requeued = await client.from("agent_jobs").update({ lease_token: token, status: "running", stage: "calling_model", progress_label: `${candidate.name}正在重新思考`, attempts: existingPetJob.data.attempts + 1, started_at: new Date().toISOString(), completed_at: null, error_code: null }).eq("id", existingPetJob.data.id).eq("status", existingPetJob.data.status).select("id").maybeSingle();
        if (requeued.error) throw requeued.error;
        if (!requeued.data) {
          await finishModelRun(client, runId, { status: "blocked", startedAt: started, errorCode: "reply_retry_claimed_elsewhere" });
          return;
        }
        petJobId = requeued.data.id;
      }
      if (petJob.error && petJob.error.code !== "23505") {
        await finishModelRun(client, runId, { status: "failed", startedAt: started, errorCode: petJob.error.message });
        throw petJob.error;
      }
      if (!petJobId) throw new Error("pet_reply_job_missing");
      if (interaction) {
        const interactionExperience = await client.from("pet_experiences").insert({
          pet_id: candidate.id,
          owner_id: candidate.owner_id,
          space_id: message.space_id,
          category: interaction.category,
          summary: `${candidate.name}${interaction.label}：${text.slice(0, 180)}`,
          source_message_id: message.id,
          interaction_key: `space-interaction:${message.id}:${candidate.id}`,
        });
        if (!interactionExperience.error) runInBackground(triggerAutomaticEvolution(client, candidate.id).catch(() => null));
        else if (interactionExperience.error.code !== "23505") throw interactionExperience.error;
      }
      const policy = concernsOwner ? (ownerOnline || highRisk ? "wait_for_owner" : "guess_low_risk") : "pet_only";
      try {
        const [signals] = await Promise.all([
          client.from("pet_style_signals").select("tendency,rationale").eq("pet_id", candidate.id).eq("source_kind", "space").eq("source_space_id", message.space_id).eq("active", true).limit(10),
          client.from("pet_runtime_states").upsert({ pet_id: candidate.id, owner_id: candidate.owner_id, state: "thinking", source_kind: "space_chat", source_id: petJobId, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "pet_id" }),
          client.from("agent_jobs").update({ stage: "calling_model", progress_label: selected.length === 1 ? `${candidate.name}正在思考` : "异宠正在思考…" }).eq("id", jobId).eq("lease_token", token).eq("status", "running"),
        ]);
        if (signals.error) throw signals.error;
        const modelStarted = Date.now();
        const reply = await adapter.generatePetReply({ petName: candidate.name, personality: candidate.personality_summary ?? "正在形成", styleSignals: (signals.data ?? []).map((signal) => `${signal.tendency}：${signal.rationale}`).join("；"), messages: recent, currentMessage: text, ownerPolicy: policy, model: replyModel });
        const content = policy === "wait_for_owner" && !/主人|本人|自己/.test(reply.content) ? `这件事要等主人本人回答。${reply.content}` : reply.content;
        const modelMs = Date.now() - modelStarted;
        const commitStarted = Date.now();
        const committed = await client.rpc("commit_space_pet_reply",{p_job_id:jobId,p_token:token,p_pet_job_id:petJobId,p_pet_id:candidate.id,p_content:content,p_explicit:candidate.explicit});
        if (committed.error) throw committed.error;
        const toReplyMs = Date.now() - routeStarted;
        firstReplyMs ??= toReplyMs;
        const commitMs = Date.now() - commitStarted;
        const inserted = {data:{id:committed.data}};
        await client.from("pet_runtime_states").upsert({ pet_id: candidate.id, owner_id: candidate.owner_id, state: interaction?.state ?? "speaking", source_kind: "space_chat", source_id: inserted.data.id, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + (interaction?.durationSeconds ?? 8) * 1_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
        if (!interaction) {
          const experience = await client.from("pet_experiences").insert({ pet_id: candidate.id, owner_id: candidate.owner_id, space_id: message.space_id, category: "social", summary: `${candidate.name}在关系空间里认真参与了一次对话：${content.slice(0, 180)}`, source_message_id: message.id, interaction_key: `space-reply:${petJobId}` });
          if (!experience.error) runInBackground(triggerAutomaticEvolution(client, candidate.id).catch(() => null));
        }
        if (!candidate.explicit) await client.from("pets").update({ implicit_cooldown_until: new Date(Date.now() + 10 * 60_000).toISOString() }).eq("id", candidate.id);
        await client.from("agent_jobs").update({ lease_until: null, status: "succeeded", stage: "completed", progress_label: "异宠已回应", retryable: false, result: { replied: true, policy, timing_ms: { model: modelMs, commit: commitMs, to_reply: toReplyMs } }, completed_at: new Date().toISOString() }).eq("id", petJobId).eq("lease_token",token);
        await finishModelRun(client, runId, { status: "succeeded", startedAt: started });
        replied.push(candidate.id);
      } catch (reason) {
        await client.from("pet_runtime_states").upsert({ pet_id: candidate.id, owner_id: candidate.owner_id, state: interaction?.state ?? "idle", source_kind: interaction ? "space_chat" : "system", source_id: interaction ? message.id : null, started_at: new Date().toISOString(), expires_at: interaction ? new Date(Date.now() + interaction.durationSeconds * 1_000).toISOString() : null, updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
        const errorCode = reason instanceof Error ? reason.message.slice(0, 120) : "reply_error";
        await client.from("agent_jobs").update({ lease_until: null, status: "failed", stage: "failed", progress_label: "异宠回应失败，可手动重试", retryable: true, error_code: errorCode, completed_at: new Date().toISOString() }).eq("id", petJobId).eq("lease_token",token);
        await finishModelRun(client, runId, { status: "failed", startedAt: started, errorCode });
        failedReplies += 1;
      }
    }));
    failedReplies += outcomes.filter((outcome) => outcome.status === "rejected").length;

    if (senderPet) {
      const consent = await consentPromise;
      if (!consent.error && consent.data) {
        try {
          const extracted = await adapter.extractStyleSignals({ ownerMessage: text, context: recent, sourceLabel: "已获全体同意的关系空间" });
          await ensureLease();
          const stillConsented=await client.rpc("is_observation_enabled",{target_space_id:message.space_id,target_pet_id:senderPet.id});
          if (extracted.length && !stillConsented.error && stillConsented.data) await client.from("pet_style_signals").insert(extracted.map((signal) => ({ pet_id: senderPet.id, owner_id: senderPet.owner_id, source_kind: "space", source_space_id: message.space_id, source_label: "已授权关系空间", observed_after: message.created_at, ...signal })));
        } catch { /* Observation must never block chat or pet replies. */ }
      }
    }
    if (failedReplies > 0 && selected.some((item) => item.explicit)) {
      await client.from("agent_jobs").update({ lease_until: null, status: "failed", stage: "failed", progress_label: "异宠回应失败，可手动重试", retryable: true, error_code: "pet_reply_failed", result: { selected: selected.map((item) => item.id), replied }, completed_at: new Date().toISOString() }).eq("id", jobId).eq("lease_token", token);
      return;
    }
    await finishJob(client, jobId, token, { selected: selected.map((item) => item.id), replied, timing_ms: { preparation: preparationMs, first_reply: firstReplyMs, total: Date.now() - routeStarted } });
  } catch (reason) {
    await client.from("agent_jobs").update({ lease_until: null, status: "failed", stage: "failed", progress_label: "处理失败，可手动重试", retryable: true, error_code: reason instanceof Error ? reason.message.slice(0, 120) : "routing_error", completed_at: new Date().toISOString() }).eq("id", jobId).eq("lease_token", token);
  }
}

