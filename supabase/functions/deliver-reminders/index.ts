import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

function bearerToken(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}

function isSchedulerRequest(request: Request): boolean {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET") ?? "";
  return Boolean(
    (serviceRoleKey && bearerToken(request) === serviceRoleKey)
      || (cronSecret && request.headers.get("x-cron-secret") === cronSecret),
  );
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const client = serviceClient();
    const now = new Date().toISOString();
    let due: Record<string, unknown>[] = [];

    if (isSchedulerRequest(request)) {
      const result = await client
        .from("scheduled_reminders")
        .select("*")
        .eq("status", "scheduled")
        .lte("scheduled_for", now)
        .order("scheduled_for", { ascending: true })
        .limit(200);
      if (result.error) throw result.error;
      due = result.data ?? [];
    } else {
      const user = await authenticatedUser(request);
      const memberships = await client.from("space_members").select("space_id").eq("user_id", user.id);
      if (memberships.error) throw memberships.error;
      const spaceIds = (memberships.data ?? []).map((row) => row.space_id);
      const personal = await client
        .from("scheduled_reminders")
        .select("*")
        .eq("owner_id", user.id)
        .eq("reminder_kind", "personal")
        .eq("status", "scheduled")
        .lte("scheduled_for", now);
      if (personal.error) throw personal.error;
      const group = spaceIds.length
        ? await client
          .from("scheduled_reminders")
          .select("*")
          .in("space_id", spaceIds)
          .eq("reminder_kind", "group")
          .eq("status", "scheduled")
          .lte("scheduled_for", now)
        : { data: [], error: null };
      if (group.error) throw group.error;
      due = [...(personal.data ?? []), ...(group.data ?? [])];
    }

    let delivered = 0;
    for (const reminder of due) {
      const reminderId = String(reminder.id);
      const claimed = await client.from("scheduled_reminders").update({ status: "sent", updated_at: now }).eq("id", reminderId).eq("status", "scheduled").select("id").maybeSingle();
      if (claimed.error || !claimed.data) continue;
      try {
        if (reminder.reminder_kind === "personal") {
          const pet = await client.from("pets").select("id,name").eq("owner_id", String(reminder.owner_id)).single();
          if (pet.error) throw pet.error;
          const inserted = await client.from("pet_private_threads").insert({ pet_id: pet.data.id, owner_id: reminder.owner_id, role: "pet", content: `⏰ ${String(reminder.content)}` }).select("id").single();
          if (inserted.error) throw inserted.error;
        } else {
          const inserted = await client.from("messages").insert({ client_id: `reminder-${reminderId}`, space_id: reminder.space_id, sender_id: null, actor_kind: "space_agent", actor_id: reminder.space_id, actor_name: "空间主 Agent", kind: "system", text: `⏰ ${String(reminder.content)}`, permission_source: "approved_group_reminder" }).select("id").single();
          if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
          await client.from("scheduled_reminders").update({ delivered_message_id: inserted.data?.id ?? null, updated_at: now }).eq("id", reminderId);
        }
        delivered += 1;
      } catch {
        await client.from("scheduled_reminders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", reminderId);
      }
    }
    return json(request, { delivered });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
