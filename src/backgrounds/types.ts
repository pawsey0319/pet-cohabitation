export type ChatThreadKey = "global" | "companion" | "steward" | `group:${string}` | `agent:${string}`;
export type BackgroundPalette = "warm" | "sage" | "slate";
export type ChatBackgroundSelection = Readonly<{ presetId: string | null; assetId: string | null; palette: BackgroundPalette }>;
export type ChatBackgroundAsset = Readonly<{ id: string; storage_path: string; source: "ai" | "upload"; prompt: string | null; created_at: string; name?: string; favorite?: boolean; version?: number; content_version?: number; parent_asset_id?: string | null; parent_asset_version?: number | null }>;
export type BackgroundGeneration = Readonly<{ request_id: string; prompt: string; status: "queued" | "running" | "uploading" | "succeeded" | "failed"; asset_id: string | null; error_code: string | null; created_at: string; parent_asset_id?: string | null; parent_asset_version?: number | null }>;
export const BACKGROUND_BUCKET = "chat-backgrounds";
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;
export const DEFAULT_BACKGROUND: ChatBackgroundSelection = { presetId: "paper", assetId: null, palette: "warm" };
export const BACKGROUND_PRESETS = [
  { id: "paper", name: "素纸", light: "#F5F4F1", dark: "#242522", palette: "warm" },
  { id: "mist", name: "薄雾", light: "#EDF2EF", dark: "#202925", palette: "sage" },
  { id: "dusk", name: "远山", light: "#EEF0F4", dark: "#242830", palette: "slate" },
  { id: "sand", name: "暖砂", light: "#F5EDE5", dark: "#302923", palette: "warm" },
] as const;

export function normalizeThreadKey(value?: string, allowLocal = false): ChatThreadKey {
  if (!value || value === "global") return "global";
  if (value === "companion" || value === "steward" || /^(group|agent):[0-9a-f-]{36}$/i.test(value)) return value as ChatThreadKey;
  if (allowLocal && /^(group|agent):local-(pair|circle|space-\d+)$/.test(value)) return value as ChatThreadKey;
  throw new Error("聊天背景位置无效，请重新打开页面。");
}

export function normalizeBackground(value: unknown): ChatBackgroundSelection | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const presetId = typeof row.presetId === "string" && BACKGROUND_PRESETS.some((preset) => preset.id === row.presetId) ? row.presetId : null;
  const assetId = typeof row.assetId === "string" && /^[0-9a-f-]{36}$/i.test(row.assetId) ? row.assetId : null;
  if (Boolean(presetId) === Boolean(assetId)) return null;
  return { presetId, assetId, palette: row.palette === "sage" || row.palette === "slate" ? row.palette : "warm" };
}

export function resolveBackground(settings: Record<string, ChatBackgroundSelection>, key?: string, allowLocal = false): ChatBackgroundSelection {
  // Unresolved navigation params must not crash the underlying chat screen.
  try { return settings[normalizeThreadKey(key,allowLocal)] ?? settings.global ?? DEFAULT_BACKGROUND; }
  catch { return settings.global ?? DEFAULT_BACKGROUND; }
}

export function backgroundColors(selection: ChatBackgroundSelection, dark: boolean) {
  const preset = BACKGROUND_PRESETS.find((entry) => entry.id === selection.presetId) ?? BACKGROUND_PRESETS[0];
  const palettes = dark
    ? { warm: { userBubble: "#6B4433", userText: "#FFF4EC" }, sage: { userBubble: "#314C3C", userText: "#F0F9F2" }, slate: { userBubble: "#36465F", userText: "#F2F6FF" } }
    : { warm: { userBubble: "#F0D9C9", userText: "#462F22" }, sage: { userBubble: "#D7E7DA", userText: "#253C2D" }, slate: { userBubble: "#D9E2F0", userText: "#27364D" } };
  return { background: dark ? preset.dark : preset.light, ...palettes[selection.palette], bubble: dark ? "#292B2A" : "#FFFFFF", text: dark ? "#F5F5F2" : "#202522", overlay: dark ? "rgba(13,17,17,0.46)" : "rgba(255,255,255,0.23)" };
}

export function backgroundErrorMessage(code: string): string {
  if (code === "background_legacy_review_required") return "这次任务已有生成记录，需核对后继续。相关图片已保留。";
  if (/unauthenticated|JWT|session/i.test(code)) return "登录已过期，请重新登录后再试。";
  if (/quota|daily_limit/i.test(code)) return "今天的图片设计次数已用完；头像与背景共用每天 12 次额度。";
  if (/edit_unavailable/.test(code)) return "原图编辑暂未启用，可以继续上传或生成新背景。";
  if (/version_conflict|impact_changed/.test(code)) return "背景或使用范围已变化，请刷新后重新确认。";
  if (/parent_deleted|asset_deleted|source_unavailable/.test(code)) return "这张原图已删除或不可用，请选择另一张图片。";
  if (/generation_busy/.test(code)) return "还有一张背景正在生成，请等待完成。";
  if (/paused|demo_test_ended/.test(code)) return "AI 设计暂时不可用，请稍后再试。";
  if (/mock_disabled/.test(code)) return "AI 设计尚未开启，请稍后再试。";
  if (/timeout|timed_out/i.test(code)) return "这次生成等得有些久，请重新生成。";
  if (/invalid_image|missing_output|invalid_output/.test(code)) return "这次未得到可用的图片，请修改描述后重试。";
  if (/content_blocked|http_400/.test(code)) return "这段描述暂时无法生成图片，请换一种描述。";
  if (/http_401|http_403|provider_session|not_configured/.test(code)) return "AI 设计暂时无法连接，请稍后再试。";
  if (/http_429|rate_limited/.test(code)) return "现在使用的人有些多，请稍后再试。";
  if (/network|fetch|connect|relay/i.test(code)) return "暂时连接不上，请检查网络后重试。";
  if (/request_conflict/.test(code)) return "这次描述已改变，请重新生成。";
  return "暂时未能完成，请稍后重试。";
}
