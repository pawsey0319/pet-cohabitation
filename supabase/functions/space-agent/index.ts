import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { sha256 } from "../_shared/hash.ts";
import { TextModelAdapter } from "../_shared/modelAdapters.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ space_id: z.string().uuid(), action: z.literal("summarize").default("summarize") });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  let jobId: string | null = null; let runId: string | null = null; const startedAt = Date.now();
  try {
    requirePost(request); const user = await authenticatedUser(request); const input = Input.parse(await request.json()); const client = serviceClient();
    const membership = await client.rpc("is_space_member", { target_space_id: input.space_id, target_user_id: user.id }); if (membership.error || !membership.data) throw new Error("not_space_member");
    const { data: rows, error: messageError } = await client.from("messages").select("actor_name,actor_kind,text,kind,created_at").eq("space_id", input.space_id).order("created_at", { ascending: false }).limit(100); if (messageError) throw messageError;
    const messages = [...(rows ?? [])].reverse().map((row) => ({ actor: `${row.actor_name}${row.actor_kind === "pet" ? "（异宠，不代表主人承诺）" : ""}`, content: row.text ?? `[${row.kind}]` }));
    if (!messages.length) throw new Error("no_messages_to_summarize");
    const { data: job, error: jobError } = await client.from("agent_jobs").insert({ job_kind: "space_summary", scope_kind: "space", scope_id: input.space_id, requested_by: user.id, status: "running", input: { message_count: messages.length } }).select("id").single(); if (jobError) throw jobError; jobId = job.id;
    const promptHash = await sha256(JSON.stringify(messages)); runId = await reserveModelRun(client, { runKind: "space_summary", dailyLimit: 20, spaceId: input.space_id, promptHash, model: TextModelAdapter.modelName() });
    const result = await new TextModelAdapter().summarizeSpace({ messages });
    const sections = [
      `群聊摘要\n${result.summary}`,
      `已确认\n${result.confirmed.length ? result.confirmed.map((item) => `• ${item}`).join("\n") : "• 暂无明确确认"}`,
      `Agent 建议\n${result.suggestions.length ? result.suggestions.map((item) => `• ${item}`).join("\n") : "• 暂无"}`,
      `待本人确认\n${result.pending_people.length ? result.pending_people.map((item) => `• ${item}`).join("\n") : "• 暂无"}`,
    ];
    const { data: inserted, error: insertError } = await client.from("messages").insert({ client_id: `space-agent-${jobId}`, space_id: input.space_id, sender_id: null, actor_kind: "space_agent", actor_id: input.space_id, actor_name: "空间主 Agent", kind: "system", text: sections.join("\n\n"), permission_source: "member_requested_objective_summary" }).select("id").single(); if (insertError) throw insertError;
    await client.from("agent_jobs").update({ status: "succeeded", result: { message_id: inserted.id, ...result }, completed_at: new Date().toISOString() }).eq("id", jobId);
    await finishModelRun(client, runId, { status: "succeeded", startedAt }); return json(request, { message_id: inserted.id, ...result });
  } catch (reason) {
    const client = serviceClient(); if (jobId) await client.from("agent_jobs").update({ status: "failed", error_code: reason instanceof Error ? reason.message.slice(0, 120) : "summary_error", completed_at: new Date().toISOString() }).eq("id", jobId);
    if (runId) await finishModelRun(client, runId, { status: "failed", startedAt, errorCode: reason instanceof Error ? reason.message : "summary_error" });
    return errorResponse(request, reason);
  }
});
