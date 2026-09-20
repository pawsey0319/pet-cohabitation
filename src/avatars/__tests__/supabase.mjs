// Real isolated Supabase RPC/RLS tests. Does not claim live image or device QA.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL;
if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "47321") throw new Error("Use isolated companion fixture :47321.");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, opts); const accounts = []; let space; let checks = 0;
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const check = (value, message) => { assert.ok(value, message); checks++; };
async function invoke(client, body) {
  const result = await client.functions.invoke("avatar-assets", { body });
  if (result.error) {
    let code = result.error.message;
    try { const data = await result.error.context.json(); code = data.error ?? data.msg ?? code; } catch {}
    throw new Error(`avatar-assets ${body.action}: ${code}`);
  }
  return result.data;
}
async function account() {
  const email = `avatar-${randomUUID()}@example.test`, password = `Temporary-${randomUUID()}!`;
  const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user;
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, opts); accounts.push({ id: user.id, client });
  ok(await service.from("profiles").insert({ id: user.id, email, nickname: "头像隔离验收" })); ok(await client.auth.signInWithPassword({ email, password }));
  return { id: user.id, client };
}
try {
  const [a, b, c] = await Promise.all([account(), account(), account()]);
  space = ok(await service.from("spaces").insert({ name: "头像权限测试", kind: "friend_circle", created_by: a.id }).select().single()).id;
  ok(await service.from("space_members").upsert([{ space_id: space, user_id: a.id, role: "owner" }, { space_id: space, user_id: b.id, role: "member" }], { onConflict: "space_id,user_id" }));
  const asset = randomUUID(); const bytes = await readFile("assets/brand/icon.png"); const path = `${a.id}/${asset}.png`; const hash = createHash("sha256").update(bytes).digest("hex");
  ok(await service.storage.from("avatars").upload(path, bytes, { contentType: "image/png" }));
  ok(await service.from("avatar_assets").insert({ id: asset, owner_id: a.id, storage_path: path, source: "ai", content_sha256: hash }));
  const uploadId = randomUUID(), uploadPath = `${a.id}/${uploadId}.jpg`;
  const jpeg = await readFile("src/avatars/__tests__/avatar-fixture.jpg");
  ok(await a.client.storage.from("avatars").upload(uploadPath, jpeg, { contentType: "image/jpeg", upsert: false }));
  const registered = await invoke(a.client, { action: "register", request_id: uploadId });
  check(registered.asset.id === uploadId, "real Edge upload registration");
  check(ok(await a.client.functions.invoke("avatar-assets", { body: { action: "register", request_id: uploadId } })).asset.id === uploadId, "Edge upload retry returns same asset");
  check(!!(await b.client.functions.invoke("avatar-assets", { body: { action: "read", asset_id: uploadId } })).error, "Edge rejects private draft read");
  check(!!(await a.client.storage.from("avatars").upload(uploadPath, bytes, { contentType: "image/jpeg", upsert: true })).error, "client cannot replace uploaded bytes under same ID");
  check(ok(await b.client.from("avatar_assets").select("id").eq("id", asset)).length === 0, "same-group member cannot read private draft");
  check(!!(await b.client.storage.from("avatars").createSignedUrl(path, 60)).error, "private draft storage denied");
  check(!!(await a.client.rpc("apply_avatar", { p_owner_id: a.id, p_request_id: randomUUID(), p_target_kind: "profile", p_target_id: a.id, p_asset_id: asset, p_expected_version: 0 })).error, "service-only RPC");
  const mutation = { p_owner_id: a.id, p_request_id: randomUUID(), p_target_kind: "profile", p_target_id: a.id, p_asset_id: asset, p_expected_version: 0 };
  const receipt = ok(await service.rpc("apply_avatar", mutation)); check(receipt.version === 1, "application receipt version");
  check(ok(await a.client.functions.invoke("avatar-assets", { body: { action: "state", target: { kind: "profile", id: a.id } } })).reference === `avatar://${asset}`, "Edge returns applied reference");
  const read = ok(await b.client.functions.invoke("avatar-assets", { body: { action: "read", asset_id: asset } }));
  check(typeof read.url === "string" && read.url.includes("/avatars/"), "authorized Edge returns short-lived signed URL");
  assert.deepEqual(ok(await service.rpc("apply_avatar", mutation)), receipt); checks++;
  check(!!(await service.rpc("apply_avatar", { ...mutation, p_asset_id: null })).error, "same ID cannot change payload");
  check(!!(await service.rpc("apply_avatar", { ...mutation, p_request_id: randomUUID(), p_asset_id: null })).error, "old version cannot overwrite");
  check(ok(await b.client.from("avatar_assets").select("id").eq("id", asset)).length === 1, "same-group applied avatar readable");
  check(ok(await c.client.from("avatar_assets").select("id").eq("id", asset)).length === 0, "unrelated account denied");
  check(!!(await service.rpc("apply_avatar", { ...mutation, p_owner_id: b.id, p_request_id: randomUUID(), p_target_kind: "space", p_target_id: space })).error, "nonowner group mutation denied");
  check(!!(await service.rpc("apply_avatar", { ...mutation, p_owner_id: b.id, p_target_id: b.id, p_request_id: randomUUID() })).error, "foreign asset apply denied");
  const group = { ...mutation, p_request_id: randomUUID(), p_target_kind: "space", p_target_id: space };
  ok(await service.rpc("apply_avatar", group));
  ok(await service.from("space_members").insert({ space_id: space, user_id: c.id, role: "member" }));
  check(ok(await service.from("avatar_bindings").select("asset_id").eq("target_kind", "space").eq("target_id", space).single()).asset_id === asset, "membership does not overwrite custom image");
  ok(await service.from("space_members").delete().eq("space_id", space).in("user_id", [b.id, c.id]));
  check(ok(await b.client.from("avatar_assets").select("id").eq("id", asset)).length === 0, "revocation immediately removes database access");
  const claim = { p_owner_id: a.id, p_request_id: randomUUID(), p_kind: "avatar" };
  check(ok(await service.rpc("claim_personal_image_design", claim)) === true, "first quota claim");
  check(ok(await service.rpc("claim_personal_image_design", claim)) === false, "quota deduplicates retry");
  for (let i = 0; i < 11; i++) ok(await service.rpc("claim_personal_image_design", { ...claim, p_request_id: randomUUID(), p_kind: i % 2 ? "background" : "avatar" }));
  check(!!(await service.rpc("claim_personal_image_design", { ...claim, p_request_id: randomUUID(), p_kind: "background" })).error, "shared daily quota caps background + avatar at 12");
  const pet = ok(await service.from("pets").insert({ owner_id: b.id, name: "透明图测试" }).select().single());
  const original = ok(await service.from("pet_visual_assets").insert({ pet_id: pet.id, owner_id: b.id, storage_path: `${b.id}/${randomUUID()}.png`, prompt_hash: hash, is_draft: false }).select().single());
  ok(await service.from("pets").update({ status: "confirmed", confirmed_at: new Date().toISOString(), current_asset_id: original.id }).eq("id", pet.id));
  const req = { p_owner_id: b.id, p_pet_id: pet.id, p_request_id: randomUUID(), p_expected_version: 0 };
  const job = ok(await service.rpc("request_pet_transparent", req));
  check(ok(await service.rpc("request_pet_transparent", req)).id === job.id, "transparent request idempotent");
  check(ok(await a.client.from("pet_transparent_jobs").select("id").eq("id", job.id)).length === 0, "pet display jobs private");
  const lease = ok(await service.rpc("lease_pet_transparent")); check(lease.id === job.id && lease.attempts === 1, "authorized cloud lease");
  check(ok(await service.rpc("lease_pet_transparent")) === null, "active lease cannot be stolen");
  check(ok(await service.rpc("begin_pet_transparent_upload", { p_job_id: job.id, p_lease_token: randomUUID() })) === false, "wrong lease denied");
  check(ok(await service.rpc("begin_pet_transparent_upload", { p_job_id: job.id, p_lease_token: lease.lease_token })) === true, "leased upload accepted");
  ok(await service.rpc("set_pet_display", { p_owner_id: b.id, p_pet_id: pet.id, p_request_id: randomUUID(), p_expected_version: 0, p_use_transparent: false }));
  check(ok(await service.rpc("complete_pet_transparent", { p_job_id: job.id, p_lease_token: lease.lease_token, p_path: `${b.id}/${lease.lease_token}.png`, p_sha256: hash })) === false, "restore original prevents late commit");
  check(ok(await service.from("pets").select("current_asset_id").eq("id", pet.id).single()).current_asset_id === original.id, "original identity never changed");
  ok(await service.rpc("block_avatar_owner", { p_owner_id: c.id }));
  check(!!(await service.rpc("claim_avatar_generation", { p_owner_id: c.id, p_request_id: randomUUID(), p_prompt: "测试头像请求", p_model: "test-fixture" })).error, "account deletion blocks late generation");
  console.log(`PASS: ${checks} real isolated Supabase avatar ACL, quotas, immutable requests, version and transparent lease checks.`);
} finally {
  if (space) await service.from("spaces").delete().eq("id", space);
  for (const a of accounts) {
    for (const bucket of ["avatars", "pet-transparent"]) {
      const files = await service.storage.from(bucket).list(a.id); const paths = (files.data ?? []).filter(x => x.id).map(x => `${a.id}/${x.name}`);
      if (paths.length) await service.storage.from(bucket).remove(paths);
    }
    await service.auth.admin.deleteUser(a.id);
  }
}
