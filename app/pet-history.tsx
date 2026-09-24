import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { PetFeatureScreen } from "../src/navigation/PetFeatureScreen";
import { OwnedPetGate, useOwnedPet } from "../src/navigation/useOwnedPet";
import type { PetRepository } from "../src/data/petRepository";
import type { PetPrivateMessage } from "../src/data/types";
import { mergePrivateHistory } from "../src/pets/privateHistory";
import { AppButton, Surface } from "../src/ui/common";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { StewardActionCard } from "../src/work/StewardActionCard";
function History({ repository, local }: { repository: PetRepository; local: boolean }) {
  const { theme } = useAppTheme(); const alive = useRef(true);
  const [rows, setRows] = useState<readonly PetPrivateMessage[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [more, setMore] = useState(true);
  const load = useCallback(async (before?: { at: string; id: string }) => {
    setBusy(true); setError("");
    try { const messages = await repository.listPrivateMessages(before); if (alive.current) { setRows(current => mergePrivateHistory(before ? current : [], messages)); setMore(messages.length === 50); } }
    catch { if (alive.current) setError("历史对话暂时无法读取，请稍后重试。"); }
    finally { if (alive.current) setBusy(false); }
  }, [repository]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  return <>
    {more && rows.length ? <AppButton label="加载更早对话" variant="quiet" disabled={busy} onPress={() => void load({ at: rows[0].createdAt, id: rows[0].id })} /> : null}
    {busy ? <ActivityIndicator color={theme.accent} /> : null}{error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}
    {!rows.length && !busy && !error ? <Text style={{ color: theme.muted }}>还没有历史对话。</Text> : null}
    {rows.map(message => <Surface key={message.id} style={{ gap: 8 }}><Text style={{ color: theme.muted, fontSize: 13 }}>{message.role === "owner" ? "我" : "异宠"} · {new Date(message.createdAt).toLocaleString("zh-CN")} · {message.conversationKind === "steward" ? "早期消息管家记录" : message.conversationKind === "companion" ? "陪伴对话" : "早期未分类记录"}</Text><Text selectable style={{ color: theme.text, fontSize: 16, lineHeight: 25 }}>{message.content}</Text>
      {!local && message.role === "owner" && message.conversationKind === "steward" ? <StewardActionCard sourceMessageId={message.id} /> : null}
    </Surface>)}
    {error ? <AppButton label="重试读取" onPress={() => void load()} /> : null}
  </>;
}
export default function PetHistoryRoute() {
  const state = useOwnedPet();
  return <PetFeatureScreen title="历史对话" description="保留陪伴与早期消息管家的原始记录。回看不会重新提取记忆或改变当前话题。"><OwnedPetGate state={state}>{state.repository && state.profile ? <History key={state.profile.id} repository={state.repository} local={state.isLocalDemo} /> : null}</OwnedPetGate></PetFeatureScreen>;
}
