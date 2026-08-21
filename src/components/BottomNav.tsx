import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../theme/tokens";

export type AppTab = "home" | "space" | "pet";

type BottomNavProps = Readonly<{
  activeTab: AppTab;
  onChange: (tab: AppTab) => void;
}>;

const items: readonly Readonly<{ key: AppTab; label: string; glyph: string }>[] = [
  { key: "home", label: "共生", glyph: "⌂" },
  { key: "space", label: "空间", glyph: "◎" },
  { key: "pet", label: "异宠", glyph: "◇" },
];

export function BottomNav({ activeTab, onChange }: BottomNavProps) {
  return (
    <View accessibilityRole="tablist" style={styles.shell}>
      {items.map((item) => {
        const active = item.key === activeTab;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={item.key}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => [styles.item, active && styles.activeItem, pressed && styles.pressed]}
          >
            <Text style={[styles.glyph, active && styles.activeText]}>{item.glyph}</Text>
            <Text style={[styles.label, active && styles.activeText]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.xs,
    backgroundColor: "rgba(42, 38, 80, 0.96)",
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
    borderRadius: radii.md,
  },
  activeItem: {
    backgroundColor: colors.lavenderSoft,
  },
  pressed: {
    opacity: 0.72,
  },
  glyph: {
    color: colors.textMuted,
    fontSize: 19,
    lineHeight: 20,
  },
  label: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: typography.eyebrow,
    fontWeight: "700",
  },
  activeText: {
    color: colors.textDark,
  },
});
