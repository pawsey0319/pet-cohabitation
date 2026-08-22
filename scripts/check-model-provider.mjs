const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const endpoint = (base, path) => `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const authorization = (key) => ({ Authorization: `Bearer ${key}` });

function standardErrorCode(label, status, payload = {}) {
  const kind = label.startsWith("chat/") ? "text" : "image";
  const providerCode = String(payload?.error?.code ?? payload?.error?.type ?? payload?.code ?? "").toLowerCase();
  if (status === 408 || status === 504) return `${kind}_model_timeout`;
  if (status === 429) return `${kind}_model_rate_limited`;
  if (/content|safety|moderation|policy/.test(providerCode)) return `${kind}_model_content_blocked`;
  return `${kind}_model_http_${status}`;
}

async function checkedFetch(label, url, init, timeoutMs) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`${label}: network_or_timeout:${error instanceof Error ? error.name : "unknown"}`);
  }
  const payload = await response.json().catch(() => { throw new Error(`${label}: invalid_json`); });
  if (!response.ok) throw new Error(`${label}: ${standardErrorCode(label, response.status, payload)}`);
  process.stdout.write(`${label}: ok (${Date.now() - started} ms)\n`);
  return payload;
}

async function imageBytes(payload) {
  const item = payload?.data?.[0];
  if (typeof item?.b64_json === "string") return Buffer.from(item.b64_json, "base64");
  if (typeof item?.url === "string") {
    const response = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`image_download: http_${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("image_generation: missing_url_or_b64_json");
}

async function main() {
  const textBase = required("TEXT_API_BASE_URL");
  const textKey = required("TEXT_API_KEY");
  const textModel = required("TEXT_MODEL");
  const imageBase = required("IMAGE_API_BASE_URL");
  const imageKey = required("IMAGE_API_KEY");
  const imageModel = required("IMAGE_MODEL");

  const text = await checkedFetch("chat/completions", endpoint(textBase, "chat/completions"), {
    method: "POST",
    headers: { ...authorization(textKey), "Content-Type": "application/json" },
    body: JSON.stringify({ model: textModel, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Return JSON only." }, { role: "user", content: "Return {\"ok\":true}." }] }),
  }, 30_000);
  const textContent = text?.choices?.[0]?.message?.content;
  if (typeof textContent !== "string" || JSON.parse(textContent)?.ok !== true) throw new Error("chat/completions: structured_output_invalid");

  const generated = await checkedFetch("images/generations", endpoint(imageBase, "images/generations"), {
    method: "POST",
    headers: { ...authorization(imageKey), "Content-Type": "application/json" },
    body: JSON.stringify({ model: imageModel, prompt: "An original small abstract alien creature on a plain background, no text", size: "1024x1024", response_format: "b64_json" }),
  }, 90_000);
  const parent = await imageBytes(generated);

  const form = new FormData();
  form.append("model", imageModel);
  form.append("prompt", "Keep the same creature recognisable and add one subtle new life-stage detail, no text");
  form.append("size", "1024x1024");
  form.append("response_format", "b64_json");
  form.append("image", new Blob([parent], { type: "image/png" }), "parent.png");
  const edited = await checkedFetch("images/edits", endpoint(imageBase, "images/edits"), { method: "POST", headers: authorization(imageKey), body: form }, 90_000);
  await imageBytes(edited);
  if (standardErrorCode("chat/completions", 504) !== "text_model_timeout") throw new Error("error_normalization: timeout_failed");
  if (standardErrorCode("images/generations", 400, { error: { code: "content_policy_violation" } }) !== "image_model_content_blocked") throw new Error("error_normalization: moderation_failed");
  process.stdout.write("timeout/content errors: standardized\n");
  process.stdout.write("provider compatibility: PASS\n");
}

main().catch((error) => {
  process.stderr.write(`provider compatibility: FAIL (${error instanceof Error ? error.message : "unknown"})\n`);
  process.exitCode = 1;
});
