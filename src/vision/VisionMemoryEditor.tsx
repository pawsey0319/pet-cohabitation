import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardScreen, KeyboardScrollView, KeyboardTextInput } from "../components/KeyboardLayout";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { createRequestId } from "../lib/uuid";
import { previewVisionMemory, visionRequest } from "./repository";
import { visionError, type VisionAsset, type VisionMemoryDraft } from "./types";
export function VisionMemoryEditor(props: { visible: boolean; asset: VisionAsset; sourceMessageId: string; onClose(): void; onSaved?(): void }) {
 const { profile } = useSession(); return props.visible && profile ? <Editor key={`${profile.id}:${props.asset.id}`} {...props} ownerId={profile.id} /> : null;
}
function Editor({ ownerId, asset, sourceMessageId, onClose, onSaved }: { ownerId: string; asset: VisionAsset; sourceMessageId: string; onClose(): void; onSaved?(): void }) {
 const { theme } = useAppTheme(); const [content, setContent] = useState(""); const [draft, setDraft] = useState<VisionMemoryDraft | null>(null); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<string | null>(null);
 const active = useRef(true); const requests = useRef(new Map<string, string>());
 useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
 const idFor = (key: string) => { const id = requests.current.get(key) ?? createRequestId(); requests.current.set(key, id); return id; };
 const run = async (action: () => Promise<void>) => { setBusy(true); setNotice(null); try { await action(); } catch (reason) { if (active.current) setNotice(visionError(reason)); } finally { if (active.current) setBusy(false); } };
 const preview = () => run(async () => { const result = await previewVisionMemory(ownerId, asset, sourceMessageId, content.trim(), idFor(`preview:${content.trim()}`)); if (active.current) setDraft(result.draft); });
 const confirm = () => run(async () => { if (!draft) return; const result = await visionRequest<{ outcome: string }>(ownerId, { action: "confirm_memory", request_id: idFor(`confirm:${draft.id}:${draft.version}`), draft_id: draft.id, expected_version: draft.version }); if (active.current && result.outcome === "memory_created") { setNotice("已保存为你确认的私人记忆。"); setDraft({ ...draft, state: "confirmed" }); onSaved?.(); } });
 const button = (text: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={action} style={{ minHeight: 44, padding: 10 }}><Text style={{ color: theme.primary }}>{text}</Text></Pressable>;
 return <Modal visible animationType="slide" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, backgroundColor: theme.page }}><KeyboardScreen style={{ flex: 1 }}><KeyboardScrollView contentContainerStyle={{ padding: 20, gap: 12 }}><Text style={{ color: theme.text, fontSize: 20, fontWeight: "600" }}>确认图片记忆</Text><Text style={{ color: theme.muted }}>写下你希望保存的内容，可以从回答中摘选并纠正。只有你确认后，才会加入私人记忆。</Text>{draft ? <View style={{ gap: 8 }}><Text style={{ color: theme.text, lineHeight: 23 }}>{draft.content}</Text><Text style={{ color: theme.muted }}>依据：这张图片及你的本次确认。请核对人物、时间和经历，图片识别可能有误。</Text>{draft.state === "pending" ? <>{button("确认保存", () => void confirm())}{button("修改内容", () => setDraft(null))}</> : null}</View> : <><KeyboardTextInput accessibilityLabel="拟保存的图片记忆" multiline value={content} onChangeText={setContent} maxLength={400} style={{ minHeight: 120, color: theme.text, padding: 12, borderRadius: 8, backgroundColor: theme.card }} />{button("预览拟保存内容", () => void preview(), !content.trim())}</>}{notice ? <Text accessibilityLiveRegion="polite" style={{ color: theme.muted }}>{notice}</Text> : null}{button("关闭", onClose)}</KeyboardScrollView></KeyboardScreen></SafeAreaView></Modal>;
}
