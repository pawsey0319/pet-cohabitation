import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { personalityError, personalityRequest, type RelationshipConsent } from "./client";
import { AppButton, Surface } from "../ui/common";
import { useAppTheme } from "../theme/ThemeProvider";
export function relationshipMemberName(member: RelationshipConsent["members"][number]): string {
  const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
  return profile?.nickname || "群成员";
}
export function RelationshipConsentPanel({ ownerId, petId, spaceId, onLoaded }: { ownerId: string; petId: string; spaceId: string; onLoaded?(value: RelationshipConsent): void }) {
  const { theme } = useAppTheme(); const alive = useRef(true); const loaded = useRef(onLoaded); loaded.current = onLoaded;
  const scopeKey = `${ownerId}:${petId}:${spaceId}`; const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const [data, setData] = useState<RelationshipConsent | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async (decision?: boolean) => {
    const requestedScope = `${ownerId}:${petId}:${spaceId}`; const valid = () => alive.current && currentScope.current === requestedScope;
    setBusy(true); setError("");
    try { const next = await personalityRequest<RelationshipConsent>(ownerId, { action: decision === undefined ? "state" : "decide", pet_id: petId, space_id: spaceId, ...(decision === undefined ? {} : { decision }) }, "space-relationship-consent"); if (valid()) { setData(next); loaded.current?.(next); } }
    catch (reason) { if (valid()) { setData(null); setError(personalityError(reason)); } }
    finally { if (valid()) setBusy(false); }
  }, [ownerId, petId, spaceId]);
  useEffect(() => { alive.current = true; setData(null); void load(); return () => { alive.current = false; }; }, [load]);
  const mine = data?.votes.find(vote => vote.member_id === ownerId && vote.epoch === data.scope?.epoch);
  return <Surface style={{ gap: 12 }}>
    <Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>{data?.pet.name ?? "异宠"}的群关系学习</Text>
    <Text style={{ color: theme.muted, lineHeight: 24 }}>这是一项独立授权。全体当前成员同意后，只从生效后的群消息积累这只异宠的关系理解。新成员加入会暂停；任何成员都可以撤回。</Text>
    <Text style={{ color: theme.text, fontWeight: "600" }}>{data ? data.enabled ? "全员同意，当前已启用" : "尚未启用，等待全体成员确认" : busy ? "正在核对当前授权" : "当前状态尚未确认"}</Text>
    {data?.members.map(member => {
      const vote = data.votes.find(value => value.member_id === member.user_id && value.epoch === data.scope?.epoch);
      return <View key={member.user_id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}><Text style={{ color: theme.text }}>{relationshipMemberName(member)}{member.user_id === ownerId ? "（我）" : ""}</Text><Text style={{ color: theme.muted }}>{vote ? vote.consented ? "已同意" : "未同意" : "待确认"}</Text></View>;
    })}
    {data ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><AppButton label={mine?.consented ? "我已同意" : "我同意此授权"} disabled={busy || mine?.consented === true} onPress={() => void load(true)} /><AppButton label={mine?.consented ? "撤回我的授权" : "不同意"} variant="quiet" disabled={busy} onPress={() => void load(false)} /></View> : busy ? <ActivityIndicator color={theme.accent} /> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}<AppButton label="刷新授权状态" variant="quiet" disabled={busy} onPress={() => void load()} />
  </Surface>;
}
