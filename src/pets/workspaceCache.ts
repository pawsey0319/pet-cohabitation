import type { PetRepository } from "../data/petRepository";

/** Session-owned, memory-only cache. A disposed session can never publish a late response. */
export class PetWorkspaceCache {
  private entries = new Map<string, { value?: unknown; ready: boolean; at: number; epoch: number; pending?: Promise<unknown> }>();
  private listeners = new Set<() => void>();
  private disposed = false;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { if (!this.disposed) this.listeners.forEach(listener => listener()); }
  peek<T>(key: string): T | undefined { return this.entries.get(key)?.value as T | undefined; }
  read<T>(key: string, fetch: () => Promise<T>, ttl = 30_000, staleWhileRevalidate = true): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("pet_session_changed"));
    let entry = this.entries.get(key);
    if (!entry) { entry = { ready: false, at: 0, epoch: 0 }; this.entries.set(key, entry); }
    if (entry.ready && Date.now() - entry.at < ttl) return Promise.resolve(entry.value as T);
    if (!entry.pending) {
      const current = entry, epoch = entry.epoch;
      const pending = fetch().then(value => {
        if (this.disposed || current.epoch !== epoch) throw new Error("pet_cache_invalidated");
        current.value = value; current.ready = true; current.at = Date.now();
        return value;
      });
      current.pending = pending;
      void pending.then(() => { if (current.pending === pending) { current.pending = undefined; this.emit(); } }, () => {
        if (current.pending === pending) { current.pending = undefined; if (current.ready) current.at = Date.now() - ttl + 5_000; }
      });
    }
    // A refresh never replaces already usable content with a loading screen.
    return entry.ready && staleWhileRevalidate ? Promise.resolve(entry.value as T) : entry.pending as Promise<T>;
  }
  invalidate(prefixes?: readonly string[], drop = false) {
    for (const [key, entry] of this.entries) if (!prefixes || prefixes.some(prefix => key.startsWith(prefix))) {
      entry.epoch++; entry.at = 0; entry.pending = undefined;
      if (drop) { entry.ready = false; entry.value = undefined; }
    }
    this.emit();
  }
  dispose() { this.disposed = true; this.entries.clear(); this.listeners.clear(); }
}

const reads = new Set(["getDashboard", "getPet", "getExpectations", "listPrivateMessages", "getCompanionContext", "listAssets", "listGenerationSessions", "listStyleSignals", "listExperiences", "listEvolutionEvents", "getRuntimeState"]);
const memoryWrites = new Set(["updatePreference", "retryMemoryExtraction", "savePersonalMemory", "removePersonalMemory", "startNewConversation"]);
export function cachedPetRepository(raw: PetRepository, cache: PetWorkspaceCache): PetRepository {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(raw, { get(target, key) {
    if (key === "subscribe") return cache.subscribe;
    if (methods.has(key)) return methods.get(key);
    const value = Reflect.get(target, key);
    if (typeof value !== "function") return value;
    const name = String(key);
    const method = reads.has(name)
      ? (...args: unknown[]) => cache.read(`${name}:${JSON.stringify(args)}`, () => value.apply(target, args))
      : async (...args: unknown[]) => {
        const result = await value.apply(target, args);
        if (name !== "createSignedAssetUrl" && name !== "listMemoryEvidence") cache.invalidate(memoryWrites.has(name)
          ? ["getCompanionContext:", "listPrivateMessages:"]
          : name === "chat" || name === "stopPrivateReply" ? ["listPrivateMessages:", "getCompanionContext:", "getDashboard:"] : undefined, memoryWrites.has(name));
        return result;
      };
    methods.set(key, method); return method;
  } });
}
