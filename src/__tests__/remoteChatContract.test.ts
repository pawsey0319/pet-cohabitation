const mockRpc = jest.fn();
const mockInvoke = jest.fn();
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../lib/supabase", () => ({
  isLocalDemoMode: false,
  requireSupabase: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    auth: { getSession: async () => ({ data: { session: { user: { id: "owner" } } } }) },
  }),
}));
import { createChatRepository } from "../data/chatRepository";
import type { QueuedMessage } from "../data/types";
const repository = createChatRepository({ id: "owner", nickname: "本人", email: "owner@example.test" });
const message = { id: "message", client_id: "immutable-request", space_id: "space", space_sequence: "19", sender_id: "owner", actor_kind: "human", kind: "text", text: "消息", created_at: "2026-09-20T01:00:00Z" };
beforeEach(() => { mockRpc.mockReset(); mockInvoke.mockReset().mockResolvedValue({ data: null }); });

it("carries the server cursor through history hydration and incremental sync", async () => {
  mockRpc.mockResolvedValue({ data: [message], error: null });
  expect((await repository.listMessages("space"))[0].spaceSequence).toBe(19);
  expect((await repository.syncMessages("space", { at: "2026-09-19T01:00:00Z", id: "previous" }))[0].spaceSequence).toBe(19);
});
it("returns the durable human message receipt without awaiting the AI route", async () => {
  mockInvoke.mockReturnValue(new Promise(() => undefined));
  mockRpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { message, job_id: "job" }, error: null }) });
  const queued: QueuedMessage = { clientId: "immutable-request", senderId: "owner", spaceId: "space", kind: "text", text: "消息", createdAt: message.created_at, attempts: 0 };
  expect(await repository.sendMessage(queued, "本人")).toMatchObject({ id: "message", spaceSequence: 19, deliveryState: "sent" });
  expect(mockInvoke).toHaveBeenCalledWith("handle-space-message", { body: { message_id: "message" } });
});
it("falls back only for a missing RPC, never for revoked access", async () => {
  mockRpc.mockResolvedValueOnce({ error: { code: "PGRST202" } }).mockResolvedValueOnce({ data: message.created_at, error: null });
  await repository.markRead("space", "message");
  expect(mockRpc.mock.calls.map(call => call[0])).toEqual(["mark_space_read_v3", "mark_space_read_through"]);
  mockRpc.mockReset().mockResolvedValue({ error: { code: "42501", message: "not_space_member" } });
  await expect(repository.markRead("space", "message")).rejects.toMatchObject({ code: "42501" });
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
