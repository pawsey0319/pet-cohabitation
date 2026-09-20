import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type ExpoResult = { status: "ok" | "error"; id?: string; details?: { error?: string } };
type Options = { fetcher?: typeof fetch; accessToken?: string; now?: () => number };
function headers(token?: string): Record<string, string> {
  return { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}

export async function dispatchNotifications(client: SupabaseClient, options: Options = {}) {
  const claimed = checked(await client.rpc("claim_notification_deliveries", { batch_size: 30 })) ?? [];
  let accepted = 0; let failed = 0; let suppressed = 0;
  for (let offset = 0; offset < claimed.length; offset += 6) {
    await Promise.all(claimed.slice(offset, offset + 6).map(async (delivery: { id: string; lease_id: string }) => {
      const payload = checked(await client.rpc("prepare_notification_delivery", { delivery_id: delivery.id, claim_id: delivery.lease_id }));
      if (!payload) { suppressed++; return; }
      let ticket: string | null = null;
      let code: string | null = null;
      try {
        const response = await (options.fetcher ?? fetch)("https://exp.host/--/api/v2/push/send", {
          method: "POST", headers: headers(options.accessToken), body: JSON.stringify([payload]), signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) {
          code = response.status === 429 ? "MessageRateExceeded" : response.status >= 500 ? "send_outcome_unknown" : response.status === 401 || response.status === 403 ? "InvalidCredentials" : `expo_http_${response.status}`;
        } else {
          const result = await response.json() as { data?: ExpoResult[] };
          const entry = result.data?.[0];
          if (entry?.status === "ok" && entry.id) ticket = entry.id;
          else code = entry?.status === "error" ? (entry.details?.error ?? "expo_push_rejected") : "send_outcome_unknown";
        }
      } catch { code = "send_outcome_unknown"; }
      // A network failure may happen after Expo accepted the payload. No blind
      // retry of unknown outcomes: Expo provides no exactly-once send contract.
      checked(await client.rpc("finish_notification_ticket", { delivery_id: delivery.id, claim_id: delivery.lease_id, ticket, error_code: code }));
      if (ticket) accepted++; else failed++;
    }));
  }
  return { processed: claimed.length, ticket_accepted: accepted, failed, suppressed };
}

export async function pollNotificationReceipts(client: SupabaseClient, options: Options = {}) {
  const now = (options.now ?? Date.now)();
  const pending = checked(await client.from("notification_deliveries")
    .select("id,device_id,ticket_id,ticket_at,attempts,event_id").eq("status", "ticket_accepted")
    .lte("next_attempt_at", new Date(now).toISOString()).order("ticket_at").limit(300)) ?? [];
  if (!pending.length) return { checked: 0, receipt_ok: 0, unknown: 0 };
  let receipts: Record<string, ExpoResult> = {};
  try {
    const response = await (options.fetcher ?? fetch)("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST", headers: headers(options.accessToken), body: JSON.stringify({ ids: pending.map(row => row.ticket_id) }), signal: AbortSignal.timeout(20000),
    });
    if (response.ok) receipts = ((await response.json()) as { data?: Record<string, ExpoResult> }).data ?? {};
  } catch { /* Read failure does not resend an accepted notification. */ }
  let okay = 0; let unknown = 0;
  for (const row of pending) {
    const receipt = receipts[row.ticket_id];
    const age = now - new Date(row.ticket_at).getTime();
    let status = "ticket_accepted"; let error: string | null = null;
    if (receipt?.status === "ok") { status = "receipt_ok"; okay++; }
    else if (receipt?.status === "error") {
      error = receipt.details?.error ?? "receipt_error";
      status = error === "MessageRateExceeded" && row.attempts < 8 ? "retry" : "failed";
      if (error === "DeviceNotRegistered") checked(await client.from("device_push_tokens").update({ enabled: false, revoked_at: new Date(now).toISOString() }).eq("id", row.device_id));
    } else if (age >= 24 * 60 * 60 * 1000) { status = "receipt_unknown"; error = "receipt_unavailable_after_24h"; unknown++; }
    checked(await client.from("notification_deliveries").update({ status, last_error: error, receipt_checked_at: new Date(now).toISOString(), next_attempt_at: new Date(now + 15 * 60 * 1000).toISOString(), updated_at: new Date(now).toISOString() })
      .eq("id", row.id).eq("status", "ticket_accepted").eq("ticket_id", row.ticket_id));
  }
  for (const eventId of new Set(pending.map(row => row.event_id))) {
    const rows = checked(await client.from("notification_deliveries").select("status").eq("event_id", eventId)) ?? [];
    if (rows.length && rows.every(row => ["receipt_ok", "failed", "cancelled", "receipt_unknown"].includes(row.status))) {
      checked(await client.from("notification_outbox").update({ status: rows.some(row => row.status === "receipt_ok") ? "sent" : "cancelled", updated_at: new Date(now).toISOString() }).eq("event_id", eventId));
    }
  }
  return { checked: pending.length, receipt_ok: okay, unknown };
}
