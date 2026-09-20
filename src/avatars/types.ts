export const AVATAR_BUCKET = "avatars";
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export type AvatarTarget = { kind: "profile" | "space"; id: string };
export type AvatarAsset = { id: string; storage_path: string; source: "upload" | "ai"; created_at: string };
export type AvatarState = { reference: string | null; version: number };
export type AvatarMember = { id: string; nickname: string; avatarUrl?: string | null; joinedAt?: string };
export type AvatarJob = { request_id: string; status: "queued" | "running" | "succeeded" | "failed"; asset_id: string | null; error_code: string | null; prompt: string };
export function avatarAssetId(reference?: string | null): string | null {
  const match = /^avatar:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(reference ?? "");
  return match?.[1] ?? null;
}
export function stableAvatarMembers(members: readonly AvatarMember[]): AvatarMember[] {
  return [...new Map(members.map(member => [member.id, member])).values()]
    .sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? "") || a.id.localeCompare(b.id)).slice(0, 9);
}
export function avatarError(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : String(reason);
  if (/version_conflict/.test(code)) return "头像已在其他设备修改，请重新打开后选择。";
  if (/request_conflict/.test(code)) return "这次请求的内容已改变，请重新选择图片。";
  if (/daily_limit/.test(code)) return "今天的 12 次图片设计额度已用完，头像与背景共用额度。";
  if (/quota/.test(code)) return "当前图片设计额度已用完，请稍后再试。";
  if (/owner_required|forbidden/.test(code)) return "只有群主可以修改群头像。";
  if (/paused|mock_disabled/.test(code)) return "图片生成服务暂不可用，仍可从相册上传。";
  if (/unauthenticated|account_changed/.test(code)) return "账号已变化，请重新打开头像设置。";
  return "暂未取得操作确认，请检查网络后重试。";
}
