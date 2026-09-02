import * as SQLite from "expo-sqlite";
import type { QueuedMessage } from "../data/types";
import { OUTBOX_KEY, type OutboxStore } from "./outbox";

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

class SqliteOutboxStore implements OutboxStore {
  async load(): Promise<readonly QueuedMessage[]> {
    const db = await ready();
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM local_state WHERE key = ?", OUTBOX_KEY);
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value);
      return Array.isArray(parsed) ? parsed as readonly QueuedMessage[] : [];
    } catch {
      return [];
    }
  }

  async save(messages: readonly QueuedMessage[]): Promise<void> {
    const db = await ready();
    await db.runAsync(
      "INSERT INTO local_state(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      OUTBOX_KEY,
      JSON.stringify(messages),
      new Date().toISOString(),
    );
  }
}

export function createPersistentOutboxStore(): OutboxStore {
  return new SqliteOutboxStore();
}
