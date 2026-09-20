// Full local Supabase policies and Edge export/deletion, using a synthetic image.
// Real provider generation is verified separately by test-chat-background-cloud.mjs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL;
if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "47321") throw new Error("Use the isolated companion fixture on port 47321.");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const accounts = [];
const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
async function account() {
  const email = `background-local-${randomUUID()}@example.test`, password = `Test-${randomUUID()}!a1`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, options);
  const record = { id, password, client, removed: false }; accounts.push(record);
  ok(await service.from("profiles").insert({ id, email, nickname: "本地背景验收" }));
  ok(await client.auth.signInWithPassword({ email, password })); return record;
}
async function remove(a) {
  if (a.removed) return;
  ok(await a.client.functions.invoke("delete-account", { body: { password: a.password } })); a.removed = true;
  assert.equal(ok(await service.storage.from("chat-backgrounds").list(a.id)).length, 0);
  for (const table of ["chat_background_settings", "chat_background_assets", "chat_background_generations", "chat_background_owner_controls"]) {
    assert.equal(ok(await service.from(table).select("owner_id").eq("owner_id", a.id)).length, 0);
  }
}
try {
  const a = await account(), b = await account();
  const requestId = randomUUID(), assetId = randomUUID(), storagePath = `${a.id}/${assetId}.png`;
  const claimArgs = { p_owner_id: a.id, p_request_id: requestId, p_prompt: "本地合成背景验收", p_model: "synthetic-fixture" };
  assert.equal(ok(await service.rpc("claim_chat_background_generation", claimArgs)).created, true);
  assert.equal(ok(await service.rpc("claim_chat_background_generation", claimArgs)).created, false);
  assert.ok((await b.client.rpc("claim_chat_background_generation", claimArgs)).error);
  assert.ok((await service.rpc("claim_chat_background_generation", { ...claimArgs, p_prompt: "不能改写原描述" })).error);
  const status = ok(await a.client.functions.invoke("generate-chat-background", { body: { action: "status", request_id: requestId } }));
  assert.equal(status.job.status, "queued");
  assert.ok((await b.client.functions.invoke("generate-chat-background", { body: { action: "status", request_id: requestId } })).error);
  console.log("PASS: local Edge authentication, request claims, conflict and task isolation");
  ok(await service.from("chat_background_generations").update({ status: "running" }).eq("request_id", requestId));
  assert.equal(ok(await service.rpc("begin_chat_background_upload", { p_owner_id: a.id, p_request_id: requestId })), true);
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII=", "base64");
  ok(await service.storage.from("chat-backgrounds").upload(storagePath, bytes, { contentType: "image/png" }));
  assert.equal(ok(await service.rpc("complete_chat_background_generation", { p_owner_id: a.id, p_request_id: requestId, p_asset_id: assetId, p_storage_path: storagePath })), true);
  ok(await a.client.from("chat_background_settings").upsert({ owner_id: a.id, thread_key: "companion", asset_id: assetId }));
  assert.ok((await b.client.from("chat_background_settings").upsert({ owner_id: b.id, thread_key: "companion", asset_id: assetId })).error);
  const signed = ok(await a.client.storage.from("chat-backgrounds").createSignedUrl(storagePath, 60));
  assert.equal((await fetch(signed.signedUrl)).status, 200);
  assert.ok((await b.client.storage.from("chat-backgrounds").createSignedUrl(storagePath, 60)).error);
  assert.equal(ok(await b.client.from("chat_background_assets").select("id")).length, 0);
  console.log("PASS: local private Storage, transactional asset and cross-owner setting rejection");
  const uploadId = randomUUID(), uploadPath = `${a.id}/${uploadId}.png`;
  ok(await a.client.storage.from("chat-backgrounds").upload(uploadPath, bytes, { contentType: "image/png" }));
  ok(await a.client.from("chat_background_assets").insert({ id: uploadId, owner_id: a.id, storage_path: uploadPath, source: "upload" }));
  const exported = ok(await a.client.functions.invoke("export-my-data", { body: {} }));
  assert.ok(JSON.stringify(exported).includes(assetId) && JSON.stringify(exported).includes(uploadId));
  console.log("PASS: local owner uploads and Edge export include background metadata");
  await remove(a); await remove(b);
  console.log("PASS: local Edge account deletion removes objects and all background rows; synthetic accounts cleaned");
} finally {
  for (const a of accounts) await remove(a);
}
