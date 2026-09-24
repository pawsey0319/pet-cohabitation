jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
const { DatabaseSync } = require("node:sqlite");
let mockDb: any;
let mockFailWrite: string | null = null;
let mockTransactions: Promise<unknown> = Promise.resolve();
interface TestSqlite {
  execAsync(sql: string): Promise<void>;
  getFirstAsync(sql: string, ...args: unknown[]): Promise<any>;
  getAllAsync(sql: string, ...args: unknown[]): Promise<any[]>;
  runAsync(sql: string, ...args: unknown[]): Promise<any>;
  withExclusiveTransactionAsync(callback: (tx: TestSqlite) => Promise<void>): Promise<void>;
}
const mockAdapter: TestSqlite = {
  execAsync: async (sql: string) => { mockDb.exec(sql); },
  getFirstAsync: async (sql: string, ...args: unknown[]) => mockDb.prepare(sql).get(...args) ?? null,
  getAllAsync: async (sql: string, ...args: unknown[]) => mockDb.prepare(sql).all(...args),
  runAsync: async (sql: string, ...args: unknown[]) => {
    if (mockFailWrite && sql.includes(mockFailWrite)) { mockFailWrite = null; throw new Error("simulated disk write failure"); }
    return mockDb.prepare(sql).run(...args);
  },
  withExclusiveTransactionAsync: (callback: (tx: TestSqlite) => Promise<void>): Promise<void> => {
    const task = mockTransactions.then(async () => {
      mockDb.exec("BEGIN IMMEDIATE");
      try { await callback(mockAdapter); mockDb.exec("COMMIT"); }
      catch (error) { mockDb.exec("ROLLBACK"); throw error; }
    }); mockTransactions = task.catch(() => undefined); return task;
  },
};
jest.mock("expo-sqlite", () => ({ openDatabaseAsync: async () => mockAdapter }));
import { OUTBOX_KEY } from "../chat/outbox";
import { createPersistentOutboxStore } from "../chat/persistentOutbox.native";
import type { QueuedMessage } from "../data/types";
const queued = (owner: string, id: string): QueuedMessage => ({ clientId: id, senderId: owner, spaceId: "group", kind: "text", text: id, createdAt: "2026-09-20T00:00:00Z", attempts: 0 });
const state = (key: string, value: unknown) => mockDb.prepare("INSERT OR REPLACE INTO local_state(key,value,updated_at) VALUES(?,?,?)").run(key, JSON.stringify(value), "2026-09-20");
const read = (key: string) => { const row = mockDb.prepare("SELECT value FROM local_state WHERE key=?").get(key); return row ? JSON.parse(row.value) : null; };
beforeAll(() => { mockDb = new DatabaseSync(":memory:"); mockDb.exec("CREATE TABLE local_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)"); });
afterAll(() => { mockDb.close(); });

test("native migration scrubs only its owner from the shared legacy JSON", async () => {
  const owner = "native-migrate", other = queued("native-other", "keep"); state(OUTBOX_KEY, [queued(owner, "private-body"), other]);
  expect(await createPersistentOutboxStore(owner).load()).toEqual([queued(owner, "private-body")]);
  expect(read(OUTBOX_KEY)).toEqual([other]);
});

test("native upgrade scrubs leftovers with an existing marker and does not resurrect them", async () => {
  const owner = "native-already-migrated", other = queued("native-other", "keep");
  state(`outbox-rows-migrated:${owner}`, true); state(OUTBOX_KEY, [queued(owner, "already-sent"), other]);
  state(`${OUTBOX_KEY}:${owner}`, [queued(owner, "old-scoped-copy")]);
  expect(await createPersistentOutboxStore(owner).load()).toEqual([]);
  expect(read(OUTBOX_KEY)).toEqual([other]); expect(read(`${OUTBOX_KEY}:${owner}`)).toBeNull();
});

test("native clearing scrubs residual legacy data even after this process already migrated", async () => {
  const owner = "native-clear", store = createPersistentOutboxStore(owner), other = queued("native-other", "keep");
  state(OUTBOX_KEY, [queued(owner, "first")]); await store.load();
  state(OUTBOX_KEY, [queued(owner, "stale-residue"), other]); await store.save([]);
  expect(read(OUTBOX_KEY)).toEqual([other]); expect(await store.load()).toEqual([]);
});

test("native concurrent owner migrations preserve all unclaimed accounts and each pending queue", async () => {
  const a = queued("native-parallel-a", "a"), b = queued("native-parallel-b", "b"), c = queued("native-parallel-c", "c"); state(OUTBOX_KEY, [a, b, c]);
  expect(await Promise.all([createPersistentOutboxStore(a.senderId).load(), createPersistentOutboxStore(b.senderId).load()])).toEqual([[a], [b]]);
  expect(read(OUTBOX_KEY)).toEqual([c]);
});

test("a failed native migration rolls back rows, marker and cleanup before retry", async () => {
  const owner = "native-rollback", pending = queued(owner, "must-not-lose"), other = queued("native-other", "keep"); state(OUTBOX_KEY, [pending, other]);
  mockFailWrite = "VALUES(?,'true',?)";
  await expect(createPersistentOutboxStore(owner).load()).rejects.toThrow("disk write");
  expect(read(OUTBOX_KEY)).toEqual([pending, other]); expect(read(`outbox-rows-migrated:${owner}`)).toBeNull();
  expect(mockDb.prepare("SELECT * FROM chat_outbox_rows WHERE owner=?").all(owner)).toEqual([]);
  expect(await createPersistentOutboxStore(owner).load()).toEqual([pending]); expect(read(OUTBOX_KEY)).toEqual([other]);
});

test("native cleanup preserves unparseable shared recovery data but removes its known scoped key", async () => {
  const owner = "native-malformed"; state(`outbox-rows-migrated:${owner}`, true); state(`${OUTBOX_KEY}:${owner}`, [queued(owner, "scoped-residue")]);
  mockDb.prepare("INSERT OR REPLACE INTO local_state(key,value,updated_at) VALUES(?,?,?)").run(OUTBOX_KEY, "malformed unknown-owner recovery data", "2026-09-20");
  expect(await createPersistentOutboxStore(owner).load()).toEqual([]); expect(read(`${OUTBOX_KEY}:${owner}`)).toBeNull();
  expect(mockDb.prepare("SELECT value FROM local_state WHERE key=?").get(OUTBOX_KEY).value).toBe("malformed unknown-owner recovery data");
});
