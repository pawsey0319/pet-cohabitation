// Bounded product-provider acceptance: one real generation POST, temporary
// accounts, actual production worker/RPC/Storage, and real Edge reads/applies.
// Generation dispatch is direct because the shared Edge fixture stays in mock
// mode. Transport faults below are injected and are never called live failures.
import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL");
if (url !== "http://127.0.0.1:47321") throw new Error("isolated_avatar_fixture_required");
for (const line of (await Deno.readTextFile("test-results/current-models.private.env")).split(/\r?\n/)) {
  const match = /^(IMAGE_API_BASE_URL|IMAGE_API_KEY|IMAGE_MODEL)=(.*)$/.exec(line.trim());
  if (match) Deno.env.set(match[1], match[2].replace(/^['"]|['"]$/g, ""));
}
Deno.env.set("MODEL_MOCK_MODE", "false");
const { runAvatarGeneration } = await import("../../../supabase/functions/_shared/imageGenerationWorkers.ts");
const { ImageModelAdapter } = await import("../../../supabase/functions/_shared/modelAdapters.ts");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), opts);
const accounts = [], checks = [], cleanup = [];
let space, requestCount = 0, blockedAttempts = 0, injectTimeout = false;
const output = "test-results/avatar-live-20260914";
await Deno.mkdir(output, { recursive: true });
const report = {
  timestamp: new Date().toISOString(), model: ImageModelAdapter.modelName(), fixture: url,
  scope: "Direct production runAvatarGeneration + real local Supabase Auth/RPC/Storage + deployed local Edge read/apply/status. Edge generation dispatch, Android UI and production deployment are excluded.",
  retryPolicy: "Only one outbound images/generations POST is allowed; automatic adapter retries are blocked in this acceptance process.",
  checks, cleanup, success: false,
};
const originalFetch = globalThis.fetch;
const generationUrl = `${Deno.env.get("IMAGE_API_BASE_URL").replace(/\/+$/, "")}/images/generations`;
globalThis.fetch = async (input, init) => {
  const address = input instanceof Request ? input.url : String(input);
  if (address === generationUrl && (init?.method ?? (input instanceof Request ? input.method : "GET")) === "POST") {
    if (injectTimeout) { blockedAttempts++; throw new DOMException("injected_avatar_timeout", "TimeoutError"); }
    if (requestCount >= 1) { blockedAttempts++; throw new Error("image_acceptance_retry_blocked"); }
    requestCount++;
    console.log("LIVE: sending the single permitted product image request.");
  }
  return originalFetch(input, init);
};
const ok = result => { if (result.error) throw new Error(`supabase_${result.error.code ?? "operation_failed"}`); return result.data; };
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
const uuid = () => crypto.randomUUID();
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
async function edge(account, body) {
  const session = ok(await account.client.auth.getSession()).session;
  const response = await fetch(`${url}/functions/v1/avatar-assets`, { method: "POST", headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY"), Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function invoke(account, body) {
  const result = await edge(account, body);
  if (result.status >= 400) throw new Error(`edge_${result.body.error ?? "operation_failed"}`);
  return result.body;
}
async function account() {
  const email = `avatar-live-${uuid()}@example.test`, password = `Temporary-${uuid()}!`;
  const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user;
  const item = { id: user.id, client: createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), opts) };
  accounts.push(item);
  ok(await service.from("profiles").insert({ id: user.id, email, nickname: "真实头像临时验收" }));
  ok(await item.client.auth.signInWithPassword({ email, password }));
  return item;
}
const state = account => invoke(account, { action: "state", target: { kind: "profile", id: account.id } });
const claims = async owner => ok(await service.from("personal_image_design_claims").select("request_id,kind").eq("owner_id", owner));
try {
  const a = await account(), b = await account(), c = await account();
  space = ok(await service.from("spaces").insert({ name: "头像真实模型隔离验收", kind: "friend_circle", created_by: a.id }).select("id").single()).id;
  ok(await service.from("space_members").upsert([{ space_id: space, user_id: a.id, role: "owner" }, { space_id: space, user_id: b.id, role: "member" }], { onConflict: "space_id,user_id" }));
  const oldId = uuid(), oldPath = `${a.id}/${oldId}.jpg`;
  const fixture = await Deno.readFile("src/avatars/__tests__/avatar-fixture.jpg");
  ok(await a.client.storage.from("avatars").upload(oldPath, fixture, { contentType: "image/jpeg", upsert: false }));
  check((await invoke(a, { action: "register", request_id: oldId })).asset.id === oldId, "real Edge registers old uploaded avatar");
  await invoke(a, { action: "apply", target: { kind: "profile", id: a.id }, request_id: uuid(), asset_id: oldId, expected_version: 0 });
  const oldState = await state(a);
  const rejected = await edge(a, { action: "generate", request_id: uuid(), prompt: "synthetic avatar acceptance" });
  check(rejected.status === 400 && rejected.body.error === "avatar_mock_disabled", "shared Edge generation remains disabled by existing mock configuration");
  check((await claims(a.id)).length === 0, "mock refusal consumes no quota");
  const prompt = "A single original imaginary pet for a personal avatar: friendly fluffy turquoise creature with two round ears, two short arms and two feet, a tiny lavender ribbon, clearly visible whole body centered with generous margins, warm cream plain background, soft clay illustration, no text or watermark. Fictional synthetic subject only.";
  const claim = { p_owner_id: a.id, p_request_id: uuid(), p_prompt: prompt, p_model: ImageModelAdapter.modelName() };
  const job = ok(await service.rpc("claim_avatar_generation", claim));
  report.request_id = job.request_id;
  check(ok(await service.rpc("claim_avatar_generation", claim)).id === job.id, "same generation request reuses job");
  check((await claims(a.id)).length === 1, "generation retry consumes exactly one personal claim");
  const lease = ok(await service.rpc("lease_avatar_generation", { p_job_id: job.id }));
  check(lease.attempts === 1, "first cloud lease acquired without generating an image");
  check(ok(await service.rpc("lease_avatar_generation", { p_job_id: job.id })) === null, "active lease is not stolen");
  ok(await service.from("avatar_generations").update({ lease_until: new Date(Date.now() - 10000).toISOString() }).eq("id", job.id).eq("owner_id", a.id));
  check(ok(await service.rpc("begin_avatar_upload", { p_job_id: job.id, p_lease_token: lease.lease_token })) === false, "expired lease cannot begin upload");
  assert.deepEqual(await state(a), oldState); checks.push("queued and interrupted generation preserves old applied avatar");
  const started = Date.now();
  await runAvatarGeneration(job.id);
  report.generation_ms = Date.now() - started;
  const generated = ok(await service.from("avatar_generations").select("status,asset_id,error_code,attempts,lease_token,upload_started").eq("id", job.id).single());
  report.generation = { status: generated.status, error_code: generated.error_code, attempts: generated.attempts };
  check(generated.status === "succeeded", `live worker succeeds (${generated.error_code ?? generated.status})`);
  check(requestCount === 1 && generated.attempts === 2 && generated.lease_token !== lease.lease_token, "expired job recovers with a new lease and one real provider request");
  check(generated.upload_started === false, "successful commit clears upload flag");
  const ai = ok(await service.from("avatar_assets").select("storage_path,source,content_sha256").eq("id", generated.asset_id).single());
  const image = new Uint8Array(await ok(await service.storage.from("avatars").download(ai.storage_path)).arrayBuffer());
  check(ai.source === "ai" && ai.content_sha256 === await hash(image), "actual AI bytes upload privately and match committed SHA256");
  const extension = ai.storage_path.split(".").pop();
  report.image = { file: `${output}/avatar.${extension}`, bytes: image.byteLength, sha256: ai.content_sha256 };
  await Deno.writeFile(report.image.file, image);
  assert.deepEqual(await state(a), oldState); checks.push("successful generation remains a preview draft until explicit apply");
  const ownStatus = await invoke(a, { action: "status", request_id: job.request_id });
  check(ownStatus.job.status === "succeeded" && ownStatus.job.asset_id === generated.asset_id, "real Edge owner status exposes completed draft");
  check((await invoke(b, { action: "status", request_id: job.request_id })).job === null, "cross-account status cannot discover draft");
  const preview = await invoke(a, { action: "read", asset_id: generated.asset_id });
  // Local Edge generates its internal storage origin. Substitute only that
  // trusted fixture host for the desktop client and record this boundary.
  const previewUrl = new URL(preview.url);
  if (previewUrl.hostname === "kong" || previewUrl.hostname === "host.docker.internal") {
    const origin = new URL(url); previewUrl.hostname = origin.hostname; previewUrl.port = origin.port;
    report.localSignedUrlOriginTranslated = true;
  }
  const visible = await fetch(previewUrl);
  check(visible.ok && await hash(await visible.arrayBuffer()) === ai.content_sha256, "owner preview URL serves exact generated bytes");
  check((await edge(b, { action: "read", asset_id: generated.asset_id })).status === 403, "same-group peer cannot read unapplied AI draft through Edge");
  check(ok(await b.client.from("avatar_assets").select("id").eq("id", generated.asset_id)).length === 0, "AI draft metadata is hidden from peer by RLS");
  check(!!(await b.client.storage.from("avatars").createSignedUrl(ai.storage_path, 60)).error, "peer cannot sign private AI draft directly in Storage");
  const apply = { action: "apply", target: { kind: "profile", id: a.id }, request_id: uuid(), asset_id: generated.asset_id, expected_version: oldState.version };
  const applied = await invoke(a, apply);
  check(applied.version === 2 && applied.reference === `avatar://${generated.asset_id}`, "explicit real Edge apply selects generated avatar at next version");
  assert.deepEqual(await invoke(a, apply), applied); checks.push("AI avatar apply retry is idempotent");
  check((await edge(b, { action: "read", asset_id: generated.asset_id })).status === 200, "same-group peer can read AI avatar after apply");
  check((await edge(c, { action: "read", asset_id: generated.asset_id })).status === 403, "unrelated account cannot read applied AI avatar");
  check((await edge(b, { action: "apply", target: { kind: "profile", id: b.id }, request_id: uuid(), asset_id: generated.asset_id, expected_version: 0 })).status === 403, "peer cannot apply another account's generated asset");
  const fail = ok(await service.rpc("claim_avatar_generation", { ...claim, p_request_id: uuid(), p_prompt: "Injected timeout acceptance without provider request" }));
  injectTimeout = true;
  await runAvatarGeneration(fail.id);
  injectTimeout = false;
  const failed = ok(await service.from("avatar_generations").select("status,error_code,asset_id").eq("id", fail.id).single());
  check(failed.status === "failed" && failed.error_code === "image_model_timeout" && failed.asset_id === null, "injected timeout is persisted as sanitized failed job without asset");
  assert.deepEqual(await state(a), applied); checks.push("injected generation failure preserves previously applied AI avatar");
  check((await invoke(a, { action: "status", request_id: fail.request_id })).job.error_code === "image_model_timeout", "real Edge reports persisted injected failure for recovery UI");
  await runAvatarGeneration(fail.id);
  check(requestCount === 1, "terminal failure cannot silently issue another provider request");
  check((await claims(a.id)).length === 2, "one live request and one injected failed request each consume one claim");
  for (let i = 0; i < 10; i++) ok(await service.rpc("claim_personal_image_design", { p_owner_id: a.id, p_request_id: uuid(), p_kind: i % 2 ? "background" : "avatar" }));
  const quota = await service.rpc("claim_personal_image_design", { p_owner_id: a.id, p_request_id: uuid(), p_kind: "background" });
  check(quota.error?.message.includes("image_daily_limit") && (await claims(a.id)).length === 12, "avatar and background share the 12-per-day quota without extra generation");
  const restored = await invoke(a, { action: "apply", target: { kind: "profile", id: a.id }, request_id: uuid(), asset_id: oldId, expected_version: applied.version });
  check(restored.reference === `avatar://${oldId}` && restored.version === 3, "real Edge restores original uploaded avatar after AI apply");
  check((await edge(b, { action: "read", asset_id: generated.asset_id })).status === 403, "restored original immediately revokes new AI signed-URL issuance to peers");
  check(ok(await service.rpc("complete_avatar_generation", { p_job_id: job.id, p_lease_token: lease.lease_token, p_asset_id: uuid(), p_path: `${a.id}/${uuid()}.png`, p_sha256: ai.content_sha256 })) === false, "stale pre-recovery lease cannot late-commit another asset");
  ok(await service.from("space_members").delete().eq("space_id", space).eq("user_id", b.id));
  check((await edge(b, { action: "state", target: { kind: "profile", id: a.id } })).status === 403, "leaving shared group revokes avatar state access");
  report.success = true;
} catch (reason) {
  report.failure = reason instanceof Error ? reason.message : "avatar_live_acceptance_failed";
  console.error(`FAIL: ${report.failure}`);
} finally {
  globalThis.fetch = originalFetch;
  report.actual_provider_generation_posts = requestCount;
  report.locally_blocked_transport_attempts = blockedAttempts;
  if (space) { const removed = await service.from("spaces").delete().eq("id", space); cleanup.push({ resource: "temporary_space", ok: !removed.error }); }
  for (const account of accounts) {
    const listed = await service.storage.from("avatars").list(account.id, { limit: 100 });
    const paths = (listed.data ?? []).filter(row => row.id).map(row => `${account.id}/${row.name}`);
    const removed = paths.length ? await service.storage.from("avatars").remove(paths) : { error: null };
    cleanup.push({ resource: "temporary_avatar_objects", count: paths.length, ok: !listed.error && !removed.error });
    const deleted = await service.auth.admin.deleteUser(account.id);
    cleanup.push({ resource: "temporary_auth_account", ok: !deleted.error });
  }
  report.success = report.success && cleanup.every(row => row.ok);
  await Deno.writeTextFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(`${report.success ? "PASS" : "FAIL"}: ${checks.length} avatar checks; ${requestCount} real generation POST(s); cleanup ${cleanup.every(row => row.ok) ? "passed" : "failed"}. Report: ${output}/report.json`);
}
if (!report.success) Deno.exit(1);
