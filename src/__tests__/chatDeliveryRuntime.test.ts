jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../chat/persistentOutbox", () => ({
  createPersistentOutboxStore: (owner: string) => new (require("../chat/outbox").AsyncStorageOutboxStore)(owner),
}));
jest.mock("../chat/mediaFile", () => ({ removeStabilizedMedia: jest.fn().mockResolvedValue(undefined) }));
import { clearChatDelivery, getChatDelivery, stopChatDelivery, type DeliveryEvent } from "../chat/deliveryRuntime";
import type { ChatRepository } from "../data/chatRepository";
import type { AppProfile, ChatMessage, QueuedMessage } from "../data/types";

const profile = (id: string) => ({ id, nickname: "测试用户", avatarUrl: null } as AppProfile);
const pending = (owner: string, clientId: string): QueuedMessage => ({ senderId: owner, spaceId: "group", clientId, kind: "text", text: clientId, createdAt: "2026-09-20T00:00:00Z", attempts: 0 });
const receipt = (row: QueuedMessage): ChatMessage => ({ ...row, id: `server-${row.clientId}`, actorKind: "human", actorName: "测试用户", mediaPath: null, mediaDurationSeconds: null, replyToMessageId: null, replyPreview: null, deliveryState: "sent", reactions: {} });
const repository = (send: (row: QueuedMessage) => Promise<ChatMessage>) => ({ sendMessage: jest.fn(send) }) as unknown as ChatRepository;

it("a new login sends while an old stopped runtime still waits for its receipt", async () => {
  const owner = "delivery-relogin";
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const began = new Promise<void>(resolve => { started = resolve; });
  const oldRepository = repository(async row => { started(); await held; return receipt(row); });
  const oldRuntime = getChatDelivery(profile(owner), oldRepository), oldEvents: DeliveryEvent[] = [];
  oldRuntime.subscribe(event => oldEvents.push(event));
  await oldRuntime.enqueue(pending(owner, "old")); await began;
  const draining = oldRuntime.flush();
  // Session adoption stops first; cleanup therefore constructs another outbox.
  stopChatDelivery(owner); await clearChatDelivery(owner);
  const freshRepository = repository(async row => receipt(row));
  const fresh = getChatDelivery(profile(owner), freshRepository), events: DeliveryEvent[] = [];
  fresh.subscribe(event => events.push(event));
  await fresh.enqueue(pending(owner, "fresh")); await fresh.flush();
  expect(freshRepository.sendMessage).toHaveBeenCalledTimes(1);
  expect(events.map(event => [event.clientId, event.status])).toEqual([["fresh", "sent"]]);
  release(); await draining;
  expect(oldEvents).toEqual([]); expect(await fresh.outbox.list()).toEqual([]);
  await expect(oldRuntime.enqueue(pending(owner, "late"))).rejects.toThrow("账号已切换");
  await clearChatDelivery(owner);
});

it("shared pages preserve a queued offline message and send it only once on reconnect", async () => {
  const owner = "delivery-offline";
  const repo = repository(async row => receipt(row));
  const runtime = getChatDelivery(profile(owner), repo);
  expect(getChatDelivery(profile(owner), repo)).toBe(runtime);
  runtime.setOnline(false);
  await runtime.enqueue(pending(owner, "offline"));
  expect(repo.sendMessage).not.toHaveBeenCalled();
  expect((await runtime.outbox.list()).map(row => row.clientId)).toEqual(["offline"]);
  runtime.setOnline(true);
  await Promise.all([runtime.flush(), runtime.flush()]);
  expect(repo.sendMessage).toHaveBeenCalledTimes(1);
  expect(await runtime.outbox.list()).toEqual([]);
  await clearChatDelivery(owner);
});
