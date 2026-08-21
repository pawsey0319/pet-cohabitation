import { StyleSheet, Text, View } from "react-native";
import type { SpaceMessage } from "../domain/types";
import { colors, radii, spacing, typography } from "../theme/tokens";

function messageLabel(message: SpaceMessage): string {
  if (message.actorType === "pet") return "异宠视角 · 主观回顾";
  if (message.actorType === "space_agent") return "空间主 Agent · 客观摘要";
  if (message.actorId === "owner-mei") return "成员消息 · 你";
  return "成员消息 · 林";
}

export function MessageBubble({ message }: Readonly<{ message: SpaceMessage }>) {
  return (
    <View
      accessibilityLabel={`${messageLabel(message)}：${message.content}`}
      style={[
        styles.bubble,
        message.actorType === "pet" && styles.pet,
        message.actorType === "space_agent" && styles.agent,
      ]}
    >
      <Text style={styles.label}>{messageLabel(message)}</Text>
      <Text style={styles.content}>{message.content}</Text>
      <Text style={styles.source}>
        {message.actorType === "human"
          ? "来源：空间成员"
          : message.actorType === "pet"
            ? "来源：本空间记忆舱"
            : "来源：客观消息计数"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    padding: spacing.md,
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  pet: { borderLeftColor: colors.mint, borderLeftWidth: 4 },
  agent: { borderLeftColor: colors.lavender, borderLeftWidth: 4 },
  label: { color: colors.coralSoft, fontSize: typography.eyebrow, fontWeight: "800" },
  content: { marginTop: spacing.xs, color: colors.text, fontSize: typography.body, lineHeight: 22 },
  source: { marginTop: spacing.xs, color: colors.textMuted, fontSize: 11 },
});
