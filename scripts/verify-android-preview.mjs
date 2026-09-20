// Verify the same update manifest and authenticated assets requested by Android.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const expectedId = process.argv[2];
if (!expectedId) throw new Error("Usage: node scripts/verify-android-preview.mjs <expected-update-id>");
const { expo } = JSON.parse(await readFile("app.json", "utf8"));
const expectedRuntime = process.argv[3] ?? (typeof expo.runtimeVersion === "string" ? expo.runtimeVersion : expo.runtimeVersion?.policy === "appVersion" ? expo.version : undefined);
assert.ok(expectedRuntime, "Provide the expected runtime or configure appVersion runtime policy");
const response = await fetch(expo.updates.url, {
  headers: { "expo-platform": "android", "expo-runtime-version": expectedRuntime, "expo-channel-name": "preview", "expo-protocol-version": "1", accept: "multipart/mixed,application/expo+json,application/json" },
  signal: AbortSignal.timeout(30_000),
});
assert.equal(response.status, 200, "Android manifest response");
const type = response.headers.get("content-type") ?? "";
const body = await response.text();
let manifest, extensions = {};
if (type.startsWith("multipart/")) {
  const boundary = type.match(/boundary="?([^";]+)"?/)?.[1]; assert.ok(boundary);
  for (const part of body.split("--" + boundary)) {
    const separator = part.indexOf("\r\n\r\n"); if (separator < 0) continue;
    const headers = part.slice(0, separator), value = part.slice(separator + 4).trim();
    if (headers.includes('name="manifest"')) manifest = JSON.parse(value);
    if (headers.includes('name="extensions"')) extensions = JSON.parse(value);
  }
} else manifest = JSON.parse(body);
assert.equal(manifest.id, expectedId, "preview serves the published update");
assert.equal(manifest.runtimeVersion, expectedRuntime);
const results = [], assets = [manifest.launchAsset, ...manifest.assets];
let next = 0;
async function worker() {
  while (next < assets.length) {
    const asset = assets[next++];
    const download = await fetch(asset.url, { headers: extensions.assetRequestHeaders?.[asset.key] ?? {}, signal: AbortSignal.timeout(60_000) });
    assert.equal(download.status, 200, `asset ${asset.key}`);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("base64url"), asset.hash, `asset integrity ${asset.key}`);
    results.push({ key: asset.key, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), launch: asset.key === manifest.launchAsset.key });
  }
}
await Promise.all([worker(), worker(), worker()]);
const receipt = { verifiedAt: new Date().toISOString(), updateId: manifest.id, createdAt: manifest.createdAt, runtimeVersion: manifest.runtimeVersion, channel: "preview", assets: results, physicalAndroid: "pending" };
await mkdir("test-results/background-release", { recursive: true });
await writeFile("test-results/background-release/android-update-verification.json", JSON.stringify(receipt, null, 2));
const launch = results.find(asset => asset.launch);
console.log(`PASS: Android preview / ${manifest.runtimeVersion} serves ${manifest.id}; ${results.length} assets downloaded with matching SHA-256. Launch bundle ${launch.bytes} bytes.`);
