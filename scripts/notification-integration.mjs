import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env;
if (!url || !anonKey || !serviceKey) throw new Error("Supabase test environment is missing");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, options);
const suffix = crypto.randomUUID();
const users = [];
let spaceId;

function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

try {
  for (const label of ["sender", "recipient", "outsider"]) {
    const email = `notifications-${label}-${suffix}@example.test`;
    const password = crypto.randomUUID();
    const created = check(await service.auth.admin.createUser({ email, password, email_confirm: true }));
    const client = createClient(url, anonKey, options);
    users.push({ id: created.user.id, client });
    check(await service.from("profiles").insert({ id: created.user.id, email, nickname: `通知测试-${label}` }));
    check(await client.auth.signInWithPassword({ email, password }));
  }
  const [sender, recipient, outsider] = users;
  spaceId = check(await sender.client.rpc("create_relationship_space", { space_name: `通知测试-${suffix.slice(0, 8)}`, space_kind: "friend_circle" }));
  check(await service.from("space_members").insert({ space_id: spaceId, user_id: recipient.id, role: "member" }));
  const send = async (text) => check(await sender.client.from("messages").insert({
    client_id: crypto.randomUUID(), space_id: spaceId, sender_id: sender.id,
    actor_kind: "human", actor_name: "通知测试-sender", kind: "text", text,
  }).select("id").single());

  const message = await send("通知正文仅由当前收件人读取");
  const event = check(await recipient.client.from("notification_events").select("id,user_id,entity_id,kind,read_at").eq("entity_id", message.id).single());
  assert.equal(event.user_id, recipient.id);
  assert.equal(event.kind, "message");
  assert.equal(event.read_at, null);
  assert.equal(check(await outsider.client.from("notification_events").select("id").eq("id", event.id)).length, 0);
  assert.equal(check(await sender.client.from("notification_events").select("id").eq("id", event.id)).length, 0);

  check(await outsider.client.rpc("mark_notification_read", { target_event_id: event.id }));
  assert.equal(check(await recipient.client.from("notification_events").select("read_at").eq("id", event.id).single()).read_at, null);
  check(await recipient.client.rpc("mark_notification_read", { target_event_id: event.id }));
  assert.ok(check(await recipient.client.from("notification_events").select("read_at").eq("id", event.id).single()).read_at);
  assert.ok((await recipient.client.from("notification_events").insert({ user_id: recipient.id, kind: "message", title: "伪造", body: "不能客户端制造系统通知", route: "/pet", idempotency_key: suffix })).error);
  assert.equal(check(await service.from("notification_outbox").select("event_id").eq("event_id", event.id)).length, 1);
  const outboxRead = await outsider.client.from("notification_outbox").select("event_id").eq("event_id", event.id);
  assert.ok(outboxRead.error || outboxRead.data.length === 0);

  check(await recipient.client.from("notification_preferences").upsert({ user_id: recipient.id, messages_enabled: false }));
  const silenced = await send("关闭消息提醒后不再产生普通消息通知");
  assert.equal(check(await service.from("notification_events").select("id").eq("entity_id", silenced.id)).length, 0);
  assert.ok((await outsider.client.from("notification_preferences").upsert({ user_id: recipient.id, messages_enabled: true })).error);
  check(await recipient.client.from("notification_preferences").upsert({ user_id: recipient.id, messages_enabled: true }));
  check(await recipient.client.from("space_notification_preferences").upsert({ user_id: recipient.id, space_id: spaceId, muted_until: new Date(Date.now() + 60_000).toISOString() }));
  const muted = await send("空间静音后不再创建通知");
  assert.equal(check(await service.from("notification_events").select("id").eq("entity_id", muted.id)).length, 0);
  assert.ok((await outsider.client.from("space_notification_preferences").upsert({ user_id: outsider.id, space_id: spaceId })).error);

  // Never register a fake Expo token: the live delivery cron must not contact a device.
  assert.ok((await recipient.client.rpc("register_push_token", { expo_token: "invalid", device_label: "test", device_platform: "android" })).error);
  console.log("notification integration: PASS (recipient isolation, read ownership, server-only insertion, one outbox row, preferences, mute, nonmember denial)");
} finally {
  if (spaceId) check(await service.from("spaces").delete().eq("id", spaceId));
  for (const user of users) check(await service.auth.admin.deleteUser(user.id));
}
