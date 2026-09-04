import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Cloud Supabase environment is missing");

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const createdUserIds = [];
const suffix = Date.now();

async function createUser(index) {
  const email = `mobile-smoke-${suffix}-${index}@example.test`;
  const password = `Mobile-smoke-${suffix}-${index}`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  createdUserIds.push(created.data.user.id);
  const profile = await service.from("profiles").insert({ id: created.data.user.id, email, nickname: "同名成员" });
  if (profile.error) throw profile.error;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { id: created.data.user.id, client };
}

async function main() {
  const owner = await createUser("owner");
  const mentioned = await createUser("mentioned");
  const sameNameBystander = await createUser("bystander");

  const space = await owner.client.rpc("create_relationship_space", { space_name: "手机可靠性冒烟", space_kind: "friend_circle" });
  assert.equal(space.error, null, space.error?.message);
  const joined = await service.from("space_members").insert([
    { space_id: space.data, user_id: mentioned.id },
    { space_id: space.data, user_id: sameNameBystander.id },
  ]);
  assert.equal(joined.error, null, joined.error?.message);

  const pet = await service.from("pets").insert({ owner_id: owner.id, name: "芽芽" }).select("id").single();
  assert.equal(pet.error, null, pet.error?.message);
  const asset = await service.from("pet_visual_assets").insert({
    pet_id: pet.data.id,
    owner_id: owner.id,
    storage_path: `smoke/${suffix}.png`,
    prompt_hash: `smoke-${suffix}`,
    is_draft: false,
  }).select("id").single();
  assert.equal(asset.error, null, asset.error?.message);
  const confirmed = await service.from("pets").update({ status: "confirmed", confirmed_at: new Date().toISOString(), current_asset_id: asset.data.id }).eq("id", pet.data.id);
  assert.equal(confirmed.error, null, confirmed.error?.message);

  const dashboard = await owner.client.rpc("get_my_pet_dashboard");
  assert.equal(dashboard.error, null, dashboard.error?.message);
  assert.equal(dashboard.data.pet.id, pet.data.id);
  const emptyDashboard = await mentioned.client.rpc("get_my_pet_dashboard");
  assert.equal(emptyDashboard.error, null, emptyDashboard.error?.message);
  assert.equal(emptyDashboard.data.pet, null);

  const targets = await mentioned.client.rpc("list_space_mention_targets", { target_space_id: space.data });
  assert.equal(targets.error, null, targets.error?.message);
  assert.equal(targets.data.filter((target) => target.target_kind === "user").length, 3);
  assert.ok(targets.data.some((target) => target.target_kind === "pet" && target.target_id === pet.data.id));

  const sent = await owner.client.rpc("send_space_message", {
    message_client_id: crypto.randomUUID(),
    target_space_id: space.data,
    message_kind: "text",
    message_text: "@同名成员 请看一下，@芽芽 也来听听",
    mentioned_user_ids: [mentioned.id],
    mentioned_pet_ids: [pet.data.id],
  });
  assert.equal(sent.error, null, sent.error?.message);
  const mentionRows = await mentioned.client.from("message_mentions").select("target_user_id,target_pet_id").eq("message_id", sent.data);
  assert.equal(mentionRows.error, null, mentionRows.error?.message);
  assert.equal(mentionRows.data.length, 2);

  const notificationKinds = await service.from("notification_events").select("user_id,kind").eq("entity_id", sent.data);
  assert.equal(notificationKinds.error, null, notificationKinds.error?.message);
  assert.equal(notificationKinds.data.find((event) => event.user_id === mentioned.id)?.kind, "mention");
  assert.equal(notificationKinds.data.find((event) => event.user_id === sameNameBystander.id)?.kind, "message");

  const read = await mentioned.client.rpc("mark_space_read_through", { target_space_id: space.data, through_message_id: sent.data });
  assert.equal(read.error, null, read.error?.message);
  const memberState = await service.from("space_members").select("last_read_at").eq("space_id", space.data).eq("user_id", mentioned.id).single();
  assert.ok(Date.parse(memberState.data.last_read_at) >= 0);
  const unreadEvents = await service.from("notification_events").select("id").eq("space_id", space.data).eq("user_id", mentioned.id).is("read_at", null);
  assert.equal(unreadEvents.data.length, 0);

  console.log("Cloud mobile reliability smoke passed");
}

try {
  await main();
} finally {
  for (const id of createdUserIds.reverse()) await service.auth.admin.deleteUser(id);
}
