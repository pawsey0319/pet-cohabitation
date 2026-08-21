import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../theme/tokens";

type AgentCardProps = Readonly<{
  pendingCount: number;
  onSummarize: () => void;
}>;

export function AgentCard({ pendingCount, onSummarize }: AgentCardProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "收起空间主 Agent" : "展开空间主 Agent"}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <View>
          <Text style={styles.eyebrow}>PUBLIC COORDINATOR</Text>
          <Text style={styles.title}>空间主 Agent</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? "−" : "+"}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          <View style={styles.statusRow}>
            <Text style={styles.confirmed}>已确认</Text>
            <Text style={styles.copy}>只有成员本人消息可形成承诺</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.suggested}>Agent 建议</Text>
            <Text style={styles.copy}>可以整理讨论、待办与共同计划</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.pending}>待本人确认</Text>
            <Text style={styles.copy}>{pendingCount} 项代理事项正在等待</Text>
          </View>
          <Text style={styles.guardrail}>宠物发言不是主人承诺</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="请求客观总结" onPress={onSummarize} style={styles.button}>
            <Text style={styles.buttonText}>请求客观总结</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radii.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: colors.lavender, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  title: { marginTop: 3, color: colors.text, fontSize: typography.title, fontWeight: "900" },
  chevron: { color: colors.lavenderSoft, fontSize: 28 },
  body: { marginTop: spacing.md, gap: spacing.sm },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  confirmed: { minWidth: 72, color: colors.mint, fontWeight: "800" },
  suggested: { minWidth: 72, color: colors.lavenderSoft, fontWeight: "800" },
  pending: { minWidth: 72, color: colors.coralSoft, fontWeight: "800" },
  copy: { flex: 1, color: colors.textMuted, fontSize: typography.eyebrow },
  guardrail: { padding: spacing.sm, color: colors.coralSoft, backgroundColor: "rgba(255,128,111,0.08)", borderRadius: radii.sm, fontWeight: "800" },
  button: { alignItems: "center", padding: spacing.sm, backgroundColor: colors.lavenderSoft, borderRadius: radii.sm },
  buttonText: { color: colors.textDark, fontWeight: "900" },
});
