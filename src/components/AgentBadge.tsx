import { StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../theme/tokens";

type AgentBadgeProps = Readonly<{
  label?: string;
}>;

export function AgentBadge({ label = "异宠 Agent" }: AgentBadgeProps) {
  return (
    <View accessibilityLabel={label} style={styles.badge}>
      <View style={styles.signal} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.mintDeep,
    borderColor: "rgba(125, 226, 196, 0.32)",
    borderWidth: 1,
    borderRadius: radii.pill,
  },
  signal: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.mint,
  },
  label: {
    color: colors.mint,
    fontSize: typography.eyebrow,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
