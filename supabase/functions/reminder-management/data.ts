import { readAccountPages } from "../_shared/dataPagination.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function exportReminderData(client: SupabaseClient, owner: string) {
  const pages = (table:string,ownerColumn:string,selection="*",order="id") => readAccountPages(client,table,owner,{ownerColumn,select:selection,key:order});
  const [series, occurrences, mutations, deliveries, events, preferences, spaces, devices] = await Promise.all([
    pages("reminder_series", "owner_id"),
    pages("reminder_occurrences", "reminder_series.owner_id", "*,reminder_series!inner(owner_id)"),
    pages("reminder_mutations", "owner_id", "*", "request_id"),
    pages("notification_deliveries", "notification_events.user_id", "*,notification_events!inner(user_id)"),
    pages("notification_events", "user_id"),
    pages("notification_preferences", "user_id", "*", "user_id"),
    pages("space_notification_preferences", "user_id", "*", "space_id"),
    pages("device_push_tokens", "user_id", "id,platform,enabled,permission_status,revoked_at,created_at,last_seen_at"),
  ]);
  return { series, occurrences, mutations, deliveries, events, preferences, spaces, devices };
}

/** Called at the start of account deletion, before removing assets or Auth. */
export async function stopAndDeleteReminderData(client: SupabaseClient, owner: string) {
  const blocked = await client.rpc("block_notification_owner", { target_owner: owner });
  if (blocked.error) throw blocked.error;
}
