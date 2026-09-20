import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { TextModelAdapter } from "./modelAdapters.ts";
import { recallKeywords, recallSpaceMatches } from "./petRecallQuery.ts";
import { canonicalRecallActor } from "./petRecallIdentity.ts";

export type PetRecallSource = Readonly<{
  space_id: string;
  space_name: string;
  message_id: string;
  created_at: string;
}>;

export type PetRecallResult = Readonly<{
  messages: readonly { actor: string; content: string }[];
  sources: readonly PetRecallSource[];
  // Optional so existing callers and isolated adapter fixtures stay compatible.
  coverage?: PetRecallCoverage;
}>;

export type PetRecallCoverage = Readonly<{
  mode: "recent" | "history";
  scanned_before_at: string;
  space_ids: readonly string[];
  scanned_message_count: number;
  eligible_message_count: number;
  used_message_count: number;
  omitted_message_count: number;
  truncated_message_count: number;
  keyword_match_count: number | null;
  scan_limit_reached: boolean;
  context_characters: number;
  earliest_used_at: string | null;
  latest_used_at: string | null;
  note: string;
}>;

export const RECALL_CONTEXT_MAX_CHARACTERS = 12_000;
export const RECALL_MESSAGE_MAX_CHARACTERS = 1_000;
const TRUNCATION = "…[本条截断]";

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

async function messagesInSpace(client: SupabaseClient, space: { spaceId: string; joinedAt: string; name: string }, scanHistory: boolean, oldestFirst: boolean, before: string): Promise<{ rows: RecallMessage[]; limited: boolean }> {
  const rows: RecallMessage[] = [];
  const pageSize = 200;
  const pageLimit = scanHistory ? 20 : 1;
  let cursor: RecallMessage | undefined;
  for (let page = 0; page < pageLimit; page += 1) {
    let query = client.from("messages")
      .select("id,space_id,sender_id,actor_name,actor_kind,text,kind,created_at")
      .eq("space_id", space.spaceId)
      .gte("created_at", space.joinedAt)
      .lte("created_at", before)
      .is("deleted_at", null)
      .in("kind", ["text", "system"])
      .order("created_at", { ascending: oldestFirst })
      .order("id", { ascending: oldestFirst })
      .limit(pageSize);
    // Values come from the preceding DB page. A timestamp alone skips peers
    // with the same time; offsets drift when rows are inserted or deleted.
    if (cursor) {
      const direction = oldestFirst ? "gt" : "lt";
      query = query.or(`created_at.${direction}.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.${direction}.${cursor.id})`);
    }
    const result = await query;
    if (result.error) throw result.error;
    const pageRows = (result.data ?? []).map((row) => ({ ...row, space_name: space.name })) as RecallMessage[];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { rows, limited: false };
    cursor = pageRows[pageRows.length - 1];
  }
  // A full final page only proves that the scan bound was reached, not that
  // more records exist or that the complete history was examined.
  return { rows, limited: true };
}

function compareMessageTime(a: RecallMessage, b: RecallMessage): number {
  const milliseconds = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (milliseconds) return milliseconds;
  // Postgres timestamps can retain microseconds beyond JavaScript Date's ms.
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(9, "0");
  const precision = fraction(a.created_at).localeCompare(fraction(b.created_at));
  return precision || a.id.localeCompare(b.id);
}

function boundedMessages(selected: readonly RecallMessage[], names: ReadonlyMap<string, string>) {
  const candidates = selected.map((row) => ({ row, actor: `[群聊回忆·${row.space_name}·${new Date(row.created_at).toISOString().slice(0, 10)}] ${canonicalRecallActor(row, names)}`, content: row.text ?? `[${row.kind}]` }));
  // Reserve a useful fragment for every candidate before sharing the remaining
  // budget. Long early messages must not consume all 60 sources' space.
  const admitted: typeof candidates = [];
  let minimum = 0;
  for (const candidate of candidates) {
    const cost = candidate.actor.length + 3 + Math.min(candidate.content.length, 32);
    if (minimum + cost <= RECALL_CONTEXT_MAX_CHARACTERS) { admitted.push(candidate); minimum += cost; }
  }
  if (candidates.length && !admitted.length) throw new Error("recall_context_label_too_long");
  let remaining = RECALL_CONTEXT_MAX_CHARACTERS - admitted.reduce((sum, item) => sum + item.actor.length + 3, 0);
  let reserved = admitted.reduce((sum, item) => sum + Math.min(item.content.length, 32), 0);
  let truncated = 0;
  const messages = admitted.map((item, index) => {
    const minimumContent = Math.min(item.content.length, 32);
    reserved -= minimumContent;
    const allocation = Math.min(RECALL_MESSAGE_MAX_CHARACTERS, minimumContent + Math.floor((remaining - reserved - minimumContent) / (admitted.length - index)));
    let content = item.content;
    if (content.length > allocation) {
      let prefix = content.slice(0, Math.max(0, allocation - TRUNCATION.length));
      if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
      content = prefix + TRUNCATION;
      truncated += 1;
    }
    remaining -= content.length;
    return { row: item.row, actor: item.actor, content };
  });
  return { messages, truncated };
}

export async function buildPetRecallContext(client: SupabaseClient, input: { ownerId: string; petId: string; question: string; adapter: TextModelAdapter; requiredSpaceId?:string }): Promise<PetRecallResult> {
  const memberships = await client.from("space_members").select("space_id,joined_at,spaces!inner(name)").eq("user_id", input.ownerId);
  if (memberships.error) throw memberships.error;
  const memberRows = (memberships.data ?? []).map((row: Record<string, unknown>) => ({ spaceId: String(row.space_id), joinedAt: String(row.joined_at), name: normalizedSpace(row.spaces).name }));
  if (!memberRows.length) return { messages: [], sources: [] };

  // Private recall follows the owner's own current read permission. Observation
  // consent only governs personality learning, and group participation settings
  // only govern whether a pet may speak inside that space.
  const allowed = input.requiredSpaceId ? memberRows.filter(row=>row.spaceId===input.requiredSpaceId) : memberRows;
  if (!allowed.length) return { messages: [], sources: [] };

  let plan: Awaited<ReturnType<TextModelAdapter["planPetRecall"]>>;
  const namedSpace = allowed.find((space) => recallSpaceMatches(input.question, space.name));
  const ownerOnly = /我.{0,8}(说|发|安排|提过)/.test(input.question);
  const explicitRecall = Boolean(namedSpace) || /之前|以前|群里|说过|聊过|记得|回忆|消息|近况|发生了什么|安排了什么/.test(input.question);
  const directKeywords = recallKeywords(input.question, allowed.map((space) => space.name));
  if (explicitRecall) {
    plan = {
      mode: namedSpace ? "recent_space" : ownerOnly ? "recent_owner" : "search_all",
      space_names: namedSpace ? [namedSpace.name] : [], keywords: [...directKeywords],
      sender_scope: ownerOnly ? "owner" : "any", limit: 60,
    };
  } else try { plan = await input.adapter.planPetRecall({ question: input.question, spaces: allowed.map(({ name }) => ({ name })) }); }
  catch {
    plan = { mode: /之前|以前|群里|说过|聊过|记得|回忆|消息|近况/.test(input.question) ? (ownerOnly ? "recent_owner" : "search_all") : "none", space_names: [], keywords: [], sender_scope: ownerOnly ? "owner" : "any", limit: 30 };
  }
  if (plan.mode === "none") return { messages: [], sources: [] };
  const namedSpaces = new Set(plan.space_names);
  const targetSpaces = namedSpaces.size ? allowed.filter((row) => namedSpaces.has(row.name)) : allowed;
  const rows: RecallMessage[] = [];
  const scannedBefore = new Date().toISOString();
  let scanLimited = false;

  const oldestRequested = /最早|第一次|刚加入|很久以前|很早以前/.test(input.question);
  const scanHistory = oldestRequested || plan.keywords.length > 0 || /哪天|什么时候|去年|上个月|几个月前/.test(input.question);
  for (const space of targetSpaces) {
    // Read state is intentionally absent from this query. Private recall searches
    // everything the owner may currently read after joined_at, including messages
    // already marked read. Deeper pagination is activated when the question asks
    // for an old time or a specific topic.
    const scanned = await messagesInSpace(client, space, scanHistory, oldestRequested, scannedBefore);
    const spaceRows = scanned.rows;
    scanLimited ||= scanned.limited;
    rows.push(...spaceRows);
    const latest = oldestRequested ? spaceRows[spaceRows.length - 1] : spaceRows[0];
    await client.from("pet_memory_cursors").upsert({
      pet_id: input.petId, owner_id: input.ownerId, space_id: space.spaceId, joined_at: space.joinedAt,
      last_message_id: latest?.id ?? null, last_message_at: latest?.created_at ?? null,
      scanned_message_count: spaceRows.length, updated_at: new Date().toISOString(),
    }, { onConflict: "pet_id,space_id" });
  }

  let selected = rows;
  let keywordMatchCount: number | null = null;
  if (plan.sender_scope === "owner" || plan.mode === "recent_owner") selected = selected.filter((row) => row.sender_id === input.ownerId);
  if (plan.keywords.length) {
    const keywords = plan.keywords.map((keyword) => keyword.toLocaleLowerCase());
    const matched = selected.filter((row) => keywords.some((keyword) => `${row.actor_name} ${row.text ?? ""}`.toLocaleLowerCase().includes(keyword)));
    keywordMatchCount = matched.length;
    if (matched.length) selected = matched;
  }
  const eligibleCount = selected.length;
  selected = selected.sort((a, b) => (oldestRequested ? 1 : -1) * compareMessageTime(a, b)).slice(0, plan.limit);
  const senderIds = [...new Set(selected.filter((row) => row.actor_kind === "human" && row.sender_id).map((row) => row.sender_id as string))];
  const currentProfileNames = new Map<string, string>();
  if (senderIds.length) {
    const profiles = await client.from("profiles").select("id,nickname").in("id", senderIds);
    if (profiles.error) throw profiles.error;
    for (const profile of profiles.data ?? []) currentProfileNames.set(String(profile.id), String(profile.nickname || "群成员"));
  }
  const bounded = boundedMessages(selected, currentProfileNames);
  const chronological = bounded.messages.sort((a, b) => compareMessageTime(a.row, b.row));
  const earliest = chronological[0]?.row.created_at ?? null;
  const latest = chronological[chronological.length - 1]?.row.created_at ?? null;
  const omitted = eligibleCount - chronological.length;
  const note = [
    `本次仅查询${targetSpaces.length}个已获读取权限的群，查询边界限定在各群本次加入之后、${scannedBefore}之前的文字/系统消息。实际扫描${rows.length}条，提供${chronological.length}条作为回答依据${earliest && latest ? `（${earliest}至${latest}）` : ""}。`,
    scanLimited ? `已达到本次${scanHistory ? "历史" : "近期"}扫描上限，${oldestRequested ? "更晚" : "更早"}记录未核实，不能声称覆盖全部历史。` : "",
    omitted ? `扫描范围内另有${omitted}条候选未纳入本次回答上下文。` : "",
    bounded.truncated ? `${bounded.truncated}条正文已截短并标记，未展示的部分不能作为结论依据。` : "",
    keywordMatchCount === 0 ? "本次扫描未命中指定关键词；提供的只是该范围记录，不能当作主题命中。" : "",
  ].filter(Boolean).join("");
  return {
    messages: chronological.map(({ actor, content }) => ({ actor, content })),
    sources: chronological.map(({ row }) => ({ space_id: row.space_id, space_name: row.space_name, message_id: row.id, created_at: row.created_at })),
    coverage: { mode: scanHistory ? "history" : "recent", scanned_before_at: scannedBefore, space_ids: targetSpaces.map((space) => space.spaceId), scanned_message_count: rows.length, eligible_message_count: eligibleCount, used_message_count: chronological.length, omitted_message_count: omitted, truncated_message_count: bounded.truncated, keyword_match_count: keywordMatchCount, scan_limit_reached: scanLimited, context_characters: chronological.reduce((sum, item) => sum + item.actor.length + item.content.length + 3, 0), earliest_used_at: earliest, latest_used_at: latest, note },
  };
}
