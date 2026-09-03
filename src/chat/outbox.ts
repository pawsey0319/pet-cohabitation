import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueuedMessage } from "../data/types";

export const OUTBOX_KEY = "pet-cohabitation-chat-outbox-v2";

export interface OutboxStore {
  load(): Promise<readonly QueuedMessage[]>;
  save(messages: readonly QueuedMessage[]): Promise<void>;
}

export interface OutboxKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export class AccountOutboxStore implements OutboxStore {
  private readonly key: string;

  constructor(private readonly storage: OutboxKeyValueStore, private readonly ownerId: string) {
    if (!ownerId) throw new Error("Outbox requires an account");
    this.key = `${OUTBOX_KEY}:${encodeURIComponent(ownerId)}`;
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

export class MessageOutbox {
  private flushing: Promise<readonly QueuedMessage[]> | null = null;

  constructor(private readonly store: OutboxStore) {}

  async enqueue(message: QueuedMessage): Promise<void> {
    if (this.flushing) await this.flushing;
    const current = await this.store.load();
    if (current.some((item) => item.clientId === message.clientId)) return;
    await this.store.save([...current, message]);
  }

  async remove(clientId: string): Promise<void> {
    const current = await this.store.load();
    await this.store.save(current.filter((item) => item.clientId !== clientId));
  }

  async list(): Promise<readonly QueuedMessage[]> {
    return this.store.load();
  }

  flush(send: (message: QueuedMessage) => Promise<void>): Promise<readonly QueuedMessage[]> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushOnce(send).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async flushOnce(send: (message: QueuedMessage) => Promise<void>): Promise<readonly QueuedMessage[]> {
    const queue = [...await this.store.load()];
    const failed: QueuedMessage[] = [];
    for (const message of queue) {
      try {
        await send(message);
      } catch {
        failed.push({ ...message, attempts: message.attempts + 1 });
      }
    }
    await this.store.save(failed);
    return failed;
  }
}

export function createClientId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return cryptoObject?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
