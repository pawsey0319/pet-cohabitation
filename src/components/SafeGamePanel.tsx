import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SafeGameType } from "../domain/types";
import { colors, radii, spacing, typography } from "../theme/tokens";

type SafeGamePanelProps = Readonly<{
  onPlay: (gameType: SafeGameType) => void;
}>;

const GAMES: readonly Readonly<{ type: SafeGameType; label: string }>[] = Object.freeze([
  Object.freeze({ type: "same_prompt_reveal", label: "同题揭晓" }),
  Object.freeze({ type: "guess_choice", label: "猜测选择" }),
  Object.freeze({ type: "relay", label: "接力" }),
]);

export function SafeGamePanel({ onPlay }: SafeGamePanelProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>共同造游戏</Text>
      <Text style={styles.note}>人类与异宠提供素材，由空间主 Agent 组合主持；仅组合预设安全素材，不执行任意代码。</Text>
      <View style={styles.actions}>
        {GAMES.map((game) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`玩${game.label}`}
            key={game.type}
            onPress={() => onPlay(game.type)}
            style={styles.button}
          ><Text style={styles.buttonText}>{game.label}</Text></Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radii.lg },
  title: { color: colors.text, fontSize: typography.title, fontWeight: "900" },
  note: { marginTop: spacing.xs, color: colors.textMuted, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  button: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.lavenderSoft, borderRadius: radii.sm },
  buttonText: { color: colors.textDark, fontWeight: "900" },
});
