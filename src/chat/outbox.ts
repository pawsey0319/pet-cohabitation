import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueuedMessage } from "../data/types";

export const OUTBOX_KEY = "pet-cohabitation-chat-outbox-v2";

export interface OutboxStore {
  readonly scopeKey?: string;
  load(): Promise<readonly QueuedMessage[]>;
  save(messages: readonly QueuedMessage[]): Promise<void>;
}

export interface OutboxKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export class AccountOutboxStore implements OutboxStore {
  private readonly key: string;
  readonly scopeKey: string;

  constructor(private readonly storage: OutboxKeyValueStore, private readonly ownerId: string) {
    if (!ownerId) throw new Error("Outbox requires an account");
    this.key = `${OUTBOX_KEY}:${encodeURIComponent(ownerId)}`;
    this.scopeKey = this.key;
  }

  async load(): Promise<readonly QueuedMessage[]> {
    const ownRaw = await this.storage.getItem(this.key);
    const raw = ownRaw ?? await this.storage.getItem(OUTBOX_KEY);
    let ownMessages: readonly QueuedMessage[] = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      ownMessages = Array.isArray(parsed) ? parsed.filter((item) => item?.senderId === this.ownerId) : [];
    } catch { /* Do not expose malformed legacy data. */ }
    // Migrate only this account. Retain other accounts' legacy records, and save
    // even an empty queue so a sent legacy message cannot reappear next launch.
    if (ownRaw === null) await this.save(ownMessages);
    return ownMessages;
  }

  async save(messages: readonly QueuedMessage[]): Promise<void> {
    if (messages.some((message) => message.senderId !== this.ownerId)) throw new Error("Outbox account mismatch");
    await this.storage.setItem(this.key, JSON.stringify(messages));
  }
}

export class AsyncStorageOutboxStore extends AccountOutboxStore {
  constructor(ownerId: string) { super(AsyncStorage, ownerId); }
}

const storeLocks = new Map<object | string, Promise<unknown>>();
const activeFlushes = new Map<object | string, Promise<readonly QueuedMessage[]>>();

export class MessageOutbox {
  private readonly lockKey: object | string;

  constructor(private readonly store: OutboxStore) { this.lockKey = store.scopeKey ?? store; }

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
      const current = await this.store.load();
      const existing = current.find((item) => item.clientId === message.clientId);
      if (existing) {
        const payload = (item: QueuedMessage) => JSON.stringify([item.senderId,item.spaceId,item.kind,item.text,item.localMediaUri ?? null,item.replyToMessageId ?? null,item.replyPreview ?? null,item.mediaMimeType ?? null,item.mediaDurationSeconds ?? null,[...(item.mentionedUserIds ?? [])].sort(),[...(item.mentionedPetIds ?? [])].sort()]);
        if (payload(existing) !== payload(message)) throw new Error("同一条待发送消息不能修改内容，请重新发送。");
        return;
      }
      await this.store.save([...current, message]);
    });
  }

  async remove(clientId: string): Promise<void> {
    await this.locked(async () => {
      const current = await this.store.load();
      await this.store.save(current.filter((item) => item.clientId !== clientId));
    });
  }

  async list(): Promise<readonly QueuedMessage[]> {
    return this.locked(() => this.store.load());
  }

  flush(send: (message: QueuedMessage) => Promise<void>): Promise<readonly QueuedMessage[]> {
    const active = activeFlushes.get(this.lockKey);
    if (active) return active.then(async (failed) => {
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
    for (;;) {
      const message = (await this.list()).find((item) => !attempted.has(item.clientId));
      if (!message) break;
      attempted.add(message.clientId);
      try {
        await send(message);
        await this.remove(message.clientId);
      } catch {
        await this.locked(async () => {
          const current = await this.store.load();
          await this.store.save(current.map((item) => item.clientId === message.clientId ? { ...item, attempts: item.attempts + 1 } : item));
        });
      }
    }
    return (await this.list()).filter((item) => attempted.has(item.clientId));
  }
}

export function createClientId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return cryptoObject?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
