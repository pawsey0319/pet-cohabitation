import { readMemorySource } from "../memory/MemorySourceModal";
jest.mock("../theme/ThemeProvider", () => ({ useAppTheme: () => ({ theme: {} }) }));
const mockRows: Record<string, unknown> = {};
const mockFilters: [string, string, unknown][] = [];
const mockClient = { from: jest.fn((table: string) => {
  const chain = { select: () => chain, eq: (field: string, value: unknown) => { mockFilters.push([table, field, value]); return chain; }, maybeSingle: () => Promise.resolve({ data: mockRows[table] ?? null, error: null }) };
  return chain;
}) };
jest.mock("../lib/supabase", () => ({ requireSupabase: () => mockClient }));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => { for (const table of Object.keys(mockRows)) delete mockRows[table]; mockFilters.length = 0; mockClient.from.mockClear(); });
test("source lookup always constrains current owner and pet and does not extract memory", async () => {
  mockRows.pet_private_threads = { content: "过去的原文", role: "owner", created_at: "2026-09-11T00:00Z" };
  expect((await readMemorySource("owner-a", "pet-a", { kind: "message", id }))?.content).toBe("过去的原文");
  expect(mockFilters).toContainEqual(["pet_private_threads", "owner_id", "owner-a"]);
  expect(mockFilters).toContainEqual(["pet_private_threads", "pet_id", "pet-a"]);
  expect(mockClient.from).toHaveBeenCalledTimes(1);
});
test("a removed memory route no longer displays its source as active memory", async () => {
  mockRows.pet_personal_memories = { content: "已停用资料", updated_at: "2026-09-11T00:00Z", source_message_id: id };
  mockRows.pet_private_context_exclusions = { message_id: id };
  expect(await readMemorySource("owner-a", "pet-a", { kind: "memory", id })).toBeNull();
  expect(mockClient.from).not.toHaveBeenCalledWith("pet_private_threads");
});
test("unavailable or invalid IDs have a readable empty state without fetching full history", async () => {
  expect(await readMemorySource("owner-a", "pet-a", { kind: "message", id: "invalid" })).toBeNull();
  expect(mockClient.from).not.toHaveBeenCalled();
  expect(await readMemorySource("owner-a", "pet-a", { kind: "memory", id })).toBeNull();
  expect(mockFilters).toContainEqual(["pet_life_facts", "state", "active"]);
});
