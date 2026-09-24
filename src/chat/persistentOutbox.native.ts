import * as SQLite from "expo-sqlite";
import { OUTBOX_KEY, immutableMessagePayload, type OutboxStore } from "./outbox";
import type { QueuedMessage } from "../data/types";
let database: Promise<SQLite.SQLiteDatabase> | undefined;
function getDatabase(){
 return database ??= SQLite.openDatabaseAsync("pet-cohabitation-local.db").then(async db => {
  await db.execAsync(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS local_state(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_outbox_rows(position INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(owner,id));`);
  return db;
 }).catch(error => { database = undefined; throw error; });
}
const migrated = new Map<string,Promise<void>>();
async function removeLegacyOwner(tx: SQLite.SQLiteDatabase, owner: string): Promise<void> {
  const row = await tx.getFirstAsync<{value:string}>("SELECT value FROM local_state WHERE key=?", OUTBOX_KEY);
  let values: QueuedMessage[] = [];
  try { const parsed = row ? JSON.parse(row.value) : []; if (Array.isArray(parsed)) values = parsed; }
  catch { /* Cannot safely attribute malformed shared data to one owner. */ }
  if (values.some(item => item?.senderId === owner))
    await tx.runAsync("INSERT OR REPLACE INTO local_state(key,value,updated_at) VALUES(?,?,?)", OUTBOX_KEY, JSON.stringify(values.filter(item => item?.senderId !== owner)), new Date().toISOString());
  await tx.runAsync("DELETE FROM local_state WHERE key=?", `${OUTBOX_KEY}:${encodeURIComponent(owner)}`);
}
function migrate(owner: string): Promise<void> {
  const old=migrated.get(owner);if(old)return old;
  const task=(async()=>{
    const db=await getDatabase();
    await db.withExclusiveTransactionAsync(async tx=>{
      const marker=`outbox-rows-migrated:${owner}`;
      const alreadyMigrated = await tx.getFirstAsync("SELECT key FROM local_state WHERE key=?",marker);
      if (alreadyMigrated) { await removeLegacyOwner(tx, owner); return; }
      const scoped=`${OUTBOX_KEY}:${encodeURIComponent(owner)}`;
      const row=await tx.getFirstAsync<{value:string}>("SELECT value FROM local_state WHERE key=?",scoped)
        ?? await tx.getFirstAsync<{value:string}>("SELECT value FROM local_state WHERE key=?",OUTBOX_KEY);
      let values: QueuedMessage[]=[];
      try { const parsed=row?JSON.parse(row.value):[]; if(Array.isArray(parsed))values=parsed; } catch { /* Malformed legacy data is not sent. */ }
      for(const item of values) if(item?.senderId===owner && typeof item.clientId==='string')
        await tx.runAsync("INSERT OR IGNORE INTO chat_outbox_rows(owner,id,body) VALUES(?,?,?)",owner,item.clientId,JSON.stringify(item));
      await tx.runAsync("INSERT OR REPLACE INTO local_state(key,value,updated_at) VALUES(?,'true',?)",marker,new Date().toISOString());
      // Import, marker and removal share the transaction; another owner cannot
      // overwrite this cleanup with a stale copy of the common legacy JSON.
      await removeLegacyOwner(tx, owner);
    });
  })();
  migrated.set(owner,task);void task.catch(()=>migrated.delete(owner));return task;
}
export function createPersistentOutboxStore(owner: string): OutboxStore {
  const ready=async()=>{await migrate(owner);return getDatabase();};
  return {
    scopeKey:`sqlite-outbox:${owner}`,
    async load() {
      const rows=await (await ready()).getAllAsync<{body:string}>("SELECT body FROM chat_outbox_rows WHERE owner=? ORDER BY position",owner);
      return rows.flatMap(row=>{try{const item=JSON.parse(row.body);return item?.senderId===owner?[item]:[];}catch{return [];}});
    },
    async save(messages) {
      if(messages.some(item=>item.senderId!==owner))throw new Error("Outbox account mismatch");
      await (await ready()).withExclusiveTransactionAsync(async tx=>{
        await tx.runAsync("DELETE FROM chat_outbox_rows WHERE owner=?",owner);
        for(const item of messages)await tx.runAsync("INSERT INTO chat_outbox_rows(owner,id,body) VALUES(?,?,?)",owner,item.clientId,JSON.stringify(item));
        // Logout can call save([]) after migrate() has been memoized in this run.
        await removeLegacyOwner(tx, owner);
      });
    },
    async put(message) {
      if(message.senderId!==owner)throw new Error("Outbox account mismatch");
      await (await ready()).withExclusiveTransactionAsync(async tx=>{
        const old=await tx.getFirstAsync<{body:string}>("SELECT body FROM chat_outbox_rows WHERE owner=? AND id=?",owner,message.clientId);
        if(old) {
          if(immutableMessagePayload(JSON.parse(old.body))!==immutableMessagePayload(message))throw new Error("同一条待发送消息不能修改内容，请重新发送。");
          return;
        }
        await tx.runAsync("INSERT INTO chat_outbox_rows(owner,id,body) VALUES(?,?,?)",owner,message.clientId,JSON.stringify(message));
      });
    },
    async remove(id) { await (await ready()).runAsync("DELETE FROM chat_outbox_rows WHERE owner=? AND id=?",owner,id); },
    async fail(id) {
      await (await ready()).runAsync("UPDATE chat_outbox_rows SET body=json_set(body,'$.attempts',coalesce(json_extract(body,'$.attempts'),0)+1) WHERE owner=? AND id=?",owner,id);
    },
  };
}
