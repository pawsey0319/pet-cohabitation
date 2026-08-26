import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { TextModelAdapter } from "./modelAdapters.ts";

export type PetRecallSource = Readonly<{
  space_id: string;
  space_name: string;
  message_id: string;
  created_at: string;
}>;

export type PetRecallResult = Readonly<{
  messages: readonly { actor: string; content: string }[];
  sources: readonly PetRecallSource[];
}>;

type RecallMessage = Readonly<{
  id: string;
  space_id: string;
  sender_id: string | null;
  actor_name: string;
  actor_kind: string;
  text: string | null;
  kind: string;
  created_at: string;
  space_name: string;
}>;

function normalizedSpace(value: unknown): { name: string } {
  if (Array.isArray(value)) return (value[0] ?? { name: "关系空间" }) as { name: string };
  return (value ?? { name: "关系空间" }) as { name: string };
}

export async function buildPetRecallContext(client: SupabaseClient, input: { ownerId: string; petId: string; question: string; adapter: TextModelAdapter }): Promise<PetRecallResult> {
  const memberships = await client.from("space_members").select("space_id,joined_at,spaces!inner(name)").eq("user_id", input.ownerId);
  if (memberships.error) throw memberships.error;
  const memberRows = (memberships.data ?? []).map((row: Record<string, unknown>) => ({ spaceId: String(row.space_id), joinedAt: String(row.joined_at), name: normalizedSpace(row.spaces).name }));
  if (!memberRows.length) return { messages: [], sources: [] };

  // Private recall follows the owner's own current read permission. Observation
  // consent only governs personality learning, and group participation settings
  // only govern whether a pet may speak inside that space.
  const allowed = memberRows;
  if (!allowed.length) return { messages: [], sources: [] };

  let plan: Awaited<ReturnType<TextModelAdapter["planPetRecall"]>>;
  try { plan = await input.adapter.planPetRecall({ question: input.question, spaces: allowed.map(({ name }) => ({ name })) }); }
  catch {
    const ownerOnly = /我.{0,8}(说|发)/.test(input.question);
    plan = { mode: /之前|以前|群里|说过|聊过|记得|回忆|消息|近况/.test(input.question) ? (ownerOnly ? "recent_owner" : "search_all") : "none", space_names: [], keywords: [], sender_scope: ownerOnly ? "owner" : "any", limit: 30 };
  }
  if (plan.mode === "none") return { messages: [], sources: [] };
  const namedSpaces = new Set(plan.space_names);
  const targetSpaces = namedSpaces.size ? allowed.filter((row) => namedSpaces.has(row.name)) : allowed;
  const rows: RecallMessage[] = [];

  for (const space of targetSpaces) {
    const result = await client.from("messages")
      .select("id,space_id,sender_id,actor_name,actor_kind,text,kind,created_at")
      .eq("space_id", space.spaceId)
      .gte("created_at", space.joinedAt)
      .is("deleted_at", null)
      .in("kind", ["text", "system"])
      .order("created_at", { ascending: false })
      .limit(200);
    if (result.error) throw result.error;
    const spaceRows = (result.data ?? []).map((row) => ({ ...row, space_name: space.name })) as RecallMessage[];
    rows.push(...spaceRows);
    const latest = spaceRows[0];
    await client.from("pet_memory_cursors").upsert({
      pet_id: input.petId, owner_id: input.ownerId, space_id: space.spaceId, joined_at: space.joinedAt,
      last_message_id: latest?.id ?? null, last_message_at: latest?.created_at ?? null,
      scanned_message_count: spaceRows.length, updated_at: new Date().toISOString(),
    }, { onConflict: "pet_id,space_id" });
  }

  let selected = rows;
  if (plan.sender_scope === "owner" || plan.mode === "recent_owner") selected = selected.filter((row) => row.sender_id === input.ownerId);
  if (plan.keywords.length) {
    const keywords = plan.keywords.map((keyword) => keyword.toLocaleLowerCase());
    const matched = selected.filter((row) => keywords.some((keyword) => `${row.actor_name} ${row.text ?? ""}`.toLocaleLowerCase().includes(keyword)));
    if (matched.length) selected = matched;
  }
  selected = selected.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, plan.limit);
  const chronological = [...selected].reverse();
  return {
    messages: chronological.map((row) => ({ actor: `[群聊回忆·${row.space_name}·${new Date(row.created_at).toISOString().slice(0, 10)}] ${row.actor_name}`, content: row.text ?? `[${row.kind}]` })),
    sources: selected.map((row) => ({ space_id: row.space_id, space_name: row.space_name, message_id: row.id, created_at: row.created_at })),
  };
}
