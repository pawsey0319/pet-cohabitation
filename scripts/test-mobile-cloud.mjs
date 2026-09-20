// Explicit target required. Only this run's synthetic account and image are removed.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL;
if (!url || new URL(url).hostname !== process.env.MOBILE_TEST_HOST) throw new Error("Set the explicit MOBILE_TEST_HOST and Supabase credentials");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const client = createClient(url, process.env.SUPABASE_ANON_KEY, opts);
const ok = (r) => { if (r.error) throw r.error; return r.data; };
async function invoke(name, body) {
  const result = await client.functions.invoke(name, { body });
  if (!result.error) return result.data;
  let code = "request_failed";
  try { code = (await result.error.context.json()).error ?? code; } catch {}
  throw new Error(name + ": " + code);
}
const email = "mobile-fix-" + randomUUID() + "@example.test";
const password = "Test-" + randomUUID() + "!a1";
let userId;
let petId;
try {
  const created = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }));
  userId = created.user.id;
  ok(await service.from("profiles").insert({ id: userId, email, nickname: "修复验收" }));
  ok(await client.auth.signInWithPassword({ email, password }));
  const health = await invoke("model-health", {});
  assert.equal(health.text_check, "generation");
  assert.equal(health.text_online, true);
  assert.equal(health.image_check, "catalog");
  console.log("PASS: cloud structured text health; image catalog explicitly unverified for generation");
  const pet = ok(await client.from("pets").insert({ owner_id: userId, name: "修复验收芽芽" }).select("id").single());
  petId = pet.id;
  const generation = await invoke("generate-pet-candidate", { request_id: randomUUID(), explore: false, instruction: "按以下期待生成原创像素异宠",
    expectations: { appearance: "透明鳍、不对称触角的小型软体生物", personality: "安静敏锐，有自己的判断", companionship: "先倾听，需要时给简短建议", excluded_features: "人脸、猫狗轮廓", additional_description: "原创像素全身异宠" } });
  const deadline = Date.now() + 180_000;
  let succeeded = false;
  while (Date.now() < deadline) {
    const state = ok(await client.from("pet_generation_sessions").select("status,error_code").eq("id", generation.session_id).single());
    if (state.status === "failed") throw new Error("generation: " + state.error_code);
    if (state.status === "succeeded") { succeeded = true; break; }
    await new Promise((done) => setTimeout(done, 2000));
  }
  assert.equal(succeeded, true, "generation deadline");
  const asset = ok(await client.from("pet_visual_assets").select("id,storage_path").eq("generation_session_id", generation.session_id).single());
  const downloaded = ok(await service.storage.from("pet-portraits").download(asset.storage_path));
  assert.ok(downloaded.size > 100);
  console.log("PASS: actual cloud pet seed + image generation + stored image");
  await invoke("confirm-pet", { asset_id: asset.id });
  const body = { content: "今天有点累，先陪我说说话。", request_id: randomUUID() };
  const reply = await invoke("pet-chat", body);
  assert.ok(reply.content);
  const again = await invoke("pet-chat", body);
  assert.equal(again.id, reply.id);
  assert.equal(ok(await service.from("pet_private_threads").select("id").eq("owner_id", userId).eq("request_key", body.request_id)).length, 1);
  console.log("PASS: actual cloud private reply and same-request retry without duplicate messages");
} finally {
  if (userId) {
    if (petId) {
      const assets = ok(await service.from("pet_visual_assets").select("storage_path").eq("pet_id", petId));
      if (assets.length) ok(await service.storage.from("pet-portraits").remove(assets.map((a) => a.storage_path)));
    }
    ok(await service.auth.admin.deleteUser(userId));
    console.log("Synthetic account and generated media removed.");
  }
}
