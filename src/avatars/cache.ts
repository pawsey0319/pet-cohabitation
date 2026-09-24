import AsyncStorage from "@react-native-async-storage/async-storage";
import { deleteAvatarThumbnail, deleteAvatarThumbnails, readAvatarThumbnail, saveAvatarThumbnail } from "./thumbnailStore";
import type { AvatarRead, SpaceAvatarState } from "./types";

const STORAGE = "avatar-cache-v1:";
const FRESH_MS = 60_000;
type Entry = { uri: string; version: string; validatedAt: number; expiresAt?: number };
const entries = new Map<string, Entry>();
const scopes = new Map<string, SpaceAvatarState>();
const inflight = new Map<string, Promise<string | null>>();
const generations = new Map<string, number>();
const cleanups = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const prefix = (owner: string, scope?: string) => `${owner}/${scope ?? "personal"}/`;
const keyFor = (owner: string, reference: string, scope?: string) => `${prefix(owner, scope)}${encodeURIComponent(reference)}`;
const epoch = (owner: string, scope?: string) => `${generations.get(owner) ?? 0}:${generations.get(prefix(owner, scope)) ?? 0}`;
export const avatarCacheGeneration = epoch;
function emit(): void { for (const listener of listeners) listener(); }
async function waitForCleanup(owner: string, scope?: string): Promise<void> {
  const key = prefix(owner, scope);
  await Promise.all([...cleanups].filter(([target]) => key.startsWith(target)).map(([, task]) => task));
}
export function subscribeAvatarCache(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function cachedAvatarUri(owner: string, reference: string, scope?: string): string | null {
  const value = entries.get(keyFor(owner, reference, scope));
  return value && (!value.expiresAt || value.expiresAt > Date.now()) ? value.uri : null;
}
export function cachedSpaceAvatar(owner: string, scope: string): SpaceAvatarState | null { return scopes.get(prefix(owner, scope)) ?? null; }
export async function hydrateSpaceAvatar(owner: string, scope: string): Promise<SpaceAvatarState | null> {
  const key = prefix(owner, scope), started = epoch(owner, scope);
  await waitForCleanup(owner, scope);
  if (started !== epoch(owner, scope)) return null;
  if (scopes.has(key)) return scopes.get(key)!;
  const raw = await AsyncStorage.getItem(`${STORAGE}${key}space`);
  if (started !== epoch(owner, scope) || !raw) return null;
  try {
    const saved = JSON.parse(raw) as SpaceAvatarState;
    if (!Array.isArray(saved.members) || !saved.members.some(member => member.id === owner)) return null;
    if (!scopes.has(key)) scopes.set(key, saved);
    emit(); return scopes.get(key)!;
  } catch { return null; }
}
export async function saveSpaceAvatar(owner: string, scope: string, state: SpaceAvatarState): Promise<void> {
  const key = prefix(owner, scope), started = epoch(owner, scope);
  await waitForCleanup(owner, scope);
  if (started !== epoch(owner, scope)) return;
  scopes.set(key, state); emit();
  await AsyncStorage.setItem(`${STORAGE}${key}space`, JSON.stringify(state));
  if (started !== epoch(owner, scope)) await AsyncStorage.removeItem(`${STORAGE}${key}space`);
}
export async function hydrateAvatar(owner: string, reference: string, scope?: string): Promise<string | null> {
  const key = keyFor(owner, reference, scope), started = epoch(owner, scope);
  await waitForCleanup(owner, scope);
  if (started !== epoch(owner, scope)) return null;
  if (cachedAvatarUri(owner, reference, scope)) return entries.get(key)!.uri;
  const raw = await AsyncStorage.getItem(`${STORAGE}${key}`);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { version?: unknown; validatedAt?: unknown };
    if (typeof data.version !== "string" || typeof data.validatedAt !== "number") return null;
    const uri = await readAvatarThumbnail(`${key}/${encodeURIComponent(data.version)}`);
    if (started !== epoch(owner, scope)) return null;
    // A newer network response can win while disk I/O is in flight.
    if (uri && !entries.has(key)) { entries.set(key, { uri, version: data.version, validatedAt: data.validatedAt }); emit(); }
    return cachedAvatarUri(owner, reference, scope);
  } catch { return null; }
}
export async function resolveCachedAvatar(owner: string, reference: string, scope: string | undefined, read: () => Promise<AvatarRead>, force = false): Promise<string | null> {
  const key = keyFor(owner, reference, scope);
  const running = inflight.get(key); if (running) return running;
  const started = epoch(owner, scope);
  const current = () => started === epoch(owner, scope);
  const work = (async () => {
    await hydrateAvatar(owner, reference, scope);
    if (!current()) return null;
    const old = entries.get(key);
    if (!force && old && cachedAvatarUri(owner, reference, scope) && Date.now() - old.validatedAt < FRESH_MS) return old.uri;
    try {
      const value = await read();
      if (!current()) return null;
      if (value.error) throw new Error(value.error);
      if (!value.url) { entries.delete(key); await AsyncStorage.removeItem(`${STORAGE}${key}`); await deleteAvatarThumbnails(`${key}/`); emit(); return null; }
      const version = value.version ?? reference;
      // Existing immutable thumbnails avoid both signing delay and re-download.
      let uri: string | null = null;
      if (value.published) {
        uri = await readAvatarThumbnail(`${key}/${encodeURIComponent(version)}`);
        if (!uri) {
          try { uri = await saveAvatarThumbnail(`${key}/${encodeURIComponent(version)}`, value.url); } catch { /* Keep the signed URL in memory only when disk/download fails. */ }
        }
      }
      if (!current()) { await deleteAvatarThumbnails(`${key}/`); return null; }
      const validatedAt = Date.now();
      entries.set(key, { uri: uri ?? value.url, version, validatedAt, ...(!uri ? { expiresAt: value.expires_at ?? validatedAt + 100_000 } : {}) });
      emit();
      if (uri && value.published) {
        await AsyncStorage.setItem(`${STORAGE}${key}`, JSON.stringify({ version, validatedAt }));
        if (!current()) { await AsyncStorage.removeItem(`${STORAGE}${key}`); await deleteAvatarThumbnails(`${key}/`); return null; }
      }
      if (!value.published) { await AsyncStorage.removeItem(`${STORAGE}${key}`); await deleteAvatarThumbnails(`${key}/`); }
      else if (old?.version && old.version !== version) await deleteAvatarThumbnail(`${key}/${encodeURIComponent(old.version)}`);
      return current() ? entries.get(key)?.uri ?? null : null;
    } catch (reason) {
      if (!current()) return null;
      const message = reason instanceof Error ? reason.message : "";
      if (/account_changed|unauthenticated/.test(message)) { await clearAvatarCache(owner); return null; }
      if (/scope_forbidden|membership_revoked/.test(message) && scope) { await clearAvatarCache(owner, scope); return null; }
      if (/forbidden|not_found/.test(message)) {
        entries.delete(key); emit(); await AsyncStorage.removeItem(`${STORAGE}${key}`); await deleteAvatarThumbnails(`${key}/`); return null;
      }
      const stale = cachedAvatarUri(owner, reference, scope); if (stale) return stale;
      throw reason;
    }
  })();
  inflight.set(key, work);
  try { return await work; } finally { if (inflight.get(key) === work) inflight.delete(key); }
}
export function invalidateAvatar(owner: string, reference: string, scope?: string): void {
  const value = entries.get(keyFor(owner, reference, scope)); if (value) value.validatedAt = 0;
}
export async function discardAvatarImage(owner: string, reference: string, scope?: string): Promise<void> {
  const key = keyFor(owner, reference, scope);
  entries.delete(key); emit();
  await Promise.all([AsyncStorage.removeItem(`${STORAGE}${key}`), deleteAvatarThumbnails(`${key}/`)]);
}
export async function clearAvatarCache(owner?: string, scope?: string): Promise<void> {
  const target = owner ? (scope ? prefix(owner, scope) : `${owner}/`) : "";
  if (owner) { const generationKey = scope ? prefix(owner, scope) : owner; generations.set(generationKey, (generations.get(generationKey) ?? 0) + 1); }
  else for (const key of [...entries.keys(), ...inflight.keys(), ...scopes.keys()]) { const id = key.split("/")[0]; generations.set(id, (generations.get(id) ?? 0) + 1); }
  for (const key of entries.keys()) if (key.startsWith(target)) entries.delete(key);
  for (const key of scopes.keys()) if (key.startsWith(target)) scopes.delete(key);
  for (const key of inflight.keys()) if (key.startsWith(target)) inflight.delete(key);
  const prior = [...cleanups].filter(([key]) => key.startsWith(target) || target.startsWith(key)).map(([, task]) => task);
  const work = (async () => {
    await Promise.all(prior);
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(`${STORAGE}${target}`));
    await Promise.all([keys.length ? AsyncStorage.multiRemove(keys) : Promise.resolve(), deleteAvatarThumbnails(target)]);
  })();
  cleanups.set(target, work);
  emit();
  try { await work; } finally { if (cleanups.get(target) === work) cleanups.delete(target); }
}
