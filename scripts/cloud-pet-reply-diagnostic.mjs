import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Supabase environment is missing");

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = Date.now();
let userId;
let spaceId;

try {
  const email = `pet-reply-diagnostic-${suffix}@example.test`;
  const password = `Pet-reply-${suffix}`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const profile = await service.from("profiles").insert({ id: userId, email, nickname: "异宠回复诊断" });
  if (profile.error) throw profile.error;
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;

  const space = await client.rpc("create_relationship_space", { space_name: "公网互动测试", space_kind: "friend_circle" });
  if (space.error) throw space.error;
  spaceId = space.data;
  const sent = await client.from("messages").insert({ client_id: `pet-recall-${suffix}`, space_id: spaceId, sender_id: userId, actor_kind: "human", actor_name: "异宠回复诊断", kind: "text", text: "之前已经确定露营集合时间是周六上午九点" }).select("id,created_at").single();
  if (sent.error) throw sent.error;
  const markedRead = await service.from("space_members").update({ last_read_at: new Date(Date.now() + 1_000).toISOString() }).eq("space_id", spaceId).eq("user_id", userId);
  if (markedRead.error) throw markedRead.error;

  const pet = await client.from("pets").insert({ owner_id: userId, name: "回声" }).select("id").single();
  if (pet.error) throw pet.error;
  const expectation = await service.from("pet_expectation_drafts").insert({ pet_id: pet.data.id, owner_id: userId, appearance_expectation: "像素小兽", personality_expectation: "直接具体", companionship_expectation: "先查证再回答", personality_seed_prompt: "直接、可靠，会先查证群聊记录再给出具体回答。", visual_seed_prompt: "原创精细像素小兽", negative_seed_prompt: "无文字水印", seed_summary: "一只直接可靠的消息管家异宠" });
  if (expectation.error) throw expectation.error;
  const asset = await service.from("pet_visual_assets").insert({ pet_id: pet.data.id, owner_id: userId, storage_path: `diagnostic/${suffix}.png`, prompt_hash: `diagnostic-${suffix}`, is_draft: true }).select("id").single();
  if (asset.error) throw asset.error;
  const confirmed = await service.rpc("confirm_pet_asset", { target_owner: userId, target_asset: asset.data.id });
  if (confirmed.error) throw confirmed.error;

  const requestId = crypto.randomUUID();
  const statuses = new Set();
  const realtimeStatuses = new Set();
  const channel = client.channel(`pet-reply-diagnostic:${suffix}`).on("postgres_changes", { event: "*", schema: "public", table: "pet_private_threads", filter: `owner_id=eq.${userId}` }, (payload) => {
    if (payload.new?.request_key === requestId && payload.new?.reply_status) realtimeStatuses.add(payload.new.reply_status);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime subscription timed out")), 10_000);
    channel.subscribe((status) => { if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); } });
  });
  let polling = true;
  const poll = (async () => {
    while (polling) {
      const row = await service.from("pet_private_threads").select("reply_status").eq("owner_id", userId).eq("request_key", requestId).maybeSingle();
      if (row.data?.reply_status) statuses.add(row.data.reply_status);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  })();
  const reply = await client.functions.invoke("pet-chat", { body: { content: "告诉我公网群之前关于露营聊了什么", request_id: requestId } });
  polling = false;
  await poll;
  if (reply.error?.context) throw new Error(await reply.error.context.text());
  if (reply.error) throw reply.error;
  const ownerMessage = await service.from("pet_private_threads").select("id,reply_status,reply_error_code").eq("owner_id", userId).eq("request_key", requestId).single();
  if (ownerMessage.error) throw ownerMessage.error;
  assert.equal(ownerMessage.data.reply_status, "succeeded");
  assert.equal(ownerMessage.data.reply_error_code, null);
  assert.ok(reply.data.recall_sources.some((source) => source.message_id === sent.data.id), "already-read message was not recalled");
  assert.match(reply.data.content, /露营|周六|九点/);
  assert.ok(statuses.has("retrieving") || statuses.has("thinking"), "no observable recall/reply phase was persisted");
  assert.ok(realtimeStatuses.has("retrieving") || realtimeStatuses.has("thinking"), "reply phases were not delivered through Realtime");

  const repeated = await client.functions.invoke("pet-chat", { body: { content: "告诉我公网群之前关于露营聊了什么", request_id: requestId } });
  if (repeated.error) throw repeated.error;
  const ownerCount = await service.from("pet_private_threads").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("request_key", requestId);
  const replyCount = await service.from("pet_private_threads").select("id", { count: "exact", head: true }).eq("in_reply_to_id", ownerMessage.data.id);
  assert.equal(ownerCount.count, 1);
  assert.equal(replyCount.count, 1);
  await client.removeChannel(channel);
  await client.realtime.disconnect();
  console.log(JSON.stringify({ status: "passed", model_reply: "concrete", recalled_already_read: true, observed_phases: [...statuses], realtime_phases: [...realtimeStatuses], idempotent_retry: true }, null, 2));
} finally {
  if (spaceId) await service.from("spaces").delete().eq("id", spaceId);
  if (userId) await service.auth.admin.deleteUser(userId);
}
