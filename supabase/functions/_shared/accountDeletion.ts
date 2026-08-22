import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function redactAndDeleteAccount(client: SupabaseClient, userId: string): Promise<string> {
  const [messageRows, portraitRows] = await Promise.all([
    client.from("messages").select("id,media_path").eq("sender_id", userId),
    client.from("pet_visual_assets").select("storage_path").eq("owner_id", userId),
  ]);
  if (messageRows.error) throw messageRows.error;
  if (portraitRows.error) throw portraitRows.error;

  const mediaPaths = (messageRows.data ?? []).map((row) => row.media_path).filter((value): value is string => Boolean(value));
  const portraitPaths = (portraitRows.data ?? []).map((row) => row.storage_path).filter((value): value is string => Boolean(value));
  if (mediaPaths.length) {
    const removed = await client.storage.from("chat-media").remove(mediaPaths);
    if (removed.error) throw removed.error;
  }
  if (portraitPaths.length) {
    const removed = await client.storage.from("pet-portraits").remove(portraitPaths);
    if (removed.error) throw removed.error;
  }

  const messageIds = (messageRows.data ?? []).map((row) => row.id);
  const redactedAt = new Date().toISOString();
  if (messageIds.length) {
    const previews = await client.from("messages").update({ reply_preview: "[已删除消息]" }).in("reply_to_message_id", messageIds);
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

  const ownedSpaces = await client.from("spaces").select("id").eq("created_by", userId);
  if (ownedSpaces.error) throw ownedSpaces.error;
  for (const space of ownedSpaces.data ?? []) {
    const successor = await client.from("space_members").select("user_id").eq("space_id", space.id).neq("user_id", userId).order("joined_at").limit(1).maybeSingle();
    if (successor.error) throw successor.error;
    if (successor.data) {
      const transferred = await client.from("spaces").update({ created_by: successor.data.user_id, updated_at: new Date().toISOString() }).eq("id", space.id).eq("created_by", userId);
      if (transferred.error) throw transferred.error;
      const promoted = await client.from("space_members").update({ role: "owner" }).eq("space_id", space.id).eq("user_id", successor.data.user_id);
      if (promoted.error) throw promoted.error;
    } else {
      const removed = await client.from("spaces").delete().eq("id", space.id).eq("created_by", userId);
      if (removed.error) throw removed.error;
    }
  }
  const signupInvites = await client.from("signup_invites").delete().or(`created_by.eq.${userId},claimed_by.eq.${userId}`);
  if (signupInvites.error) throw signupInvites.error;
  const spaceInvites = await client.from("space_invites").delete().or(`created_by.eq.${userId},claimed_by.eq.${userId}`);
  if (spaceInvites.error) throw spaceInvites.error;

  const deleted = await client.auth.admin.deleteUser(userId);
  if (deleted.error) throw deleted.error;
  return redactedAt;
}
