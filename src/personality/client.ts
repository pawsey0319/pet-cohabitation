import { requireSupabase } from "../lib/supabase";
import type { LearnedStyle, StyleTrait } from "../../supabase/functions/_shared/personalityDomain";
export { STYLE_LABELS, STYLE_TRAITS } from "../../supabase/functions/_shared/personalityDomain";
export type PersonalityState = { pet_id: string; owner_id: string; paused: boolean; blocked_traits: StyleTrait[]; revision: number; styles: LearnedStyle[]; reset_at: string | null; last_learned_day: string | null };
export type PersonalityEvidence = { id: string; source_kind: "private" | "space"; source_id: string; space_id: string | null; trait: StyleTrait; quote: string | null; state: string; source_date: string; confidence: number };
export type Relationship = { id: string; space_id: string; subject_id: string; object_id: string; speaker_id: string; source_id: string; relation: string | null; quote: string | null; assertion: string; state: string; source_date: string; owner_correction: string | null };
export type PersonalitySnapshot = { seed: string | null; state: PersonalityState; evidence: PersonalityEvidence[]; history: { id: string; revision: number; previous_styles: LearnedStyle[]; styles: LearnedStyle[]; reason: string; created_at: string }[]; relationships: Relationship[]; jobs: { id: string; kind: string; status: string; attempts: number; error_code: string | null }[]; page: number; page_size: number };
export type RelationshipConsent = { pet: { id: string; owner_id: string; name: string }; scope: { epoch: number; revision: number; enabled_at: string | null } | null; votes: { member_id: string; epoch: number; consented: boolean }[]; members: { user_id: string; profiles: { nickname: string } | { nickname: string }[] | null }[]; enabled: boolean };
export async function personalityRequest<T>(owner: string, body: Record<string, unknown>, endpoint = "pet-personality"): Promise<T> {
  const client = requireSupabase();
  const session = await client.auth.getSession();
  if (session.error || session.data.session?.user.id !== owner) throw new Error("account_changed");
  const response = await client.functions.invoke(endpoint, { body, headers: { Authorization: `Bearer ${session.data.session.access_token}` } });
  if (response.error) {
    let code = "personality_unavailable";
    try { const payload = await (response.error as unknown as { context: Response }).context.json(); code = payload.error ?? code; } catch { /* Keep request identity for retry. */ }
    throw new Error(code);
  }
  const current = await client.auth.getSession();
  if (current.data.session?.user.id !== owner) throw new Error("account_changed");
  if (response.data?.error) throw new Error(response.data.error);
  return response.data as T;
}
export function personalityError(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : String(reason);
  if (/version|revision|conflict/.test(code)) return "其他设备已经修改，请刷新后按最新状态再操作。";
  if (/account_changed|unauthenticated/.test(code)) return "账号已变化，请重新打开页面。";
  if (/not_space_member|forbidden|pet_not_in_space/.test(code)) return "当前已无权使用这份群资料，请返回群聊确认成员身份。";
  if (/retry_not_available/.test(code)) return "这项后台任务的状态已经改变，请刷新查看。";
  return "暂未取得服务端确认，内容仍保留，请稍后重试。";
}
