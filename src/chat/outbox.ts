import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueuedMessage } from "../data/types";

export const OUTBOX_KEY = "pet-cohabitation-chat-outbox-v2";

export interface OutboxStore {
  readonly scopeKey?: string;
  load(): Promise<readonly QueuedMessage[]>;
  save(messages: readonly QueuedMessage[]): Promise<void>;
  put?(message: QueuedMessage): Promise<void>;
  remove?(clientId: string): Promise<void>;
  fail?(clientId: string): Promise<void>;
}

export interface OutboxKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function immutableMessagePayload(item: QueuedMessage): string {
  return JSON.stringify([item.senderId,item.spaceId,item.kind,item.text,item.localMediaUri ?? null,item.replyToMessageId ?? null,item.replyPreview ?? null,item.mediaMimeType ?? null,item.mediaDurationSeconds ?? null,item.mediaSizeBytes ?? null,[...(item.mentionedUserIds ?? [])].sort(),[...(item.mentionedPetIds ?? [])].sort()]);
}

export class AccountOutboxStore implements OutboxStore {
  // Different owners still share the legacy key. Serialize its read/modify/write
  // across instances; Web Locks additionally cover browser tabs on this origin.
  private static localWrites: Promise<void> = Promise.resolve();
  private readonly key: string;
  readonly scopeKey: string;

  constructor(private readonly storage: OutboxKeyValueStore, private readonly ownerId: string) {
    if (!ownerId) throw new Error("Outbox requires an account");
    this.key = `${OUTBOX_KEY}:${encodeURIComponent(ownerId)}`;
    this.scopeKey = this.key;
  }

  private locked<T>(operation: () => Promise<T>): Promise<T> {
    const task = AccountOutboxStore.localWrites.then(() => {
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      return locks?.request ? locks.request(OUTBOX_KEY, operation) : operation();
    });
    AccountOutboxStore.localWrites = task.then(() => undefined, () => undefined);
    return task;
  }

  private parse(raw: string | null): readonly QueuedMessage[] | null {
    try {
      const parsed = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  private async removeLegacyOwner(): Promise<void> {
    const values = this.parse(await this.storage.getItem(OUTBOX_KEY));
    // Unparseable data cannot safely be attributed to this account; never erase
    // another account's recovery material to repair a malformed legacy blob.
    if (!values?.some(item => item?.senderId === this.ownerId)) return;
    await this.storage.setItem(OUTBOX_KEY, JSON.stringify(values.filter(item => item?.senderId !== this.ownerId)));
  }

  load(): Promise<readonly QueuedMessage[]> {
    return this.locked(async () => {
      const ownRaw = await this.storage.getItem(this.key);
      const raw = ownRaw ?? await this.storage.getItem(OUTBOX_KEY);
      const ownMessages = (this.parse(raw) ?? []).filter(item => item?.senderId === this.ownerId);
      // Write the scoped queue first, including [] as a durable migration marker.
      // A crash before cleanup can leave duplicates but must not lose pending data.
      if (ownRaw === null) await this.storage.setItem(this.key, JSON.stringify(ownMessages));
      // Also repair residue left by previous app versions after their migration.
      await this.removeLegacyOwner();
      return ownMessages;
    });
  }

  async save(messages: readonly QueuedMessage[]): Promise<void> {
    if (messages.some((message) => message.senderId !== this.ownerId)) throw new Error("Outbox account mismatch");
    await this.locked(async () => {
      await this.storage.setItem(this.key, JSON.stringify(messages));
      await this.removeLegacyOwner();
    });
  }
}

export class AsyncStorageOutboxStore extends AccountOutboxStore {
  constructor(ownerId: string) { super(AsyncStorage, ownerId); }
}

const storeLocks = new Map<object | string, Promise<unknown>>();
const activeFlushes = new Map<object | string, Promise<readonly QueuedMessage[]>>();
// A logout starts a new local account lifetime. Old network operations must never
// drain, acknowledge or fail rows belonging to a later sign-in of the same user.
const storeEpochs = new Map<object | string, number>();

export class MessageOutbox {
  private readonly lockKey: object | string;
  private readonly epoch: number;

  constructor(private readonly store: OutboxStore) {
    this.lockKey = store.scopeKey ?? store;
    this.epoch = storeEpochs.get(this.lockKey) ?? 0;
  }
  private current() { return this.epoch === (storeEpochs.get(this.lockKey) ?? 0); }
  private assertCurrent() { if (!this.current()) throw new Error("发送账号已退出，请在当前账号重新发送。"); }

  // Only serialize local read/modify/write. A network send must never hold this lock.
  private locked<T>(operation: () => Promise<T>): Promise<T> {
    const previous = storeLocks.get(this.lockKey) ?? Promise.resolve();
    const running = previous.catch(() => undefined).then(operation);
    storeLocks.set(this.lockKey, running);
    void running.finally(() => { if (storeLocks.get(this.lockKey) === running) storeLocks.delete(this.lockKey); }).catch(() => undefined);
    return running;
  }

  async enqueue(message: QueuedMessage): Promise<void> {
    await this.locked(async () => {
      this.assertCurrent();
      if (this.store.put) return this.store.put(message);
      const current = await this.store.load();
      const existing = current.find((item) => item.clientId === message.clientId);
      if (existing) {
        if (immutableMessagePayload(existing) !== immutableMessagePayload(message)) throw new Error("同一条待发送消息不能修改内容，请重新发送。");
        return;
      }
      await this.store.save([...current, message]);
    });
  }

  async remove(clientId: string): Promise<void> {
    await this.locked(async () => {
      this.assertCurrent();
      if (this.store.remove) return this.store.remove(clientId);
      const current = await this.store.load();
      await this.store.save(current.filter((item) => item.clientId !== clientId));
    });
  }

  async list(): Promise<readonly QueuedMessage[]> {
    return this.locked(() => this.current() ? this.store.load() : Promise.resolve([]));
  }

  async clear(): Promise<void> {
    if (!this.current()) return;
    const next = this.epoch + 1;
    storeEpochs.set(this.lockKey, next);
    // A new account lifetime can send immediately instead of attaching to the
    // old, potentially hung upload. Existing local writes still finish first.
    activeFlushes.delete(this.lockKey);
    await this.locked(async () => {
      if (storeEpochs.get(this.lockKey) === next) await this.store.save([]);
    });
  }

  flush(send: (message: QueuedMessage) => Promise<void>): Promise<readonly QueuedMessage[]> {
    if (!this.current()) return Promise.resolve([]);
    const active = activeFlushes.get(this.lockKey);
    if (active) return active.then(async (failed) => {
      if (!this.current()) return [];
      // Catch a fresh enqueue arriving while the previous drain was finishing.
      const pending = await this.list();
      return pending.some((item) => item.attempts === 0) ? this.flush(send) : failed;
    });
    const running = this.flushOnce(send).finally(() => {
      if (activeFlushes.get(this.lockKey) === running) activeFlushes.delete(this.lockKey);
    });
    activeFlushes.set(this.lockKey, running);
    return running;
  }

  private async flushOnce(send: (message: QueuedMessage) => Promise<void>): Promise<readonly QueuedMessage[]> {
    const attempted = new Set<string>();
    const busySpaces = new Set<string>();
    const sending = new Set<Promise<void>>();
    const attempt = async (message: QueuedMessage) => {
      try {
        if (!this.current()) return;
        await send(message);
        if (!this.current()) return;
        await this.remove(message.clientId);
      } catch {
        if (!this.current()) return;
        await this.locked(async () => {
          if (!this.current()) return;
          if (this.store.fail) return this.store.fail(message.clientId);
          const current = await this.store.load();
          await this.store.save(current.map((item) => item.clientId === message.clientId ? { ...item, attempts: item.attempts + 1 } : item));
        });
      }
    };
    for (;;) {
      if (!this.current()) return [];
      const message = (await this.list()).find((item) => !attempted.has(item.clientId) && !busySpaces.has(item.spaceId));
      if (!this.current()) return [];
      if (!message || sending.size >= 3) {
        if (!sending.size) break;
        await Promise.race(sending);
        continue;
      }
      attempted.add(message.clientId);
      busySpaces.add(message.spaceId);
      const task = attempt(message).finally(() => { busySpaces.delete(message.spaceId); sending.delete(task); });
      sending.add(task);
    }
    return (await this.list()).filter((item) => attempted.has(item.clientId));
  }
}

export function createClientId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return cryptoObject?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
