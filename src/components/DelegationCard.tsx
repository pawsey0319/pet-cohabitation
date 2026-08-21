import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DelegatedAction } from "../domain/types";
import { colors, radii, spacing } from "../theme/tokens";

const blockedReasons: Readonly<Record<string, string>> = {
  meetup: "真实见面必须由本人确认，异宠不能代替主人承诺。",
  relationship_change: "关系变化与情感承诺必须由本人表达。",
  location: "位置属于敏感信息，需要本人再次授权。",
  purchase: "消费与财务决定不能交给异宠确认。",
  finance: "财务信息与操作必须由本人处理。",
  health: "健康信息需要本人再次授权。",
};

type DelegationCardProps = Readonly<{
  action: DelegatedAction;
  onConfirm: () => void;
  onRevoke: () => void;
}>;

export function DelegationCard({ action, onConfirm, onRevoke }: DelegationCardProps) {
  const summary = action.summary?.trim() || "未命名代理事项";
  const status = action.status === "blocked" ? "已阻断" : action.status === "pending_owner" ? "待本人确认" : "已确认";

  return (
    <View accessibilityLabel={`代理事项：${summary}`} style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.summary}>{summary}</Text>
        <Text style={[styles.status, action.status === "blocked" && styles.blocked]}>{status}</Text>
      </View>
      <Text style={styles.source}>{action.status === "blocked" ? "依据：高风险代理阻断策略" : "依据：异宠低风险代理范围"}</Text>
      {action.status === "blocked" ? <Text style={styles.reason}>{blockedReasons[action.kind] || "该事项超出异宠代理范围，必须由本人处理。"}</Text> : null}
      <View style={styles.actions}>
        {action.status === "pending_owner" ? <Pressable accessibilityRole="button" accessibilityLabel="本人确认" onPress={onConfirm} style={styles.confirm}><Text style={styles.confirmText}>本人确认</Text></Pressable> : null}
        {action.status !== "blocked" ? <Pressable accessibilityRole="button" accessibilityLabel="撤回" onPress={onRevoke} style={styles.revoke}><Text style={styles.revokeText}>撤回</Text></Pressable> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, backgroundColor: colors.surfaceSoft, borderColor: colors.line, borderWidth: 1, borderRadius: radii.md },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  summary: { flex: 1, color: colors.text, fontWeight: "900" },
  status: { color: colors.mint, fontWeight: "900" },
  blocked: { color: colors.coralSoft },
  source: { marginTop: spacing.xs, color: colors.textMuted, fontSize: 11 },
  reason: { marginTop: spacing.sm, color: colors.coralSoft, lineHeight: 20 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  confirm: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.mint, borderRadius: radii.sm },
  confirmText: { color: colors.textDark, fontWeight: "900" },
  revoke: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderColor: colors.line, borderWidth: 1, borderRadius: radii.sm },
  revokeText: { color: colors.text, fontWeight: "800" },
});
