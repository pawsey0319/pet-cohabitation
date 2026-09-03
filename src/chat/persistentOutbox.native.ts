import * as SQLite from "expo-sqlite";
import { AccountOutboxStore, type OutboxKeyValueStore, type OutboxStore } from "./outbox";

const database = SQLite.openDatabaseAsync("pet-cohabitation-local.db");

async function ready() {
  const db = await database;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS local_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

const sqliteKeyValues: OutboxKeyValueStore = {
  async getItem(key: string): Promise<string | null> {
    const db = await ready();
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM local_state WHERE key = ?", key);
    return row?.value ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    const db = await ready();
    await db.runAsync(
      "INSERT INTO local_state(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      key,
      value,
      new Date().toISOString(),
    );
  },
};

export function createPersistentOutboxStore(ownerId: string): OutboxStore {
  return new AccountOutboxStore(sqliteKeyValues, ownerId);
}
