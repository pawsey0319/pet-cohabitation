// Deterministic faults through real local Edge/Auth/Postgres. Synthetic users only.
// Requires the dedicated companion-validation stack and COMPANION_SUPABASE_CLI.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cli = process.env.COMPANION_SUPABASE_CLI;
const workdir = path.resolve(process.env.COMPANION_SUPABASE_WORKDIR ?? "test-results/companion-supabase");
if (!url || !anonKey || !serviceKey || !cli) throw new Error("Missing local Supabase environment or COMPANION_SUPABASE_CLI executable path");
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Loopback Supabase only");
if (!/^project_id\s*=\s*"companion-validation"\s*$/m.test(await readFile(path.join(workdir, "supabase/config.toml"), "utf8"))) throw new Error("Use the dedicated companion-validation fixture");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, options);
const ok = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
const count = async (table, ownerId) => {
  const result = await service.from(table).select("*", { count: "exact", head: true }).eq("owner_id", ownerId);
  ok(result); return result.count;
};
assert.equal(ok(await service.from("profiles").select("id")).length, 0, "Recovery fixture must start without user data");
const testToken = randomUUID(); // Dedicated synthetic provider key, never a real credential.
const envPath = path.join(workdir, "functions-recovery.env");
const users = new Set();
const clients = [];
const passed = [];
let malformedReply = true;
let extractionMode = "invalid";
let replyHeld = false;
let releaseReply = null;
let releaseExtraction = null;
let lastReplyPayload = null;
let functionProcess;
const functionLog = createWriteStream(path.join(workdir, "recovery-functions.log"));
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions" || request.headers.authorization !== `Bearer ${testToken}`) {
    response.writeHead(403); response.end(); return;
  }
  try {
    let raw = "";
    for await (const chunk of request) { raw += chunk; if (raw.length > 100_000) throw new Error("Oversized fixture request"); }
    const body = JSON.parse(raw);
    const system = body.messages[0].content;
    let content;
    if (system.includes("只提取主人此消息中明确")) {
      if (extractionMode === "hold") await new Promise((resolve) => { releaseExtraction = resolve; });
      if (extractionMode === "invalid") content = "{invalid extraction";
      else {
        const quote = body.messages.at(-1).content;
        const object = quote.includes("咖啡") ? "咖啡" : "茶";
        content = JSON.stringify({ candidates: [{ object, topic: "drink", context: "global", polarity: "positive", temporal: "current", strength: 0.6, quote, preferredOver: [], operation: "observe" }] });
      }
    } else if (system.includes("现在与主人私聊")) {
      lastReplyPayload = body.messages;
      if (replyHeld) await new Promise((resolve) => { releaseReply = resolve; });
      content = malformedReply ? "{invalid reply" : JSON.stringify({ content: "我们接着聊刚才的面试。", concerns_owner: false, risk: "none" });
      malformedReply = false;
    } else content = JSON.stringify({ signals: [] });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }));
  } catch { response.writeHead(500); response.end(); }
});

async function until(read, predicate, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${label}`);
}
async function invoke(client, name, body) {
  const result = await client.functions.invoke(name, { body });
  if (result.error) {
    let code = result.error.name;
    try { code = (await result.error.context.json()).error ?? code; } catch { /* No body. */ }
    throw new Error(code);
  }
  return result.data;
}
async function createUser(label) {
  const email = `recovery-${label}-${randomUUID()}@example.test`;
  const password = `Test-${randomUUID()}-1a!`;
  const created = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }));
  users.add(created.user.id);
  ok(await service.from("profiles").insert({ id: created.user.id, email, nickname: label }));
  const client = createClient(url, anonKey, options); clients.push(client);
  ok(await client.auth.signInWithPassword({ email, password }));
  return { id: created.user.id, email, password, client };
}
const pass = (name) => { passed.push(name); console.log(`PASS: ${name}`); };

try {
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const port = server.address().port;
  await writeFile(envPath, `MODEL_MOCK_MODE=false\nTEXT_API_BASE_URL=http://host.docker.internal:${port}/v1\nTEXT_API_KEY=${testToken}\nTEXT_MODEL=companion-fault-fixture\n`);
  functionProcess = spawn(cli, ["functions", "serve", "--workdir", workdir, "--env-file", envPath], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let serving = false;
  let launchError = null;
  const log = (chunk) => { functionLog.write(chunk); if (String(chunk).includes("Serving functions on")) serving = true; };
  functionProcess.stdout.on("data", log); functionProcess.stderr.on("data", log);
  functionProcess.on("error", (error) => { launchError = error; });
  await until(async () => { if (launchError) throw launchError; return serving; }, Boolean, "Edge Functions serve", 45_000);

  const owner = await createUser("owner");
  const outsider = await createUser("other");
  const second = createClient(url, anonKey, options); clients.push(second);
  ok(await second.auth.signInWithPassword({ email: owner.email, password: owner.password }));
  const pet = ok(await owner.client.from("pets").insert({ owner_id: owner.id, name: "验收芽芽" }).select("id").single());
  const chatRows = async () => ok(await service.from("pet_private_threads").select("id,role,content").eq("pet_id", pet.id));
  const sourceJob = async (id) => ok(await service.from("pet_memory_extraction_jobs").select("*").eq("source_message_id", id).single());
  const chatBody = { content: "我喜欢咖啡", request_id: randomUUID() };

  // Invalid model output fails closed. Retrying the same request recovers one pair.
  await assert.rejects(invoke(owner.client, "pet-chat", chatBody), /text_model_invalid_json/);
  let rows = await chatRows();
  assert.equal(rows.filter((row) => row.role === "owner").length, 1);
  assert.equal(rows.filter((row) => row.role === "pet").length, 0);
  const sourceId = rows[0].id;
  const reply = await invoke(second, "pet-chat", chatBody);
  rows = await chatRows();
  assert.equal(rows.length, 2);
  assert.equal(ok(await service.from("pet_private_requests").select("owner_message_id").eq("pet_id", pet.id).single()).owner_message_id, sourceId);
  pass("malformed reply rejected; same request recovers without duplicate messages");

  // Extraction failure happens after the reply is already durable.
  const failedJob = await until(() => sourceJob(sourceId), (job) => job.status === "failed", "failed background extraction");
  assert.equal(failedJob.error_code, "text_model_invalid_json");
  assert.equal(await count("pet_memory_evidence", owner.id), 0);
  assert.ok((await chatRows()).some((row) => row.id === reply.id));
  extractionMode = "success";
  await invoke(owner.client, "retry-pet-memory", {});
  const recoveredJob = await until(() => sourceJob(sourceId), (job) => job.status === "succeeded", "background recovery");
  assert.equal(recoveredJob.attempts, 2);
  assert.equal(await count("pet_memory_evidence", owner.id), 1);
  assert.equal(ok(await owner.client.rpc("get_pet_preference_facts"))[0].frequencyDays, 1);
  assert.equal((await invoke(owner.client, "pet-chat", chatBody)).id, reply.id);
  assert.equal((await chatRows()).length, 2);
  pass("failed extraction preserves chat; retry writes one evidence and one frequency day");

  // Hold an actual HTTP model response, edit from the other client, then release it.
  replyHeld = true;
  const conflictBody = { content: "我们继续面试准备", request_id: randomUUID() };
  const conflictResult = invoke(owner.client, "pet-chat", conflictBody).then((value) => ({ value }), (error) => ({ error }));
  await until(async () => releaseReply, Boolean, "held model reply");
  ok(await second.rpc("update_pet_preference", { target_key: "咖啡|global", action: "negative" }));
  replyHeld = false; releaseReply(); releaseReply = null;
  assert.match((await conflictResult).error?.message ?? "", /companion_context_changed/);
  assert.equal((await chatRows()).filter((row) => row.role === "pet").length, 1);
  await invoke(second, "pet-chat", conflictBody);
  assert.equal((await chatRows()).filter((row) => row.content === conflictBody.content).length, 1);
  await until(async () => ok(await service.from("pet_memory_extraction_jobs").select("status").eq("pet_id", pet.id)), (jobs) => jobs.every((job) => job.status === "succeeded"), "preceding jobs settled");
  pass("second-client edit during real generation blocks stale write; retry reuses owner message");

  // A forgotten source is cancelled while its actual model extraction is in flight.
  extractionMode = "hold";
  const teaBody = { content: "我喜欢茶", request_id: randomUUID() };
  await invoke(owner.client, "pet-chat", teaBody);
  await until(async () => releaseExtraction, Boolean, "held memory extraction");
  const teaSource = (await chatRows()).find((row) => row.role === "owner" && row.content === teaBody.content);
  const manual = ok(await owner.client.rpc("save_pet_personal_memory", { target_pet_id: pet.id, memory_content: teaBody.content, source_message_id: teaSource.id }));
  ok(await second.rpc("remove_pet_personal_memory", { target_memory_id: manual.id }));
  assert.equal((await sourceJob(teaSource.id)).status, "cancelled");
  extractionMode = "success"; releaseExtraction(); releaseExtraction = null;
  await until(async () => ok(await service.from("model_runs").select("status").eq("pet_id", pet.id)), (runs) => runs.every((run) => run.status !== "running"), "held worker settled");
  assert.ok(!ok(await owner.client.rpc("get_pet_preference_facts")).some((fact) => fact.object === "茶"));
  assert.equal((await sourceJob(teaSource.id)).status, "cancelled");
  pass("forgetting an in-flight source prevents its late extraction from restoring it");

  ok(await second.rpc("update_pet_preference", { target_key: "咖啡|global", action: "forget" }));
  await invoke(owner.client, "pet-chat", { content: "接着聊面试", request_id: randomUUID() });
  const futureContext = JSON.stringify(lastReplyPayload.slice(1));
  assert.ok(!futureContext.includes("我喜欢咖啡"));
  assert.ok(!futureContext.includes("我喜欢茶"));
  assert.ok(futureContext.includes("我们继续面试准备"));
  assert.ok((await chatRows()).some((row) => row.id === sourceId), "raw log retained");
  pass("forgotten source is absent from the actual next model payload; unrelated topic remains");

  const retained = ok(await owner.client.rpc("save_pet_personal_memory", { target_pet_id: pet.id, memory_content: "测试用事实" }));
  ok(await second.rpc("save_pet_personal_memory", { target_pet_id: pet.id, memory_id: retained.id, memory_content: "测试用事实新版本" }));
  await assert.rejects(invoke(owner.client, "delete-account", { password: "wrong-password-for-test" }), /password_verification_failed/);
  assert.equal((await invoke(owner.client, "delete-account", { password: owner.password })).deleted, true);
  users.delete(owner.id);
  for (const table of ["pet_private_threads", "pet_memory_evidence", "pet_personal_memories", "pet_personal_memory_versions", "pet_preference_controls", "pet_private_context_exclusions", "pet_memory_extraction_jobs", "pet_private_requests"]) assert.equal(await count(table, owner.id), 0, `${table} must cascade`);
  assert.equal(ok(await service.from("profiles").select("id").eq("id", outsider.id)).length, 1);
  pass("password-verified account deletion removes new memory data and preserves the other account");
} finally {
  releaseReply?.(); releaseExtraction?.();
  for (const client of clients) await client.removeAllChannels();
  for (const id of users) ok(await service.auth.admin.deleteUser(id));
  // Stop only this script's dedicated Edge container; retain its database backup.
  spawnSync("docker", ["stop", "supabase_edge_runtime_companion-validation"], { windowsHide: true, stdio: "ignore" });
  functionProcess?.kill();
  functionLog.end();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  await rm(envPath, { force: true });
  await writeFile(path.join(workdir, "recovery-result.json"), JSON.stringify({ passed, completed: passed.length === 6 }, null, 2));
}
console.log(`PASS: ${passed.length} deterministic Supabase/Edge recovery scenarios.`);
