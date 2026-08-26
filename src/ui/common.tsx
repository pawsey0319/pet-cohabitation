import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";
import { useAppTheme } from "../theme/ThemeProvider";

export function AppButton({ label, onPress, variant = "primary", disabled = false }: Readonly<{
  label: string;
  onPress(): void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
}>) {
  const { theme } = useAppTheme();
  const backgroundColor = variant === "primary" ? theme.primary : variant === "secondary" ? theme.secondary : variant === "danger" ? theme.danger : "transparent";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { minHeight: theme.controlHeight, borderRadius: theme.radius, backgroundColor }, variant === "quiet" && { borderColor: theme.line }, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, variant === "quiet" && styles.quietText]}>{label}</Text>
    </Pressable>
  );
}

export function AppField({ label, error, ...props }: TextInputProps & Readonly<{ label: string; error?: string | null }>) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={props.accessibilityLabel ?? label} placeholderTextColor={theme.muted} style={[styles.input, { minHeight: theme.controlHeight, borderRadius: theme.radius, borderColor: theme.line, backgroundColor: theme.card, color: theme.text }]} {...props} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function DemoBanner() {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.banner, { backgroundColor: theme.secondary }]}>
      <Text style={[styles.bannerText, { color: theme.accent }]}>本地体验模式 · 数据只保存在当前浏览器，配置 Supabase 后自动切换为多人实时聊天</Text>
    </View>
  );
}

export function EmptyState({ icon, title, body }: Readonly<{ icon: string; title: string; body: string }>) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: theme.muted }]}>{body}</Text>
    </View>
  );
}

export function Surface({ children, style }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { theme } = useAppTheme();
  return <View style={[styles.surface, { backgroundColor: theme.card, borderRadius: theme.radius + 8, borderColor: theme.line }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  button_quiet: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  buttonText: { color: colors.white, fontWeight: "800", fontSize: 15 },
  quietText: { color: colors.lavenderSoft },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.42 },
  fieldWrap: { gap: 7 },
  label: { color: colors.lavenderSoft, fontSize: 13, fontWeight: "700" },
  input: { minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.canvasRaised, color: colors.text, paddingHorizontal: 15, fontSize: 16 },
  error: { color: colors.coralSoft, fontSize: 12 },
  banner: { backgroundColor: colors.mintDeep, paddingHorizontal: spacing.md, paddingVertical: 9 },
  bannerText: { color: colors.mint, textAlign: "center", fontSize: 12, lineHeight: 17 },
  empty: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  emptyIcon: { fontSize: 38 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  emptyBody: { color: colors.textMuted, textAlign: "center", lineHeight: 21 },
  surface: { backgroundColor: colors.canvasRaised, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md },
});
