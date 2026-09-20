// Actual Deno source handler + isolated Auth/DB. No model, deployed function,
// production account, or user message is used. One controlled race pauses a
// real REST update while the same isolated row is marked for operator review.
import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL");
if (!url || new URL(url).hostname !== "127.0.0.1" || !["47321", "48321"].includes(new URL(url).port)) throw new Error("isolated_fixture_required");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), options);
const accounts = [], clients = [], checks = [], cleanup = [], background = [];
const report = { checked_at: new Date().toISOString(), fixture: url, source_handler: "supabase/functions/handle-space-message/index.ts", scope: "Real isolated Auth/REST/RPC with actual Deno source handler and a controlled pre-update race; not a deployed Edge or model acceptance", checks, cleanup, success: false };
const originalFetch = globalThis.fetch, originalServe = Deno.serve, originalEdgeRuntime = globalThis.EdgeRuntime;
let space, handler, raceJob = null, crossedRace = false;
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
async function account() {
  const email = `legacy-review-${crypto.randomUUID()}@example.test`, password = `Test-${crypto.randomUUID()}!`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  accounts.push(id); ok(await service.from("profiles").insert({ id, email, nickname: "Synthetic retry review" }));
  const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), options); clients.push(client);
  const session = ok(await client.auth.signInWithPassword({ email, password })).session;
  return { id, client, token: session.access_token };
}
async function invoke(owner, messageId) {
  const response = await handler(new Request(`${url}/functions/v1/handle-space-message`, { method: "POST", headers: { Authorization: `Bearer ${owner.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message_id: messageId }) }));
  return { status: response.status, body: await response.json() };
}
async function markReview(id) {
  ok(await service.from("agent_jobs").update({ status: "failed", stage: "failed", retryable: false, error_code: "legacy_route_review_required", completed_at: new Date().toISOString() }).eq("id", id));
}
try {
  const owner = await account(), outsider = await account();
  space = ok(await owner.client.rpc("create_relationship_space", { space_name: "Synthetic legacy review", space_kind: "friend_circle" }));
  const sent = ok(await owner.client.rpc("send_space_message_v2", { message_client_id: crypto.randomUUID(), target_space_id: space, message_kind: "text", message_text: "Synthetic review retry fixture" }));
  ok(await service.from("agent_jobs").update({ attempts: 1, result: { retained: "synthetic existing result" } }).eq("id", sent.job_id));
  await markReview(sent.job_id);
  Deno.serve = callback => { handler = callback; return {}; };
  globalThis.EdgeRuntime = { waitUntil: promise => background.push(Promise.resolve(promise)) };
  globalThis.fetch = async (input, init) => {
    const address = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (address.origin !== new URL(url).origin) throw new Error("external_network_forbidden_in_retry_test");
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (raceJob && !crossedRace && method === "PATCH" && address.pathname === "/rest/v1/agent_jobs") {
      crossedRace = true;
      await markReview(raceJob);
    }
    return originalFetch(input, init);
  };
  await import("../supabase/functions/handle-space-message/index.ts");
  check(typeof handler === "function", "loads the actual Deno handler");
  const result = await invoke(owner, sent.message.id);
  check(result.status === 202 && result.body.status === "failed" && result.body.error_code === "legacy_route_review_required" && result.body.retryable === false, "review-required replay returns the terminal receipt without requeue");
  const preserved = ok(await service.from("agent_jobs").select("status,attempts,result,error_code").eq("id", sent.job_id).single());
  check(preserved.status === "failed" && preserved.attempts === 1 && preserved.result.retained === "synthetic existing result", "manual retry preserves attempt count and partial result");
  check(ok(await service.rpc("claim_space_route_job", { p_job_id: sent.job_id })) === null, "worker claim rejects the review terminal state");
  check((await invoke(outsider, sent.message.id)).status >= 400, "an unrelated account cannot route the source message");
  // Simulate an ordinary retryable failure observed just before an operator
  // marks it for review. The REST write must enforce the fence atomically.
  ok(await service.from("agent_jobs").update({ status: "failed", error_code: "synthetic_model_failure", retryable: true }).eq("id", sent.job_id));
  raceJob = sent.job_id;
  const raced = await invoke(owner, sent.message.id);
  check(crossedRace, "crossed a real REST requeue write boundary");
  check(raced.status === 202 && raced.body.status === "failed" && raced.body.error_code === "legacy_route_review_required" && raced.body.retryable === false, "a concurrent review decision cannot be overwritten by retry");
  const afterRace = ok(await service.from("agent_jobs").select("status,attempts,result,error_code").eq("id", sent.job_id).single());
  check(afterRace.status === "failed" && afterRace.error_code === "legacy_route_review_required" && afterRace.attempts === 1 && afterRace.result.retained === "synthetic existing result", "the retry race preserves the review state and retained result");
  check(background.length === 0, "no model/background execution is started");
  const rows = ok(await service.from("agent_jobs").select("id").eq("source_message_id", sent.message.id));
  check(rows.length === 1 && rows[0].id === sent.job_id, "replays create no duplicate route or child jobs");
  report.success = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  globalThis.fetch = originalFetch; Deno.serve = originalServe;
  if (originalEdgeRuntime === undefined) delete globalThis.EdgeRuntime; else globalThis.EdgeRuntime = originalEdgeRuntime;
  await Promise.allSettled(background);
  if (space) { const removed = await service.from("spaces").delete().eq("id", space); cleanup.push({ resource: "synthetic_space", ok: !removed.error }); }
  for (const id of accounts) { const removed = await service.auth.admin.deleteUser(id); cleanup.push({ resource: "synthetic_account", ok: !removed.error }); }
  await Promise.all(clients.map(client => client.removeAllChannels()));
  await Deno.mkdir("test-results/targeted-review-20260914", { recursive: true });
  await Deno.writeTextFile(`test-results/targeted-review-20260914/legacy-route-retry-${new URL(url).port}.json`, JSON.stringify(report, null, 2));
  if (!cleanup.every(item => item.ok)) throw new Error("fixture_cleanup_failed");
}
console.log(`PASS: ${checks.length} legacy review retry checks; cleanup passed.`);
