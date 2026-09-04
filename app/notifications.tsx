import { type Href, router } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNotificationInbox, type NotificationEvent } from "../src/notifications/inbox";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { colors, spacing } from "../src/theme/tokens";
import { EmptyState } from "../src/ui/common";

const kindGlyph: Readonly<Record<NotificationEvent["kind"], string>> = {
  message: "◍",
  mention: "@",
  proposal: "◇",
  reminder: "◷",
  agent_result: "✦",
};

function formatTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { events, loading, error, reload, markRead } = useNotificationInbox();

  const open = async (event: NotificationEvent) => {
    try {
      if (!event.readAt) await markRead(event.id);
    } finally {
      if (event.spaceId && event.messageId) router.push({ pathname: "/chat/[spaceId]", params: { spaceId: event.spaceId, messageId: event.messageId } });
      else router.push(event.route as Href);
    }
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top, backgroundColor: theme.page }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={[styles.back, { backgroundColor: theme.card }]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>跨设备同步</Text>
          <Text style={styles.title}>通知</Text>
        </View>
      </View>
      {error ? (
        <Pressable onPress={() => void reload()} style={styles.error}>
          <Text style={styles.errorText}>通知暂时加载失败 · 点击重试</Text>
        </Pressable>
      ) : null}
      {loading ? <ActivityIndicator color={theme.accent} style={styles.loading} /> : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          contentContainerStyle={events.length ? styles.list : styles.empty}
          ListEmptyComponent={<EmptyState icon="◌" title="暂时没有通知" body="新消息、提案、提醒和 Agent 结果会集中出现在这里。" />}
          renderItem={({ item }) => (
            <Pressable onPress={() => void open(item)} style={[styles.row, { backgroundColor: theme.card, borderColor: item.readAt ? theme.line : theme.accent }]}>
              <View style={[styles.glyph, { backgroundColor: item.readAt ? theme.cardSoft : theme.primary }]}>
                <Text style={styles.glyphText}>{kindGlyph[item.kind]}</Text>
              </View>
              <View style={styles.copy}>
                <View style={styles.topline}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
                </View>
                <Text numberOfLines={2} style={styles.body}>{item.body}</Text>
              </View>
              {!item.readAt ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  back: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.text, fontSize: 34, lineHeight: 37 },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.mint, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 28, fontWeight: "900" },
  list: { padding: spacing.md, gap: 10, paddingBottom: 40 },
  empty: { flexGrow: 1, justifyContent: "center" },
  loading: { marginTop: 60 },
  row: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 20, padding: 13 },
  glyph: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  glyphText: { color: colors.text, fontSize: 19, fontWeight: "900" },
  copy: { flex: 1, gap: 5 },
  topline: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "900" },
  time: { color: colors.textMuted, fontSize: 10 },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  error: { margin: spacing.md, padding: 12, borderRadius: 14, backgroundColor: "#5B3040" },
  errorText: { color: colors.coralSoft, textAlign: "center", fontWeight: "700" },
});
