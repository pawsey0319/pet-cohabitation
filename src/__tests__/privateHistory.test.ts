import { mergePrivateHistory } from "../pets/privateHistory";
import type { PetPrivateMessage } from "../data/types";
const row = (id: string, minute: number, extra: Partial<PetPrivateMessage> = {}): PetPrivateMessage => ({ id, role: "owner", content: id, createdAt: `2026-09-11T00:${String(minute).padStart(2, "0")}:00Z`, ...extra });
test("latest refresh retains old history and replaces authoritative rows in the latest window", () => {
  const result = mergePrivateHistory([row("old", 1), row("deleted", 30), row("changed", 31)], [row("first", 29), row("changed", 31, { replyStatus: "succeeded" })], true);
  expect(result.map(item => item.id)).toEqual(["old", "first", "changed"]);
  expect(result[2].replyStatus).toBe("succeeded");
});
test("real receipts replace optimistic IDs once while preserving later unsent messages", () => {
  const result = mergePrivateHistory([row("pending:req", 1, { requestKey: "req" }), row("pending:next", 3, { requestKey: "next" })], [row("real", 2, { requestKey: "req" })], true);
  expect(result.map(item => item.id)).toEqual(["real", "pending:next"]);
});
test("older pages merge equal timestamps by ID without losing new rows", () => {
  expect(mergePrivateHistory([row("c", 2)], [row("b", 1), row("a", 1)]).map(item => item.id)).toEqual(["a", "b", "c"]);
});
