import { usePetSectionFocusEffect } from "../src/pets/PetSectionScope";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { PetFeatureScreen } from "../src/navigation/PetFeatureScreen";
import { OwnedPetGate, useOwnedPet } from "../src/navigation/useOwnedPet";
import { PreferenceMemoryPanel } from "../src/components/PreferenceMemoryPanel";
import { KeyboardScreen, KeyboardTextInput } from "../src/components/KeyboardLayout";
import { MemoryEvolutionPanel } from "../src/memory/MemoryEvolutionPanel";
import { MemorySourceModal, type MemorySourceTarget } from "../src/memory/MemorySourceModal";
import { PERSONAL_MEMORY_LENGTH, PERSONAL_MEMORY_LIMIT } from "../src/pets/companion";
import type { PetRepository } from "../src/data/petRepository";
import type { PetCompanionContext, PetPersonalMemory, SavePetMemoryInput } from "../src/data/types";
import { AppButton, Surface } from "../src/ui/common";
import { useAppTheme } from "../src/theme/ThemeProvider";

function MemoryManager({ ownerId, petId, repository, local }: { ownerId: string; petId: string; repository: PetRepository; local: boolean }) {
  const { theme } = useAppTheme(); const active = useRef(true);
  const [context, setContext] = useState<PetCompanionContext | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [editor, setEditor] = useState<SavePetMemoryInput | null>(null), [removing, setRemoving] = useState<PetPersonalMemory | null>(null);
  const [source, setSource] = useState<MemorySourceTarget | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = useCallback(async () => { try { const next = await repository.getCompanionContext(); if (active.current) { setContext(next); setError(""); } } catch { if (active.current) setError("记忆暂时未加载，请稍后重试。"); } }, [repository]);
  usePetSectionFocusEffect(useCallback(() => { void load(); }, [load]));
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return; setBusy(true); setError("");
    try { await operation(); if (!active.current) return; setEditor(null); setRemoving(null); await load(); }
    catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : "这次修改尚未确认，请重试。"); throw reason; }
    finally { if (active.current) setBusy(false); }
  };
  usePetSectionFocusEffect(useCallback(() => repository.subscribe(() => { void load(); }), [repository, load]));
  const length = [...(editor?.content.trim() ?? "")].length;
  return <>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}
    {!context ? <View style={{ gap: 12 }}>{!error ? <ActivityIndicator color={theme.accent} /> : null}<AppButton label="重新加载记忆" onPress={() => void load()} /></View> : <>
      <PreferenceMemoryPanel preferences={context.preferences ?? []} pending={context.pendingExtractions ?? 0} failed={context.failedExtractions ?? 0} busy={busy}
        onUpdate={input => run(() => repository.updatePreference(input))} onListEvidence={(key, offset) => repository.listMemoryEvidence(key, offset)} onRetry={() => run(() => repository.retryMemoryExtraction())} />
      {!local ? <MemoryEvolutionPanel petId={petId} onSource={id => setSource({ kind: "message", id })} /> : null}
      <Surface style={{ gap: 12 }}><Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>你主动保存的记忆</Text><Text style={{ color: theme.muted }}>{context.memories.length}/{PERSONAL_MEMORY_LIMIT} 条 · 每条最多 {PERSONAL_MEMORY_LENGTH} 字</Text>
        {!context.memories.length ? <Text style={{ color: theme.muted, lineHeight: 23 }}>把希望它长期记住的偏好或经历放在这里。自动积累的依据单独保存。</Text> : null}
        {context.memories.map(memory => <View key={memory.id} style={{ gap: 8, borderTopWidth: 1, borderColor: theme.line, paddingTop: 12 }}>
          <Text style={{ color: theme.text, fontSize: 16, lineHeight: 25 }}>{memory.content}</Text>
          <Text style={{ color: theme.muted, fontSize: 13 }}>{new Date(memory.updatedAt).toLocaleDateString("zh-CN")} · {memory.sourceMessageId ? "来自你标记的私聊" : "由你主动保存"}</Text>
          {memory.sourceMessageId && context.excludedMessageIds?.includes(memory.sourceMessageId) ? <Text style={{ color: theme.muted }}>关联原话已停用，不会用于后续回应。</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {memory.sourceMessageId && !local ? <AppButton label="查看原话" variant="quiet" onPress={() => setSource({ kind: "message", id: memory.sourceMessageId! })} /> : null}
            <AppButton label="纠正" variant="quiet" disabled={busy} onPress={() => setEditor({ id: memory.id, content: memory.content, sourceMessageId: memory.sourceMessageId })} />
            <AppButton label="忘记" variant="quiet" disabled={busy} onPress={() => setRemoving(memory)} />
          </View>
          {(context.manualHistory ?? []).filter(item => item.memoryId === memory.id).slice(0, 3).map(item => <Text key={item.id} style={{ color: theme.muted, fontSize: 13 }}>过去版本 · {new Date(item.createdAt).toLocaleDateString("zh-CN")}：{item.content}</Text>)}
        </View>)}
        <AppButton label="记下一件事" disabled={busy || context.memories.length >= PERSONAL_MEMORY_LIMIT} onPress={() => setEditor({ content: "" })} />
      </Surface>
    </>}
    <Modal visible={!!editor || !!removing} transparent animationType="fade" onRequestClose={() => { if (!busy) { setEditor(null); setRemoving(null); } }}>
      <KeyboardScreen style={{ flex: 1, backgroundColor: theme.overlay, alignItems: "center", justifyContent: "center", padding: 16 }}><Surface style={{ width: "100%", maxWidth: 560, gap: 12 }}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>{removing ? "忘记这条记忆？" : editor?.id ? "纠正记忆" : "记下一件事"}</Text>
        {removing ? <Text style={{ color: theme.text, lineHeight: 24 }}>保存的记忆和已关联内容将停止用于后续回应。原始聊天仍可回看，其他话题可以继续。</Text> : <>
          <KeyboardTextInput accessibilityLabel="个人记忆内容" value={editor?.content ?? ""} onChangeText={content => setEditor(value => value ? { ...value, content } : value)} multiline editable={!busy} style={{ color: theme.text, borderWidth: 1, borderColor: theme.line, borderRadius: 8, padding: 12, minHeight: 100, maxHeight: 220 }} />
          <Text style={{ color: length > PERSONAL_MEMORY_LENGTH ? theme.danger : theme.muted }}>{length}/{PERSONAL_MEMORY_LENGTH} 字 · 修改后不会开启新话题</Text>
        </>}
        {error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}><AppButton label="取消" variant="quiet" disabled={busy} onPress={() => { setEditor(null); setRemoving(null); }} /><AppButton label={removing ? "确认忘记" : "保存记忆"} disabled={busy || !removing && (!length || length > PERSONAL_MEMORY_LENGTH)} onPress={() => void run(() => removing ? repository.removePersonalMemory(removing.id) : repository.savePersonalMemory(editor!)).catch(() => undefined)} /></View>
      </Surface></KeyboardScreen>
    </Modal>
    {!local ? <MemorySourceModal ownerId={ownerId} petId={petId} target={source} onClose={() => setSource(null)} /> : null}
  </>;
}
export function PetMemoryPanel() {
  const state = useOwnedPet(); const pet = state.dashboard?.pet;
  return <PetFeatureScreen title="它记住的你" description="当前理解、过去变化和原话依据分开保存。你可以随时纠正、忘记或标记重要。"><OwnedPetGate state={state}>{pet && state.profile && state.repository ? <MemoryManager key={`${state.profile.id}:${pet.id}`} ownerId={state.profile.id} petId={pet.id} repository={state.repository} local={state.isLocalDemo} /> : null}</OwnedPetGate></PetFeatureScreen>;
}

export default function LegacyPetRoute() { const params = useLocalSearchParams(); return <Redirect href={{ pathname: "/pet", params: { ...params, section: "memory" } }} />; }
