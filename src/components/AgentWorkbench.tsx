import { useCallback, useEffect, useState } from "react";
import { createRequestId } from "../lib/uuid";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ChatRepository } from "../data/chatRepository";
import type { AgentRequest, AgentRequestKind } from "../data/types";
import { colors, radii, spacing } from "../theme/tokens";

const KINDS: readonly Readonly<{ kind: AgentRequestKind; label: string; hint: string }>[] = [
  { kind: "read_summary", label: "群聊简报", hint: "总结最近发生的事" },
  { kind: "read_query", label: "查询消息", hint: "按问题查当前群消息" },
  { kind: "delegated_message", label: "代发原文", hint: "必须逐字发送本次输入" },
  { kind: "group_task", label: "群待办", hint: "形成提案并投票" },
  { kind: "group_plan", label: "共同计划", hint: "形成提案并投票" },
  { kind: "group_schedule", label: "日程安排", hint: "被安排成员还需确认" },
  { kind: "group_reminder", label: "群提醒", hint: "通过后到点发群聊" },
];

const STATUS: Record<string, string> = { queued: "排队中", reviewing: "主 Agent 评审中", needs_clarification: "需要补充", voting: "等待投票", approved: "已通过", executing: "执行中", completed: "已完成", failed: "暂不可用", withdrawn: "已撤回", expired: "已过期", rejected: "未通过" };

export function AgentWorkbench({ visible, spaceId, repository, onClose, onPublished }: Readonly<{ visible: boolean; spaceId: string; repository: ChatRepository; onClose(): void; onPublished(): void }>) {
  const [requests, setRequests] = useState<readonly AgentRequest[]>([]);
  const [kind, setKind] = useState<AgentRequestKind>("read_summary");
  const [text, setText] = useState("请总结最近的群聊，区分已确认和待确认事项");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setRequests(await repository.listAgentRequests(spaceId)); } catch (reason) { setError(reason instanceof Error ? reason.message : "共享面板加载失败"); } }, [repository, spaceId]);
  useEffect(() => { if (visible) void load(); }, [load, visible]);
  useEffect(() => { if (!visible) return; return repository.subscribe(spaceId, () => void load()); }, [load, repository, spaceId, visible]);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await repository.submitAgentRequest({ spaceId, origin: "space_panel", kind, text: text.trim(), exactContent: kind === "delegated_message" ? text.trim() : null, idempotencyKey: createRequestId() });
      setText(""); await load(); onPublished();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "请求提交失败"); }
    finally { setBusy(false); }
  };
  const vote = async (proposalId: string, decision: "approve" | "reject") => { setBusy(true); try { await repository.voteAgentProposal(proposalId, decision); await load(); onPublished(); } catch (reason) { setError(reason instanceof Error ? reason.message : "投票失败"); } finally { setBusy(false); } };
  const withdraw = async (requestId: string) => { setBusy(true); try { await repository.withdrawAgentRequest(requestId); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "撤回失败"); } finally { setBusy(false); } };

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.backdrop}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} /><View style={styles.panel}>
      <View style={styles.head}><View style={{ flex: 1 }}><Text style={styles.title}>空间主 Agent</Text><Text style={styles.note}>成员主动下达需求；分析、评审和投票留在此处，普通聊天不会自动触发。</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭主 Agent" onPress={onClose}><Text style={styles.close}>×</Text></Pressable></View>
      <View style={styles.kinds}>{KINDS.map((item) => <Pressable key={item.kind} onPress={() => { setKind(item.kind); if (item.kind === "read_summary") setText("请总结最近的群聊，区分已确认和待确认事项"); else setText(""); }} style={[styles.kind, kind === item.kind && styles.kindActive]}><Text style={[styles.kindLabel, kind === item.kind && styles.kindLabelActive]}>{item.label}</Text><Text style={styles.kindHint}>{item.hint}</Text></Pressable>)}</View>
      <TextInput value={text} onChangeText={setText} multiline maxLength={4000} placeholder={kind === "delegated_message" ? "输入需要逐字代发的原文；主 Agent 不会改写" : "输入你希望主 Agent 完成的事"} placeholderTextColor={colors.textMuted} style={styles.input} />
      {error ? <Text style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="提交给主 Agent" disabled={busy || !text.trim()} onPress={() => void submit()} style={[styles.submit, (busy || !text.trim()) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.textDark} /> : <Text style={styles.submitText}>提交给主 Agent</Text>}</Pressable>
      <Text style={styles.section}>共享记录</Text>
      <FlatList data={requests} keyExtractor={(item) => item.id} style={styles.list} ListEmptyComponent={<Text style={styles.empty}>还没有成员请求。</Text>} renderItem={({ item }) => <View style={styles.request}>
        <View style={styles.requestHead}><Text style={styles.requestKind}>{KINDS.find((candidate) => candidate.kind === item.kind)?.label ?? item.kind}</Text><Text style={styles.status}>{STATUS[item.status] ?? item.status}</Text></View>
        <Text style={styles.requestInput}>{item.userInput}</Text>{item.resultText ? <Text style={styles.result}>{item.resultText}</Text> : null}{item.reviewReason ? <Text style={styles.error}>{item.reviewReason}</Text> : null}
        {item.proposal?.status === "voting" ? <View style={styles.voteRow}><Text style={styles.voteCount}>赞成 {item.proposal.votes.filter((voteItem) => voteItem.decision === "approve").length} / 至少 {item.proposal.requiredApprovals}{item.proposal.affectedUserIds.length ? "，且被安排成员需全部同意" : ""}</Text><Pressable onPress={() => void vote(item.proposal!.id, "approve")}><Text style={styles.approve}>赞成</Text></Pressable><Pressable onPress={() => void vote(item.proposal!.id, "reject")}><Text style={styles.reject}>拒绝</Text></Pressable></View> : null}
        {!['completed', 'executing', 'withdrawn', 'expired', 'rejected'].includes(item.status) ? <Pressable onPress={() => void withdraw(item.id)}><Text style={styles.withdraw}>撤回请求</Text></Pressable> : null}
      </View>} />
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(4,3,13,.72)", alignItems: "flex-end" }, panel: { width: "100%", maxWidth: 680, height: "100%", backgroundColor: colors.canvasRaised, padding: spacing.lg, gap: spacing.md }, head: { flexDirection: "row", gap: 8 }, title: { color: colors.text, fontSize: 24, fontWeight: "900" }, note: { color: colors.textMuted, lineHeight: 19, marginTop: 4 }, close: { color: colors.textMuted, fontSize: 28, padding: 6 },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, kind: { minWidth: 98, flexGrow: 1, borderRadius: radii.md, backgroundColor: colors.surface, padding: 9, borderWidth: 1, borderColor: "transparent" }, kindActive: { borderColor: colors.mint, backgroundColor: colors.mintDeep }, kindLabel: { color: colors.text, fontWeight: "900", fontSize: 12 }, kindLabelActive: { color: colors.mint }, kindHint: { color: colors.textMuted, fontSize: 9, marginTop: 3 },
  input: { minHeight: 82, maxHeight: 150, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text, padding: 12, textAlignVertical: "top" }, submit: { minHeight: 46, backgroundColor: colors.mint, borderRadius: radii.md, alignItems: "center", justifyContent: "center" }, submitText: { color: colors.textDark, fontWeight: "900" }, disabled: { opacity: .4 }, error: { color: colors.coralSoft, fontSize: 11 }, section: { color: colors.text, fontWeight: "900", fontSize: 16 }, list: { flex: 1 }, empty: { color: colors.textMuted, textAlign: "center", padding: 20 }, request: { backgroundColor: colors.surface, borderRadius: radii.md, padding: 12, gap: 7, marginBottom: 8 }, requestHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 }, requestKind: { color: colors.lavender, fontWeight: "900", fontSize: 11 }, status: { color: colors.mint, fontSize: 10 }, requestInput: { color: colors.text, lineHeight: 20 }, result: { color: colors.textMuted, lineHeight: 19, borderLeftWidth: 2, borderLeftColor: colors.mint, paddingLeft: 8 }, voteRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }, voteCount: { flex: 1, minWidth: 180, color: colors.textMuted, fontSize: 10 }, approve: { color: colors.mint, fontWeight: "900" }, reject: { color: colors.coralSoft, fontWeight: "900" }, withdraw: { color: colors.textMuted, fontSize: 10, textDecorationLine: "underline" },
});
