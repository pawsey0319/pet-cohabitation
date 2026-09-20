// Synthetic accounts only. Verify actual Auth/RLS/Edge/Realtime delivery.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)
    || !["47321", "48321"].includes(new URL(url).port)) throw new Error("Isolated fixture required");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const clients = [], users = [], results = [];
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const pass = (label, condition) => { assert.ok(condition, label); results.push(label); };
async function login(email, password) {
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, options); clients.push(client);
  ok(await client.auth.signInWithPassword({ email, password })); return client;
}
async function account() {
  const email = `background-events-${randomUUID()}@example.test`, password = `A1!${randomUUID()}`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  users.push(id); ok(await service.from("profiles").insert({ id, email, nickname: "合成背景事件验收" }));
  return { id, email, password, client: await login(email, password) };
}
async function subscribe(client, events) {
  await new Promise((resolve, reject) => {
    let joined = false, replicationReady = false;
    const timer = setTimeout(() => reject(new Error(`Realtime readiness timeout (joined=${joined}, replicationReady=${replicationReady})`)), 30_000);
    const ready = () => { if (joined && replicationReady) { clearTimeout(timer); resolve(); } };
    client.channel(`background-${randomUUID()}`, { config: { broadcast: { replication_ready: true } } }).on("postgres_changes", {
      event: "INSERT", schema: "public", table: "chat_background_mutations",
      // No client owner filter: the server's RLS must provide isolation itself.
    }, event => events.push(event.new)).on("system", {}, event => {
      if (event.status === "error") console.error("Realtime table subscription:", event.message);
      // SUBSCRIBED alone precedes the PostgreSQL change stream on a cold server.
      if (event.status === "ok" && event.extension === "postgres_changes") { replicationReady = true; ready(); }
    }).subscribe(status => {
      if (status === "SUBSCRIBED") { joined = true; ready(); }
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        clearTimeout(timer); reject(new Error(`Realtime ${status}`));
      }
    });
  });
}
async function until(predicate) {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Mutation delivery timeout");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function invoke(client, body) {
  const result = await client.functions.invoke("background-management", { body });
  if (result.error) {
    let code = "background_request_failed";
    try { code = (await result.error.context.json()).error ?? code; } catch {}
    throw new Error(code);
  }
  return result.data;
}
async function asset(owner) {
  const id = randomUUID();
  return ok(await service.from("chat_background_assets").insert({ id, owner_id: owner,
    storage_path: `${owner}/${id}.jpg`, source: "upload" }).select("id,version").single());
}
let passed = false;
try {
  const A = await account(), B = await account(), otherDevice = await login(A.email, A.password);
  const eventsA = [], eventsB = [];
  await Promise.all([subscribe(otherDevice, eventsA), subscribe(B.client, eventsB)]);
  const original = await asset(A.id), outsiderAsset = await asset(B.id);
  ok(await A.client.from("chat_background_settings").insert({ owner_id: A.id, thread_key: "global", asset_id: original.id }));
  const impact = await invoke(A.client, { action: "impact", asset_id: original.id });
  const request = { action: "delete", request_id: randomUUID(), asset_id: original.id,
    expected_version: original.version, settings_version: impact.settings_version };
  const removed = await invoke(A.client, request);
  pass("deletion returns a committed tombstone", removed.outcome === "deleted" && !!removed.asset.deleted_at);
  await until(() => eventsA.some(event => event.request_id === request.request_id));
  const remote = eventsA.find(event => event.request_id === request.request_id);
  pass("second session receives exact owner deletion receipt", remote.owner_id === A.id
    && remote.receipt.outcome === "deleted" && remote.receipt.asset.id === original.id);
  pass("deleted asset is hidden even from owner asset queries", ok(await otherDevice.from("chat_background_assets").select("id").eq("id", original.id)).length === 0);
  pass("applied background returns to inheritance", ok(await otherDevice.from("chat_background_settings").select("thread_key").eq("owner_id", A.id)).length === 0);
  const replay = await invoke(A.client, request);
  pass("retry preserves the same mutation receipt", replay.asset.id === original.id && replay.asset.version === removed.asset.version);
  const marker = { action: "rename", request_id: randomUUID(), asset_id: outsiderAsset.id, expected_version: 1, name: "自己的事件标记" };
  await invoke(B.client, marker);
  await until(() => eventsB.some(event => event.request_id === marker.request_id));
  pass("outsider subscription is active but never receives owner receipt", eventsB.length === 1 && eventsB[0].owner_id === B.id);
  pass("owner sees one event despite retry, and no outsider data", eventsA.length === 1 && eventsA[0].owner_id === A.id);
  pass("RLS denies direct outsider reads of mutation payload", ok(await B.client.from("chat_background_mutations").select("request_id").eq("owner_id", A.id)).length === 0);
  passed = true; console.log(`PASS ${results.length} real background multi-session mutation and RLS assertions`);
} finally {
  for (const client of clients) await client.removeAllChannels();
  for (const id of users.reverse()) ok(await service.auth.admin.deleteUser(id));
  await mkdir("test-results/background-realtime-ready", { recursive: true });
  await writeFile("test-results/background-realtime-ready/verification.json", JSON.stringify({
    checkedAt: new Date().toISOString(), fixture: new URL(url).port, passed, assertions: results,
    physicalAndroid: "pending", cloudMutated: false,
  }, null, 2));
}
