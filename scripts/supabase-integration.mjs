import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Local Supabase environment is missing");

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = Date.now();

async function createUser(index, admin = false) {
  const email = `integration-${suffix}-${index}@example.test`;
  const password = `Demo-pass-${suffix}-${index}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const profile = await service.from("profiles").insert({ id: data.user.id, email, nickname: `测试成员${index}`, is_admin: admin });
  if (profile.error) throw profile.error;
  const client = anon(); const login = await client.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { id: data.user.id, client, email, password };
}

async function main() {
  const admin = await createUser("admin", true);
  const invite = await admin.client.rpc("create_signup_invite");
  assert.equal(invite.error, null, invite.error?.message);
  assert.match(invite.data, /^[A-F0-9]{12}$/);

  const invitedEmail = `invited-${suffix}@example.test`; const invitedPassword = `Invited-pass-${suffix}`;
  const registration = await fetch(`${url}/functions/v1/register-with-invite`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ inviteCode: invite.data, email: invitedEmail, password: invitedPassword, nickname: "被邀请者" }),
  });
  assert.equal(registration.status, 200, await registration.text());
  const repeated = await fetch(`${url}/functions/v1/register-with-invite`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ inviteCode: invite.data, email: `repeat-${suffix}@example.test`, password: invitedPassword, nickname: "重复领取" }),
  });
  assert.notEqual(repeated.status, 200, "single-use signup invite was reused");

  const owner = await createUser("owner");
  const pair = await owner.client.rpc("create_relationship_space", { space_name: "双人边界", space_kind: "friend_pair" });
  assert.equal(pair.error, null, pair.error?.message);
  const member2 = await createUser(2); const member3 = await createUser(3);
  assert.equal((await service.from("space_members").insert({ space_id: pair.data, user_id: member2.id })).error, null);
  const pairOverflow = await service.from("space_members").insert({ space_id: pair.data, user_id: member3.id });
  assert.equal(pairOverflow.error?.message, "space_member_limit_reached");

  const circle = await owner.client.rpc("create_relationship_space", { space_name: "二十人边界", space_kind: "friend_circle" });
  assert.equal(circle.error, null, circle.error?.message);
  const circleUsers = [];
  for (let index = 4; index <= 23; index += 1) circleUsers.push(await createUser(index));
  for (const member of circleUsers.slice(0, 19)) {
    const joined = await service.from("space_members").insert({ space_id: circle.data, user_id: member.id });
    assert.equal(joined.error, null, joined.error?.message);
  }
  const circleOverflow = await service.from("space_members").insert({ space_id: circle.data, user_id: circleUsers[19].id });
  assert.equal(circleOverflow.error?.message, "space_member_limit_reached");
  const memberCount = await service.from("space_members").select("user_id", { count: "exact", head: true }).eq("space_id", circle.data);
  assert.equal(memberCount.count, 20);

  const sent = await owner.client.from("messages").insert({ client_id: `client-${suffix}`, space_id: pair.data, sender_id: owner.id, actor_kind: "human", actor_name: "伪造昵称", kind: "text", text: "@测试宠 你在吗？" }).select("id,actor_name").single();
  assert.equal(sent.error, null, sent.error?.message); assert.equal(sent.data.actor_name, "测试成员owner");
  const outsiderRead = await circleUsers[19].client.from("messages").select("id").eq("space_id", pair.data);
  assert.equal(outsiderRead.error, null); assert.equal(outsiderRead.data.length, 0);
  const forgedAgent = await owner.client.from("messages").insert({ client_id: `forged-${suffix}`, space_id: pair.data, actor_kind: "pet", actor_id: owner.id, actor_name: "伪异宠", kind: "text", text: "我是 Agent" });
  assert.ok(forgedAgent.error, "client forged an agent message");

  const otherSpace = await owner.client.rpc("create_relationship_space", { space_name: "回复隔离", space_kind: "friend_circle" });
  const crossReply = await owner.client.from("messages").insert({ client_id: `cross-${suffix}`, space_id: otherSpace.data, sender_id: owner.id, actor_kind: "human", actor_name: "测试成员owner", kind: "text", text: "跨空间回复", reply_to_message_id: sent.data.id });
  assert.match(crossReply.error?.message ?? "", /reply_must_be_in_same_space/);

  const pet = await owner.client.from("pets").insert({ owner_id: owner.id, name: "测试宠" }).select("id,status").single();
  assert.equal(pet.error, null, pet.error?.message);
  for (let turn = 1; turn <= 5; turn += 1) {
    const row = await owner.client.from("pet_private_threads").insert({ pet_id: pet.data.id, owner_id: owner.id, role: "owner", content: `孵化对话 ${turn}` });
    assert.equal(row.error, null, row.error?.message);
  }
  const generation = await owner.client.functions.invoke("generate-pet-candidate", { body: { instruction: "安静但有奇怪的感知器官", explore: false } });
  if (generation.error?.context) throw new Error(`generate-pet-candidate: ${await generation.error.context.text()}`);
  assert.equal(generation.error, null, generation.error?.message); assert.equal(generation.data.parent_asset_id, null);
  const confirm = await owner.client.functions.invoke("confirm-pet", { body: { asset_id: generation.data.id } });
  assert.equal(confirm.error, null, confirm.error?.message);
  const directPetEdit = await owner.client.from("pets").update({ status: "incubating", current_asset_id: null, confirmed_at: null }).eq("id", pet.data.id);
  assert.equal(directPetEdit.error, null);
  const petAfterDirectEdit = await service.from("pets").select("status,current_asset_id,confirmed_at").eq("id", pet.data.id).single();
  assert.equal(petAfterDirectEdit.data.status, "confirmed", "direct pet reset was accepted");
  const regenerate = await owner.client.functions.invoke("generate-pet-candidate", { body: { instruction: "重捏", explore: true } });
  assert.ok(regenerate.error, "confirmed pet entered initial editing again");

  const permission = await service.from("space_pet_permissions").select("pet_id").eq("space_id", pair.data).eq("pet_id", pet.data.id);
  assert.equal(permission.data.length, 1, "owner pet was not attached to the relationship space");
  await owner.client.rpc("set_space_observation_consent", { target_space_id: pair.data, target_pet_id: pet.data.id, decision: true });
  await member2.client.rpc("set_space_observation_consent", { target_space_id: pair.data, target_pet_id: pet.data.id, decision: true });
  const consentBefore = await owner.client.rpc("is_observation_enabled", { target_space_id: pair.data, target_pet_id: pet.data.id });
  assert.equal(consentBefore.data, true);

  const routed = await member2.client.functions.invoke("handle-space-message", { body: { message_id: sent.data.id, cue_pet_ids: [pet.data.id] } });
  assert.equal(routed.error, null, routed.error?.message);
  const petReplies = await service.from("messages").select("id").eq("space_id", pair.data).eq("actor_kind", "pet");
  assert.equal(petReplies.data.length, 1);
  const replyRuns = await service.from("model_runs").select("id").eq("space_id", pair.data).eq("run_kind", "explicit_pet_reply");
  assert.equal(replyRuns.data.length, 1, "one explicit cue generated more than one full reply call");

  const observationRows = await owner.client.rpc("list_space_pet_observation", { target_space_id: pair.data });
  assert.equal(observationRows.error, null, observationRows.error?.message);
  assert.equal(observationRows.data[0].unanimous_consent, true);
  const interaction = await member2.client.functions.invoke("pet-interaction", { body: { space_id: pair.data, pet_id: pet.data.id, action: "play" } });
  if (interaction.error?.context) throw new Error(`pet-interaction: ${await interaction.error.context.text()}`);
  assert.equal(interaction.error, null, interaction.error?.message);
  const corner = await member2.client.from("pet_corner_stories").select("id,content").eq("space_id", pair.data);
  assert.equal(corner.data.length, 1);
  const experience = await owner.client.from("pet_experiences").select("id").eq("pet_id", pet.data.id);
  assert.equal(experience.data.length, 1);
  await member2.client.rpc("set_pet_local_mute", { target_space_id: pair.data, target_pet_id: pet.data.id, decision: true });
  assert.equal((await member2.client.from("space_member_pet_settings").select("pet_id").eq("space_id", pair.data)).data.length, 1);
  assert.equal((await owner.client.from("space_member_pet_settings").select("pet_id").eq("space_id", pair.data)).data.length, 0, "local mute leaked another member's setting");
  await owner.client.rpc("vote_pet_pause", { target_space_id: pair.data, target_pet_id: pet.data.id, decision: true });
  assert.equal((await service.from("space_pet_permissions").select("paused_by_vote").eq("space_id", pair.data).eq("pet_id", pet.data.id).single()).data.paused_by_vote, false);
  await member2.client.rpc("vote_pet_pause", { target_space_id: pair.data, target_pet_id: pet.data.id, decision: true });
  assert.equal((await service.from("space_pet_permissions").select("paused_by_vote").eq("space_id", pair.data).eq("pet_id", pet.data.id).single()).data.paused_by_vote, true);
  const pausedCueMessage = await owner.client.from("messages").insert({ client_id: `paused-cue-${suffix}`, space_id: pair.data, sender_id: owner.id, actor_kind: "human", actor_name: "测试成员owner", kind: "text", text: "@测试宠 现在能回答吗？" }).select("id").single();
  const pausedCue = await owner.client.functions.invoke("handle-space-message", { body: { message_id: pausedCueMessage.data.id, cue_pet_ids: [pet.data.id] } });
  assert.equal(pausedCue.error, null, pausedCue.error?.message);
  const pausedNotice = await service.from("messages").select("text").eq("space_id", pair.data).eq("permission_source", "pet_participation_paused");
  assert.equal(pausedNotice.data.length, 1, "paused explicit cue was not explained in chat");
  await member2.client.rpc("vote_pet_pause", { target_space_id: pair.data, target_pet_id: pet.data.id, decision: false });
  assert.equal((await service.from("space_pet_permissions").select("paused_by_vote").eq("space_id", pair.data).eq("pet_id", pet.data.id).single()).data.paused_by_vote, false);

  const styleSignal = await service.from("pet_style_signals").insert({ pet_id: pet.data.id, owner_id: owner.id, source_kind: "pet_private", source_label: "集成测试", tendency: "旧判断", rationale: "待纠正", confidence: 0.6 }).select("id").single();
  const corrected = await owner.client.from("pet_style_feedback").insert({ signal_id: styleSignal.data.id, feedback_kind: "corrected", correction: "先理解，再清楚表达" });
  assert.equal(corrected.error, null, corrected.error?.message);
  const correctedSignal = await owner.client.from("pet_style_signals").select("tendency,active").eq("id", styleSignal.data.id).single();
  assert.equal(correctedSignal.data.tendency, "先理解，再清楚表达");
  const forgotten = await owner.client.from("pet_style_feedback").update({ feedback_kind: "forgotten", correction: null }).eq("signal_id", styleSignal.data.id);
  assert.equal(forgotten.error, null, forgotten.error?.message);
  const forgottenSignal = await service.from("pet_style_signals").select("active").eq("id", styleSignal.data.id).single();
  assert.equal(forgottenSignal.data.active, false);

  const evolution = await owner.client.functions.invoke("evolve-pet", { body: { blessing: "愿你继续按自己的方式认识世界" } });
  if (evolution.error?.context) throw new Error(`evolve-pet: ${await evolution.error.context.text()}`);
  assert.equal(evolution.error, null, evolution.error?.message);
  assert.equal(evolution.data.parent_asset_id, generation.data.id);
  const eventId = evolution.data.evolution_event_id;
  const repaired = await owner.client.functions.invoke("evolve-pet", { body: { event_id: eventId, continuity_repair: true } });
  if (repaired.error?.context) throw new Error(`evolve-pet repair: ${await repaired.error.context.text()}`);
  assert.equal(repaired.error, null, repaired.error?.message);
  assert.equal(repaired.data.parent_asset_id, generation.data.id);
  const oldOfficial = await service.from("pet_visual_assets").select("superseded_at").eq("id", evolution.data.id).single();
  assert.ok(oldOfficial.data.superseded_at, "continuity repair did not supersede the disconnected result");
  const secondRepair = await owner.client.functions.invoke("evolve-pet", { body: { event_id: eventId, continuity_repair: true } });
  assert.ok(secondRepair.error, "continuity repair was used more than once");

  const observationSpace = await owner.client.rpc("create_relationship_space", { space_name: "新增成员暂停观察", space_kind: "friend_circle" });
  await owner.client.rpc("set_space_observation_consent", { target_space_id: observationSpace.data, target_pet_id: pet.data.id, decision: true });
  assert.equal((await owner.client.rpc("is_observation_enabled", { target_space_id: observationSpace.data, target_pet_id: pet.data.id })).data, true);
  await service.from("space_members").insert({ space_id: observationSpace.data, user_id: member3.id });
  assert.equal((await owner.client.rpc("is_observation_enabled", { target_space_id: observationSpace.data, target_pet_id: pet.data.id })).data, false);

  const quotaKind = `atomic-test-${suffix}`;
  const reservations = await Promise.all([1, 2, 3].map((index) => service.rpc("reserve_model_run", { target_run_kind: quotaKind, target_daily_limit: 2, target_owner_id: owner.id, target_prompt_hash: String(index), target_provider: "test", target_model: "test" })));
  assert.equal(reservations.filter((result) => !result.error).length, 2, "atomic quota admitted too many concurrent runs");

  console.log(JSON.stringify({ signupInvite: "passed", pairLimit: "passed", circleLimit: "passed", rls: "passed", chatConstraints: "passed", petLock: "passed", consent: "passed", petRouter: "passed", petCorner: "passed", petGovernance: "passed", styleFeedback: "passed", evolutionContinuity: "passed", newMemberPausesObservation: "passed", atomicQuota: "passed" }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
