import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Cloud Supabase environment is missing");

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = Date.now();
let userId;

try {
  const email = `pet-generation-smoke-${suffix}@example.test`;
  const password = `Pet-generation-${suffix}`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const profile = await service.from("profiles").insert({ id: userId, email, nickname: "异步生成冒烟" });
  if (profile.error) throw profile.error;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const pet = await client.from("pets").insert({ owner_id: userId, name: "星澜" }).select("id").single();
  if (pet.error) throw pet.error;

  const startedAt = Date.now();
  const requested = await client.functions.invoke("generate-pet-candidate", { body: {
    instruction: "按这份期待生成第一版异宠",
    request_id: crypto.randomUUID(),
    expectations: {
      appearance: "深蓝色的小型星海鹿，透明枝状角、发光鳍、完整四肢与精细像素材质",
      personality: "敏锐、温暖、有主见",
      companionship: "先认真听，再清楚回答",
      excluded_features: "普通猫狗轮廓、简单几何色块、人脸、文字、水印",
      additional_description: "原创精细像素桌宠，全身清晰",
    },
  } });
  if (requested.error?.context) throw new Error(await requested.error.context.text());
  if (requested.error) throw requested.error;
  const requestMs = Date.now() - startedAt;
  assert.match(requested.data.session_id, /^[0-9a-f-]{36}$/);
  assert.ok(requestMs < 10_000, `generation request took ${requestMs}ms instead of returning asynchronously`);

  const observedStages = new Set();
  const deadline = Date.now() + 180_000;
  let session;
  while (Date.now() < deadline) {
    const result = await service.from("pet_generation_sessions").select("status,stage,progress_label,error_code,retryable").eq("id", requested.data.session_id).single();
    if (result.error) throw result.error;
    session = result.data;
    observedStages.add(result.data.stage);
    if (["succeeded", "failed"].includes(result.data.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(session, "generation session was not persisted");
  assert.equal(session.status, "succeeded", `${session.progress_label}: ${session.error_code}`);
  assert.equal(session.stage, "completed");
  const asset = await service.from("pet_visual_assets").select("id,storage_path").eq("generation_session_id", requested.data.session_id).single();
  assert.equal(asset.error, null, asset.error?.message);
  const stored = await service.storage.from("pet-portraits").download(asset.data.storage_path);
  assert.equal(stored.error, null, stored.error?.message);
  assert.ok(stored.data.size > 0);
  console.log(JSON.stringify({ status: "passed", request_ms: requestMs, stages: [...observedStages], image_bytes: stored.data.size }));
} finally {
  if (userId) await service.auth.admin.deleteUser(userId);
}
