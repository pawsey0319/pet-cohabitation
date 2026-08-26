import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const client = serviceClient();
    const memberships = await client.from("space_members").select("space_id").eq("user_id", user.id);
    if (memberships.error) throw memberships.error;
    const spaceIds = (memberships.data ?? []).map((row) => row.space_id);
    const personal = await client.from("scheduled_reminders").select("*").eq("owner_id", user.id).eq("reminder_kind", "personal").eq("status", "scheduled").lte("scheduled_for", new Date().toISOString());
    if (personal.error) throw personal.error;
    const group = spaceIds.length ? await client.from("scheduled_reminders").select("*").in("space_id", spaceIds).eq("reminder_kind", "group").eq("status", "scheduled").lte("scheduled_for", new Date().toISOString()) : { data: [], error: null };
    if (group.error) throw group.error;
    const due = [...(personal.data ?? []), ...(group.data ?? [])];
    let delivered = 0;
    for (const reminder of due) {
      const claimed = await client.from("scheduled_reminders").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", reminder.id).eq("status", "scheduled").select("id").maybeSingle();
      if (claimed.error || !claimed.data) continue;
      try {
        if (reminder.reminder_kind === "personal") {
          const pet = await client.from("pets").select("id,name").eq("owner_id", reminder.owner_id).single();
          if (pet.error) throw pet.error;
          const inserted = await client.from("pet_private_threads").insert({ pet_id: pet.data.id, owner_id: reminder.owner_id, role: "pet", content: `⏰ ${reminder.content}` }).select("id").single();
          if (inserted.error) throw inserted.error;
        } else {
          const inserted = await client.from("messages").insert({ client_id: `reminder-${reminder.id}`, space_id: reminder.space_id, sender_id: null, actor_kind: "space_agent", actor_id: reminder.space_id, actor_name: "空间主 Agent", kind: "system", text: `⏰ ${reminder.content}`, permission_source: "approved_group_reminder" }).select("id").single();
          if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
          await client.from("scheduled_reminders").update({ delivered_message_id: inserted.data?.id ?? null, updated_at: new Date().toISOString() }).eq("id", reminder.id);
        }
        delivered += 1;
      } catch (reason) {
        await client.from("scheduled_reminders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", reminder.id);
      }
    }
    return json(request, { delivered });
  } catch (reason) { return errorResponse(request, reason); }
});
