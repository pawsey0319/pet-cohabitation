import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Supabase environment is missing");
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const createdUsers = [];

async function assertFunction(result, label) {
  if (!result.error) return result.data;
  let detail = result.error.message;
  try { detail = JSON.stringify(await result.error.context.json()); } catch { /* retain message */ }
  throw new Error(`${label}: ${detail}`);
}

async function user(label) {
  const n = createdUsers.length; const email = `new-flow-${n}-${Date.now()}@example.test`; const password = `New-flow-${n}-${Date.now()}`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true }); if (created.error) throw created.error;
  createdUsers.push(created.data.user.id);
  const profile = await service.from("profiles").insert({ id: created.data.user.id, email, nickname: label }); if (profile.error) throw profile.error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } }); const login = await client.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { id: created.data.user.id, client, label };
}

async function waitFor(table, id, terminal, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await service.from(table).select("*").eq("id", id).single(); if (result.error) throw result.error;
    if (terminal.includes(result.data.status)) return result.data;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${table}:${id} did not finish`);
}

async function send(client, input) {
  const inserted = await client.from("messages").insert(input).select("*").single(); assert.equal(inserted.error, null, inserted.error?.message); return inserted.data;
}

async function main() {
  const owner = await user("小舟"); const friend = await user("阿满");
  const space = await owner.client.rpc("create_relationship_space", { space_name: "海边计划", space_kind: "friend_circle" }); assert.equal(space.error, null, space.error?.message);
  const join = await service.from("space_members").insert({ space_id: space.data, user_id: friend.id }); assert.equal(join.error, null, join.error?.message);
  await send(friend.client, { client_id: crypto.randomUUID(), space_id: space.data, sender_id: friend.id, actor_kind: "human", actor_name: friend.label, kind: "text", text: "我们约定的暗号是蓝色树叶" });
  await send(owner.client, { client_id: crypto.randomUUID(), space_id: space.data, sender_id: owner.id, actor_kind: "human", actor_name: owner.label, kind: "text", text: "我记住了，周末再聊" });

  const pet = await owner.client.from("pets").insert({ owner_id: owner.id, name: "雾团" }).select("id").single(); assert.equal(pet.error, null, pet.error?.message);
  const generatedShapes = new Set(); let latestAssetId = null;
  for (const [index, appearance] of ["细长水母身体和三条透明鳍", "六足石头身体与发光触须", "倒三角云朵身体和漂浮环"] .entries()) {
    const generated = await owner.client.functions.invoke("generate-pet-candidate", { body: { instruction: `探索第${index + 1}种结构`, explore: true, request_id: crypto.randomUUID(), expectations: { appearance, personality: "安静敏锐但有主见", companionship: "先倾听再直接提醒", excluded_features: "不要人脸和普通猫狗轮廓", additional_description: "原创二维全身异宠" } } });
    const generatedData = await assertFunction(generated, "generate-pet-candidate");
    const session = await waitFor("pet_generation_sessions", generatedData.session_id, ["succeeded", "failed"]); assert.equal(session.status, "succeeded", session.error_code);
    const asset = await service.from("pet_visual_assets").select("id,storage_path").eq("generation_session_id", session.id).single(); assert.equal(asset.error, null, asset.error?.message); latestAssetId = asset.data.id;
    const downloaded = await service.storage.from("pet-portraits").download(asset.data.storage_path); assert.equal(downloaded.error, null, downloaded.error?.message);
    const svg = await downloaded.data.text(); const bodyMatch = svg.match(/<path d="([^"]+)" fill="url\(#b\)"/); generatedShapes.add(bodyMatch?.[1] ?? svg.slice(0, 80));
  }
  assert.ok(generatedShapes.size >= 2, "mock generator only changed color, not body structure");
  const confirmed = await owner.client.functions.invoke("confirm-pet", { body: { asset_id: latestAssetId } }); assert.equal(confirmed.error, null, confirmed.error?.message);
  const lockedDraft = await owner.client.from("pet_expectation_drafts").update({ personality_expectation: "确认后不应修改" }).eq("pet_id", pet.data.id); assert.ok(lockedDraft.error, "confirmed pet expectations were still editable");
  const regenerate = await owner.client.functions.invoke("generate-pet-candidate", { body: { instruction: "确认后重捏", explore: true, request_id: crypto.randomUUID() } }); assert.ok(regenerate.error, "confirmed pet could regenerate initial appearance");

  const ordinary = await send(friend.client, { client_id: crypto.randomUUID(), space_id: space.data, sender_id: friend.id, actor_kind: "human", actor_name: friend.label, kind: "text", text: "今天风很轻" });
  const routedOrdinary = await friend.client.functions.invoke("handle-space-message", { body: { message_id: ordinary.id } }); assert.equal(routedOrdinary.error, null, routedOrdinary.error?.message);
  await waitFor("agent_jobs", routedOrdinary.data.job_id, ["succeeded", "failed"]);
  const ordinaryReplies = await service.from("messages").select("id").eq("reply_to_message_id", ordinary.id).eq("actor_kind", "pet"); assert.equal(ordinaryReplies.data?.length, 0, "ordinary message triggered a pet implicitly");

  const explicit = await send(friend.client, { client_id: crypto.randomUUID(), space_id: space.data, sender_id: friend.id, actor_kind: "human", actor_name: friend.label, kind: "text", text: "@雾团 你觉得这个暗号怎么样？" });
  const routedExplicit = await friend.client.functions.invoke("handle-space-message", { body: { message_id: explicit.id } }); assert.equal(routedExplicit.error, null, routedExplicit.error?.message);
  await waitFor("agent_jobs", routedExplicit.data.job_id, ["succeeded", "failed"]);
  const explicitReplies = await service.from("messages").select("id").eq("reply_to_message_id", explicit.id).eq("actor_kind", "pet"); assert.equal(explicitReplies.data?.length, 1, "explicit pet cue did not get one reply");

  const recalled = await owner.client.functions.invoke("pet-chat", { body: { content: "海边计划群里大家之前说过什么？" } }); assert.equal(recalled.error, null, recalled.error?.message);
  assert.ok(recalled.data.recall_sources.some((source) => source.message_id && source.space_name === "海边计划"), "private pet recall did not include group sources");
  const delegated = await owner.client.functions.invoke("pet-chat", { body: { content: "帮我发到海边计划：这周六下午我有空" } }); assert.equal(delegated.error, null, delegated.error?.message); assert.ok(delegated.data.agent_request_id);
  const reviewed = await owner.client.functions.invoke("space-agent", { body: { request_id: delegated.data.agent_request_id } }); await assertFunction(reviewed, "space-agent delegated review");
  const delegatedMessage = await service.from("messages").select("text,sender_id,delegation_request_id").eq("delegation_request_id", delegated.data.agent_request_id).single(); assert.equal(delegatedMessage.error, null, delegatedMessage.error?.message); assert.deepEqual({ text: delegatedMessage.data.text, sender: delegatedMessage.data.sender_id }, { text: "这周六下午我有空", sender: owner.id });

  const planRequest = await owner.client.rpc("create_agent_request", { target_space_id: space.data, request_origin: "space_panel", request_text: "制定周末海边散步计划", request_kind: "group_plan", exact_content: null, target_pet_id: null, request_key: crypto.randomUUID() }); assert.equal(planRequest.error, null, planRequest.error?.message);
  const planReview = await owner.client.functions.invoke("space-agent", { body: { request_id: planRequest.data } }); await assertFunction(planReview, "space-agent proposal review");
  const proposal = await service.from("agent_proposals").select("id").eq("request_id", planRequest.data).single(); assert.equal(proposal.error, null, proposal.error?.message);
  assert.equal((await owner.client.rpc("cast_agent_proposal_vote", { target_proposal_id: proposal.data.id, vote_decision: "approve" })).data, "pending");
  assert.equal((await friend.client.rpc("cast_agent_proposal_vote", { target_proposal_id: proposal.data.id, vote_decision: "approve" })).data, "approved");
  const executed = await owner.client.functions.invoke("space-agent", { body: { proposal_id: proposal.data.id } }); assert.equal(executed.error, null, executed.error?.message); assert.equal(executed.data.status, "completed");
  console.log(JSON.stringify({ structuredPet: "passed", variedMockBodies: generatedShapes.size, seedLock: "passed", explicitOnly: "passed", crossGroupRecall: "passed", delegatedExact: "passed", proposalExecution: "passed" }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const id of createdUsers.reverse()) await service.auth.admin.deleteUser(id).catch(() => undefined);
});
