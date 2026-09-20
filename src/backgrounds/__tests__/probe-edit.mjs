// A live source-image editing probe; prints no credentials or provider payloads.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const file = process.env.BACKGROUND_PROVIDER_ENV_FILE;
if (!file) throw new Error("Set BACKGROUND_PROVIDER_ENV_FILE to the existing private provider configuration.");
const config = {};
for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
  const match = /^(IMAGE_API_BASE_URL|IMAGE_API_KEY|IMAGE_MODEL)=(.*)$/.exec(line.trim());
  if (match) config[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
}
if (!config.IMAGE_API_BASE_URL || !config.IMAGE_API_KEY || !config.IMAGE_MODEL) throw new Error("Existing provider image configuration is incomplete.");
const endpoint = new URL(config.IMAGE_API_BASE_URL.replace(/\/+$/, "") + "/images/edits");
// Docker's host alias points to the same configured CPA service when probing on Windows.
if (endpoint.hostname === "host.docker.internal") endpoint.hostname = "127.0.0.1";
const source = await readFile("assets/brand/icon.png"); const form = new FormData();
form.append("model", config.IMAGE_MODEL); form.append("size", "1024x1024"); form.append("response_format", "b64_json");
form.append("prompt", "Edit the supplied image: keep the exact green outlined smiling animal face, its geometry and proportions. Change only the surrounding background into a soft pale blue gradient with very subtle cloud texture. No letters, no additional subjects.");
form.append("image", new Blob([source], { type: "image/png" }), "source.png");
const started = Date.now(); const out = "test-results/background-edit-proof"; await mkdir(out, { recursive: true });
let record = { checked_at: new Date().toISOString(), model: config.IMAGE_MODEL, actual_input_image: true, passed: false };
try {
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${config.IMAGE_API_KEY}` }, body: form, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`image_edit_http_${response.status}`);
  const payload = await response.json(); const item = payload?.data?.[0]; let bytes;
  if (item?.b64_json) bytes = Buffer.from(item.b64_json, "base64");
  else if (item?.url) { const image = await fetch(item.url, { signal: AbortSignal.timeout(30_000) }); if (!image.ok) throw new Error("image_edit_download_failed"); bytes = Buffer.from(await image.arrayBuffer()); }
  if (!bytes || bytes.length < 1000) throw new Error("image_edit_missing_image");
  const png = bytes[0] === 137 && bytes[1] === 80; const jpeg = bytes[0] === 255 && bytes[1] === 216;
  if (!png && !jpeg) throw new Error("image_edit_format_unverified");
  const filename = `${out}/edited-source.${png ? "png" : "jpg"}`; await writeFile(filename, bytes);
  record = { ...record, response_image: filename, bytes: bytes.length, elapsed_ms: Date.now() - started, source_sha256: createHash("sha256").update(source).digest("hex"), output_sha256: createHash("sha256").update(bytes).digest("hex"), visual_review: "required", passed: false };
  console.log("Live source-image edit returned an image; inspect preserved subject and requested change before enabling editing.");
} catch (reason) {
  record = { ...record, elapsed_ms: Date.now() - started, error_code: /^image_edit_/.test(reason.message) ? reason.message : "image_edit_network_or_timeout" };
  console.log(`Live edit probe did not pass: ${record.error_code}`);
}
await writeFile(`${out}/verification.json`, JSON.stringify(record, null, 2));
