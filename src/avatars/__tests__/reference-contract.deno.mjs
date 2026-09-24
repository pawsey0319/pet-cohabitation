// Actual local Auth/Postgres/Storage with the unchanged Edge handler. The seeded
// brand image validates access/races, not pet-image visual quality.
import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL");
if (!url || new URL(url).hostname !== "127.0.0.1" || !["47321", "48321"].includes(new URL(url).port)) throw new Error("isolated_fixture_required");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), opts);
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const uuid = () => crypto.randomUUID(); const accounts = [], checks = [], files = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
const originalServe = Deno.serve, originalFetch = globalThis.fetch; let handler, space;
Deno.serve = callback => { handler = callback; return {}; };
await import("../../../supabase/functions/avatar-assets/index.ts"); Deno.serve = originalServe;
async function account() {
  const email = `avatar-reference-${uuid()}@example.test`, password = `Synthetic-${uuid()}!`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  accounts.push(id); ok(await service.from("profiles").insert({ id, email, nickname: "头像合同合成账号" }));
  const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), opts);
  ok(await client.auth.signInWithPassword({ email, password })); return { id, client };
}
async function edge(account, body) {
  const session = ok(await account.client.auth.getSession()).session;
  const response = await handler(new Request(`${url}/functions/v1/avatar-assets`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}
async function read(account, reference, scope = space) {
  const result = await edge(account, { action: "read_batch", references: [{ reference, space_id: scope }] });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.entries[0];
}
async function upload(bucket, owner, bytes) {
  const path = `${owner}/${uuid()}.png`; ok(await service.storage.from(bucket).upload(path, bytes, { contentType: "image/png" })); files.push({ bucket, path }); return path;
}
const report = { timestamp: new Date().toISOString(), fixture: url, success: false, checks, cleanup: [] };
try {
  const a = await account(), b = await account(), c = await account();
  space = ok(await service.from("spaces").insert({ name: "头像合同隔离群", kind: "friend_circle", created_by: a.id }).select("id").single()).id;
  ok(await service.from("space_members").upsert([{ space_id: space, user_id: a.id, role: "owner" }, { space_id: space, user_id: b.id, role: "member" }], { onConflict: "space_id,user_id" }));
  const bytes = await Deno.readFile("assets/brand/icon.png"), avatar = uuid();
  const avatarPath = await upload("avatars", a.id, bytes);
  ok(await service.from("avatar_assets").insert({ id: avatar, owner_id: a.id, storage_path: avatarPath, source: "ai", content_sha256: "a".repeat(64) }));
  const humanRef = `avatar://${avatar}`;
  check((await read(b, humanRef)).error === "avatar_forbidden", "shared group never authorizes private avatar draft");
  check((await read(a, humanRef, null)).published === false, "own private preview is explicitly non-persistent");
  check((await read(a, humanRef)).error === "avatar_forbidden", "private draft cannot be read as group avatar even by owner");
  ok(await service.rpc("apply_avatar", { p_owner_id: a.id, p_request_id: uuid(), p_target_kind: "profile", p_target_id: a.id, p_asset_id: avatar, p_expected_version: 0 }));
  const human = await read(b, humanRef);
  check(human.published && human.url.includes("/avatars/") && !human.path && !human.bucket, "published human avatar returns versioned short URL without storage inputs");
  check((await read(c, humanRef)).error === "avatar_scope_forbidden", "unrelated account cannot use a valid group id");
  check(!!(await b.client.rpc("resolve_avatar_references", { p_viewer: a.id, p_references: [{ reference: humanRef }] })).error, "signing-input resolver is service-only");
  const snapshot = await edge(b, { action: "space_state", space_id: space });
  check(snapshot.status === 200 && snapshot.body.members.length === 2, "one authorized snapshot contains stable member references");
  const pet = ok(await service.from("pets").insert({ owner_id: a.id, name: "本体头像合同" }).select("id").single());
  const source = uuid(), originalPath = await upload("pet-portraits", a.id, bytes);
  ok(await service.from("pet_visual_assets").insert({ id: source, pet_id: pet.id, owner_id: a.id, storage_path: originalPath, prompt_hash: "synthetic-avatar-contract", is_draft: false }));
  ok(await service.from("pets").update({ current_asset_id: source, status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", pet.id));
  const petRef = `pet-avatar://${pet.id}`;
  const original = await read(b, petRef);
  check(original.url.includes("/pet-portraits/") && original.version === source, "pet reference resolves the actual published pet rather than owner avatar");
  const mentions = ok(await b.client.rpc("list_space_mention_targets", { target_space_id: space }));
  check(mentions.find(row => row.target_kind === "pet" && row.target_id === pet.id)?.avatar_url === petRef, "mention list uses a stable pet identity reference");
  const job = ok(await service.rpc("request_pet_transparent", { p_owner_id: a.id, p_pet_id: pet.id, p_request_id: uuid(), p_expected_version: 0 }));
  const transparentPath = await upload("pet-transparent", a.id, bytes);
  ok(await service.from("pet_transparent_jobs").update({ status: "succeeded", output_path: transparentPath, output_sha256: "b".repeat(64), completed_at: new Date().toISOString() }).eq("id", job.id));
  check((await read(b, petRef)).version === source, "unapproved transparent candidate stays private");
  ok(await service.rpc("approve_pet_transparent", { p_owner_id: a.id, p_pet_id: pet.id, p_request_id: uuid(), p_job_id: job.id, p_source_asset_id: source, p_expected_version: 0 }));
  const approved = await read(b, petRef);
  check(approved.url.includes("/pet-transparent/") && approved.version.includes(job.id), "approved transparent source/version is shared as published pet portrait");
  check(ok(await b.client.from("pet_transparent_jobs").select("id").eq("id", job.id)).length === 0, "shared avatar does not open private processing records");
  let crossed = false;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init), address = input instanceof Request ? input.url : String(input);
    if (!crossed && address.includes("/storage/v1/object/sign/")) { crossed = true; ok(await service.from("space_members").delete().eq("space_id", space).eq("user_id", b.id)); }
    return response;
  };
  const revoked = await read(b, petRef); globalThis.fetch = originalFetch;
  check(crossed && revoked.error === "avatar_scope_forbidden" && !revoked.url, "membership removed during signing suppresses late image URL");
  ok(await service.from("space_members").insert({ space_id: space, user_id: b.id, role: "member" }));
  crossed = false;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init), address = input instanceof Request ? input.url : String(input);
    if (!crossed && address.includes("/storage/v1/object/sign/")) { crossed = true; ok(await service.rpc("set_pet_display", { p_owner_id: a.id, p_pet_id: pet.id, p_request_id: uuid(), p_expected_version: 0, p_use_transparent: false })); }
    return response;
  };
  const changed = await read(b, petRef); globalThis.fetch = originalFetch;
  check(crossed && changed.error === "avatar_version_changed" && !changed.url, "display version changed during signing suppresses obsolete portrait");
  check((await read(b, petRef)).version === source, "next request resolves restored original");
  ok(await service.from("pet_visual_assets").update({ is_draft: true }).eq("id", source));
  check(!(await read(b, petRef)).url, "a draft can never be published by a current_asset pointer");
  report.success = true;
} catch (reason) { report.failure = reason instanceof Error ? reason.message : String(reason); throw reason; }
finally {
  globalThis.fetch = originalFetch; Deno.serve = originalServe;
  if (space) { const result = await service.from("spaces").delete().eq("id", space); if (result.error) report.cleanup.push("space_cleanup_failed"); }
  for (const file of files) { const result = await service.storage.from(file.bucket).remove([file.path]); if (result.error) report.cleanup.push("storage_cleanup_failed"); }
  for (const id of accounts) { const result = await service.auth.admin.deleteUser(id); if (result.error) report.cleanup.push("account_cleanup_failed"); }
  await Deno.mkdir("test-results", { recursive: true }); await Deno.writeTextFile("test-results/2026-09-20-avatar-reference-contract.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, checks: checks.length, cleanupIssues: report.cleanup.length }));
}
