import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AgentProposal } from "../data/types";
import { colors, radii, spacing } from "../theme/tokens";

const LABELS: Record<string, string> = {
  group_schedule: "日程提案",
  group_reminder: "群提醒提案",
  group_task: "群待办提案",
  group_plan: "共同计划提案",
};
const STATUS: Record<string, string> = { voting: "投票中", approved: "已通过", rejected: "未通过", expired: "已过期", withdrawn: "已撤回", executed: "已执行" };

export function AgentProposalCard({ proposal, currentUserId, onVote, disabled = false }: Readonly<{
  proposal: AgentProposal;
  currentUserId: string;
  onVote(decision: "approve" | "reject"): void;
  disabled?: boolean;
}>) {
  const kind = String(proposal.content.request_kind ?? "group_plan");
  const summary = String(proposal.content.summary ?? proposal.title);
  const scheduledFor = typeof proposal.content.scheduled_for === "string" ? proposal.content.scheduled_for : null;
  const approvals = proposal.votes.filter((vote) => vote.decision === "approve").length;
  const ownVote = proposal.votes.find((vote) => vote.userId === currentUserId)?.decision;
  return <View accessibilityLabel={`${LABELS[kind] ?? "群提案"}：${summary}`} style={styles.card}>
    <View style={styles.head}><Text style={styles.kind}>{LABELS[kind] ?? "群提案"}</Text><Text style={styles.status}>{STATUS[proposal.status] ?? proposal.status}</Text></View>
    <Text style={styles.title}>{summary}</Text>
    {scheduledFor ? <Text style={styles.detail}>时间：{new Date(scheduledFor).toLocaleString("zh-CN")}</Text> : null}
    {typeof proposal.content.created_by_name === "string" ? <Text style={styles.detail}>发起人：{proposal.content.created_by_name}</Text> : null}
    <Text style={styles.voteCount}>赞成 {approvals} / {proposal.requiredApprovals}{proposal.affectedUserIds.length ? " · 被安排成员需全部同意" : ""}</Text>
    {proposal.status === "voting" ? <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="赞成日程提案" disabled={disabled} onPress={() => onVote("approve")} style={[styles.button, ownVote === "approve" && styles.approveActive]}><Text style={styles.approve}>赞成</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="拒绝日程提案" disabled={disabled} onPress={() => onVote("reject")} style={[styles.button, ownVote === "reject" && styles.rejectActive]}><Text style={styles.reject}>拒绝</Text></Pressable>
    </View> : null}
    <Text style={styles.expires}>有效至 {new Date(proposal.expiresAt).toLocaleString("zh-CN")}</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { width: "100%", minWidth: 250, maxWidth: 460, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.mint, backgroundColor: colors.canvasRaised, gap: 7 },
  head: { flexDirection: "row", justifyContent: "space-between", gap: 8 }, kind: { color: colors.mint, fontWeight: "900", fontSize: 12 }, status: { color: colors.lavender, fontSize: 11 },
  title: { color: colors.text, fontSize: 16, fontWeight: "900", lineHeight: 23 }, detail: { color: colors.textMuted, fontSize: 12 }, voteCount: { color: colors.lavenderSoft, fontSize: 11 },
  actions: { flexDirection: "row", gap: 8, marginTop: 3 }, button: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.surface }, approveActive: { borderWidth: 1, borderColor: colors.mint }, rejectActive: { borderWidth: 1, borderColor: colors.coral }, approve: { color: colors.mint, fontWeight: "900" }, reject: { color: colors.coralSoft, fontWeight: "900" }, expires: { color: colors.textMuted, fontSize: 9 },
});
