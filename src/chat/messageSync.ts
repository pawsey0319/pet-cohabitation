import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage } from "../data/types";

export type MessageCursor = Readonly<{ at: string; id: string; sequence?: number }>;
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
    if (existing?.syncSequence !== undefined && message.syncSequence !== undefined) {
      if(existing.syncSequence>message.syncSequence)continue;
    } else if (existing?.updatedAt && message.updatedAt && existing.updatedAt > message.updatedAt) continue;
    byKey.set(key, message);
  }
  return [...byKey.values()].filter((m) => !m.deletedAt && !deleted.has(m.id))
    .sort((a, b) => a.spaceSequence && b.spaceSequence
      ? a.spaceSequence-b.spaceSequence
      : a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function newestCursor(messages: readonly ChatMessage[], previous: MessageCursor | null = null): MessageCursor | null {
  return messages.reduce<MessageCursor | null>((cursor, message) => {
    const at = message.updatedAt ?? message.createdAt;
    if(message.syncSequence !== undefined || cursor?.sequence !== undefined) {
      return message.syncSequence !== undefined && (cursor?.sequence === undefined || message.syncSequence>cursor.sequence)
        ? {at,id:message.id,sequence:message.syncSequence} : cursor;
    }
    return !cursor || at > cursor.at || (at === cursor.at && message.id > cursor.id) ? { at, id: message.id } : cursor;
  }, previous);
}

type CacheStorage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;
const liveCaches = new Map<string, Set<MessageCache>>();
const cacheEpochs = new Map<string, number>();
const cacheWrites = new Map<string, Promise<unknown>>();
const accountClears = new Map<string, Promise<void>>();
function cacheWrite<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const running = (cacheWrites.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
  cacheWrites.set(key, running);
  void running.finally(() => { if(cacheWrites.get(key)===running)cacheWrites.delete(key); }).catch(()=>undefined);
  return running;
}
export class MessageCache {
  readonly key: string;
  private readonly epoch: number;
  private readonly accountBarrier: Promise<void>;
  constructor(readonly ownerId: string, readonly spaceId: string, private readonly storage: CacheStorage = AsyncStorage) {
    this.key = `${MESSAGE_CACHE_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(spaceId)}`;
    this.epoch=cacheEpochs.get(this.key) ?? 0;
    this.accountBarrier=accountClears.get(ownerId) ?? Promise.resolve();
    const own = liveCaches.get(ownerId) ?? new Set<MessageCache>();
    own.add(this); liveCaches.set(ownerId,own);
  }
  private current(){return this.epoch===(cacheEpochs.get(this.key) ?? 0);}
  async load(): Promise<MessageSnapshot | null> {
    try {
      await this.accountBarrier;
      await cacheWrites.get(this.key)?.catch(()=>undefined);
      const raw = await this.storage.getItem(this.key);
      if (!raw || !this.current()) return null;
      const value = JSON.parse(raw);
      if (value.ownerId !== this.ownerId || value.spaceId !== this.spaceId || !Array.isArray(value.messages)) return null;
      return { messages: value.messages.filter((m: ChatMessage) => m.spaceId === this.spaceId && m.deliveryState === "sent" && !m.deletedAt), cursor: value.cursor ?? null, hasOlder: !!value.hasOlder };
    } catch { return null; }
  }
  save(snapshot: MessageSnapshot): Promise<unknown> {
    return cacheWrite(this.key,async () => {
      await this.accountBarrier;
      if (!this.current()) return;
      const messages = snapshot.messages.filter((m) => m.spaceId === this.spaceId && m.deliveryState === "sent" && !m.deletedAt).slice(-500);
      await this.storage.setItem(this.key, JSON.stringify({ ...snapshot, messages, ownerId: this.ownerId, spaceId: this.spaceId, hasOlder: snapshot.hasOlder || snapshot.messages.length > 500 }));
    });
  }
  async clear(): Promise<void> {
    if(!this.current())return;
    const next=this.epoch+1;
    cacheEpochs.set(this.key,next);
    await cacheWrite(this.key,async()=>{
      await this.accountBarrier;
      if(cacheEpochs.get(this.key)===next)await this.storage.removeItem(this.key);
    });
  }
}

export function clearAccountMessageCaches(ownerId: string): Promise<void> {
  const previous=accountClears.get(ownerId);
  const existing=[...(liveCaches.get(ownerId) ?? [])];
  liveCaches.delete(ownerId);
  // Invalidate synchronously. A new same-account instance waits for this cleanup
  // before reading or saving, so the final disk sweep cannot erase its new data.
  const clears=existing.map(cache=>cache.clear());
  const running=(async()=>{
    await previous;
    await Promise.all(clears);
    const prefix = `${MESSAGE_CACHE_PREFIX}${encodeURIComponent(ownerId)}:`;
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
    if(keys.length) await AsyncStorage.multiRemove(keys);
  })();
  accountClears.set(ownerId,running);
  void running.finally(()=>{if(accountClears.get(ownerId)===running)accountClears.delete(ownerId);}).catch(()=>undefined);
  return running;
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
