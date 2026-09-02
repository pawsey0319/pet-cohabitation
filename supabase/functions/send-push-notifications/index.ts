import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { requirePost, serviceClient } from "../_shared/supabase.ts";

function requireDispatcher(request: Request): void {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const cronSecret = request.headers.get("x-cron-secret") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const configuredCronSecret = Deno.env.get("PUSH_CRON_SECRET") ?? "";
  if (bearer !== serviceRole && (!configuredCronSecret || cronSecret !== configuredCronSecret)) throw new Error("forbidden_push_dispatch");
}

function privateBody(kind: string): string {
  if (kind === "proposal") return "有一项空间提案等待查看";
  if (kind === "reminder") return "有一条提醒到时间了";
  if (kind === "agent_result") return "异宠或 Agent 已完成处理";
  return "发来一条新消息";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    requireDispatcher(request);
    const client = serviceClient();
    const now = new Date().toISOString();
    const pending = await client.from("notification_outbox")
      .select("event_id,status,attempts")
      .in("status", ["queued", "failed"])
      .lte("next_attempt_at", now)
      .order("created_at", { ascending: true })
      .limit(50);
    if (pending.error) throw pending.error;

    let sent = 0;
    let failed = 0;
    for (const item of pending.data ?? []) {
      const claimed = await client.from("notification_outbox")
        .update({ status: "sending", attempts: item.attempts + 1, updated_at: now })
        .eq("event_id", item.event_id)
        .eq("status", item.status)
        .select("event_id")
        .maybeSingle();
      if (claimed.error || !claimed.data) continue;

      try {
        const eventResult = await client.from("notification_events").select("*").eq("id", item.event_id).single();
        if (eventResult.error) throw eventResult.error;
        const event = eventResult.data;
        const [tokensResult, preferenceResult] = await Promise.all([
          client.from("device_push_tokens").select("id,expo_push_token").eq("user_id", event.user_id).eq("enabled", true).is("revoked_at", null),
          client.from("notification_preferences").select("messages_enabled,mentions_enabled,proposals_enabled,reminders_enabled,agent_results_enabled,show_content_preview").eq("user_id", event.user_id).maybeSingle(),
        ]);
        if (tokensResult.error) throw tokensResult.error;
        const tokens = tokensResult.data ?? [];
        const preference = preferenceResult.data;
        const kindEnabled = preference == null || ({
          message: preference.messages_enabled,
          mention: preference.mentions_enabled,
          proposal: preference.proposals_enabled,
          reminder: preference.reminders_enabled,
          agent_result: preference.agent_results_enabled,
        } as Record<string, boolean>)[event.kind] !== false;
        if (!kindEnabled) {
          await client.from("notification_outbox").update({ status: "cancelled", last_error: "disabled_by_user", updated_at: new Date().toISOString() }).eq("event_id", item.event_id);
          continue;
        }
        if (!tokens.length) {
          await client.from("notification_outbox").update({ status: "cancelled", last_error: "no_active_device", updated_at: new Date().toISOString() }).eq("event_id", item.event_id);
          continue;
        }
        const messages = tokens.map((token) => ({
          to: token.expo_push_token,
          sound: "default",
          channelId: "messages",
          title: event.title,
          body: preference?.show_content_preview === true ? event.body : privateBody(event.kind),
          data: { ...(event.payload ?? {}), route: event.route, notification_event_id: event.id },
        }));
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
          body: JSON.stringify(messages),
        });
        if (!response.ok) throw new Error(`expo_push_${response.status}`);
        const payload = await response.json() as { data?: Array<{ status: string; id?: string; details?: { error?: string }; message?: string }> };
        const tickets = Array.isArray(payload.data) ? payload.data : [];
        const receiptIds = tickets.flatMap((ticket) => ticket.status === "ok" && ticket.id ? [ticket.id] : []);
        await Promise.all(tickets.map(async (ticket, index) => {
          if (ticket.details?.error === "DeviceNotRegistered" && tokens[index]) {
            await client.from("device_push_tokens").update({ enabled: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", tokens[index].id);
          }
        }));
        if (!receiptIds.length) throw new Error(tickets[0]?.details?.error ?? tickets[0]?.message ?? "expo_push_rejected");
        await client.from("notification_outbox").update({ status: "sent", receipt_ids: receiptIds, last_error: null, updated_at: new Date().toISOString() }).eq("event_id", item.event_id);
        sent += 1;
      } catch (reason) {
        const attempt = item.attempts + 1;
        const terminal = attempt >= 8;
        const nextAttemptAt = new Date(Date.now() + Math.min(3600, 2 ** attempt * 15) * 1000).toISOString();
        const errorCode = reason instanceof Error ? reason.message.slice(0, 180) : "push_failed";
        await client.from("notification_outbox").update({ status: terminal ? "cancelled" : "failed", next_attempt_at: nextAttemptAt, last_error: errorCode, updated_at: new Date().toISOString() }).eq("event_id", item.event_id);
        failed += 1;
      }
    }
    return json(request, { processed: (pending.data ?? []).length, sent, failed });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
