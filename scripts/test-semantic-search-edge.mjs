import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.SUPABASE_ANON_KEY;
if (!url || !key || !anon || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Isolated fixture credentials required");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); let owner;
try {
  const email = `semantic-edge-${randomUUID()}@example.test`, password = `Temporary-${randomUUID()}!`;
  const created = await client.auth.admin.createUser({ email, password, email_confirm: true }); if (created.error) throw created.error; owner = created.data.user.id;
  const profile = await client.from("profiles").insert({ id: owner, email, nickname: "语义接口验收" }); if (profile.error) throw profile.error;
  const caller = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }); const login = await caller.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  const invoke = (body, token = login.data.session.access_token) => fetch(`${url}/functions/v1/semantic-search`, { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const invalid = await invoke({ query: "" }); assert.equal(invalid.status, 400);
  const unauthorized = await invoke({ query: "验收" }, "invalid-token"); assert.equal(unauthorized.status, 401);
  const empty = await invoke({ query: "无资料合成空账号搜索", types: ["memory"] }); assert.equal(empty.status, 200); const result = await empty.json(); assert.equal(result.method, "semantic"); assert.deepEqual(result.results, []); assert.ok(result.coverage.includes("未找到不代表"));
  assert.equal((await client.from("pet_personal_memories").select("id").eq("owner_id", owner)).data.length, 0);
  console.log("PASS semantic Edge: authenticated empty search, invalid input, unauthenticated rejection, no memory writes; current fixture model configuration only.");
} finally { if (owner) await client.auth.admin.deleteUser(owner); }
