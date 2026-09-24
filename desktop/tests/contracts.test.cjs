const test = require("node:test");
const assert = require("node:assert/strict");
const { validate, clampBounds, approvedImage, upsertRequest, validatePublicConfig } = require("../contracts.cjs");
test("unexposed IPC, arbitrary ids and coordinate values are rejected", () => {
  for (const [method, value] of [["readFile", {}], ["login", { email: "x", password: "x" }], ["send", { id: "x", content: "hello" }], ["drag", { x: Infinity, y: 0 }], ["resize", { size: 999999 }]]) assert.throws(() => validate(method, value));
});
test("disconnected screens and DPI changes restore wholly inside an available work area", () => {
  assert.deepEqual(clampBounds({ x: 5000, y: -800 }, [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }], 120), { x: 1800, y: 0, width: 120, height: 120 });
  assert.deepEqual(clampBounds({ x: -100, y: 500 }, [{ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }], 160), { x: -160, y: 500, width: 160, height: 160 });
});
test("retries retain immutable text and request id", () => {
  const input = { id: "7350dafe-7488-4466-8c65-ed0c74d2d837", content: "晚上好" };
  const once = upsertRequest([], input); assert.equal(upsertRequest(once, input).length, 1);
  assert.throws(() => upsertRequest(once, { ...input, content: "different" }));
});
test("unreviewed or obsolete transparent results never render as desktop pets", () => {
  const value = { url: "https://example.supabase.co/storage/v1/object/sign/a", source_asset_id: "asset", job: { id: "job", status: "succeeded" }, preference: { version: 3, use_transparent: true, approved_source_asset_id: "asset", approved_job_id: "job", approved_display_version: 3, approved_at: "date" } };
  assert.ok(approvedImage(value, "asset", "https://example.supabase.co"));
  assert.throws(() => approvedImage({ ...value, preference: { ...value.preference, approved_display_version: 2 } }, "asset", "https://example.supabase.co"));
  assert.throws(() => approvedImage({ ...value, url: "https://evil.invalid/image.png" }, "asset", "https://example.supabase.co"));
});
test("service credentials cannot be packaged even under a misleading public environment variable", () => {
  const base = { supabaseUrl: "https://example.supabase.co", publicAppUrl: "https://pet.example" };
  assert.ok(validatePublicConfig({ ...base, publishableKey: "sb_publishable_fixture" }));
  const service = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  assert.throws(() => validatePublicConfig({ ...base, publishableKey: service }));
  assert.throws(() => validatePublicConfig({ ...base, publishableKey: "sb_secret_fixture" }));
  assert.throws(() => validatePublicConfig({ ...base, publishableKey: "sb_publishable_fixture", private_key: "fixture" }));
});
