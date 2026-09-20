import { requireSupabase } from "../lib/supabase";
import type { InteractionSettings, LifeFact } from "../../supabase/functions/_shared/companionMemoryTypes";
export type LifeMemory = LifeFact & { id: string; pet_id: string; source_message_id: string; source_date: string; version: number; state: string };
export type MemoryContext = { facts: LifeMemory[]; settings: InteractionSettings; source_ids: string[]; revision: number };
export type ForgetPreview = { fact: LifeMemory; sources: string[]; derived_facts: { id: string; kind: string; label: string }[]; private_items: { id: string; title: string; version: number; status: string }[]; shared_items: { id: string; title: string; version: number; status: string }[] };
export type MemoryReview = { days: number; since: string; facts: LifeMemory[]; private_items: { id: string; title: string; status: string; updated_at: string }[]; has_enough_sources: boolean; coverage: string };
export type ContinuationFragment = { fragment_key: string; kind: "item" | "memory"; title: string; date: string; source_message_id: string | null; item_id?: string; fact_id?: string; status?: string; phase?: string };
export async function listLifeMemories(petId: string, before?: { date: string; id: string }) {
  let query = requireSupabase().from("pet_life_facts").select("*").eq("pet_id", petId).eq("state", "active").order("source_date", { ascending: false }).order("id", { ascending: false }).limit(21);
  if (before) query = query.or(`source_date.lt.${before.date},and(source_date.eq.${before.date},id.lt.${before.id})`);
  const result = await query; if (result.error) throw result.error;
  const rows = result.data as LifeMemory[]; const page = rows.slice(0, 20);
  return { rows: page, next: rows.length > 20 ? { date: page[19].source_date, id: page[19].id } : undefined };
}
export async function getMemoryContext(petId: string): Promise<MemoryContext> {
  const state = await requireSupabase().from("pet_companion_states").select("context_started_at").eq("pet_id", petId).maybeSingle();
  if (state.error) throw state.error;
  const result = await requireSupabase().rpc("get_companion_memory_context", { target_pet_id: petId, topic_started_at: state.data?.context_started_at ?? null });
  if (result.error) throw result.error; return result.data;
}
export async function mutateMemory(command: Record<string, unknown>) {
  const result = await requireSupabase().rpc("manage_memory_evolution", { command });
  if (result.error) throw new Error(result.error.message); return result.data;
}
export async function previewForget(factId: string): Promise<ForgetPreview> {
  const result = await requireSupabase().rpc("preview_life_memory_forget", { target_fact: factId });
  if (result.error) throw result.error; return result.data;
}
export async function getMemoryReview(days: 7 | 30): Promise<MemoryReview> {
  const result = await requireSupabase().rpc("get_companion_review", { days });
  if (result.error) throw result.error; return result.data;
}
export async function getContinuation(): Promise<ContinuationFragment | null> {
  const result = await requireSupabase().rpc("get_companion_continuation"); if (result.error) throw result.error; return result.data;
}
export const PHASE_LABELS: Record<string, string> = { desired: "愿望", planned: "计划", ongoing: "进行中", happened: "本人已表达发生", pending_acceptance: "待接受", not_started: "待开始", in_progress: "进行中", pending_review: "待验收", completed: "已完成", cancelled: "已取消" };
export function memoryError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : "";
  if (message.includes("version_conflict")) return "资料已有变化，你的输入仍保留。请刷新后核对再保存。";
  if (message.includes("forbidden")) return "当前账号不能修改这条内容。";
  if (message.includes("quote_invalid")) return "名称需要出现在你填写的新表达里。";
  if (message.includes("private_item_has_children")) return "这件事项还有下级事项，请先在事项页处理；也可以保留事项，只停用记忆。";
  return "暂时没能完成，请联网后重试；尚未确认保存成功。";
}
