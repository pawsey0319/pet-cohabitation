// No image provider or rembg inference. Only temporary accounts and seeded
// jobs in an isolated fixture; never leases the global transparent queue.
import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL");
if (!url || new URL(url).hostname !== "127.0.0.1" || !["47321", "48321"].includes(new URL(url).port)) throw new Error("isolated_fixture_required");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), opts);
const clients = [], accounts = [], checks = [], cleanup = [], channels = [];
const uuid = () => crypto.randomUUID();
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
const report = { timestamp: new Date().toISOString(), fixture: url, scope: "Real local Auth/RPC/Edge/Storage/Realtime approval contracts; seeded image jobs, no inference or quality acceptance. Race tests invoke the unchanged source Edge handler in-process with actual Supabase I/O and a controlled signing barrier.", checks, cleanup, success: false };
const originalFetch = globalThis.fetch, originalServe = Deno.serve;
async function login(email, password) {
  const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), opts); clients.push(client);
  ok(await client.auth.signInWithPassword({ email, password })); return client;
}
async function account() {
  const email = `pet-approval-${uuid()}@example.test`, password = `Test-${uuid()}!`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  accounts.push(id); ok(await service.from("profiles").insert({ id, email, nickname: "透明预览确认隔离验收" }));
  return { id, email, password, client: await login(email, password) };
}
async function pet(owner) {
  const id = ok(await service.from("pets").insert({ owner_id: owner, name: "确认合同合成样本" }).select("id").single()).id;
  const source = uuid(), sourcePath = `${owner}/${source}.png`, bytes = await Deno.readFile("assets/brand/icon.png");
  ok(await service.storage.from("pet-portraits").upload(sourcePath, bytes, { contentType: "image/png" }));
  ok(await service.from("pet_visual_assets").insert({ id: source, pet_id: id, owner_id: owner, storage_path: sourcePath, prompt_hash: "approval-contract-bundled-brand", is_draft: false }));
  ok(await service.from("pets").update({ status: "confirmed", confirmed_at: new Date().toISOString(), current_asset_id: source }).eq("id", id));
  return { id, owner, source, bytes };
}
async function readyJob(pet, version) {
  const job = ok(await service.rpc("request_pet_transparent", { p_owner_id: pet.owner, p_pet_id: pet.id, p_request_id: uuid(), p_expected_version: version }));
  const path = `${pet.owner}/${uuid()}.png`;
  ok(await service.storage.from("pet-transparent").upload(path, pet.bytes, { contentType: "image/png" }));
  ok(await service.from("pet_transparent_jobs").update({ status: "succeeded", output_path: path, output_sha256: "a".repeat(64), completed_at: new Date().toISOString() }).eq("id", job.id).eq("owner_id", pet.owner));
  return { ...job, status: "succeeded", output_path: path };
}
async function edge(client, body) {
  const session = ok(await client.auth.getSession()).session;
  const response = await fetch(`${url}/functions/v1/pet-display`, { method: "POST", headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY"), Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function invoke(client, body) { const result = await edge(client, body); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; }
const status = (client, pet) => invoke(client, { action: "status", pet_id: pet.id });
const parameters = (pet, job, version) => ({ p_owner_id: pet.owner, p_pet_id: pet.id, p_request_id: uuid(), p_job_id: job.id, p_source_asset_id: pet.source, p_expected_version: version });
const approvalBody = params => ({ action: "approve", pet_id: params.p_pet_id, request_id: params.p_request_id, job_id: params.p_job_id, source_asset_id: params.p_source_asset_id, expected_version: params.p_expected_version });
async function restore(client, pet, version, enabled = false) { return invoke(client, { action: "set", pet_id: pet.id, request_id: uuid(), expected_version: version, use_transparent: enabled }); }
async function subscribe(client, events) {
  await new Promise((resolve, reject) => {
    let joined = false, replicationReady = false;
    const timer = setTimeout(() => reject(new Error("approval_realtime_not_ready")), 30000);
    const ready = () => { if (joined && replicationReady) { clearTimeout(timer); resolve(); } };
    const channel = client.channel(`approval-${uuid()}`, { config: { broadcast: { replication_ready: true } } })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pet_display_preferences" }, event => events.push(event.new))
      .on("system", {}, event => { if (event.status === "ok" && event.extension === "postgres_changes") { replicationReady = true; ready(); } })
      .subscribe(value => { if (value === "SUBSCRIBED") { joined = true; ready(); } if (["CHANNEL_ERROR", "TIMED_OUT"].includes(value)) { clearTimeout(timer); reject(new Error(`approval_realtime_${value}`)); } });
    channels.push(channel);
  });
}
async function until(predicate) { const end = Date.now() + 15000; while (!predicate()) { if (Date.now() > end) throw new Error("approval_realtime_update_timeout"); await new Promise(resolve => setTimeout(resolve, 100)); } }
try {
  const a = await account(), b = await account(), second = await login(a.email, a.password);
  const p = await pet(a.id), other = await pet(b.id), job = await readyJob(p, 0), otherJob = await readyJob(other, 0);
  const initial = await status(a.client, p);
  check(initial.url === null && typeof initial.candidate_url === "string", "old clients receive no main URL for a succeeded unapproved derivative");
  check(initial.preference.approved_job_id === null, "existing succeeded jobs are not silently grandfathered into approval");
  check((await edge(b.client, { action: "status", pet_id: p.id })).status === 403, "other account cannot read candidate or main URL");
  const params = parameters(p, job, 0);
  check(!!(await a.client.rpc("approve_pet_transparent", params)).error, "approval RPC is service-only");
  const directUpdate = await a.client.from("pet_display_preferences").update({ approved_job_id: job.id }).eq("pet_id", p.id).select("approved_job_id");
  check((!!directUpdate.error || directUpdate.data.length === 0) && ok(await service.from("pet_display_preferences").select("approved_job_id").eq("pet_id", p.id).single()).approved_job_id === null, "owner cannot write approval columns directly");
  for (const field of Object.keys(params)) {
    const invalid = await service.rpc("approve_pet_transparent", { ...params, [field]: null });
    check(invalid.error?.message.includes("pet_display_input_invalid"), `approval rejects null ${field}`);
  }
  check((await service.rpc("approve_pet_transparent", { ...params, p_expected_version: -1 })).error?.message.includes("pet_display_input_invalid"), "approval rejects negative version");
  check((await service.rpc("approve_pet_transparent", { ...params, p_job_id: otherJob.id })).error?.message.includes("pet_display_forbidden"), "approval cannot target another owner's job");
  check((await service.rpc("approve_pet_transparent", { ...params, p_source_asset_id: uuid() })).error?.message.includes("pet_display_source_changed"), "approval requires current immutable source");
  check((await service.rpc("approve_pet_transparent", { ...params, p_expected_version: 1 })).error?.message.includes("pet_display_version_conflict"), "approval requires exact current preference version");
  ok(await service.from("pet_transparent_jobs").update({ status: "running" }).eq("id", job.id));
  check((await service.rpc("approve_pet_transparent", params)).error?.message.includes("pet_display_not_ready"), "incomplete jobs cannot be approved");
  ok(await service.from("pet_transparent_jobs").update({ status: "succeeded" }).eq("id", job.id));
  const eventsA = [], eventsB = [];
  await Promise.all([subscribe(second, eventsA), subscribe(b.client, eventsB)]);
  const applied = await invoke(a.client, approvalBody(params));
  check(applied.preference.version === 0 && applied.preference.approved_job_id === job.id && applied.preference.approved_source_asset_id === p.source && applied.preference.approved_display_version === 0, "real Edge persists exact approval without advancing generation version");
  await until(() => eventsA.some(event => event.approved_job_id === job.id));
  check(eventsA.some(event => event.owner_id === a.id && event.pet_id === p.id), "second owner session receives real approval Realtime update");
  const viewed = await status(second, p);
  check(!!viewed.url && viewed.url === viewed.candidate_url, "another session sees persisted approved main image");
  const duplicateRequests = await Promise.all([a.client, second].map(client => edge(client, { action: "request", pet_id: p.id, request_id: uuid(), expected_version: 0 })));
  check(duplicateRequests.every(result => result.status === 202 && result.body.job.id === job.id && result.body.job.status === "succeeded"), "concurrent fresh request IDs reuse the succeeded approved job across owner sessions");
  const jobsForVersion = ok(await service.from("pet_transparent_jobs").select("id").eq("pet_id", p.id).eq("owner_id", a.id).eq("source_asset_id", p.source).eq("expected_display_version", 0));
  check(jobsForVersion.length === 1 && jobsForVersion[0].id === job.id, "request deduplication cannot create a newer competing job for an approved source/version");
  const afterDuplicateRequests = await status(a.client, p);
  check(!!afterDuplicateRequests.url && afterDuplicateRequests.preference.approved_job_id === job.id && afterDuplicateRequests.job.id === job.id, "request replay from another session preserves the approved portrait");
  assert.deepEqual(await invoke(a.client, approvalBody(params)), applied); checks.push("approval request replay is idempotent");
  check((await service.rpc("approve_pet_transparent", { ...params, p_job_id: uuid() })).error?.message.includes("pet_display_request_conflict"), "approval request ID cannot change payload");
  const reverted = await restore(a.client, p, 0);
  check(reverted.preference.version === 1, "explicit restore advances preference version");
  await until(() => eventsA.some(event => event.version === 1 && !event.use_transparent));
  check((await status(second, p)).url === null, "remote restored choice returns original main portrait");
  check((await service.rpc("approve_pet_transparent", { ...params, p_request_id: uuid() })).error?.message.includes("pet_display_version_conflict"), "stale approval cannot undo restore");
  await invoke(a.client, approvalBody(params));
  check((await status(a.client, p)).url === null, "replayed old approval receipt cannot reactivate a restored image");
  await restore(a.client, p, 1, true);
  const replacement = await readyJob(p, 2);
  const unapprovedAgain = await status(a.client, p);
  check(unapprovedAgain.url === null && !!unapprovedAgain.candidate_url, "restore then re-enable requires approval of the new display version");
  await invoke(b.client, approvalBody(parameters(other, otherJob, 0)));
  await until(() => eventsB.some(event => event.approved_job_id === otherJob.id));
  check(eventsB.every(event => event.owner_id === b.id) && eventsA.every(event => event.owner_id === a.id), "Realtime approval payloads obey owner RLS even without client owner filter");
  check(ok(await b.client.from("pet_display_preferences").select("approved_job_id").eq("pet_id", p.id)).length === 0, "approval metadata is private in direct database reads");
  await invoke(a.client, approvalBody(parameters(p, replacement, 2)));

  // Invoke the source handler directly without opening a server. Network I/O
  // stays real; the single barrier is after Storage signs and before return.
  let handler;
  Deno.serve = callback => { handler = callback; return {}; };
  await import("../../../supabase/functions/pet-display/index.ts");
  Deno.serve = originalServe;
  assert.equal(typeof handler, "function");
  async function race(action) {
    let crossed = false;
    globalThis.fetch = async (input, init) => {
      const address = input instanceof Request ? input.url : String(input);
      const response = await originalFetch(input, init);
      if (!crossed && address.includes("/storage/v1/object/sign/pet-transparent/")) { crossed = true; await action(); }
      return response;
    };
    try {
      const session = ok(await a.client.auth.getSession()).session;
      const response = await handler(new Request(`${url}/functions/v1/pet-display`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: "status", pet_id: p.id }) }));
      check(crossed, "race barrier crossed actual Storage signing boundary");
      return { status: response.status, body: await response.json() };
    } finally { globalThis.fetch = originalFetch; }
  }
  const restoreRace = await race(() => service.rpc("set_pet_display", { p_owner_id: a.id, p_pet_id: p.id, p_request_id: uuid(), p_expected_version: 2, p_use_transparent: false }).then(ok));
  check(restoreRace.status === 200 && restoreRace.body.preference.version === 3 && restoreRace.body.url === null && restoreRace.body.candidate_url === null, "restore while signing suppresses both stale main and candidate URLs");
  await restore(a.client, p, 3, true);
  const next = await readyJob(p, 4); await invoke(a.client, approvalBody(parameters(p, next, 4)));
  const changedSource = uuid();
  ok(await service.from("pet_visual_assets").insert({ id: changedSource, pet_id: p.id, owner_id: a.id, storage_path: `${a.id}/${changedSource}.png`, prompt_hash: "new-source-contract", is_draft: false }));
  const sourceRace = await race(() => service.from("pets").update({ current_asset_id: changedSource }).eq("id", p.id).then(ok));
  check(sourceRace.status === 200 && sourceRace.body.source_asset_id === changedSource && sourceRace.body.url === null && sourceRace.body.candidate_url === null, "source changed while signing suppresses previous derivative URLs");
  ok(await service.from("pets").update({ current_asset_id: p.source }).eq("id", p.id));
  const deletionRace = await race(() => service.from("chat_background_owner_controls").upsert({ owner_id: a.id, deleting: true }).then(ok));
  check(deletionRace.status === 403 && !deletionRace.body.url && !deletionRace.body.candidate_url, "account deletion during signing denies response URLs");
  check((await edge(a.client, { action: "status", pet_id: p.id })).status === 403, "deleting owner cannot obtain fresh candidate/main URLs through actual Edge");
  check((await service.rpc("approve_pet_transparent", { ...parameters(p, next, 4) })).error?.message.includes("pet_display_forbidden"), "deleting owner cannot approve a ready candidate");
  report.success = true;
} catch (reason) {
  report.failure = reason instanceof Error ? reason.message : "approval_contract_failed";
  console.error(`FAIL: ${report.failure}`);
} finally {
  globalThis.fetch = originalFetch; Deno.serve = originalServe;
  for (const client of clients) await client.removeAllChannels();
  for (const owner of accounts) {
    for (const bucket of ["pet-portraits", "pet-transparent"]) {
      const files = await service.storage.from(bucket).list(owner, { limit: 100 });
      const paths = (files.data ?? []).filter(row => row.id).map(row => `${owner}/${row.name}`);
      const removed = paths.length ? await service.storage.from(bucket).remove(paths) : { error: null };
      cleanup.push({ resource: bucket, count: paths.length, ok: !files.error && !removed.error });
    }
    const deleted = await service.auth.admin.deleteUser(owner); cleanup.push({ resource: "temporary_account", ok: !deleted.error });
  }
  report.success = report.success && cleanup.every(result => result.ok);
  const folder = "test-results/avatar-live-20260914"; await Deno.mkdir(folder, { recursive: true });
  await Deno.writeTextFile(`${folder}/approval-contract-${new URL(url).port}.json`, JSON.stringify(report, null, 2));
  console.log(`${report.success ? "PASS" : "FAIL"}: ${checks.length} approval checks; cleanup ${cleanup.every(result => result.ok) ? "passed" : "failed"}.`);
}
if (!report.success) Deno.exit(1);
