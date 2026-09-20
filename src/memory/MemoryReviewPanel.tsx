import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { createRequestId } from "../lib/uuid";
import { requireSupabase } from "../lib/supabase";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton, Surface } from "../ui/common";
import { getContinuation, getMemoryReview, memoryError, mutateMemory, PHASE_LABELS, type ContinuationFragment, type MemoryReview } from "./repository";

function MemoryReviewContent({ petId, onSource }: { petId: string; onSource?(id: string): void }) {
  const { theme } = useAppTheme();
  const [review, setReview] = useState<MemoryReview | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(petId); active.current = petId;
  useEffect(() => { setReview(null); setOpen(false); }, [petId]);
  const load = async (days: 7 | 30) => {
    if (busy) return; setBusy(true); setError("");
    try { const data = await getMemoryReview(days); if (active.current === petId) { setReview(data); setOpen(true); } }
    catch (reason) { setError(memoryError(reason)); } finally { setBusy(false); }
  };
  return <View style={{ gap: 12 }}>
    <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>一起回顾</Text>
    <View style={{ gap: 8 }}><AppButton label="看看近 7 天" variant="secondary" disabled={busy} onPress={() => void load(7)} /><AppButton label="看看近 30 天" variant="secondary" disabled={busy} onPress={() => void load(30)} /></View>
    {error ? <Text style={{ color: theme.text }}>{error}</Text> : null}
    {open && review ? <>
      <Text style={{ color: theme.muted }}>{review.has_enough_sources ? "这些内容来自你确实表达过的事情和私人事项记录。表达日期不等同现实发生日期。" : "这段时间的资料还不足，不补写没有依据的经历。"}</Text>
      {review.facts.map(fact => <Surface key={fact.id} style={{ gap: 8 }}><Text style={{ color: theme.text }}>{fact.quote}</Text><Text style={{ color: theme.muted }}>{PHASE_LABELS[fact.phase]} · 表达于 {new Date(fact.source_date).toLocaleDateString("zh-CN")}</Text>{onSource ? <AppButton label="查看原话" variant="quiet" onPress={() => onSource(fact.source_message_id)} /> : null}</Surface>)}
      {review.private_items.map(item => <Surface key={item.id}><Text style={{ color: theme.text }}>{item.title} · {PHASE_LABELS[item.status]}</Text><Text style={{ color: theme.muted }}>更新于 {new Date(item.updated_at).toLocaleDateString("zh-CN")}</Text></Surface>)}
      <AppButton label="收起回顾" variant="quiet" onPress={() => { setOpen(false); setReview(null); }} />
    </> : null}
  </View>;
}

function MemoryContinuationContent({ petId, onContinue, onNewTopic }: { petId: string; onContinue(fragment: ContinuationFragment): void; onNewTopic(): void }) {
  const { theme } = useAppTheme();
  const [fragment, setFragment] = useState<ContinuationFragment | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; setFragment(null); void getContinuation().then(value => { if (active) setFragment(value); }).catch(() => undefined); return () => { active = false; }; }, [petId]);
  if (!fragment) return null;
  const dismiss = async () => { try { await mutateMemory({ action: "dismiss", request_id: createRequestId(), input: { fragment_key: fragment.fragment_key } }); setFragment(null); } catch (reason) { setError(memoryError(reason)); } };
  return <Surface style={{ gap: 8 }}><Text style={{ color: theme.text }}>{fragment.title}</Text><Text style={{ color: theme.muted }}>{PHASE_LABELS[fragment.status ?? fragment.phase ?? ""]} · {new Date(fragment.date).toLocaleDateString("zh-CN")}</Text>{error ? <Text style={{ color: theme.text }}>{error}</Text> : null}<AppButton label="接着聊" variant="secondary" onPress={() => onContinue(fragment)} /><AppButton label="收起这段接续" variant="quiet" onPress={() => void dismiss()} /><AppButton label="开启新话题" variant="quiet" onPress={onNewTopic} /></Surface>;
}
export function MemoryReviewPanel(props: { petId: string; onSource?(id: string): void }) { return <MemoryReviewContent key={props.petId} {...props} />; }
export function MemoryContinuationCard(props: { petId: string; onContinue(fragment: ContinuationFragment): void; onNewTopic(): void }) { return <MemoryContinuationContent key={props.petId} {...props} />; }

/** Batch once per message page; merely viewing history never starts extraction. */
export async function getLifeMemoryNotices(sourceIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(sourceIds)].slice(0, 50); if (!ids.length) return {};
  const result = await requireSupabase().from("pet_life_facts").select("source_message_id").eq("state", "active").in("source_message_id", ids).limit(250);
  if (result.error) throw result.error;
  return (result.data ?? []).reduce<Record<string, number>>((counts, row) => { counts[row.source_message_id] = (counts[row.source_message_id] ?? 0) + 1; return counts; }, {});
}
export function MemorySavedIndicator({ count, onOpen }: { count: number; onOpen(): void }) {
  const { theme } = useAppTheme();
  if (count < 1) return null;
  return <Pressable accessibilityRole="button" onPress={onOpen}><Text style={{ color: theme.muted, fontSize: 12 }}>从这条表达记下了 {count} 项 · 查看与纠正</Text></Pressable>;
}
