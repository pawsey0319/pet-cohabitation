export type RecallActorRow = Readonly<{
  sender_id: string | null;
  actor_name: string;
  actor_kind: string;
}>;

/**
 * Historical actor_name is a message-time snapshot. A member may rename their
 * account, so it must never be used as a stable identity when preparing model
 * context. Human rows with the same sender_id receive one current display name.
 */
export function canonicalRecallActor(row: RecallActorRow, currentProfileNames: ReadonlyMap<string, string>): string {
  if (row.actor_kind === "human" && row.sender_id) return currentProfileNames.get(row.sender_id)?.trim() || row.actor_name.trim() || "群成员";
  return row.actor_name.trim() || (row.actor_kind === "pet" ? "异宠" : row.actor_kind === "space_agent" ? "空间主 Agent" : "系统");
}

