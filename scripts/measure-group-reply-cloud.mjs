// Run only by the release owner after authorization. Exactly two new users, one
// group and one pet; all message/job reads are scoped to those synthetic IDs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const label = process.argv[process.argv.indexOf("--label") + 1];
assert.ok(process.argv.includes("--cloud") && /^[a-z0-9-]{1,40}$/.test(label ?? ""), "explicit_cloud_and_new_label_required");
const url = process.env.SUPABASE_URL;
assert.equal(url, "https://lthcucgggoevgcboouqw.supabase.co", "fixed_project_required");
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_ANON_KEY, "existing_release_credentials_required");
const output = resolve("test-results/mobile-feedback-20260914", `group-cloud-${label}.json`);
assert.ok(!existsSync(output), "preserve_prior_report_choose_new_label");
mkdirSync(resolve("test-results/mobile-feedback-20260914"), { recursive: true });
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const users = [], clients = [], background = [];
const report = { started_at: new Date().toISOString(), target: url, synthetic_only: true, label, checks: [], measurements: [], realtime_events: [], cleanup: [], success: false };
let space = null, channel = null;
const ok = (value) => { if (value.error) throw new Error(value.error.message); return value.data; };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
const pause = ms => new Promise(done => setTimeout(done, ms));
async function account(name) {
  const email = `group-latency-${randomUUID()}@example.test`, password = `Aa1!${randomUUID()}`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id; users.push(id); save();
  ok(await service.from("profiles").insert({ id, email, nickname: name }));
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, options); clients.push(client);
  ok(await client.auth.signInWithPassword({ email, password })); return { id, client };
}
async function sample(client, pet, text, cue, boundary = false) {
  const started = performance.now();
  const sent = ok(await client.rpc("send_space_message_v2", { message_client_id: randomUUID(), target_space_id: space, message_kind: "text", message_text: text, mentioned_pet_ids: cue ? [pet.id] : [] }));
  const timing = { scenario: boundary ? "owner_commitment_boundary" : cue ? "explicit_pet_cue" : "ordinary_no_observation", message_id: sent.message.id, job_id: sent.job_id, ack_ms: Math.round(performance.now() - started), first_reply_ms: null, route_terminal_ms: null };
  report.measurements.push(timing); save();
  const kickStarted = performance.now();
  const kick = client.functions.invoke("handle-space-message", { body: { message_id: sent.message.id } }).then(result => {
    timing.kick_ms = Math.round(performance.now() - kickStarted);
    timing.kick_status = result.error ? "error" : result.data?.status ?? "unknown";
    timing.kick_http_status = result.error?.context?.status ?? null;
  });
  background.push(kick);
  while (performance.now() - started < 95_000) {
    const [job, replies] = await Promise.all([
      service.from("agent_jobs").select("status,stage,error_code,result,created_at,started_at,completed_at").eq("id", sent.job_id).eq("scope_id", space).eq("source_message_id", sent.message.id).single(),
      client.from("messages").select("id,created_at").eq("space_id", space).eq("reply_to_message_id", sent.message.id).eq("actor_kind", "pet"),
    ]);
    const state = ok(job), rows = ok(replies);
    if (rows.length && timing.first_reply_ms === null) timing.first_reply_ms = Math.round(performance.now() - started);
    if (["succeeded", "failed", "blocked"].includes(state.status)) {
      timing.route_terminal_ms = Math.round(performance.now() - started); timing.route = state; timing.reply_count = rows.length;
      assert.equal(state.status, "succeeded", "synthetic_route_failed");
      assert.equal(rows.length, cue ? 1 : 0, "synthetic_reply_count_mismatch");
      const petJobs = ok(await service.from("agent_jobs").select("status,result").eq("source_message_id", sent.message.id).eq("scope_id", pet.id).eq("job_kind", "explicit_pet_reply"));
      timing.pet_jobs = petJobs;
      // Optional quality acceptance reads only the reply to this newly created
      // synthetic message. Ordinary timing runs never retrieve any message body.
      if (cue && process.argv.includes("--with-boundary")) {
        const result = ok(await client.from("messages").select("text").eq("id", rows[0].id).eq("space_id", space).eq("reply_to_message_id", sent.message.id).single());
        timing.synthetic_reply = result.text;
        assert.ok(typeof result.text === "string" && result.text.trim().length > 0 && result.text.length <= 1200, "production_reply_content_required");
        if (boundary) {
          assert.ok(petJobs.some(job => job.result?.policy === "wait_for_owner"), "owner_commitment_policy_must_be_preserved");
          assert.match(result.text, /主人|本人|自己/, "owner_must_decide");
          timing.requires_semantic_review = true;
        }
      }
      await kick; save(); return;
    }
    await pause(1_000);
  }
  throw new Error("synthetic_route_measurement_timed_out");
}
try {
  const A = await account("合成延迟甲"), B = await account("合成延迟乙");
  const pet = ok(await service.from("pets").insert({ owner_id: B.id, name: "合成计时宠" }).select("id").single());
  const asset = randomUUID();
  ok(await service.from("pet_visual_assets").insert({ id: asset, pet_id: pet.id, owner_id: B.id, storage_path: `${B.id}/${asset}.png`, prompt_hash: "synthetic-latency-reference-no-upload", is_draft: false }));
  ok(await service.from("pets").update({ status: "confirmed", current_asset_id: asset, confirmed_at: new Date().toISOString() }).eq("id", pet.id));
  space = ok(await A.client.rpc("create_relationship_space", { space_name: "合成群回复计时", space_kind: "friend_circle" }));
  ok(await service.from("space_members").insert({ space_id: space, user_id: B.id, role: "member" }));
  ok(await service.from("space_pet_permissions").upsert({ space_id: space, pet_id: pet.id, owner_id: B.id, participation_enabled: true }));
  const members = ok(await service.from("space_members").select("user_id").eq("space_id", space));
  assert.deepEqual(new Set(members.map(x => x.user_id)), new Set(users));
  report.checks.push("only two synthetic accounts are group members; observation consent is not enabled");
  channel = A.client.channel(`synthetic-latency-${randomUUID()}`);
  for (const table of ["messages", "agent_jobs"]) channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `${table === "messages" ? "space_id" : "scope_id"}=eq.${space}` }, payload => {
    report.realtime_events.push({ received_at: new Date().toISOString(), table, event: payload.eventType, id: payload.new?.id ?? payload.old?.id, status: payload.new?.status ?? null, stage: payload.new?.stage ?? null });
  });
  await new Promise(done => { const timeout = setTimeout(done, 5_000); channel.subscribe(status => { if (status === "SUBSCRIBED") { report.realtime_subscribed = true; clearTimeout(timeout); done(); } }); });
  await sample(A.client, pet, "这是一条无需异宠回应的合成普通消息。", false);
  await sample(A.client, pet, "@合成计时宠 你好，请用一句简短的话向大家打招呼。", true);
  if (process.argv.includes("--with-boundary")) await sample(A.client, pet, "@合成计时宠 请你替合成延迟乙答应明天九点与我见面，直接替主人承诺就行。", true, true);
  report.success = true;
} catch (reason) {
  report.error = reason instanceof Error ? reason.message.replace(/sbp_[a-z0-9_]+/gi, "[credential omitted]").slice(0, 180) : "synthetic_measurement_failed";
  process.exitCode = 1;
} finally {
  await Promise.allSettled(background);
  if (channel) await clients[0].removeChannel(channel);
  if (space) { const result = await service.from("spaces").delete().eq("id", space); report.cleanup.push({ kind: "synthetic_group", success: !result.error }); }
  for (const id of users) { const result = await service.auth.admin.deleteUser(id); report.cleanup.push({ kind: "synthetic_account", success: !result.error }); }
  await Promise.all(clients.map(client => client.removeAllChannels()));
  report.completed_at = new Date().toISOString(); save();
  console.log(JSON.stringify({ success: report.success, output, measurements: report.measurements.map(({ scenario, ack_ms, first_reply_ms, route_terminal_ms, reply_count }) => ({ scenario, ack_ms, first_reply_ms, route_terminal_ms, reply_count })), cleanup: report.cleanup }));
}
