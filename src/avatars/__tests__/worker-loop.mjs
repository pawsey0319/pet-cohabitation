// Real rembg inference through the isolated cloud-style gateway and Storage.
// The input is a bundled brand fixture, not a claim of pet visual acceptance.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL;
if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "47321") throw new Error("Only isolated companion fixture is permitted.");
const envText = await readFile("test-results/android-companion-supabase/functions.env", "utf8");
const token = envText.match(/^PET_TRANSPARENT_WORKER_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
if (!token || token.length < 32) throw new Error("Set a temporary worker credential in fixture functions.env.");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, opts); const client = createClient(url, process.env.SUPABASE_ANON_KEY, opts);
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; }; let owner;
try {
  const email = `transparent-${randomUUID()}@example.test`, password = `Test-${randomUUID()}!`;
  owner = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  ok(await service.from("profiles").insert({ id: owner, email, nickname: "透明模型链路验收" })); ok(await client.auth.signInWithPassword({ email, password }));
  const pet = ok(await service.from("pets").insert({ owner_id: owner, name: "模型测试" }).select().single());
  const assetId = randomUUID(), sourcePath = `${owner}/${assetId}.png`; const bytes = await readFile("assets/brand/icon.png");
  ok(await service.storage.from("pet-portraits").upload(sourcePath, bytes, { contentType: "image/png" }));
  ok(await service.from("pet_visual_assets").insert({ id: assetId, pet_id: pet.id, owner_id: owner, storage_path: sourcePath, prompt_hash: "synthetic-brand-fixture", is_draft: false }));
  ok(await service.from("pets").update({ status: "confirmed", confirmed_at: new Date().toISOString(), current_asset_id: assetId }).eq("id", pet.id));
  const requested = ok(await client.functions.invoke("pet-display", { body: { action: "request", pet_id: pet.id, request_id: randomUUID(), expected_version: 0 } }));
  assert.equal(requested.job.status, "queued");
  const invalid = await fetch(`${url}/functions/v1/pet-transparent-worker`, { method: "POST", headers: { "content-type": "application/json", "x-pet-worker-token": "incorrect-credential" }, body: JSON.stringify({ action: "lease" }) });
  assert.equal(invalid.status, 401);
  const work = join(tmpdir(), "pet-transparent-validation");
  const workerEnv = { ...process.env, PET_TRANSPARENT_WORKER_TOKEN: token, PET_TRANSPARENT_WORKER_URL: `${url}/functions/v1/pet-transparent-worker` };
  delete workerEnv.SUPABASE_SERVICE_ROLE_KEY; delete workerEnv.SUPABASE_ANON_KEY;
  const child = spawn(join(work, "venv", "Scripts", "python.exe"), [resolve("src/avatars/transparent-worker/worker.py"), "--once", "--model-dir", work], { env: workerEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", () => {});
  const code = await new Promise((done, reject) => { child.on("error", reject); child.on("exit", done); });
  assert.equal(code, 0, "worker process exits cleanly");
  assert.match(output, /"status": "committed"/, "authorized model output commits through gateway");
  const candidate = ok(await client.functions.invoke("pet-display", { body: { action: "status", pet_id: pet.id } }));
  assert.equal(candidate.job.status, "succeeded"); assert.equal(candidate.url, null); assert.ok(candidate.candidate_url);
  // Contract confirmation uses the bundled fixture; it is not a claim that
  // this or any other rembg image passed real-pet anatomy/edge quality review.
  ok(await client.functions.invoke("pet-display", { body: { action: "approve", pet_id: pet.id, job_id: candidate.job.id, source_asset_id: assetId, request_id: randomUUID(), expected_version: candidate.preference.version } }));
  const state = ok(await client.functions.invoke("pet-display", { body: { action: "status", pet_id: pet.id } }));
  assert.ok(state.url); assert.equal(state.preference.approved_job_id, candidate.job.id);
  const job = ok(await service.from("pet_transparent_jobs").select("output_path,output_sha256").eq("id", requested.job.id).single());
  const stored = ok(await service.storage.from("pet-transparent").download(job.output_path)); const png = new Uint8Array(await stored.arrayBuffer());
  assert.equal(png[25], 6, "stored cloud PNG carries RGBA"); assert.equal(job.output_sha256.length, 64);
  assert.equal(ok(await service.from("personal_image_design_claims").select("request_id").eq("owner_id", owner)).length, 0, "system derivative does not consume design quota");
  assert.equal(ok(await service.from("pets").select("current_asset_id").eq("id", pet.id).single()).current_asset_id, assetId);
  ok(await client.functions.invoke("pet-display", { body: { action: "set", pet_id: pet.id, request_id: randomUUID(), expected_version: 0, use_transparent: false } }));
  assert.equal(ok(await client.functions.invoke("pet-display", { body: { action: "status", pet_id: pet.id } })).url, null);
  console.log("PASS: real locked rembg model -> authorized lease gateway -> cloud Storage -> guarded commit -> private preview -> explicit approval -> display -> original restore. Brand fixture only; pet visual acceptance remains pending.");
} finally {
  if (owner) {
    for (const bucket of ["pet-portraits", "pet-transparent"]) {
      const files = await service.storage.from(bucket).list(owner); const paths = (files.data ?? []).filter(row => row.id).map(row => `${owner}/${row.name}`);
      if (paths.length) await service.storage.from(bucket).remove(paths);
    }
    await service.auth.admin.deleteUser(owner);
  }
}
