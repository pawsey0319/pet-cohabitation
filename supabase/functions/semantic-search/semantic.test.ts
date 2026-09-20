import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { searchSemantically, type SearchResult } from "../_shared/semanticSearch.ts";
const row = (id: string): SearchResult => ({ id, type: "message", title: "自己的资料", snippet: id, createdAt: "2026-09-11T00:00:00Z", spaceId: null, sourceMessageId: id, route: `/pet?messageId=${id}` });
function assert(value: unknown, label: string) { if (!value) throw new Error(label); }
Deno.test("bounds expansion and drops forged model citations, final gate excludes revoked candidates", async () => {
  let gates = 0; const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "search_owned_content") return { data: [row("allowed"), row("forgotten-before-model"), row("revoked-during-model")], error: null };
    gates++; return { data: gates === 1 ? [row("allowed"), row("revoked-during-model")] : [row("allowed")], error: null };
  } } as unknown as SupabaseClient;
  let modelRows: SearchResult[] = [];
  const result = await searchSemantically(client, "owner-a", { query: "曾讨论过的旅行", types: ["message"] }, {
    expand: async () => ["旅行", "出游", "假期", "第四个不能使用"],
    rank: async (_query, candidates) => { modelRows = candidates; return ["message:forged", "message:revoked-during-model", "message:allowed", "message:allowed"]; },
  });
  assert(calls.filter(call => call.name === "search_owned_content").length === 4, "at most original plus three phrases");
  assert(modelRows.every(item => item.id !== "forgotten-before-model"), "excluded data never reaches ranker");
  assert(result.results.length === 1 && result.results[0].id === "allowed", "forged and revoked sources not returned");
  assert(gates === 2 && calls.every(call => call.args.p_owner === "owner-a"), "fresh checks before and after model stay owner scoped");
});
Deno.test("model failure is surfaced and never falls through to invented answer or data writes", async () => {
  let called = false;
  const client = { rpc: () => { called = true; throw new Error("unexpected"); } } as unknown as SupabaseClient;
  let failed = false;
  try { await searchSemantically(client, "owner", { query: "资料", types: ["memory"] }, { expand: async () => { throw new Error("offline"); }, rank: async () => [] }); } catch { failed = true; }
  assert(failed && !called, "model unavailability stays explicit");
});
Deno.test("empty authorized recall does not ask a model to invent a result", async () => {
  const client = { rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient;
  const result = await searchSemantically(client, "owner", { query: "不存在的资料", types: ["work"] }, { expand: async () => [], rank: async () => { throw new Error("must_not_rank_empty"); } });
  assert(result.results.length === 0, "no candidates yields no claims");
});
