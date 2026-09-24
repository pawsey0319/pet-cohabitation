// Full local Supabase/Realtime/Edge validation. Only synthetic accounts are created.
// Run against a disposable, migrated local stack with MODEL_MOCK_MODE=true first.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Set local SUPABASE_URL, SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY), and SUPABASE_SERVICE_ROLE_KEY.");
const endpoint = new URL(url);
if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) || !["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
  throw new Error("This test only accepts a loopback Supabase URL; remote environments are refused.");
}
await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(5000) }).then((response) => {
  if (!response.ok) throw new Error(`Local Auth health check failed (${response.status}).`);
});

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, options);
const clients = [];
const users = [];
const suffix = randomUUID();
let checks = 0;
const recoveredErrors = [];
function ok(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function createUser(label) {
  const email = `companion-${label}-${suffix}@example.test`;
  const password = `Test-${randomUUID()}-a1!`;
  const created = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }));
  users.push(created.user.id);
  ok(await service.from("profiles").insert({ id: created.user.id, email, nickname: `陪伴验收${label}` }));
  const client = createClient(url, anonKey, options);
  clients.push(client);
  ok(await client.auth.signInWithPassword({ email, password }));
  return { id: created.user.id, client, email, password };
}
async function waitUntil(read, predicate, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
async function watch(client, ownerId, events) {
  const channel = client.channel(`companion-${randomUUID()}`).on("postgres_changes", {
    event: "*", schema: "public", table: "pet_memory_evidence", filter: `owner_id=eq.${ownerId}`,
  }, (event) => events.push(event));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime subscription timed out")), 10_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) { clearTimeout(timer); reject(new Error(`Realtime ${status}`)); }
    });
  });
}
async function invoke(client, name, body) {
  const result = await client.functions.invoke(name, { body });
  if (result.error) {
    // Only the application's normalized error code is reported, never headers or keys.
    let code = result.error.name;
    try { code = (await result.error.context.json()).error ?? code; } catch { /* No JSON body. */ }
    throw new Error(`${name}: ${code}`);
  }
  return result.data;
}

async function chatWithRecovery(client, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await invoke(client, "pet-chat", body); }
    catch (error) {
      if (attempt === 3 || !/pet-chat: (text_model_(invalid_json|timeout|network_error|http_50[234])|companion_context_changed)$/.test(error.message)) throw error;
      recoveredErrors.push(error.message);
      console.log(`Retrying the same request after ${error.message}`);
    }
  }
}

try {
  const owner = await createUser("owner");
  const outsider = await createUser("other");
  const second = createClient(url, anonKey, options);
  clients.push(second);
  ok(await second.auth.signInWithPassword({ email: owner.email, password: owner.password }));
  const pet = ok(await owner.client.from("pets").insert({ owner_id: owner.id, name: "验收芽芽" }).select("id").single());
  ok(await outsider.client.from("pets").insert({ owner_id: outsider.id, name: "另一只异宠" }));
  const ownerEvents = [], outsiderEvents = [];
  await watch(second, owner.id, ownerEvents);
  await watch(outsider.client, owner.id, outsiderEvents);

  const memory = ok(await owner.client.rpc("save_pet_personal_memory", { target_pet_id: pet.id, memory_content: "面试时希望先理清思路" }));
  const boundary = ok(await owner.client.from("pet_companion_states").select("context_started_at").eq("pet_id", pet.id).single());
  ok(await second.rpc("save_pet_personal_memory", { target_pet_id: pet.id, memory_id: memory.id, memory_content: "紧张时希望先听我说" }));
  const edited = ok(await owner.client.from("pet_companion_states").select("context_started_at").eq("pet_id", pet.id).single());
  assert.equal(edited.context_started_at, boundary.context_started_at);
  assert.equal(ok(await owner.client.from("pet_personal_memory_versions").select("id").eq("memory_id", memory.id)).length, 1);
  checks++;

  // Actual Edge request, background extraction, and duplicate HTTP request.
  const requestId = randomUUID();
  const body = { content: "我晚上不喝咖啡", request_id: requestId };
  const reply = await chatWithRecovery(owner.client, body);
  const expectedProvider = process.env.COMPANION_EXPECT_MODEL_PROVIDER;
  if (expectedProvider) {
    const run = ok(await service.from("model_runs").select("provider,model").eq("owner_id", owner.id).eq("run_kind", "pet_private_reply").eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).single());
    assert.equal(run.provider, expectedProvider, "The Edge function must use the intended provider mode");
  }
  const duplicate = await invoke(second, "pet-chat", body);
  assert.equal(duplicate.id, reply.id);
  const threads = ok(await owner.client.from("pet_private_threads").select("id,role").eq("pet_id", pet.id));
  assert.equal(threads.filter((row) => row.role === "owner").length, 1);
  assert.equal(threads.filter((row) => row.role === "pet").length, 1);
  const waitForExtraction = () => waitUntil(async () => ok(await owner.client.from("pet_memory_extraction_jobs").select("status,error_code").eq("pet_id", pet.id).single()), (row) => ["succeeded", "failed"].includes(row.status), "background memory extraction", 75_000);
  let job = await waitForExtraction();
  for (let retry = 0; job.status === "failed" && retry < 2; retry++) {
    recoveredErrors.push(`memory-extraction: ${job.error_code}`);
    await invoke(owner.client, "retry-pet-memory", {});
    // Wait for the new lease to be claimed before checking a terminal state again.
    await waitUntil(async () => ok(await owner.client.from("pet_memory_extraction_jobs").select("status,attempts").eq("pet_id", pet.id).single()), (row) => row.attempts >= retry + 2, "memory retry lease");
    job = await waitForExtraction();
  }
  assert.equal(job.status, "succeeded", job.error_code);
  const facts = ok(await owner.client.rpc("get_pet_preference_facts"));
  assert.equal(facts[0].object, "咖啡");
  assert.equal(facts[0].context, "晚上");
  assert.equal(facts[0].polarity, "negative");
  assert.equal(facts[0].frequencyDays, 1);
  await waitUntil(async () => ownerEvents, (events) => events.some((event) => event.eventType === "INSERT"), "second-client Realtime insert");
  checks++;

  // Deterministic in-flight conflict: the second client changes memory before commit.
  const conflictId = randomUUID();
  const claim = ok(await service.rpc("claim_pet_private_request", { target_pet_id: pet.id, request_id: conflictId, owner_content: "继续聊面试" }));
  ok(await second.rpc("update_pet_preference", { target_key: facts[0].key, action: "positive" }));
  const stale = await service.rpc("commit_pet_private_request", { target_pet_id: pet.id, request_id: conflictId, target_token: claim.token, expected_revision: claim.revision, reply_content: "这是一条应该被拦截的旧回复", target_model_run_id: null });
  assert.match(stale.error?.message ?? "", /companion_context_changed/);
  ok(await service.rpc("fail_pet_private_request", { target_pet_id: pet.id, request_id: conflictId, target_token: claim.token }));
  const retry = ok(await service.rpc("claim_pet_private_request", { target_pet_id: pet.id, request_id: conflictId, owner_content: "继续聊面试" }));
  assert.equal(retry.message_id, claim.message_id);
  ok(await service.rpc("commit_pet_private_request", { target_pet_id: pet.id, request_id: conflictId, target_token: retry.token, expected_revision: retry.revision, reply_content: "我们继续聊面试。", target_model_run_id: null, context_ids: [claim.message_id] }));
  checks++;

  ok(await second.rpc("update_pet_preference", { target_key: facts[0].key, action: "forget" }));
  assert.deepEqual(ok(await owner.client.rpc("get_pet_preference_facts")), []);
  assert.ok(ok(await owner.client.rpc("get_pet_excluded_message_ids")).length > 0);
  assert.ok(ok(await owner.client.from("pet_private_threads").select("id").eq("pet_id", pet.id)).some((row) => row.id === reply.id), "raw conversation stays readable");
  const retryJob = await invoke(owner.client, "retry-pet-memory", {});
  assert.ok(retryJob);
  const exported = await invoke(owner.client, "export-my-data", {});
  assert.ok(exported.preference_evidence.some((row) => row.state === "forgotten"));
  assert.ok(exported.preference_evidence.every((row) => row.owner_id === owner.id));
  assert.equal(exported.manual_memory_versions.length, 1);
  checks++;

  assert.deepEqual(ok(await outsider.client.rpc("get_pet_preference_facts", { target_pet_id: pet.id })), []);
  assert.deepEqual(ok(await outsider.client.rpc("get_pet_excluded_message_ids", { target_pet_id: pet.id })), []);
  for (const table of ["pet_personal_memories", "pet_memory_evidence", "pet_private_requests", "pet_memory_extraction_jobs", "pet_personal_memory_versions"]) {
    assert.deepEqual(ok(await outsider.client.from(table).select("*").eq("owner_id", owner.id)), []);
  }
  assert.ok((await outsider.client.rpc("update_pet_preference", { target_key: facts[0].key, action: "positive" })).error);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(outsiderEvents.length, 0, "Realtime must obey owner RLS");
  checks++;
  console.log(`PASS: ${checks} local Supabase/Realtime/Edge scenario groups; ${recoveredErrors.length} recovered provider errors.`);
} finally {
  for (const client of clients) await client.removeAllChannels();
  for (const id of users.reverse()) {
    const removed = await service.auth.admin.deleteUser(id);
    if (removed.error) { console.error("Synthetic account cleanup failed:", removed.error.message); process.exitCode = 1; }
  }
}
