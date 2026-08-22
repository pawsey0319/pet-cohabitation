jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import { MessageOutbox, type OutboxStore } from "../chat/outbox";
import type { QueuedMessage } from "../data/types";

class MemoryStore implements OutboxStore {
  value: readonly QueuedMessage[] = [];
  async load() { return this.value; }
  async save(messages: readonly QueuedMessage[]) { this.value = [...messages]; }
}

const message = (id: string): QueuedMessage => ({
  clientId: id,
  spaceId: "space-1",
  senderId: "user-1",
  kind: "text",
  text: id,
  createdAt: "2026-08-21T00:00:00.000Z",
  attempts: 0,
});

describe("MessageOutbox", () => {
  it("deduplicates by client id and removes only after a successful send", async () => {
    const store = new MemoryStore();
    const outbox = new MessageOutbox(store);
    await outbox.enqueue(message("same"));
    await outbox.enqueue(message("same"));
    expect(await outbox.list()).toHaveLength(1);
    const sent: string[] = [];
    await outbox.flush(async (item) => { sent.push(item.clientId); });
    expect(sent).toEqual(["same"]);
    expect(await outbox.list()).toEqual([]);
  });

  it("keeps failed messages and increments their attempt count", async () => {
    const store = new MemoryStore();
    const outbox = new MessageOutbox(store);
    await outbox.enqueue(message("offline"));
    await outbox.flush(async () => { throw new Error("offline"); });
    expect((await outbox.list())[0]).toMatchObject({ clientId: "offline", attempts: 1 });
  });

  it("coalesces concurrent flushes so a message is not sent twice", async () => {
    const store = new MemoryStore();
    const outbox = new MessageOutbox(store);
    await outbox.enqueue(message("once"));
    let sends = 0;
    const sender = async () => { sends += 1; await Promise.resolve(); };
    await Promise.all([outbox.flush(sender), outbox.flush(sender)]);
    expect(sends).toBe(1);
  });
});
