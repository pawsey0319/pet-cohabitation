import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueuedMessage } from "../data/types";

export const OUTBOX_KEY = "pet-cohabitation-chat-outbox-v2";

export interface OutboxStore {
  load(): Promise<readonly QueuedMessage[]>;
  save(messages: readonly QueuedMessage[]): Promise<void>;
}

export class AsyncStorageOutboxStore implements OutboxStore {
  async load(): Promise<readonly QueuedMessage[]> {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async save(messages: readonly QueuedMessage[]): Promise<void> {
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(messages));
  }
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
