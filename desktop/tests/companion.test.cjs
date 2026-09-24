const test = require("node:test");
const assert = require("node:assert/strict");
const { DesktopCompanion } = require("../companion.cjs");
const ID = "7350dafe-7488-4466-8c65-ed0c74d2d837";
function fixture(changes = {}) {
  let account = "owner";
  const data = {
    pet_private_requests: { pet_id: "pet", owner_message_id: "source", reply_message_id: "reply" },
    pet_private_threads: { id: "source", role: "owner", created_at: "2026-09-20T08:00:00Z", conversation_kind: "companion", context_message_ids: ["context"] },
    pet_companion_states: { revision: 4, context_started_at: null }, pet_private_streams: { status: "succeeded", revision: 4 }, pet_private_cancellations: null, pet_private_context_exclusions: [], ...changes,
  };
  const calls = [], storage = new Map();
  const client = { auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: account ? { user: { id: account } } : null } }) },
    from(table) { const filters = []; const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, in(key, value) { filters.push([key, value]); return query; }, maybeSingle() { return query; }, abortSignal() { return query; }, then(resolve) { calls.push({ table, filters }); resolve({ data: data[table], error: null }); } }; return query; },
    rpc: async () => ({ error: null }), removeChannel: async () => {},
  };
  const store = { getItem: async key => storage.get(key), setItem: async (key, value) => storage.set(key, value), removeItem: async key => storage.delete(key) };
  const companion = new DesktopCompanion(client, {}, store); companion.owner = "owner"; companion.pet = { id: "pet" };
  return { companion, client, calls, storage, account: value => { account = value; } };
}
test("lost response recovery rechecks revision and all referenced exclusions", async () => {
  const { companion, calls } = fixture();
  assert.ok(await companion.recover(ID, 4, new AbortController().signal, "owner", 0));
  const exclusions = calls.find(call => call.table === "pet_private_context_exclusions");
  assert.ok(exclusions.filters.some(([key, value]) => key === "message_id" && value.includes("context")));
  assert.ok(calls.every(call => call.filters.some(([key, value]) => key === "owner_id" && value === "owner")));
});
test("corrected, cancelled and forgotten in-flight replies cannot become final", async () => {
  for (const changes of [{ pet_companion_states: { revision: 5 } }, { pet_private_streams: { revision: 4, status: "invalidated" } }, { pet_private_context_exclusions: [{ message_id: "context" }] }, { pet_private_cancellations: { request_id: ID } }]) {
    const { companion } = fixture(changes); await assert.rejects(companion.recover(ID, 4, new AbortController().signal, "owner", 0));
  }
});
test("account switch prevents response download or publication", async () => {
  const { companion, account, calls } = fixture(); account("different");
  await assert.rejects(companion.guard(0, "owner"), /account_changed/); assert.equal(calls.length, 0);
});
test("stopping current reply aborts its transport without deleting created actions", async () => {
  const { companion } = fixture(), controller = new AbortController(); companion.active = { id: ID, controller }; companion.partial = "stale";
  await companion.stopReply(ID); assert.equal(controller.signal.aborted, true); assert.equal(companion.partial, ""); assert.match(companion.phase, /事项仍然保留/);
});
test("logout keeps the signed-in state until durable session removal finishes", async () => {
  const {companion,client,storage,account}=fixture();
  storage.set("queue:owner","private queue");storage.set("placement:owner","position");
  let release,started;const held=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
  client.auth.signOut=async()=>{started();await held;account(null);return {error:null};};
  const states=[];companion.on("state",value=>states.push(value));
  const logout=companion.logout();await began;
  assert.equal(companion.snapshot().signedIn,true);assert.equal(companion.snapshot().closing,true);
  assert.equal(storage.has("queue:owner"),false);assert.equal(storage.has("placement:owner"),false);
  await assert.rejects(companion.guard(),/account_changed/);assert.ok(states.every(state=>state.signedIn));
  release();await logout;
  assert.equal(companion.snapshot().signedIn,false);assert.equal(companion.snapshot().closing,false);
});
test("failed logout never declares a still-persisted session signed out",async()=>{
  const {companion,client}=fixture();client.auth.signOut=async()=>({error:Error("network failure")});
  await assert.rejects(companion.logout(),/退出未完成/);
  assert.equal(companion.snapshot().signedIn,true);assert.equal(companion.snapshot().closing,false);
});
