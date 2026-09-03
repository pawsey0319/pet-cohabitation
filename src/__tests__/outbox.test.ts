jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import { AccountOutboxStore, MessageOutbox, OUTBOX_KEY, type OutboxStore } from "../chat/outbox";
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

describe("account-scoped persistent outbox", () => {
  function setup() {
    const values = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
    };
    return { values, storage };
  }

  it("migrates only the signed-in account's legacy pending messages", async () => {
    const { values, storage } = setup();
    const other = { ...message("other-private-draft"), senderId: "user-2" };
    values.set(OUTBOX_KEY, JSON.stringify([message("own"), other]));
    expect(await new AccountOutboxStore(storage, "user-1").load()).toEqual([message("own")]);
    expect(await new AccountOutboxStore(storage, "user-2").load()).toEqual([other]);
    expect(JSON.parse(values.get(OUTBOX_KEY)!)).toHaveLength(2);
  });

  it("does not resurrect a migrated message after it has been sent", async () => {
    const { values, storage } = setup();
    values.set(OUTBOX_KEY, JSON.stringify([message("legacy")]));
    const queue = new MessageOutbox(new AccountOutboxStore(storage, "user-1"));
    await queue.flush(async () => undefined);
    expect(await new AccountOutboxStore(storage, "user-1").load()).toEqual([]);
  });

  it("keeps queues independent when two accounts use the same device", async () => {
    const { storage } = setup();
    const first = new AccountOutboxStore(storage, "user-1");
    const second = new AccountOutboxStore(storage, "user-2");
    const other = { ...message("second"), senderId: "user-2" };
    await Promise.all([first.save([message("first")]), second.save([other])]);
    await first.save([]);
    expect(await second.load()).toEqual([other]);
    expect(await first.load()).toEqual([]);
  });

  it("rejects writes attributed to a different account", async () => {
    const { storage } = setup();
    await expect(new AccountOutboxStore(storage, "user-2").save([message("wrong-owner")])).rejects.toThrow("mismatch");
  });

  it("filters foreign records even in a malformed account-specific cache", async () => {
    const { values, storage } = setup();
    values.set(`${OUTBOX_KEY}:user-2`, JSON.stringify([null, message("wrong-owner")]));
    expect(await new AccountOutboxStore(storage, "user-2").load()).toEqual([]);
  });
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

  it("does not lose a message enqueued while an earlier flush is still running", async () => {
    const store = new MemoryStore();
    const outbox = new MessageOutbox(store);
    await outbox.enqueue(message("first"));
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const sent: string[] = [];
    const firstFlush = outbox.flush(async (item) => {
      sent.push(item.clientId);
      markStarted();
      await release;
    });
    await firstStarted;
    const secondEnqueue = outbox.enqueue(message("second"));
    releaseFirst();
    await Promise.all([firstFlush, secondEnqueue]);
    await outbox.flush(async (item) => { sent.push(item.clientId); });
    expect(sent).toEqual(["first", "second"]);
    expect(await outbox.list()).toEqual([]);
  });
});
