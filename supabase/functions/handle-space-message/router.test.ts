// Real isolated Auth/DB/RPC acceptance. Models are controlled promises; no cloud
// deploy, global dispatch/sweep, external model call, or other group's reads.
import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runSpaceRouteJob } from "../_shared/spaceMessageRouter.ts";
import type { TextModelAdapter } from "../_shared/modelAdapters.ts";

const url = Deno.env.get("SUPABASE_URL")!;
assert.equal(url, "http://127.0.0.1:47321", "isolated_primary_fixture_required");
Deno.env.set("MODEL_MOCK_MODE", "true");
const originalFetch = globalThis.fetch;
const reads: string[] = [];
let holdConsent = false, consentEntered = false;
let releaseConsent!: () => void;
globalThis.fetch = (input, init) => {
  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.equal(target.origin, url, "external_calls_forbidden");
  assert.ok(!target.pathname.startsWith("/functions/"), "unnecessary_function_dispatch_forbidden");
  if (target.pathname === "/rest/v1/messages" && target.searchParams.get("select") === "actor_name,text,kind") reads.push("context");
  if (holdConsent && target.pathname === "/rest/v1/rpc/is_observation_enabled") {
    holdConsent = false; consentEntered = true;
    return new Promise<void>((resolve) => { releaseConsent = resolve; }).then(() => originalFetch(input, init));
  }
  return originalFetch(input, init);
};
const background: Promise<unknown>[] = [];
(globalThis as any).EdgeRuntime = { waitUntil: (task: Promise<unknown>) => background.push(task) };
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options);
const users: string[] = [], checks: string[] = [], measurements: unknown[] = [];
let space = "", replyCalls = 0, observationCalls = 0;
const requestedModels: Array<string | undefined> = [];
const previousGroupModel = Deno.env.get("GROUP_TEXT_MODEL");
const ok = (result: any): any => { if (result.error) throw new Error(result.error.message); return result.data; };
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks.push(label); };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean) { for (let i = 0; i < 100; i++) { if (condition()) return; await pause(20); } throw new Error("controlled_stage_did_not_start"); }
async function account(name: string) {
  const email = `group-route-${crypto.randomUUID()}@example.test`, password = `Aa1!${crypto.randomUUID()}`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id; users.push(id);
  ok(await service.from("profiles").insert({ id, email, nickname: name }));
  const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, options);
  ok(await client.auth.signInWithPassword({ email, password }));
  const pet = ok(await service.from("pets").insert({ owner_id: id, name: `${name}宠` }).select("id,name").single());
  const asset = crypto.randomUUID();
  ok(await service.from("pet_visual_assets").insert({ id: asset, pet_id: pet.id, owner_id: id, storage_path: `${id}/${asset}.png`, prompt_hash: "synthetic-route-test-no-upload", is_draft: false }));
  ok(await service.from("pets").update({ status: "confirmed", current_asset_id: asset, confirmed_at: new Date().toISOString() }).eq("id", pet.id));
  return { id, client, pet };
}
type Reply = Awaited<ReturnType<TextModelAdapter["generatePetReply"]>>;
let replyImpl: () => Promise<Reply> = async () => ({ content: "这是合成群聊回应。", concerns_owner: false, risk: "none" });
let observeImpl: () => Promise<any[]> = async () => [{ tendency: "表达具体", rationale: "本次合成表达清楚", confidence: 0.8 }];
const adapter = {
  generatePetReply: (input: Parameters<TextModelAdapter["generatePetReply"]>[0]) => { replyCalls++; requestedModels.push(input.model); return replyImpl(); },
  extractStyleSignals: () => { observationCalls++; return observeImpl(); },
};
const job = async (id: string) => ok(await service.from("agent_jobs").select("status,result,input,lease_token,error_code,attempts").eq("id", id).single());
const replies = async (id: string) => ok(await service.from("messages").select("id,actor_id").eq("space_id", space).eq("reply_to_message_id", id).eq("actor_kind", "pet"));

try {
  const A = await account("验收甲"), B = await account("验收乙");
  space = ok(await A.client.rpc("create_relationship_space", { space_name: "路由隔离验收", space_kind: "friend_circle" }));
  ok(await service.from("space_members").insert({ space_id: space, user_id: B.id, role: "member" }));
  for (const owner of [A, B]) ok(await service.from("space_pet_permissions").upsert({ space_id: space, pet_id: owner.pet.id, owner_id: owner.id, participation_enabled: true }));
  const send = async (text: string, petIds: string[] = []) => ok(await A.client.rpc("send_space_message_v2", { message_client_id: crypto.randomUUID(), target_space_id: space, message_kind: "text", message_text: text, mentioned_pet_ids: petIds }));
  const run = (source: any) => runSpaceRouteJob(source.job_id, A.id, { message_id: source.message.id, cue_pet_ids: [] }, { client: service, adapter });

  const ordinary = await send("今天的天气很好。");
  const started = performance.now(); await run(ordinary);
  check((await job(ordinary.job_id)).status === "succeeded", "ordinary durable route completes");
  check(replyCalls === 0 && observationCalls === 0 && reads.length === 0, "unconsented ordinary message uses no reply model, observation model or recent context");
  measurements.push({ scenario: "ordinary_no_observation", elapsed_ms: Math.round(performance.now() - started), model_calls: 0 });

  let entered = 0; const releases: Array<(value: Reply) => void> = [];
  Deno.env.set("GROUP_TEXT_MODEL", "  synthetic-group-selected  ");
  replyImpl = () => { entered++; return new Promise<Reply>((resolve) => releases.push(resolve)); };
  const two = await send(`@${A.pet.name} @${B.pet.name} 你们好`, [A.pet.id, B.pet.id]);
  const twoStarted = performance.now(); const twoRunning = run(two);
  await until(() => entered === 2);
  check(releases.length === 2, "both explicit reply models start before either completes");
  const during = await job(two.job_id);
  check(during.input.reply_pet_ids.length === 2, "UI receives server-validated explicit pet IDs");
  check(during.status === "running", "reply progress remains tied to a running durable lease");
  const secondClaim = ok(await service.rpc("claim_space_route_job", { p_job_id: two.job_id }));
  check(secondClaim === null, "concurrent worker cannot claim live route lease");
  for (const release of releases) release({ content: "合成并发回应。", concerns_owner: false, risk: "none" });
  await twoRunning;
  check((await replies(two.message.id)).length === 2, "two explicit pets commit one reply each");
  check((await job(two.job_id)).status === "succeeded", "parallel replies complete route");
  check(requestedModels.length === 2 && requestedModels.every((model) => model === "synthetic-group-selected"), "group configuration selects the exact trimmed reply request model");
  const modelRuns = ok(await service.from("model_runs").select("model").eq("space_id", space).eq("run_kind", "explicit_pet_reply"));
  check(modelRuns.length === 2 && modelRuns.every((run: any) => run.model === "synthetic-group-selected"), "reserved model-run records match the actual group request selection");
  const callsBeforeDuplicate = replyCalls; await run(two);
  check(replyCalls === callsBeforeDuplicate && (await replies(two.message.id)).length === 2, "duplicate route performs no second model call or reply");
  const projection = ok(await A.client.from("agent_jobs").select("input->reply_pet_ids").eq("id", two.job_id).single());
  check(projection.reply_pet_ids.length === 2, "authenticated UI JSON projection works with existing schema");
  measurements.push({ scenario: "two_explicit_controlled_models", elapsed_ms: Math.round(performance.now() - twoStarted), route: (await job(two.job_id)).result, real_model: false });

  let partialCalls = 0;
  Deno.env.set("GROUP_TEXT_MODEL", "  ");
  replyImpl = async () => { if (++partialCalls === 1) throw new Error("synthetic_model_error"); return { content: "部分成功的合成回应", concerns_owner: false, risk: "none" }; };
  const partial = await send(`@${A.pet.name} @${B.pet.name} 再问好`, [A.pet.id, B.pet.id]); await run(partial);
  check(requestedModels.slice(2).every((model) => model === "mock-text"), "blank group configuration falls back to the existing text-model selection");
  Deno.env.delete("GROUP_TEXT_MODEL");
  check((await job(partial.job_id)).status === "failed" && (await replies(partial.message.id)).length === 1, "partial reply failure stays retryable instead of falsely completing");
  ok(await service.from("agent_jobs").update({ status: "queued" }).eq("id", partial.job_id).eq("status", "failed"));
  const beforePartialRetry = replyCalls; await run(partial);
  check(replyCalls === beforePartialRetry + 1 && (await replies(partial.message.id)).length === 2 && (await job(partial.job_id)).status === "succeeded", "partial retry only calls the missing pet and preserves the successful reply");

  for (const member of [A, B]) ok(await member.client.rpc("set_space_observation_consent", { target_space_id: space, target_pet_id: A.pet.id, decision: true }));
  const observed = await send("我想先把时间确认清楚，再决定安排。");
  const beforeReplies = replyCalls; await run(observed);
  check(observationCalls === 1 && replyCalls === beforeReplies, "authorized ordinary observation is preserved without a pet reply");
  const signals = ok(await service.from("pet_style_signals").select("id").eq("pet_id", A.pet.id).eq("source_space_id", space));
  check(signals.length === 1, "authorized style signal commits in the same group");

  ok(await service.from("space_pet_permissions").update({ proactive_paused: true }).eq("space_id", space).eq("pet_id", B.pet.id));
  let releasePausedObservation!: (value: any[]) => void;
  observeImpl = () => new Promise((resolve) => { releasePausedObservation = resolve; });
  const pausedCue = await send(`@${B.pet.name} 你好`);
  const beforePausedReply = replyCalls, beforePausedObservation = observationCalls;
  holdConsent = true; const pausedRun = run(pausedCue);
  await until(() => consentEntered);
  const awaitingConsent = await job(pausedCue.job_id);
  check(awaitingConsent.status === "running" && Array.isArray(awaitingConsent.input.reply_pet_ids) && awaitingConsent.input.reply_pet_ids.length === 0,
    "paused pet cue publishes empty reply IDs before slow observation consent resolves");
  releaseConsent(); await until(() => Boolean(releasePausedObservation));
  check((await job(pausedCue.job_id)).input.reply_pet_ids.length === 0 && replyCalls === beforePausedReply,
    "paused cue stays explicitly non-reply while authorized observation is slow");
  releasePausedObservation([]); await pausedRun;
  check(observationCalls === beforePausedObservation + 1 && (await job(pausedCue.job_id)).status === "succeeded",
    "paused pet cue still completes the sender active pet's authorized observation");
  ok(await service.from("space_pet_permissions").update({ proactive_paused: false }).eq("space_id", space).eq("pet_id", B.pet.id));

  let releaseObservation!: (value: any[]) => void;
  observeImpl = () => new Promise((resolve) => { releaseObservation = resolve; });
  replyImpl = async () => ({ content: "先回应你。", concerns_owner: false, risk: "none" });
  const delayed = await send(`@${B.pet.name} 你好`, [B.pet.id]); const delayedRun = run(delayed);
  await until(() => Boolean(releaseObservation));
  check((await replies(delayed.message.id)).length === 1, "explicit reply commits before slow authorized observation finishes");
  ok(await B.client.rpc("set_space_observation_consent", { target_space_id: space, target_pet_id: A.pet.id, decision: false }));
  releaseObservation([{ tendency: "不应存储", rationale: "撤权后的迟到结果", confidence: 0.8 }]); await delayedRun;
  check(ok(await service.from("pet_style_signals").select("id").eq("pet_id", A.pet.id).eq("source_space_id", space)).length === 1, "late observation result is rejected after consent revocation");

  let releaseReply!: (value: Reply) => void;
  replyImpl = () => new Promise((resolve) => { releaseReply = resolve; });
  const revoked = await send(`@${B.pet.name} 再聊一句`, [B.pet.id]); const revokedRun = run(revoked);
  await until(() => Boolean(releaseReply));
  ok(await service.from("space_pet_permissions").update({ participation_enabled: false }).eq("space_id", space).eq("pet_id", B.pet.id));
  releaseReply({ content: "撤权后不得发出的迟到回复", concerns_owner: false, risk: "none" }); await revokedRun;
  check((await replies(revoked.message.id)).length === 0 && (await job(revoked.job_id)).status === "failed", "real commit RPC fences a late reply after pet permission revocation");
  ok(await service.from("space_pet_permissions").update({ participation_enabled: true }).eq("space_id", space).eq("pet_id", B.pet.id));

  releaseReply = undefined as any;
  const stale = await send(`@${B.pet.name} 最后一句`, [B.pet.id]); const staleRun = run(stale);
  await until(() => Boolean(releaseReply));
  ok(await service.from("agent_jobs").update({ lease_until: "2000-01-01T00:00:00Z" }).eq("id", stale.job_id));
  const replacement = ok(await service.rpc("claim_space_route_job", { p_job_id: stale.job_id }));
  releaseReply({ content: "旧租约不得提交的回复", concerns_owner: false, risk: "none" }); await staleRun;
  const afterStale = await job(stale.job_id);
  check((await replies(stale.message.id)).length === 0 && afterStale.lease_token === replacement.lease_token && afterStale.status === "running", "takeover token fences old worker reply and route finalization");
  ok(await service.from("agent_jobs").update({ status: "blocked", retryable: false, error_code: "legacy_route_review_required", lease_until: null }).eq("id", stale.job_id));
  const beforeReview = replyCalls; await run(stale);
  check(replyCalls === beforeReview && (await job(stale.job_id)).error_code === "legacy_route_review_required", "old review-required job cannot be claimed");
  await Promise.allSettled(background);
  await Deno.mkdir("test-results/mobile-feedback-20260914", { recursive: true });
  await Deno.writeTextFile("test-results/mobile-feedback-20260914/group-local-report.json", JSON.stringify({ checked_at: new Date().toISOString(), target: url, real_auth_db_commit: true, external_model_called: false, checks, measurements }, null, 2));
  console.log(`PASS ${checks.length} group route isolation, concurrency, lifecycle and lease checks.`);
} finally {
  await Promise.allSettled(background);
  if (space) ok(await service.from("spaces").delete().eq("id", space));
  for (const id of users) ok(await service.auth.admin.deleteUser(id));
  if (previousGroupModel === undefined) Deno.env.delete("GROUP_TEXT_MODEL"); else Deno.env.set("GROUP_TEXT_MODEL", previousGroupModel);
  globalThis.fetch = originalFetch;
}
