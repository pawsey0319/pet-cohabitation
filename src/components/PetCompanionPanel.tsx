import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { newPrivateRequestId } from "../pets/requestId";
import { loadPrivateDraft, savePrivateDraft } from "../pets/privateDraft";
import { PreferenceMemoryPanel } from "./PreferenceMemoryPanel";
import type { MemoryEvidencePage, PreferenceAction, PetCompanionContext, PetPersonalMemory, PetPrivateMessage, SavePetMemoryInput } from "../data/types";
import { currentPrivateMessages, PERSONAL_MEMORY_LENGTH, PERSONAL_MEMORY_LIMIT, privateContinuation } from "../pets/companion";
import { colors, radii, spacing } from "../theme/tokens";
import { AppButton, Surface } from "../ui/common";
import { EnterSendTextInput } from "./EnterSendTextInput";

type Props = Readonly<{
  petName: string;
  ownerId?: string;
  incubating: boolean;
  portrait?: ReactNode;
  messages: readonly PetPrivateMessage[];
  context: PetCompanionContext;
  enteredAt: number;
  busy: boolean;
  onSend(content: string, requestId?: string): Promise<void>;
  onUpdatePreference?(input: PreferenceAction): Promise<void>;
  onListEvidence?(key: string, offset?: number): Promise<MemoryEvidencePage>;
  onRetryExtraction?(): Promise<void>;
  onSaveMemory(input: SavePetMemoryInput): Promise<void>;
  onRemoveMemory(id: string): Promise<void>;
  onNewConversation(): Promise<void>;
}>;

export function PetCompanionPanel(props: Props) {
  const { petName, messages, context, busy } = props;
  const [draft, setDraft] = useState("");
  const [editor, setEditor] = useState<SavePetMemoryInput | null>(null);
  const [removing, setRemoving] = useState<PetPersonalMemory | null>(null);
  const [resetting, setResetting] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [dismissedEntry, setDismissedEntry] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thread = useRef<ScrollView>(null);
  const pending = useRef(false);
  const request = useRef<{content:string;id:string}|null>(null);
  const [draftReady,setDraftReady]=useState(!props.ownerId);
  useEffect(()=>{let active=true;if(!props.ownerId)return;void loadPrivateDraft(props.ownerId).then((saved)=>{if(active&&saved){request.current=saved;setDraft(saved.content);}}).catch(()=>undefined).finally(()=>{if(active)setDraftReady(true);});return()=>{active=false;};},[props.ownerId]);
  const latestMessageId = messages.at(-1)?.id;
  useEffect(() => { thread.current?.scrollToEnd({ animated: false }); }, [latestMessageId]);
  const safeMessages = messages.filter((message)=>!context.excludedMessageIds?.includes(message.id));
  const activeMessages = currentPrivateMessages(safeMessages, context.contextStartedAt);
  const listed = showHistory ? messages : activeMessages;
  const continuation = dismissedEntry === props.enteredAt || props.incubating ? null : privateContinuation(safeMessages, context.contextStartedAt, props.enteredAt, context.preferences);

  const run = async (operation: () => Promise<void>) => {
    if (busy || pending.current || !draftReady) return;
    pending.current = true; setError(null); setNotice(null);
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "暂时没有完成，请重试"); }
    finally { pending.current = false; }
  };
  const send = (value = draft) => run(async () => {
    const text = value.trim(); if (!text) return;
    if(request.current?.content!==text) request.current={content:text,id:newPrivateRequestId()};
    if(props.ownerId) await savePrivateDraft(props.ownerId,request.current);
    try { await props.onSend(text,request.current.id); }
    catch(error){if(error instanceof Error&&error.name==="PrivateRequestNeedsNewId"){request.current={content:text,id:newPrivateRequestId()};if(props.ownerId)await savePrivateDraft(props.ownerId,request.current);}throw error;}
    request.current=null; if(props.ownerId)await savePrivateDraft(props.ownerId,null); setDraft(""); setShowHistory(false); setDismissedEntry(props.enteredAt);
  });
  const edit = (value: SavePetMemoryInput) => { setEditor(value); setError(null); setNotice(null); };
  const memoryLength = [...(editor?.content.trim() ?? "")].length;

  return <Surface style={styles.panel}>
    <View style={styles.heading}>
      {props.portrait ? <View style={styles.portrait}>{props.portrait}</View> : <View style={styles.seed}><Text style={styles.seedGlyph}>✦</Text></View>}
      <View style={styles.headingCopy}><Text style={styles.kicker}>只属于你们的对话</Text><Text style={styles.title}>和 {petName} 私聊</Text><Text style={styles.muted}>可以聊心事，也可以分享一件小事。</Text></View>
    </View>

    {continuation ? <View style={styles.reunion} accessibilityLabel="私聊接续">
      <View style={styles.row}><Text style={styles.reunionTitle}>{continuation.isReunion ? "欢迎回来，慢慢接着聊" : "上次的话，还可以接着聊"}</Text><Pressable accessibilityRole="button" accessibilityLabel="收起私聊接续" onPress={() => setDismissedEntry(props.enteredAt)}><Text style={styles.muted}>收起</Text></Pressable></View>
      <Text style={styles.muted}>上次你说 · {new Date(continuation.message.createdAt).toLocaleString("zh-CN")}</Text>
      <Text style={styles.quote} numberOfLines={3}>“{continuation.message.content}”</Text>
      <View style={styles.row}><Pressable accessibilityRole="button" disabled={busy} onPress={() => { setDraft(`我想接着聊这件事：${continuation.message.content.slice(0, 500)}`); setDismissedEntry(props.enteredAt); }}><Text style={styles.action}>接着聊这件事</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => setResetting(true)}><Text style={styles.muted}>聊点新的</Text></Pressable></View>
    </View> : null}

    <View style={styles.row}><Text style={styles.muted}>{context.contextStartedAt ? "这一段对话" : "最近的对话"}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => setResetting(true)}><Text style={styles.action}>开启新话题</Text></Pressable></View>
    {showHistory ? <Text style={styles.muted}>历史记录供你回看。新话题不会自动接续之前的对话。</Text> : null}
    <ScrollView ref={thread} style={styles.thread} contentContainerStyle={styles.messages} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {listed.length > visibleCount ? <Pressable accessibilityRole="button" onPress={() => setVisibleCount((count) => count + 20)}><Text style={styles.history}>查看更多对话</Text></Pressable> : null}
      {!listed.length ? <Text style={styles.empty}>{context.contextStartedAt ? "新的话题，从你想说的地方开始。你保存的记忆仍会保留。" : "我在这里。今天想从什么说起？"}</Text> : null}
      {listed.slice(-visibleCount).map((message) => <View key={message.id} style={[styles.bubble, message.role === "owner" ? styles.owner : styles.pet]}>
        <Text selectable style={[styles.message, message.role === "owner" && styles.ownerText]}>{message.content}</Text>
        {message.role === "owner" ? <Pressable accessibilityRole="button" accessibilityLabel={`记住这句：${message.content.slice(0, 30)}`} disabled={busy || context.memories.length >= PERSONAL_MEMORY_LIMIT} onPress={() => edit({ content: message.content, sourceMessageId: message.id })}><Text style={styles.pin}>记住这句</Text></Pressable> : null}
        {message.recallSources?.length ? <Text style={styles.source}>群聊来源：{[...new Set(message.recallSources.map((source) => source.spaceName))].join("、")}</Text> : null}
      </View>)}
      {busy ? <ActivityIndicator color={colors.mint} accessibilityLabel="正在回应" /> : null}
    </ScrollView>
    {messages.length > activeMessages.length ? <Pressable accessibilityRole="button" onPress={() => { setShowHistory((value) => !value); setVisibleCount(20); }}><Text style={styles.history}>{showHistory ? "回到当前对话" : "查看之前的聊天记录"}</Text></Pressable> : null}
    {messages.length >= 200 ? <Text style={styles.muted}>这里展示最近 200 条聊天，更多记录仍保留在账号中。</Text> : null}
    <View style={styles.composer}>
      <EnterSendTextInput accessibilityLabel="异宠私聊输入" value={draft} onChangeText={setDraft} onSend={(value) => void send(value)} editable={!busy && draftReady} maxLength={4000} placeholder={props.incubating ? "说说你喜欢怎样相处…" : "今天有什么想和它说的…"} placeholderTextColor={colors.textMuted} style={styles.input} />
      <Pressable accessibilityRole="button" accessibilityLabel="发送私聊" disabled={busy || !draftReady || !draft.trim()} onPress={() => void send()} style={[styles.send, (busy || !draft.trim()) && styles.disabled]}><Text style={styles.sendText}>发送</Text></Pressable>
    </View>
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {error && !editor && !removing && !resetting ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

    {props.onUpdatePreference && props.onListEvidence && props.onRetryExtraction ? <PreferenceMemoryPanel preferences={context.preferences??[]} pending={context.pendingExtractions??0} failed={context.failedExtractions??0} busy={busy} onUpdate={props.onUpdatePreference} onListEvidence={props.onListEvidence} onRetry={props.onRetryExtraction}/> : null}
    <View style={styles.memoryHeader}><View style={styles.headingCopy}><Text style={styles.memoryTitle}>你希望我记住的</Text><Text style={styles.muted}>仅用于你们的私聊 · {context.memories.length}/{PERSONAL_MEMORY_LIMIT} 件事</Text></View><Pressable accessibilityRole="button" onPress={() => setMemoryOpen((value) => !value)}><Text style={styles.action}>{memoryOpen ? "收起记忆" : "查看记忆"}</Text></Pressable></View>
    {memoryOpen ? <View style={styles.memoryList}>
      {!context.memories.length ? <Text style={styles.muted}>还没有保存的记忆。由你决定哪些偏好或经历值得留下。</Text> : null}
      {context.memories.map((memory) => <View key={memory.id} style={styles.memory}>
        <Text style={styles.message}>{memory.content}</Text>
        <Text style={styles.source}>{memory.sourceMessageId ? "来自你标记的私聊" : "由你亲手记下"} · {new Date(memory.updatedAt).toLocaleDateString("zh-CN")}</Text>
        {memory.sourceMessageId&&context.excludedMessageIds?.includes(memory.sourceMessageId)?<Text style={styles.source}>关联来源已停用，不用于回应。手动编辑可以重新确认内容。</Text>:null}
        <View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel={`编辑记忆：${memory.content}`} disabled={busy} onPress={() => edit({ id: memory.id, content: memory.content, sourceMessageId: memory.sourceMessageId })}><Text style={styles.action}>编辑</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`移出记忆：${memory.content}`} disabled={busy} onPress={() => { setError(null); setRemoving(memory); }}><Text style={styles.remove}>移出记忆</Text></Pressable></View>
        {(context.manualHistory??[]).filter((item)=>item.memoryId===memory.id).slice(0,3).map((item)=><Text key={item.id} style={styles.source}>过去版本 · {new Date(item.createdAt).toLocaleDateString("zh-CN")}：{item.content}</Text>)}
      </View>)}
    </View> : null}
    <AppButton label="记下一件事" variant="quiet" disabled={busy || context.memories.length >= PERSONAL_MEMORY_LIMIT} onPress={() => edit({ content: "" })} />

    <Modal visible={Boolean(editor)} transparent animationType="fade" onRequestClose={() => { if (!busy) setEditor(null); }}>
      <View style={styles.overlay}><Surface style={styles.modal}>
        <Text style={styles.title}>{editor?.id ? "更新这条记忆" : "你希望它记住什么？"}</Text>
        <Text style={styles.muted}>{editor?.id ? "更新后按你的最新想法回应，过去的版本保留作变化记录。当前话题可以继续。" : "写下一个偏好、一件经历，或你喜欢的相处方式。保存后可随时编辑。"}</Text>
        <TextInput accessibilityLabel="个人记忆内容" value={editor?.content ?? ""} onChangeText={(content) => setEditor((value) => value ? { ...value, content } : value)} multiline style={[styles.input, styles.memoryInput]} placeholder="例如：我累的时候，先听我说，别急着给建议。" placeholderTextColor={colors.textMuted} editable={!busy} />
        <Text style={memoryLength > PERSONAL_MEMORY_LENGTH ? styles.error : styles.muted}>{memoryLength}/{PERSONAL_MEMORY_LENGTH} 字{memoryLength > PERSONAL_MEMORY_LENGTH ? "，请选取最想留下的部分" : ""}</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.buttons}><AppButton label="取消" variant="quiet" disabled={busy} onPress={() => setEditor(null)} /><AppButton label="保存记忆" disabled={busy || !memoryLength || memoryLength > PERSONAL_MEMORY_LENGTH} onPress={() => void run(async () => { if (!editor) return; await props.onSaveMemory(editor); setEditor(null); setMemoryOpen(true); setNotice("已经记下。以后可以按你的最新想法更新。"); })} /></View>
      </Surface></View>
    </Modal>
    <Modal visible={Boolean(removing) || resetting} transparent animationType="fade" onRequestClose={() => { if (!busy) { setRemoving(null); setResetting(false); } }}>
      <View style={styles.overlay}><Surface style={styles.modal}>
        <Text style={styles.title}>{removing ? "把这件事移出记忆？" : "从一个新话题开始"}</Text>
        <Text style={styles.muted}>{removing ? "这条保存的记忆会被删除，已关联内容不再用于后续回应。原始聊天仍可回看，其他话题可以继续。" : "之前的聊天仍可回看，接下来不会自动接着旧话题。你主动保存的记忆会保留。"}</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.buttons}><AppButton label="取消" variant="quiet" disabled={busy} onPress={() => { setRemoving(null); setResetting(false); }} /><AppButton label={removing ? "确认移出记忆" : "开始新话题"} disabled={busy} onPress={() => void run(async () => { if (removing) { await props.onRemoveMemory(removing.id); setNotice("已经移出保存的记忆，其他话题可以继续。"); } else { await props.onNewConversation(); setDraft(""); request.current=null; if(props.ownerId)await savePrivateDraft(props.ownerId,null); setNotice("我们从这里重新开始。之前的聊天仍可回看。"); } setRemoving(null); setResetting(false); setShowHistory(false); setDismissedEntry(props.enteredAt); })} /></View>
      </Surface></View>
    </Modal>
  </Surface>;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md }, heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, headingCopy: { flex: 1, gap: 5 }, portrait: { width: 64, height: 64, overflow: "hidden", borderRadius: 20 }, seed: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.mintDeep, alignItems: "center", justifyContent: "center" }, seedGlyph: { color: colors.mint, fontSize: 28 },
  kicker: { color: colors.mint, fontSize: 11 }, title: { color: colors.text, fontSize: 20, fontWeight: "800" }, muted: { color: colors.textMuted, fontSize: 12, lineHeight: 19 }, row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" }, action: { color: colors.mint, fontSize: 13, fontWeight: "700", paddingVertical: 4 },
  reunion: { backgroundColor: colors.mintDeep, borderRadius: radii.md, padding: spacing.md, gap: 8 }, reunionTitle: { color: colors.text, fontWeight: "800" }, quote: { color: colors.text, lineHeight: 22 },
  thread: { maxHeight: 340 }, messages: { gap: 10, paddingVertical: 5 }, empty: { color: colors.textMuted, paddingVertical: 18, lineHeight: 23 }, bubble: { maxWidth: "90%", borderRadius: 16, padding: 12, gap: 7 }, owner: { alignSelf: "flex-end", backgroundColor: colors.coralSoft }, pet: { alignSelf: "flex-start", backgroundColor: colors.mintDeep }, message: { color: colors.text, lineHeight: 22 }, ownerText: { color: colors.textDark }, pin: { color: colors.textDark, fontSize: 11, paddingVertical: 3 }, source: { color: colors.textMuted, fontSize: 11, lineHeight: 18 }, history: { color: colors.mint, textAlign: "center", fontSize: 12, padding: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 }, input: { flex: 1, minHeight: 48, maxHeight: 120, padding: 12, backgroundColor: colors.surface, borderRadius: 14, color: colors.text, textAlignVertical: "top" }, send: { minHeight: 48, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center" }, sendText: { color: colors.white, fontWeight: "800" }, disabled: { opacity: .4 },
  memoryHeader: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md }, memoryTitle: { color: colors.text, fontSize: 15, fontWeight: "800" }, memoryList: { gap: 10 }, memory: { backgroundColor: colors.surface, borderRadius: 14, padding: 12, gap: 8 }, remove: { color: colors.coralSoft, fontSize: 12, paddingVertical: 4 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(4,3,13,.82)", padding: spacing.md }, modal: { width: "100%", maxWidth: 480, gap: spacing.md }, memoryInput: { flex: 0, minHeight: 120, maxHeight: 240 }, buttons: { flexDirection: "row", justifyContent: "flex-end", gap: 8 }, notice: { color: colors.mint, fontSize: 12, lineHeight: 20 }, error: { color: colors.coralSoft, fontSize: 12, lineHeight: 20 },
});
