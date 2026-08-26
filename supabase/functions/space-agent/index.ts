import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { assertAgentWorkbenchAllowed } from "../_shared/demoSettings.ts";
import { sha256 } from "../_shared/hash.ts";
import { TextModelAdapter } from "../_shared/modelAdapters.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ request_id: z.string().uuid().optional(), proposal_id: z.string().uuid().optional() })
  .refine((value) => Boolean(value.request_id) !== Boolean(value.proposal_id));
const PROPOSAL_KINDS = new Set(["group_task", "group_plan", "group_schedule", "group_reminder"]);

function scheduledTime(text: string): string | null {
  const explicit = text.match(/(20\d{2}-\d{1,2}-\d{1,2})[ T日]*(\d{1,2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})?/);
  if (!explicit) return null;
  const datePart = explicit[1].split("-").map((part, index) => index ? part.padStart(2, "0") : part).join("-");
  const zone = explicit[4] ? explicit[4].replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : "+08:00";
  const parsed = new Date(`${datePart}T${explicit[2].padStart(2, "0")}:${explicit[3]}:00${zone}`);
  return Number.isNaN(parsed.valueOf()) || parsed <= new Date() ? null : parsed.toISOString();
}

async function messagesForMember(client: ReturnType<typeof serviceClient>, spaceId: string, userId: string) {
  const membership = await client.from("space_members").select("joined_at").eq("space_id", spaceId).eq("user_id", userId).single();
  if (membership.error) throw new Error("not_space_member");
  const rows = await client.from("messages").select("actor_name,actor_kind,text,kind,created_at")
    .eq("space_id", spaceId).gte("created_at", membership.data.joined_at).order("created_at", { ascending: false }).limit(150);
  if (rows.error) throw rows.error;
  return [...(rows.data ?? [])].reverse().map((row) => ({
    actor: `${row.actor_name}${row.actor_kind === "pet" ? "（异宠，不代表主人承诺）" : ""}`,
    content: row.text ?? `[${row.kind}]`,
  }));
}

async function executeApprovedProposal(client: ReturnType<typeof serviceClient>, proposalId: string, callerId: string) {
  const proposalResult = await client.from("agent_proposals").select("*,agent_requests(*)").eq("id", proposalId).single();
  if (proposalResult.error) throw proposalResult.error;
  const proposal = proposalResult.data;
  const request = Array.isArray(proposal.agent_requests) ? proposal.agent_requests[0] : proposal.agent_requests;
  const member = await client.rpc("is_space_member", { target_space_id: proposal.space_id, target_user_id: callerId });
  if (member.error || !member.data) throw new Error("not_space_member");
  if (proposal.status === "executed") return { status: "completed", request_id: request.id };
  if (proposal.status !== "approved" || request.status !== "approved") throw new Error("proposal_not_approved");
  if (proposal.expires_at <= new Date().toISOString()) throw new Error("proposal_expired");
  if (proposal.affected_user_ids?.length) {
    const currentAffected = await client.from("space_members").select("user_id").eq("space_id", proposal.space_id).in("user_id", proposal.affected_user_ids);
    if (currentAffected.error) throw currentAffected.error;
    if ((currentAffected.data ?? []).length !== proposal.affected_user_ids.length) {
      await client.from("agent_proposals").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", proposal.id);
      await client.from("agent_requests").update({ status: "rejected", review_reason: "被安排成员已离开空间，请重新发起", updated_at: new Date().toISOString() }).eq("id", request.id);
      return { status: "rejected", request_id: request.id };
    }
  }
  const claimed = await client.from("agent_requests").update({ status: "executing", updated_at: new Date().toISOString() })
    .eq("id", request.id).eq("status", "approved").select("id").maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return { status: request.status, request_id: request.id };

  const publication = String(proposal.proposal_content?.publication ?? proposal.proposal_content?.summary ?? request.user_input);
  if (request.request_kind === "group_reminder") {
    const reminderTime = String(proposal.proposal_content?.scheduled_for ?? "");
    if (!reminderTime) throw new Error("scheduled_time_required");
    const reminder = await client.from("scheduled_reminders").insert({ request_id: request.id, owner_id: request.requested_by, space_id: proposal.space_id, reminder_kind: "group", content: publication, scheduled_for: reminderTime, idempotency_key: `reminder:${request.id}` }).select("id").single();
    if (reminder.error && reminder.error.code !== "23505") throw reminder.error;
    await client.from("agent_proposals").update({ status: "executed", updated_at: new Date().toISOString() }).eq("id", proposal.id);
    await client.from("agent_requests").update({ status: "completed", result: { text: `群提醒已安排在 ${reminderTime}` }, updated_at: new Date().toISOString() }).eq("id", request.id);
    return { status: "completed", request_id: request.id, reminder_id: reminder.data?.id };
  }
  const clientId = `agent-proposal-${proposal.id}`;
  const inserted = await client.from("messages").insert({
    client_id: clientId, space_id: proposal.space_id, sender_id: null, actor_kind: "space_agent",
    actor_id: proposal.space_id, actor_name: "空间主 Agent", kind: "system", text: publication,
    permission_source: `approved_${request.request_kind}`,
  }).select("id").single();
  if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
  const existing = inserted.data ? null : await client.from("messages").select("id").eq("client_id", clientId).eq("space_id", proposal.space_id).single();
  if (existing?.error) throw existing.error;
  const messageId = inserted.data?.id ?? existing?.data?.id;
  await client.from("agent_proposals").update({ status: "executed", updated_at: new Date().toISOString() }).eq("id", proposal.id);
  await client.from("agent_requests").update({ status: "completed", final_message_id: messageId, result: { text: publication }, updated_at: new Date().toISOString() }).eq("id", request.id);
  return { status: "completed", request_id: request.id, message_id: messageId };
}

async function processRequest(client: ReturnType<typeof serviceClient>, requestId: string, callerId: string) {
  const requestResult = await client.from("agent_requests").select("*").eq("id", requestId).single();
  if (requestResult.error) throw requestResult.error;
  const request = requestResult.data;
  if (request.requested_by !== callerId) throw new Error("request_not_owned");
  if (["completed", "voting", "withdrawn", "expired", "rejected"].includes(request.status)) return { request_id: request.id, status: request.status };
  if (request.space_id) {
    const member = await client.rpc("is_space_member", { target_space_id: request.space_id, target_user_id: callerId });
    if (member.error || !member.data) throw new Error("not_space_member");
  }
  const job = await client.from("agent_jobs").insert({
    job_kind: `agent_request_${request.request_kind}`, scope_kind: request.space_id ? "space" : "user",
    scope_id: request.space_id ?? callerId, requested_by: callerId, status: "running", input: { request_id: request.id },
  }).select("id").single();
  if (job.error) throw job.error;
  await client.from("agent_requests").update({ status: "reviewing", updated_at: new Date().toISOString() }).eq("id", request.id);

  if (request.request_kind === "delegated_message") {
    if (!request.exact_content || !request.space_id) throw new Error("delegated_message_requires_exact_content");
    const profile = await client.from("profiles").select("nickname").eq("id", callerId).single();
    if (profile.error) throw profile.error;
    const clientId = `delegated-${request.id}`;
    const inserted = await client.from("messages").insert({
      client_id: clientId, space_id: request.space_id, sender_id: callerId, actor_kind: "human", actor_id: null,
      actor_name: profile.data.nickname, kind: "text", text: request.exact_content, permission_source: "pet_delegated_exact",
      delegated_by_pet_id: request.pet_id, delegation_request_id: request.id,
    }).select("id").single();
    if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    const existing = inserted.data ? null : await client.from("messages").select("id").eq("client_id", clientId).eq("sender_id", callerId).single();
    if (existing?.error) throw existing.error;
    const messageId = inserted.data?.id ?? existing?.data?.id;
    await client.from("agent_requests").update({ status: "completed", review_decision: "approved", final_message_id: messageId, result: { text: request.exact_content }, updated_at: new Date().toISOString() }).eq("id", request.id);
    await client.from("agent_jobs").update({ status: "succeeded", result: { message_id: messageId }, completed_at: new Date().toISOString() }).eq("id", job.data.id);
    return { request_id: request.id, status: "completed", message_id: messageId };
  }

  if (request.request_kind === "personal_reminder") {
    const reminderTime = scheduledTime(request.user_input);
    if (!reminderTime) {
      await client.from("agent_requests").update({ status: "needs_clarification", review_decision: "needs_clarification", review_reason: "请补充明确时间，例如 2026-08-30 19:30", updated_at: new Date().toISOString() }).eq("id", request.id);
      await client.from("agent_jobs").update({ status: "succeeded", result: { clarification: "scheduled_for" }, completed_at: new Date().toISOString() }).eq("id", job.data.id);
      return { request_id: request.id, status: "needs_clarification" };
    }
    const reminder = await client.from("scheduled_reminders").insert({ request_id: request.id, owner_id: callerId, reminder_kind: "personal", content: request.user_input, scheduled_for: reminderTime, idempotency_key: `reminder:${request.id}` }).select("id").single();
    if (reminder.error && reminder.error.code !== "23505") throw reminder.error;
    await client.from("agent_requests").update({ status: "completed", review_decision: "approved", result: { text: `个人提醒已安排在 ${reminderTime}` }, updated_at: new Date().toISOString() }).eq("id", request.id);
    await client.from("agent_jobs").update({ status: "succeeded", result: { reminder_id: reminder.data?.id }, completed_at: new Date().toISOString() }).eq("id", job.data.id);
    return { request_id: request.id, status: "completed", reminder_id: reminder.data?.id };
  }

  if (PROPOSAL_KINDS.has(request.request_kind)) {
    const reminderTime = request.request_kind === "group_reminder" ? scheduledTime(request.user_input) : null;
    if (request.request_kind === "group_reminder" && !reminderTime) {
      await client.from("agent_requests").update({ status: "needs_clarification", review_decision: "needs_clarification", review_reason: "群提醒需要明确时间，例如 2026-08-30 19:30", updated_at: new Date().toISOString() }).eq("id", request.id);
      await client.from("agent_jobs").update({ status: "succeeded", result: { clarification: "scheduled_for" }, completed_at: new Date().toISOString() }).eq("id", job.data.id);
      return { request_id: request.id, status: "needs_clarification" };
    }
    const members = await client.from("space_members").select("user_id").eq("space_id", request.space_id);
    if (members.error || !members.data.length) throw members.error ?? new Error("space_has_no_members");
    const snapshot = members.data.map((item) => item.user_id);
    const profiles = await client.from("profiles").select("id,nickname").in("id", snapshot);
    if (profiles.error) throw profiles.error;
    const namedAffected = (profiles.data ?? []).filter((profile) => profile.id !== callerId && request.user_input.includes(profile.nickname)).map((profile) => profile.id);
    const explicitAffected = Array.isArray(request.structured_intent?.affected_user_ids) ? request.structured_intent.affected_user_ids : [];
    const affected = [...new Set([...namedAffected, ...explicitAffected])].filter((id) => snapshot.includes(id));
    const proposal = await client.from("agent_proposals").insert({
      request_id: request.id, space_id: request.space_id, created_by: callerId, title: request.user_input.slice(0, 80),
      proposal_content: { summary: request.user_input, publication: request.user_input, scheduled_for: reminderTime, request_kind: request.request_kind }, member_snapshot: snapshot,
      affected_user_ids: affected,
      required_approvals: Math.floor(snapshot.length / 2) + 1,
    }).select("id").single();
    if (proposal.error?.code !== "23505" && proposal.error) throw proposal.error;
    await client.from("agent_requests").update({ status: "voting", review_decision: "approved", result: { text: "已形成提案，等待成员投票" }, updated_at: new Date().toISOString() }).eq("id", request.id);
    await client.from("agent_jobs").update({ status: "succeeded", result: { proposal_id: proposal.data?.id }, completed_at: new Date().toISOString() }).eq("id", job.data.id);
    return { request_id: request.id, status: "voting", proposal_id: proposal.data?.id };
  }

  const messages = await messagesForMember(client, request.space_id, callerId);
  if (!messages.length) throw new Error("no_messages_to_analyze");
  const adapter = new TextModelAdapter();
  const startedAt = Date.now();
  const promptHash = await sha256(JSON.stringify({ request: request.user_input, messages }));
  const runId = await reserveModelRun(client, { runKind: request.request_kind, dailyLimit: 30, spaceId: request.space_id, promptHash, model: TextModelAdapter.modelName() });
  try {
    const result = request.request_kind === "read_summary"
      ? await adapter.summarizeSpace({ messages })
      : await adapter.answerSpaceQuery({ question: request.user_input, messages });
    const text = "answer" in result ? result.answer : [
      result.summary,
      result.confirmed.length ? `已确认：${result.confirmed.join("；")}` : "",
      result.pending_people.length ? `待确认：${result.pending_people.join("；")}` : "",
    ].filter(Boolean).join("\n");
    await client.from("agent_requests").update({ status: "completed", review_decision: "approved", result: { text, detail: result }, updated_at: new Date().toISOString() }).eq("id", request.id);
    await client.from("agent_jobs").update({ status: "succeeded", result, completed_at: new Date().toISOString() }).eq("id", job.data.id);
    await finishModelRun(client, runId, { status: "succeeded", startedAt });
    return { request_id: request.id, status: "completed", text };
  } catch (reason) {
    await finishModelRun(client, runId, { status: "failed", startedAt, errorCode: reason instanceof Error ? reason.message : "agent_request_failed" });
    throw reason;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  let requestId: string | null = null;
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const input = Input.parse(await request.json());
    const client = serviceClient();
    await assertAgentWorkbenchAllowed(client);
    if (input.proposal_id) return json(request, await executeApprovedProposal(client, input.proposal_id, user.id));
    requestId = input.request_id ?? null;
    return json(request, await processRequest(client, input.request_id!, user.id));
  } catch (reason) {
    if (requestId) await serviceClient().from("agent_requests").update({
      status: "failed", review_reason: reason instanceof Error ? reason.message.slice(0, 240) : "agent_request_failed", updated_at: new Date().toISOString(),
    }).eq("id", requestId).not("status", "in", '(completed,withdrawn,expired,rejected)');
    return errorResponse(request, reason);
  }
});
