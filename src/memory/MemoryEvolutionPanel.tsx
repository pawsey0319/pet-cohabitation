import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton, AppField, Surface } from "../ui/common";
import { createRequestId } from "../lib/uuid";
import { requireSupabase } from "../lib/supabase";
import { KeyboardScreen } from "../components/KeyboardLayout";
import { listLifeMemories, memoryError, mutateMemory, PHASE_LABELS, previewForget, type ForgetPreview, type LifeMemory } from "./repository";

function MemoryEvolutionContent({ petId, onSource }: { petId: string; onSource?(id: string): void }) {
  const { theme } = useAppTheme();
  const [rows, setRows] = useState<LifeMemory[]>([]);
  const [next, setNext] = useState<{ date: string; id: string }>();
  const [loadedPet, setLoadedPet] = useState(petId);
  const [preview, setPreview] = useState<ForgetPreview | null>(null);
  const [editing, setEditing] = useState<{ fact: LifeMemory; action: "correct" | "change"; quote: string; label: string; phase: LifeMemory["phase"] } | null>(null);
  const [itemAction, setItemAction] = useState<"keep" | "cancel" | "remove">("keep");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latestPet = useRef(petId); latestPet.current = petId;
  const submitted = useRef<{ signature: string; id: string } | undefined>(undefined);
  const load = useCallback(async () => {
    try { const result = await listLifeMemories(petId); if (latestPet.current !== petId) return; setRows(result.rows); setNext(result.next); setLoadedPet(petId); setError(""); }
    catch (reason) { if (latestPet.current === petId) setError(memoryError(reason)); }
  }, [petId]);
  useEffect(() => { setRows([]); setPreview(null); setEditing(null); void load(); }, [load]);
  useEffect(() => {
    const client = requireSupabase();
    const channel = client.channel(`life-memory-panel:${petId}`).on("postgres_changes", { event: "*", schema: "public", table: "pet_life_facts", filter: `pet_id=eq.${petId}` }, () => void load()).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [petId, load]);
  const perform = async (command: Record<string, unknown>) => {
    if (busy) return; setBusy(true); setError("");
    const signature = JSON.stringify(command);
    if (submitted.current?.signature !== signature) submitted.current = { signature, id: createRequestId() };
    try { await mutateMemory({ ...command, request_id: submitted.current.id }); if (latestPet.current !== petId) return; setPreview(null); setEditing(null); await load(); }
    catch (reason) { setError(memoryError(reason)); } finally { setBusy(false); }
  };
  return <View style={{ gap: 12 }}>
    <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>经历、人物与目标</Text>
    <Text style={{ color: theme.muted }}>从你的明确表达中积累，只在私下陪伴时使用。人物名称相同，也不会自动认作某位群成员。</Text>
    {loadedPet === petId && !rows.length ? <Text style={{ color: theme.muted }}>目前资料还不足，你可以自然说起自己的经历和重要的人。</Text> : null}
    {(loadedPet === petId ? rows : []).map(row => <Surface key={row.id} style={{ gap: 8 }}>
      <Text style={{ color: theme.text, fontWeight: "600" }}>{row.label} · {PHASE_LABELS[row.phase]}</Text>
      <Text selectable style={{ color: theme.text }}>“{row.quote}”</Text>
      <Text style={{ color: theme.muted }}>表达于 {new Date(row.source_date).toLocaleString("zh-CN")}</Text>
      {onSource ? <AppButton label="查看原话" variant="quiet" onPress={() => onSource(row.source_message_id)} /> : null}
      <View style={{ gap: 8 }}><AppButton label="这项理解记错了" variant="quiet" disabled={busy} onPress={() => { setError(""); setEditing({ fact: row, action: "correct", quote: "", label: row.label, phase: row.phase }); }} /><AppButton label="后来有了变化" variant="quiet" disabled={busy} onPress={() => { setError(""); setEditing({ fact: row, action: "change", quote: "", label: row.label, phase: row.phase }); }} /><AppButton label="查看忘记影响" variant="quiet" disabled={busy} onPress={() => { setError(""); setItemAction("keep"); void previewForget(row.id).then(value => { if (latestPet.current === petId) setPreview(value); }).catch(reason => setError(memoryError(reason))); }} /></View>
    </Surface>)}
    {next ? <AppButton label="更多记忆" variant="quiet" onPress={() => void listLifeMemories(petId, next).then(result => { if (latestPet.current === petId) { setRows(old => [...old, ...result.rows]); setNext(result.next); } }).catch(reason => setError(memoryError(reason)))} /> : null}
    <AppButton label="刷新记忆" variant="quiet" onPress={() => void load()} />
    <AppButton label="重试尚未整理的表达" variant="quiet" disabled={busy} onPress={() => void requireSupabase().functions.invoke("memory-evolution", { body: { action: "retry" } }).then(result => { if (result.error) throw result.error; setError("已请求重新整理；保存完成后才会显示记忆。"); }).catch(reason => setError(memoryError(reason)))} />
    {error && !preview && !editing ? <Text accessibilityRole="alert" style={{ color: theme.text }}>{error}</Text> : null}
    <Modal visible={Boolean(preview) && loadedPet === petId} transparent animationType="fade" onRequestClose={() => !busy && setPreview(null)}><View style={{ flex: 1, justifyContent: "center", padding: 20, backgroundColor: theme.overlay }}><Surface style={{ gap: 12, maxHeight: "90%" }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>忘记前看一眼影响</Text>
      <Text style={{ color: theme.text }}>{preview?.fact.label}：{preview?.fact.quote}</Text>
      <Text style={{ color: theme.muted }}>这段原话及由它形成的 {preview?.derived_facts.length ?? 0} 条记忆会停止用于回应、接续、搜索、回顾和成长。原始聊天仍可回看。</Text>
      {preview?.private_items.length ? <><Text style={{ color: theme.text }}>关联私人事项</Text>{preview.private_items.map(item => <Text key={item.id} style={{ color: theme.muted }}>{item.title} · {PHASE_LABELS[item.status]}</Text>)}{([['keep','保留事项'],['cancel','取消这些私人事项'],['remove','移除这些私人事项']] as const).map(([value, label]) => <AppButton key={value} label={label} variant={itemAction === value ? "primary" : "secondary"} onPress={() => setItemAction(value)} />)}</> : null}
      {preview?.shared_items.length ? <><Text style={{ color: theme.text }}>关联群事项需要单独处理</Text>{preview.shared_items.map(item => <Text key={item.id} style={{ color: theme.muted }}>{item.title}</Text>)}</> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.text }}>{error}</Text> : null}
      <AppButton label="确认停用这份记忆" disabled={busy} onPress={() => preview && void perform({ action: "forget", fact_id: preview.fact.id, expected_version: preview.fact.version, input: { private_items: itemAction === "keep" ? [] : preview.private_items.map(item => ({ id: item.id, expected_version: item.version, action: itemAction })) } })} />
      <AppButton label="返回" variant="quiet" disabled={busy} onPress={() => setPreview(null)} />
    </ScrollView></Surface></View></Modal>
    <Modal visible={Boolean(editing) && loadedPet === petId} transparent animationType="fade" onRequestClose={() => !busy && setEditing(null)}><KeyboardScreen style={{ flex: 1, justifyContent: "center", padding: 20, backgroundColor: theme.overlay }}><Surface style={{ gap: 12, maxHeight: "90%" }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>{editing?.action === "correct" ? "纠正理解" : "记录变化"}</Text>
      <Text style={{ color: theme.muted }}>{editing?.action === "correct" ? "错误依据停止使用，不再描述成你的真实过去。" : "保留真实的先前表达，并以这次变化作为当前理解。"}新表达会记录在你的陪伴对话中。</Text>
      <AppField label="这件事或人物名称" value={editing?.label ?? ""} maxLength={80} onChangeText={label => setEditing(current => current ? { ...current, label } : null)} />
      <AppField label="你的新表达（需要包含上面的名称）" value={editing?.quote ?? ""} maxLength={1000} multiline onChangeText={quote => setEditing(current => current ? { ...current, quote } : null)} />
      {(["desired", "planned", "ongoing", "happened"] as const).map(phase => <AppButton key={phase} label={PHASE_LABELS[phase]} variant={editing?.phase === phase ? "primary" : "secondary"} onPress={() => setEditing(current => current ? { ...current, phase } : null)} />)}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.text }}>{error}</Text> : null}
      <AppButton label="保存这次表达" disabled={busy || !editing?.quote.trim()} onPress={() => editing && void perform({ action: editing.action, fact_id: editing.fact.id, expected_version: editing.fact.version, input: { label: editing.label, quote: editing.quote, phase: editing.phase } })} />
      <AppButton label="返回" variant="quiet" disabled={busy} onPress={() => setEditing(null)} />
    </ScrollView></Surface></KeyboardScreen></Modal>
  </View>;
}
export function MemoryEvolutionPanel(props: { petId: string; onSource?(id: string): void }) { return <MemoryEvolutionContent key={props.petId} {...props} />; }
