import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radii, shadows, spacing } from "../theme/tokens";

type GlassCardProps = PropsWithChildren<{
  accent?: "coral" | "mint" | "lavender";
  header?: ReactNode;
  style?: StyleProp<ViewStyle>;
}>;

const accents = {
  coral: colors.coral,
  mint: colors.mint,
  lavender: colors.lavender,
} as const;

export function GlassCard({ accent, children, header, style }: GlassCardProps) {
  return (
    <View style={[styles.card, style]}>
      {accent ? <View style={[styles.accent, { backgroundColor: accents[accent] }]} /> : null}
      {header}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  accent: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    top: 0,
    height: 3,
    borderBottomLeftRadius: radii.pill,
    borderBottomRightRadius: radii.pill,
  },
});
