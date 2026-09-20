import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage } from "../data/types";

export type MessageCursor = Readonly<{ at: string; id: string }>;
export type ChatChange = Readonly<{ kind: "messages" | "auxiliary" | "connected" | "permission"; ids?: readonly string[] }>;
export const MESSAGE_CACHE_PREFIX = "pet-chat-messages-v1:";
export type MessageSnapshot = Readonly<{ messages: readonly ChatMessage[]; cursor: MessageCursor | null; hasOlder: boolean }>;

/** Pending outbox IDs have no server row and cannot be used as a read receipt cursor. */
export function latestSentMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].deliveryState === "sent" && !messages[index].deletedAt) return messages[index];
  }
  return undefined;
}

export function mergeMessages(...groups: readonly (readonly ChatMessage[])[]): readonly ChatMessage[] {
  const byKey = new Map<string, ChatMessage>();
  const deleted = new Set(groups.flat().filter((m) => m.deletedAt).map((m) => m.id));
  for (const message of groups.flat()) {
    const key = `${message.senderId}:${message.clientId}`;
    const existing = byKey.get(key);
    // A persisted ACK must not be overwritten by an outbox snapshot read before removal.
    if (existing?.deliveryState === "sent" && message.deliveryState !== "sent") continue;
    if (existing?.updatedAt && message.updatedAt && existing.updatedAt > message.updatedAt) continue;
    byKey.set(key, message);
  }
  return [...byKey.values()].filter((m) => !m.deletedAt && !deleted.has(m.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function newestCursor(messages: readonly ChatMessage[], previous: MessageCursor | null = null): MessageCursor | null {
  return messages.reduce<MessageCursor | null>((cursor, message) => {
    const at = message.updatedAt ?? message.createdAt;
    return !cursor || at > cursor.at || (at === cursor.at && message.id > cursor.id) ? { at, id: message.id } : cursor;
  }, previous);
}

type CacheStorage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;
const liveCaches = new Map<string, Set<MessageCache>>();
export class MessageCache {
  readonly key: string;
  private invalidated = false;
  private write: Promise<unknown> = Promise.resolve();
  constructor(readonly ownerId: string, readonly spaceId: string, private readonly storage: CacheStorage = AsyncStorage) {
    this.key = `${MESSAGE_CACHE_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(spaceId)}`;
    const own = liveCaches.get(ownerId) ?? new Set<MessageCache>();
    own.add(this); liveCaches.set(ownerId,own);
  }
  async load(): Promise<MessageSnapshot | null> {
    try {
      const raw = await this.storage.getItem(this.key);
      if (!raw || this.invalidated) return null;
      const value = JSON.parse(raw);
      if (value.ownerId !== this.ownerId || value.spaceId !== this.spaceId || !Array.isArray(value.messages)) return null;
      return { messages: value.messages.filter((m: ChatMessage) => m.spaceId === this.spaceId && m.deliveryState === "sent" && !m.deletedAt), cursor: value.cursor ?? null, hasOlder: !!value.hasOlder };
    } catch { return null; }
  }
  save(snapshot: MessageSnapshot): Promise<unknown> {
    this.write = this.write.catch(() => undefined).then(async () => {
      if (this.invalidated) return;
      const messages = snapshot.messages.filter((m) => m.spaceId === this.spaceId && m.deliveryState === "sent" && !m.deletedAt).slice(-500);
      await this.storage.setItem(this.key, JSON.stringify({ ...snapshot, messages, ownerId: this.ownerId, spaceId: this.spaceId, hasOlder: snapshot.hasOlder || snapshot.messages.length > 500 }));
    });
    return this.write;
  }
  async clear(): Promise<void> {
    this.invalidated = true;
    await this.write.catch(() => undefined);
    await this.storage.removeItem(this.key);
  }
}

export async function clearAccountMessageCaches(ownerId: string): Promise<void> {
  await Promise.all([...(liveCaches.get(ownerId) ?? [])].map((cache) => cache.clear()));
  liveCaches.delete(ownerId);
  const prefix = `${MESSAGE_CACHE_PREFIX}${encodeURIComponent(ownerId)}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if(keys.length) await AsyncStorage.multiRemove(keys);
}

// At most one fetch runs. Events arriving in flight cause one more incremental pass.
export function coalesceRefresh(refresh: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let dirty = false;
  return () => {
    dirty = true;
    if (running) return running;
    running = (async () => { do { dirty = false; await refresh(); } while (dirty); })()
      .finally(() => { running = null; });
    return running;
  };
}
