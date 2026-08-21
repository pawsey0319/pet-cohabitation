import { StyleSheet, Text, View } from "react-native";
import type { SpaceMessage } from "../domain/types";
import { colors, radii, spacing, typography } from "../theme/tokens";

function messageLabel(
  message: SpaceMessage,
  currentUserId: string,
  memberNames: Readonly<Record<string, string>>,
): string {
  if (message.actorType === "pet") return "异宠视角 · 主观回顾";
  if (message.actorType === "space_agent") {
    return message.permissionSource === "space_safe_game_host"
      ? "空间主 Agent · 游戏主持"
      : "空间主 Agent · 客观摘要";
  }
  if (message.actorId === currentUserId) return "成员消息 · 你";
  return `成员消息 · ${memberNames[message.actorId] ?? message.actorId}`;
}

export function MessageBubble({ message, currentUserId, memberNames }: Readonly<{
  message: SpaceMessage;
  currentUserId: string;
  memberNames: Readonly<Record<string, string>>;
}>) {
  const label = messageLabel(message, currentUserId, memberNames);
  return (
    <View
      accessibilityLabel={`${label}：${message.content}`}
      style={[
        styles.bubble,
        message.actorType === "pet" && styles.pet,
        message.actorType === "space_agent" && styles.agent,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      {message.metadata?.replyPreview ? <Text style={styles.metadata}>引用消息：{message.metadata.replyPreview}</Text> : null}
      {message.metadata?.mood ? <Text style={styles.metadata}>心情：{message.metadata.mood}</Text> : null}
      {message.metadata?.communicationIntent ? (
        <Text style={styles.metadata}>沟通意图：{message.metadata.communicationIntent === "share" ? "分享" : "寻求安慰"}</Text>
      ) : null}
      <Text style={styles.content}>{message.content}</Text>
      {message.metadata?.mediaBoundary ? <Text style={styles.metadata}>边界：本地演示占位，未上传</Text> : null}
      <Text style={styles.source}>
        {message.actorType === "human"
          ? "来源：空间成员"
          : message.actorType === "pet"
            ? message.permissionSource === "pet_ritual_invite"
              ? "来源：共同碰面设置"
              : "来源：本空间记忆舱"
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
  metadata: { marginTop: spacing.xs, color: colors.lavenderSoft, fontSize: 12, lineHeight: 18 },
  source: { marginTop: spacing.xs, color: colors.textMuted, fontSize: 11 },
});
