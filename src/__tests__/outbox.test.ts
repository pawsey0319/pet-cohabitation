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
    expect(JSON.parse(values.get(OUTBOX_KEY)!)).toEqual([other]);
    expect(await new AccountOutboxStore(storage, "user-2").load()).toEqual([other]);
    expect(JSON.parse(values.get(OUTBOX_KEY)!)).toEqual([]);
  });

  it("cleans leftovers for already migrated accounts without importing sent messages again", async () => {
    const { values, storage } = setup(); const other = { ...message("other"), senderId: "user-2" };
    values.set(OUTBOX_KEY, JSON.stringify([message("already-sent"), other]));
    values.set(`${OUTBOX_KEY}:user-1`, "[]");
    expect(await new AccountOutboxStore(storage, "user-1").load()).toEqual([]);
    expect(JSON.parse(values.get(OUTBOX_KEY)!)).toEqual([other]);
  });

  it("account cleanup removes its old plaintext without first loading the queue", async () => {
    const { values, storage } = setup(); const other = { ...message("other"), senderId: "user-2" };
    values.set(OUTBOX_KEY, JSON.stringify([message("private-old-body"), other]));
    await new AccountOutboxStore(storage, "user-1").save([]);
    expect(JSON.parse(values.get(OUTBOX_KEY)!)).toEqual([other]);
    expect(await new AccountOutboxStore(storage, "user-1").load()).toEqual([]);
  });

  it("serializes concurrent migrations across accounts without reviving or deleting either queue", async () => {
    const { values, storage } = setup(); const other = { ...message("other"), senderId: "user-2" };
    const untouched = { ...message("third-account"), senderId: "user-3" };
    values.set(OUTBOX_KEY, JSON.stringify([message("own"), other, untouched]));
    const results = await Promise.all([new AccountOutboxStore(storage, "user-1").load(), new AccountOutboxStore(storage, "user-2").load()]);
    expect(results).toEqual([[message("own")], [other]]);
    expect(JSON.parse(values.get(OUTBOX_KEY)!)).toEqual([untouched]);
    expect(JSON.parse(values.get(`${OUTBOX_KEY}:user-1`)!)).toEqual([message("own")]);
    expect(JSON.parse(values.get(`${OUTBOX_KEY}:user-2`)!)).toEqual([other]);
  });

  it("leaves recovery data intact if the first scoped write fails", async () => {
    const { values, storage } = setup(); values.set(OUTBOX_KEY, JSON.stringify([message("recoverable")]));
    const write = storage.setItem; storage.setItem = jest.fn().mockRejectedValueOnce(new Error("disk full")).mockImplementation(write);
    await expect(new AccountOutboxStore(storage, "user-1").load()).rejects.toThrow("disk full");
    expect(JSON.parse(values.get(OUTBOX_KEY)!)).toEqual([message("recoverable")]);
    expect(await new AccountOutboxStore(storage, "user-1").load()).toEqual([message("recoverable")]);
    expect(JSON.parse(values.get(OUTBOX_KEY)!)).toEqual([]);
  });

  it("retries interrupted cleanup without reviving a cleared message", async () => {
    const { values, storage } = setup(); const other = { ...message("keep"), senderId: "user-2" };
    values.set(OUTBOX_KEY, JSON.stringify([message("must-stay-cleared"), other]));
    const write = storage.setItem; let fail = true;
    storage.setItem = async (key, value) => { if (key === OUTBOX_KEY && fail) { fail = false; throw new Error("cleanup interrupted"); } await write(key, value); };
    await expect(new AccountOutboxStore(storage, "user-1").save([])).rejects.toThrow("cleanup interrupted");
    expect(await new AccountOutboxStore(storage, "user-1").load()).toEqual([]); expect(JSON.parse(values.get(OUTBOX_KEY)!)).toEqual([other]);
  });

  it("shares the origin Web Lock before touching the legacy key when available", async () => {
    const { values, storage } = setup(); values.set(OUTBOX_KEY, JSON.stringify([message("locked")]));
    const previous = Object.getOwnPropertyDescriptor(navigator, "locks"); let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const request = jest.fn(async (_name: string, operation: () => Promise<unknown>) => { await held; return operation(); });
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
    try {
      const loading = new AccountOutboxStore(storage, "user-1").load();
      await Promise.resolve(); await Promise.resolve(); expect(request).toHaveBeenCalledWith(OUTBOX_KEY, expect.any(Function));
      expect(values.has(`${OUTBOX_KEY}:user-1`)).toBe(false); release(); expect(await loading).toEqual([message("locked")]);
    } finally { release(); if (previous) Object.defineProperty(navigator, "locks", previous); else Reflect.deleteProperty(navigator, "locks"); }
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
  it("a stopped account drain cannot fail messages after the same account signs in again", async () => {
    const store = new MemoryStore(), oldQueue = new MessageOutbox(store);
    await oldQueue.enqueue(message("old-request"));
    let release!: () => void, started!: () => void, oldEnabled = true;
    const held = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { started = resolve; });
    const oldSends: string[] = [], newSends: string[] = [];
    const oldDrain = oldQueue.flush(async row => {
      if (!oldEnabled) throw new Error("delivery_suspended");
      oldSends.push(row.clientId); started(); await held;
    });
    await began; oldEnabled = false; await oldQueue.clear();
    const newQueue = new MessageOutbox(store);
    await newQueue.enqueue(message("new-request"));
    const newDrain = newQueue.flush(async row => { newSends.push(row.clientId); });
    release(); await Promise.all([oldDrain, newDrain]);
    expect(newSends).toEqual(["new-request"]);
    expect(oldSends).toEqual(["old-request"]);
    expect(await newQueue.list()).toEqual([]);
  });

  it("logout fences old pending local writes as well as late acknowledgements", async () => {
    const store = new MemoryStore(), oldQueue = new MessageOutbox(store);
    await oldQueue.clear();
    const newQueue = new MessageOutbox(store);
    await newQueue.enqueue(message("current-session"));
    await expect(oldQueue.enqueue(message("late-old-session"))).rejects.toThrow("账号");
    await oldQueue.clear();
    expect(await newQueue.list()).toEqual([message("current-session")]);
  });

  it("a slow upload blocks its own conversation but not another group's text", async () => {
    const queue=new MessageOutbox(new MemoryStore());
    await queue.enqueue({...message("image"),kind:"image",localMediaUri:"file://image"});
    await queue.enqueue(message("same-group"));
    await queue.enqueue({...message("other-group"),spaceId:"space-2"});
    let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
    let received!:()=>void;const otherReceived=new Promise<void>(resolve=>{received=resolve;});const sent:string[]=[];
    const work=queue.flush(async value=>{sent.push(value.clientId);if(value.clientId==="image")await held;if(value.clientId==="other-group")received();});
    await otherReceived;expect(sent).toEqual(["image","other-group"]);
    release();await work;expect(sent).toEqual(["image","other-group","same-group"]);
  });
  it("accepts new typing into the queue before a slow upload finishes", async () => {
    const outbox = new MessageOutbox(new MemoryStore());
    await outbox.enqueue(message("upload"));
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const sending = outbox.flush(async () => { started(); await held; });
    await began;
    // This await would deadlock if enqueue still waited for the network drain.
    await outbox.enqueue(message("next"));
    expect((await outbox.list()).map((m) => m.clientId)).toEqual(["upload", "next"]);
    release(); await sending;
  });

  it("serializes simultaneous local enqueues across queue instances", async () => {
    const store = new MemoryStore();
    const first = new MessageOutbox(store), second = new MessageOutbox(store);
    await Promise.all(Array.from({length:20},(_,i) => (i%2 ? first : second).enqueue(message(`item-${i}`))));
    expect(await first.list()).toHaveLength(20);
    const sent: string[] = [];
    await Promise.all([first.flush(async (m)=>{sent.push(m.clientId);}),second.flush(async (m)=>{sent.push(m.clientId);})]);
    expect(new Set(sent).size).toBe(20); expect(sent).toHaveLength(20);
  });

  it("rejects an immutable request ID reused with new text or attachments", async () => {
    const outbox = new MessageOutbox(new MemoryStore());
    await outbox.enqueue(message("fixed"));
    await expect(outbox.enqueue({...message("fixed"),text:"replacement"})).rejects.toThrow("不能修改");
    await expect(outbox.enqueue({...message("fixed"),localMediaUri:"private.jpg"})).rejects.toThrow("不能修改");
  });

  it("does not restore a removed in-flight item after a send failure", async () => {
    const outbox = new MessageOutbox(new MemoryStore());
    await outbox.enqueue(message("removed"));
    await outbox.flush(async () => { await outbox.remove("removed"); throw new Error("offline"); });
    expect(await outbox.list()).toEqual([]);
  });

  it("persists each ACK before the next upload and continues after a failed item", async () => {
    const store = new MemoryStore(), outbox = new MessageOutbox(store);
    await Promise.all(["first","bad","last"].map((id)=>outbox.enqueue(message(id))));
    await outbox.flush(async (m) => {
      if(m.clientId === "bad") throw new Error("upload failed");
      if(m.clientId === "last") expect((await new MessageOutbox(store).list()).map((x)=>x.clientId)).toEqual(["bad","last"]);
    });
    expect(await outbox.list()).toEqual([{...message("bad"),attempts:1}]);
  });
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
