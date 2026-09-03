import type { ErrorBoundaryProps } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/tokens";

// Keep unexpected route/effect errors recoverable, including production APKs.
// Deliberately do not render stack traces or server details to the user.
export function RouteErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <View style={styles.page}>
    <Text accessibilityRole="header" style={styles.title}>页面暂时遇到了问题</Text>
    <Text style={styles.body}>请点击重试。如果仍无法打开，请重新启动 App，并告诉我们刚才点击了哪个入口。</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="重试页面" onPress={() => void retry()} style={styles.button}>
      <Text style={styles.label}>重试页面</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", padding: 28, gap: 18, backgroundColor: colors.canvas },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 24 },
  button: { alignSelf: "flex-start", backgroundColor: colors.coral, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 24 },
  label: { color: colors.textDark, fontSize: 16, fontWeight: "800" },
});
