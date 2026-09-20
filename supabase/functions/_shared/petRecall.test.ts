import assert from "node:assert/strict";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { TextModelAdapter } from "./modelAdapters.ts";
import { buildPetRecallContext, RECALL_CONTEXT_MAX_CHARACTERS, RECALL_MESSAGE_MAX_CHARACTERS } from "./petRecall.ts";

type Row = Record<string, any>;
type Query = { table: string; filters: [string, string, any][]; orders: [string, boolean][]; limit?: number; cursor?: string; ids?: string[] };
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const joined = "2026-01-01T00:00:00.000Z";
const message = (value: number, text = "露营装备讨论") => ({ id: id(value), space_id: "space-a", sender_id: "owner", actor_kind: "human", actor_name: value % 2 ? "旧称呼甲" : "旧称呼乙", kind: "text", text, created_at: "2026-02-01T12:00:00.000Z", deleted_at: null });

function fixture(messages: Row[], afterPage?: (state: { messages: Row[] }, query: Query, page: number) => void) {
  const state = { messages };
  const queries: Query[] = [], cursors: Row[] = [];
  const memberships = [
    { user_id: "owner", space_id: "space-a", joined_at: joined, spaces: { name: "老友小圈" } },
    { user_id: "owner", space_id: "space-b", joined_at: joined, spaces: { name: "另一个群" } },
  ];
  let page = 0;
  const client = { from(table: string) {
    const query: Query = { table, filters: [], orders: [] };
    const builder: any = {
      select: () => builder,
      eq: (key: string, value: any) => { query.filters.push([key, "eq", value]); return builder; },
      gte: (key: string, value: any) => { query.filters.push([key, "gte", value]); return builder; },
      lte: (key: string, value: any) => { query.filters.push([key, "lte", value]); return builder; },
      is: (key: string, value: any) => { query.filters.push([key, "eq", value]); return builder; },
      in: (key: string, value: any) => { query.filters.push([key, "in", value]); return builder; },
      order: (key: string, options: { ascending: boolean }) => { query.orders.push([key, options.ascending]); return builder; },
      limit: (value: number) => { query.limit = value; return builder; },
      or: (value: string) => { query.cursor = value; return builder; },
      range: () => { throw new Error("offset pagination must not return"); },
      upsert: (value: Row) => { assert.equal(table, "pet_memory_cursors"); cursors.push(value); return Promise.resolve({ error: null }); },
      then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        try {
          let rows: Row[] = [...(table === "messages" ? state.messages : table === "space_members" ? memberships : table === "profiles" ? [{ id: "owner", nickname: "当前真名" }, { id: "peer", nickname: "另一成员" }] : [])];
          for (const [key, operator, value] of query.filters) rows = rows.filter((row) => operator === "eq" ? row[key] === value : operator === "in" ? value.includes(row[key]) : operator === "gte" ? row[key] >= value : row[key] <= value);
          if (query.cursor) {
            const parsed = /^created_at\.(lt|gt)\.(.+),and\(created_at.eq\.(.+),id\.(lt|gt)\.(.+)\)$/.exec(query.cursor);
            assert.ok(parsed, "timestamp/ID cursor syntax"); assert.equal(parsed[1], parsed[4]); assert.equal(parsed[2], parsed[3]);
            const [, direction, time, , , lastId] = parsed;
            rows = rows.filter((row) => direction === "lt" ? row.created_at < time || row.created_at === time && row.id < lastId : row.created_at > time || row.created_at === time && row.id > lastId);
          }
          rows.sort((a, b) => { for (const [key, ascending] of query.orders) { const order = String(a[key]).localeCompare(String(b[key])); if (order) return ascending ? order : -order; } return 0; });
          if (query.limit !== undefined) rows = rows.slice(0, query.limit);
          query.ids = rows.map((row) => row.id); queries.push(query);
          if (table === "messages") afterPage?.(state, query, ++page);
          resolve({ data: rows, error: null });
        } catch (error) { reject(error); }
      },
    };
    return builder;
  } } as unknown as SupabaseClient;
  let plannerCalls = 0;
  const adapter = { planPetRecall: () => { plannerCalls++; throw new Error("explicit scope must not need a model planner"); } } as unknown as TextModelAdapter;
  return { client, adapter, queries, cursors, plannerCalls: () => plannerCalls, run: (question = "老友小圈群里最近聊了什么？", requiredSpaceId = "space-a") => buildPetRecallContext(client, { ownerId: "owner", petId: "pet", question, requiredSpaceId, adapter }) };
}

Deno.test("redundant single-group recent summary reads one page and reports only its actual scope", async () => {
  const f = fixture(Array.from({ length: 410 }, (_, index) => message(index + 1)));
  const result = await f.run("关于老友小圈最近大家都聊了什么？");
  assert.equal(f.plannerCalls(), 0); assert.equal(f.queries.filter((query) => query.table === "messages").length, 1);
  assert.equal(result.coverage?.mode, "recent"); assert.equal(result.coverage?.scanned_message_count, 200);
  assert.equal(result.coverage?.used_message_count, 60); assert.equal(result.coverage?.omitted_message_count, 140);
  assert.deepEqual(result.coverage?.space_ids, ["space-a"]); assert.equal(result.coverage?.scan_limit_reached, true);
  assert.match(result.coverage!.note, /更早记录未核实/); assert.doesNotMatch(result.coverage!.note, /未读/);
  assert.ok(result.sources.every((source) => source.space_id === "space-a"));
});

Deno.test("history cursor keeps timestamp peers through concurrent page deletion and later insertion", async () => {
  const f = fixture(Array.from({ length: 405 }, (_, index) => message(index + 1)), (state, _query, page) => {
    if (page === 1) { state.messages = state.messages.filter((row) => row.id !== id(405)); state.messages.push({ ...message(999), created_at: "2099-01-01T00:00:00.000Z" }); }
  });
  const result = await f.run("老友小圈之前关于露营装备聊了什么？");
  const pages = f.queries.filter((query) => query.table === "messages");
  assert.deepEqual(pages.map((query) => query.ids!.length), [200, 200, 5]);
  const scannedIds = pages.flatMap((query) => query.ids!);
  assert.equal(new Set(scannedIds).size, 405); assert.ok(scannedIds.includes(id(1))); assert.ok(!scannedIds.includes(id(999)));
  assert.deepEqual(pages[0].orders, [["created_at", false], ["id", false]]);
  assert.equal(pages[1].cursor, `created_at.lt.2026-02-01T12:00:00.000Z,and(created_at.eq.2026-02-01T12:00:00.000Z,id.lt.${id(206)})`);
  assert.equal(new Set(pages.map((query) => query.filters.find(([key, operator]) => key === "created_at" && operator === "lte")?.[2])).size, 1);
  assert.equal(result.coverage?.scanned_message_count, 405); assert.equal(result.coverage?.scan_limit_reached, false);
});

Deno.test("oldest history uses forward cursors and retains join time, deletion, kind and explicit space boundaries", async () => {
  const f = fixture([
    ...Array.from({ length: 410 }, (_, index) => message(index + 1)),
    { ...message(1001), created_at: "2025-01-01T00:00:00.000Z" },
    { ...message(1002), deleted_at: "2026-02-02T00:00:00.000Z" },
    { ...message(1003), space_id: "space-b" }, { ...message(1004), kind: "image" },
  ]);
  const result = await f.run("老友小圈最早关于露营装备说了什么？");
  const pages = f.queries.filter((query) => query.table === "messages");
  assert.deepEqual(pages[0].orders, [["created_at", true], ["id", true]]); assert.match(pages[1].cursor!, /created_at.gt/);
  assert.equal(result.coverage?.scanned_message_count, 410);
  assert.deepEqual(result.sources.map((source) => source.message_id), Array.from({ length: 60 }, (_, index) => id(index + 1)));
  assert.equal(f.cursors[0].last_message_id, id(410)); assert.equal(f.cursors[0].joined_at, joined);
});

Deno.test("context shares its character budget across 60 long messages and keeps actual sender identity and sources", async () => {
  const f = fixture(Array.from({ length: 60 }, (_, index) => message(index + 1, "合成长文内容".repeat(800))));
  const result = await f.run();
  assert.equal(result.messages.length, 60); assert.equal(result.sources.length, 60); assert.equal(result.coverage?.truncated_message_count, 60);
  const chars = result.messages.reduce((sum, entry) => sum + entry.actor.length + entry.content.length + 3, 0);
  assert.ok(chars <= RECALL_CONTEXT_MAX_CHARACTERS); assert.equal(result.coverage?.context_characters, chars);
  assert.ok(result.messages.every((entry) => entry.content.length <= RECALL_MESSAGE_MAX_CHARACTERS && entry.content.length >= 32 && entry.content.endsWith("…[本条截断]") && entry.actor.endsWith("当前真名")));
  assert.deepEqual(result.sources.map((source) => source.message_id), Array.from({ length: 60 }, (_, index) => id(index + 1)));
  assert.match(result.coverage!.note, /60条正文已截短/); assert.equal(result.coverage?.omitted_message_count, 0);
});

Deno.test("a single long message is marked and never cuts a Unicode surrogate in half", async () => {
  const f = fixture([message(1, "🦊".repeat(800))]);
  const result = await f.run(); const content = result.messages[0].content;
  assert.ok(content.length <= RECALL_MESSAGE_MAX_CHARACTERS); assert.match(content, /…\[本条截断\]$/);
  assert.doesNotMatch(content.replace("…[本条截断]", ""), /[\uD800-\uDBFF]$/); assert.equal(result.sources[0].message_id, id(1));
});

Deno.test("oversized labels cannot invent unused sources or silently erase a nonempty recall", async () => {
  const oversized = { ...message(2), actor_kind: "system", actor_name: "合成超长标签".repeat(2500) };
  const f = fixture([message(1), oversized, message(3)]);
  const result = await f.run();
  assert.deepEqual(result.sources.map((source) => source.message_id), [id(1), id(3)]);
  assert.equal(result.messages.length, 2); assert.equal(result.coverage?.omitted_message_count, 1);
  assert.match(result.coverage!.note, /另有1条候选未纳入/);
  await assert.rejects(fixture([oversized]).run(), /recall_context_label_too_long/);
});

Deno.test("owner-only recall stays within sender scope and preserves microsecond source order", async () => {
  const f = fixture([
    { ...message(1), created_at: "2026-02-01T12:00:00.000002Z" },
    { ...message(2), created_at: "2026-02-01T12:00:00.000001Z" },
    { ...message(3), sender_id: "peer" },
  ]);
  const result = await f.run("老友小圈里我说过什么？");
  assert.deepEqual(result.sources.map((source) => source.message_id), [id(2), id(1)]);
  assert.equal(result.coverage?.eligible_message_count, 2);
  assert.ok(result.messages.every((entry) => entry.actor.endsWith("当前真名")));
});

Deno.test("history stops at its bounded page cap and makes no full-history claim", async () => {
  const f = fixture(Array.from({ length: 4001 }, (_, index) => message(index + 1)));
  const result = await f.run("老友小圈关于露营装备聊了什么？");
  assert.equal(f.queries.filter((query) => query.table === "messages").length, 20);
  assert.equal(result.coverage?.scanned_message_count, 4000); assert.equal(result.coverage?.scan_limit_reached, true);
  assert.match(result.coverage!.note, /不能声称覆盖全部历史/);
});

Deno.test("a topic absent from scanned history is not described as a successful match", async () => {
  const f = fixture([message(1, "晚饭吃面")]);
  const result = await f.run("老友小圈关于露营装备聊了什么？");
  assert.equal(result.coverage?.keyword_match_count, 0); assert.match(result.coverage!.note, /未命中指定关键词/);
  assert.equal(result.sources.length, 1); assert.equal(result.coverage?.scan_limit_reached, false);
});

Deno.test("a nonmember required space returns no messages and never expands into another group", async () => {
  const f = fixture([message(1)]); const result = await f.run("老友小圈最近聊了什么？", "not-member");
  assert.deepEqual(result, { messages: [], sources: [] }); assert.equal(f.plannerCalls(), 0);
  assert.equal(f.queries.filter((query) => query.table === "messages").length, 0);
});
