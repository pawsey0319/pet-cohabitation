import { useState } from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { PetFeatureScreen } from "../src/navigation/PetFeatureScreen";
import { OwnedPetGate, useOwnedPet } from "../src/navigation/useOwnedPet";
import { usePersonality } from "../src/personality/usePersonality";
import { STYLE_LABELS, STYLE_TRAITS } from "../src/personality/client";
import { AppButton, Surface } from "../src/ui/common";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { KeyboardScreen } from "../src/components/KeyboardLayout";

function PersonalityContent({ owner }: { owner: string }) {
  const { theme } = useAppTheme(); const router = useRouter(); const { data, error, busy, load, mutate } = usePersonality(owner);
  const [confirm, setConfirm] = useState<{ action: string; label: string; fields?: Record<string, unknown> } | null>(null);
  const [showEvidence, setShowEvidence] = useState(false), [showTraits, setShowTraits] = useState(false);
  if (!data) return <View style={{ gap: 12 }}>{error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : <ActivityIndicator color={theme.accent} />}<AppButton label="重新加载性格" onPress={() => void load()} /></View>;
  return <>
    <Surface style={{ gap: 12 }}><Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>初始底色</Text><Text style={{ color: theme.text, fontSize: 16, lineHeight: 25 }}>{data.seed || "它会在相处中慢慢形成表达习惯。"}</Text></Surface>
    <Surface style={{ gap: 12 }}><Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>现在的表达习惯</Text>
      {data.state.styles.length ? data.state.styles.map(style => <View key={style.trait} style={{ gap: 4 }}><Text style={{ color: theme.text, lineHeight: 24 }}>{STYLE_LABELS[style.trait]}</Text><AppButton label="我不喜欢这种方式" variant="quiet" disabled={busy} onPress={() => setConfirm({ action: "block_trait", label: "停止使用这项表达习惯", fields: { trait: style.trait } })} /></View>) : <Text style={{ color: theme.muted, lineHeight: 23 }}>还没有足够的跨天依据。一次情绪或玩笑不会直接改变长期性格。</Text>}
      <Text style={{ color: theme.muted }}>{data.state.paused ? "性格学习已暂停" : "会从你的明确表达中逐渐学习"} · {data.state.last_learned_day ? `最近变化 ${data.state.last_learned_day}` : "尚未形成长期变化"}</Text>
      <AppButton label={data.state.paused ? "恢复性格学习" : "暂停性格学习"} variant="secondary" disabled={busy} onPress={() => void mutate(data.state.paused ? "resume" : "pause")} />
      <AppButton label="恢复初始底色" variant="quiet" disabled={busy} onPress={() => setConfirm({ action: "reset", label: "恢复初始底色" })} />
      <AppButton label={showTraits ? "收起表达边界" : "管理不喜欢的表达方式"} variant="quiet" onPress={() => setShowTraits(value => !value)} />
      {showTraits ? STYLE_TRAITS.map(trait => <View key={trait} style={{ gap: 4, borderTopWidth: 1, borderColor: theme.line, paddingTop: 8 }}><Text style={{ color: theme.text }}>{STYLE_LABELS[trait]}</Text><AppButton label={data.state.blocked_traits.includes(trait) ? "允许以后重新学习" : "停止使用"} variant="quiet" disabled={busy} onPress={() => void mutate(data.state.blocked_traits.includes(trait) ? "unblock_trait" : "block_trait", { trait })} /></View>) : null}
    </Surface>
    <Surface style={{ gap: 12 }}><Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>变化时间线</Text>
      {!data.history.length ? <Text style={{ color: theme.muted }}>暂无有依据的长期变化记录。</Text> : data.history.map(item => <View key={item.id} style={{ gap: 5, paddingTop: 8, borderTopWidth: 1, borderColor: theme.line }}><Text style={{ color: theme.muted }}>{new Date(item.created_at).toLocaleString("zh-CN")}</Text><Text style={{ color: theme.text, lineHeight: 23 }}>{item.styles.map(style => STYLE_LABELS[style.trait]).join("；") || "按你的要求调整了表达习惯"}</Text></View>)}
      <AppButton label={showEvidence ? "收起学习依据" : "查看学习依据"} variant="quiet" onPress={() => setShowEvidence(value => !value)} />
      {showEvidence ? data.evidence.map(item => <View key={item.id} style={{ gap: 7, paddingTop: 12, borderTopWidth: 1, borderColor: theme.line }}>
        <Text style={{ color: theme.text }}>{STYLE_LABELS[item.trait]}</Text><Text style={{ color: theme.muted }}>{new Date(item.source_date).toLocaleDateString("zh-CN")} · {item.source_kind === "private" ? "本人私聊" : "已授权群内的本人表达"}</Text>
        <Text style={{ color: theme.text, lineHeight: 24 }}>{item.quote ?? "这项依据已停用，原话不再用于性格理解。"}</Text>
        {item.state === "active" ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <AppButton label="查看原话" variant="quiet" onPress={() => router.push(item.source_kind === "space" && item.space_id ? { pathname: "/chat/[spaceId]", params: { spaceId: item.space_id, messageId: item.source_id } } : { pathname: "/pet", params: { messageId: item.source_id } } as Href)} />
          <AppButton label="理解错了" variant="quiet" disabled={busy} onPress={() => setConfirm({ action: "correct_evidence", label: "停用这项错误理解", fields: { evidence_id: item.id } })} />
          <AppButton label="忘记依据" variant="quiet" disabled={busy} onPress={() => setConfirm({ action: "forget_evidence", label: "忘记这项学习依据", fields: { evidence_id: item.id } })} />
        </View> : null}
      </View>) : null}
      {data.evidence.length >= (data.page + 1) * data.page_size || data.history.length >= (data.page + 1) * data.page_size ? <AppButton label="加载更早记录" variant="quiet" disabled={busy} onPress={() => void load(data.page + 1)} /> : null}
    </Surface>
    {data.jobs.filter(job => job.status === "failed").map(job => <Surface key={job.id} style={{ gap: 8 }}><Text style={{ color: theme.muted }}>一项后台学习尚未完成，不影响聊天。</Text><AppButton label="重试学习" variant="quiet" disabled={busy} onPress={() => void mutate("retry", { job_id: job.id })} /></Surface>)}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}<AppButton label="刷新当前状态" variant="quiet" onPress={() => void load()} />
    <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => !busy && setConfirm(null)}><KeyboardScreen style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: "center", padding: 20 }}><Surface style={{ gap: 12 }}><Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>{confirm?.label}？</Text><Text style={{ color: theme.muted, lineHeight: 24 }}>{confirm?.action === "reset" ? "撤销已经学到的表达习惯，保留最初的性格底色。旧依据不会立即重新塑造相同习惯，新聊天仍可产生新依据。" : "相关理解将停止参与后续回应，其他聊天和真实经历继续保留。"}</Text>{error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}<AppButton label="确认" disabled={busy} onPress={() => { if (confirm) void mutate(confirm.action, confirm.fields).then(done => { if (done) setConfirm(null); }); }} /><AppButton label="取消" variant="quiet" disabled={busy} onPress={() => setConfirm(null)} /></Surface></KeyboardScreen></Modal>
  </>;
}
export default function PetPersonalityRoute() {
  const state = useOwnedPet(); const { theme } = useAppTheme();
  return <PetFeatureScreen title="性格变化" description="保留初始底色，也逐渐学会和你相处。私聊更贴近你，群内会照顾不同成员的相处距离。"><OwnedPetGate state={state}>{state.profile && !state.isLocalDemo ? <PersonalityContent key={state.profile.id} owner={state.profile.id} /> : <Text style={{ color: theme.muted }}>登录真实账号后，可以查看和管理有来源的性格学习。</Text>}</OwnedPetGate></PetFeatureScreen>;
}
