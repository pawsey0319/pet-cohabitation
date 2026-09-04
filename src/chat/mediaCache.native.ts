import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";

const MAX_ACCOUNT_CACHE_BYTES = 200 * 1024 * 1024;

type CacheRow = Readonly<{ local_uri: string; size_bytes: number; last_accessed_at: number }>;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync("private-media-cache.db").then(async (db) => {
      await db.execAsync(`
        pragma journal_mode = WAL;
        create table if not exists media_cache (
          owner_id text not null,
          storage_path text not null,
          local_uri text not null,
          size_bytes integer not null,
          last_accessed_at integer not null,
          primary key (owner_id, storage_path)
        );
        create index if not exists media_cache_owner_accessed_idx
          on media_cache(owner_id, last_accessed_at);
      `);
      return db;
    });
  }
  return databasePromise;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cacheDirectory(ownerId: string): Directory {
  return new Directory(Paths.cache, "pet-cohabitation-media", safeSegment(ownerId));
}

function targetFile(ownerId: string, storagePath: string): File {
  const extension = storagePath.match(/\.[a-zA-Z0-9]{2,5}$/)?.[0]?.toLowerCase() ?? ".bin";
  return new File(cacheDirectory(ownerId), `${stableHash(storagePath)}${extension}`);
}

function ensureDirectory(directory: Directory): void {
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
}

async function saveEntry(ownerId: string, storagePath: string, file: File): Promise<void> {
  const db = await database();
  await db.runAsync(
    "insert into media_cache(owner_id,storage_path,local_uri,size_bytes,last_accessed_at) values(?,?,?,?,?) on conflict(owner_id,storage_path) do update set local_uri=excluded.local_uri,size_bytes=excluded.size_bytes,last_accessed_at=excluded.last_accessed_at",
    ownerId, storagePath, file.uri, file.size, Date.now(),
  );
}

async function prune(ownerId: string): Promise<void> {
  const db = await database();
  const rows = await db.getAllAsync<CacheRow>(
    "select local_uri,size_bytes,last_accessed_at from media_cache where owner_id=? order by last_accessed_at asc",
    ownerId,
  );
  let total = rows.reduce((sum, row) => sum + Number(row.size_bytes), 0);
  for (const row of rows) {
    if (total <= MAX_ACCOUNT_CACHE_BYTES) break;
    const file = new File(row.local_uri);
    if (file.exists) file.delete();
    await db.runAsync("delete from media_cache where owner_id=? and local_uri=?", ownerId, row.local_uri);
    total -= Number(row.size_bytes);
  }
}

export async function resolveCachedMedia(
  ownerId: string,
  storagePath: string,
  getSignedUrl: () => Promise<string>,
): Promise<string> {
  const db = await database();
  const recorded = await db.getFirstAsync<CacheRow>(
    "select local_uri,size_bytes,last_accessed_at from media_cache where owner_id=? and storage_path=?",
    ownerId, storagePath,
  );
  if (recorded) {
    const recordedFile = new File(recorded.local_uri);
    if (recordedFile.exists && recordedFile.size > 0) {
      await db.runAsync("update media_cache set last_accessed_at=? where owner_id=? and storage_path=?", Date.now(), ownerId, storagePath);
      return recordedFile.uri;
    }
    await db.runAsync("delete from media_cache where owner_id=? and storage_path=?", ownerId, storagePath);
  }

  const directory = cacheDirectory(ownerId);
  ensureDirectory(directory);
  const destination = targetFile(ownerId, storagePath);
  if (destination.exists && destination.size > 0) {
    await saveEntry(ownerId, storagePath, destination);
    return destination.uri;
  }

  const signedUrl = await getSignedUrl();
  try {
    const downloaded = await File.downloadFileAsync(signedUrl, destination, { idempotent: true });
    if (!downloaded.exists || downloaded.size <= 0) throw new Error("媒体缓存文件为空");
    await saveEntry(ownerId, storagePath, downloaded);
    await prune(ownerId);
    return downloaded.uri;
  } catch (reason) {
    if (destination.exists) destination.delete();
    throw reason;
  }
}

export async function clearMediaCache(ownerId: string): Promise<void> {
  const directory = cacheDirectory(ownerId);
  if (directory.exists) directory.delete();
  const db = await database();
  await db.runAsync("delete from media_cache where owner_id=?", ownerId);
}

export async function invalidateCachedMedia(ownerId: string, storagePath: string): Promise<void> {
  const db = await database();
  const recorded = await db.getFirstAsync<CacheRow>(
    "select local_uri,size_bytes,last_accessed_at from media_cache where owner_id=? and storage_path=?",
    ownerId, storagePath,
  );
  const file = recorded ? new File(recorded.local_uri) : targetFile(ownerId, storagePath);
  if (file.exists) file.delete();
  await db.runAsync("delete from media_cache where owner_id=? and storage_path=?", ownerId, storagePath);
}
