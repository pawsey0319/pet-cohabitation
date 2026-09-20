import {deleteVisionData} from "./visionData.ts";
import { readAccountPages, removeStoragePrefix } from "./dataPagination.ts";
import { stopAndDeleteReminderData } from "../reminder-management/data.ts";
import { deletePrivateWorkData } from "../work-items/accountData.ts";
import { deleteAvatarData } from "./avatarData.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { deleteChatBackgroundData } from "./chatBackgroundData.ts";

export async function redactAndDeleteAccount(client: SupabaseClient, userId: string): Promise<{ redactedAt: string; storageCleanup: "complete" | "pending" }> {
  const fenced = await client.rpc("begin_account_data_deletion", { p_owner: userId }); if (fenced.error) throw fenced.error;
  await deleteAvatarData(client,userId);
  await deleteVisionData(client,userId);
  await stopAndDeleteReminderData(client,userId);
  await deletePrivateWorkData(client,userId);
  await deleteChatBackgroundData(client, userId);
  const [messageRows, memberships] = await Promise.all([
    readAccountPages(client,"messages",userId,{ownerColumn:"sender_id",select:"id,media_path,space_id"}),
    readAccountPages(client,"space_members",userId,{ownerColumn:"user_id",key:"space_id"}),
  ]);
  const spaces = new Set([...messageRows.map(row => row.space_id), ...memberships.map(row => row.space_id)]);
  for (const space of spaces) await removeStoragePrefix(client,"chat-media",`${space}/${userId}`);
  await removeStoragePrefix(client,"pet-portraits",userId);

  const messageIds = messageRows.map((row) => row.id);
  const redactedAt = new Date().toISOString();
  for (let offset=0;offset<messageIds.length;offset+=100) {
    const previews = await client.from("messages").update({ reply_preview: "[已删除消息]" }).in("reply_to_message_id", messageIds.slice(offset,offset+100));
    if (previews.error) throw previews.error;
  }
  const redacted = await client.from("messages").update({
    actor_name: "已注销用户",
    kind: "system",
    text: "[消息已由已注销用户删除]",
    media_path: null,
    media_duration_seconds: null,
    deleted_at: redactedAt,
  }).eq("sender_id", userId);
  if (redacted.error) throw redacted.error;

  const transferred = await client.rpc("transfer_account_spaces", { p_owner: userId }); if (transferred.error) throw transferred.error;
  const signupInvites = await client.from("signup_invites").delete().or(`created_by.eq.${userId},claimed_by.eq.${userId}`);
  if (signupInvites.error) throw signupInvites.error;
  const spaceInvites = await client.from("space_invites").delete().or(`created_by.eq.${userId},claimed_by.eq.${userId}`);
  if (spaceInvites.error) throw spaceInvites.error;

  const deleted = await client.auth.admin.deleteUser(userId);
  if (deleted.error) throw deleted.error;
  // The profile lock in the Storage insert fence means all pre-deletion upload
  // metadata has committed now; catch any upload that finished during cleanup.
  let storageCleanup: "complete" | "pending" = "complete";
  try {
    // Preserve confirmed shared materials while removing late private uploads.
    for (;;) {
      const page = await client.rpc("deleted_account_storage", { p_owner: userId }); if (page.error) throw page.error;
      if (!(page.data ?? []).length) break;
      for (const object of page.data) {
        const removed = await client.storage.from(object.bucket).remove([object.path]); if (removed.error) throw removed.error;
      }
    }
  } catch {
    storageCleanup = "pending";
    // The periodic service also discovers files whose account no longer exists.
    await client.rpc("enqueue_media_maintenance");
  }
  return { redactedAt, storageCleanup };
}
