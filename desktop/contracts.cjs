"use strict";
const METHODS = new Set(["state", "login", "logout", "start", "hide", "show", "stop", "resize", "openApp", "send", "retry", "stopReply", "drag", "hit", "chat", "closeChat", "menu"]);
function validate(method, body = {}) {
  if (!METHODS.has(method) || !body || typeof body !== "object" || Array.isArray(body)) throw Error("desktop_request_invalid");
  if (method === "login" && (typeof body.email !== "string" || body.email.length > 320 || !body.email.includes("@") || typeof body.password !== "string" || !body.password || body.password.length > 1024)) throw Error("请输入账号和密码。");
  if (method === "send" && (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.id) || typeof body.content !== "string" || !body.content.trim() || body.content.length > 4000)) throw Error("消息格式无效或超过 4000 字。");
  if (["retry", "stopReply"].includes(method) && (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.id))) throw Error("请求标识无效。");
  if (method === "resize" && (!Number.isFinite(body.size) || body.size < 72 || body.size > 240)) throw Error("桌宠尺寸无效。");
  if (method === "drag" && (![body.x, body.y].every(Number.isFinite) || Math.abs(body.x) > 50_000 || Math.abs(body.y) > 50_000)) throw Error("桌宠位置无效。");
  if (method === "hit" && typeof body.opaque !== "boolean") throw Error("desktop_hit_invalid");
  return body;
}
function clampBounds(position, displays, size) {
  const containing = displays.find(({ workArea: r }) => position && position.x + size > r.x && position.x < r.x + r.width && position.y + size > r.y && position.y < r.y + r.height);
  const rect = (containing || displays[0]).workArea;
  const x = Number.isFinite(position?.x) ? position.x : rect.x + rect.width - size - 24;
  const y = Number.isFinite(position?.y) ? position.y : rect.y + rect.height * 0.45;
  return { x: Math.round(Math.min(Math.max(x, rect.x), rect.x + Math.max(0, rect.width - size))), y: Math.round(Math.min(Math.max(y, rect.y), rect.y + Math.max(0, rect.height - size))), width: size, height: size };
}
function approvedImage(display, assetId, origin) {
  const pref = display?.preference;
  if (!display?.url || !pref?.use_transparent || display.job?.status !== "succeeded" || display.source_asset_id !== assetId || pref.approved_source_asset_id !== assetId || pref.approved_job_id !== display.job.id || pref.approved_display_version !== pref.version || !pref.approved_at) throw Error("请先在 App 中预览并确认透明本体，再开启桌宠。");
  const url = new URL(display.url);
  if (url.origin !== new URL(origin).origin || url.protocol !== "https:" || !url.pathname.startsWith("/storage/v1/object/sign/")) throw Error("透明形象地址无效。");
  return url.href;
}
function upsertRequest(rows, input) {
  validate("send", input);
  const existing = rows.find(row => row.id === input.id);
  if (existing && existing.content !== input.content) throw Error("同一请求不能替换内容。");
  if (existing) return rows.map(row => row.id === input.id ? { ...row, state: "queued", error: undefined } : row);
  if (rows.length >= 50) throw Error("等待消息过多，请先处理失败的消息。");
  return [...rows, { id: input.id, content: input.content, state: "queued" }];
}
function validatePublicConfig(config) {
  if (!config || new URL(config.supabaseUrl).protocol !== "https:" || new URL(config.publicAppUrl).protocol !== "https:" || typeof config.publishableKey !== "string") throw Error("桌宠公开配置无效。");
  if (Object.keys(config).some(key => !["supabaseUrl", "publishableKey", "publicAppUrl"].includes(key))) throw Error("桌宠配置只能包含公开客户端字段。");
  if (!config.publishableKey.startsWith("sb_publishable_")) {
    let role; try { role = JSON.parse(Buffer.from(config.publishableKey.split(".")[1], "base64url").toString("utf8")).role; } catch {}
    if (role !== "anon") throw Error("只能打包 publishable / anon 客户端密钥。");
  }
  return config;
}
module.exports = { validate, clampBounds, approvedImage, upsertRequest, validatePublicConfig };
