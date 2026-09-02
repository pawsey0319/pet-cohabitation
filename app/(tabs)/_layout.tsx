import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSession } from "../../src/auth/SessionProvider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../src/theme/tokens";
import { useAppTheme } from "../../src/theme/ThemeProvider";

function TabGlyph({ glyph, focused, active, muted }: Readonly<{ glyph: string; focused: boolean; active: string; muted: string }>) {
  return <Text style={[styles.glyph, { color: focused ? active : muted }]}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { profile, isLoading } = useSession();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  if (isLoading) return <View style={[styles.loading, { backgroundColor: theme.page }]}><ActivityIndicator color={theme.primary} /></View>;
  if (!profile) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: theme.accent,
      tabBarInactiveTintColor: theme.muted,
      tabBarHideOnKeyboard: true,
      tabBarStyle: [styles.bar, { height: 58 + insets.bottom, paddingBottom: Math.max(insets.bottom, 6), backgroundColor: theme.card, borderTopColor: theme.line }],
      tabBarLabelStyle: styles.label,
    }}>
      <Tabs.Screen name="chats/index" options={{ title: "消息", tabBarIcon: ({ focused }) => <TabGlyph glyph="◍" focused={focused} active={theme.accent} muted={theme.muted} /> }} />
      <Tabs.Screen name="pet" options={{ title: "异宠", tabBarIcon: ({ focused }) => <TabGlyph glyph="✦" focused={focused} active={theme.accent} muted={theme.muted} /> }} />
      <Tabs.Screen name="me" options={{ title: "我的", tabBarIcon: ({ focused }) => <TabGlyph glyph="○" focused={focused} active={theme.accent} muted={theme.muted} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  bar: { backgroundColor: colors.canvasRaised, borderTopColor: colors.line, height: 68, paddingTop: 7 }, label: { fontSize: 12, fontWeight: "700", paddingBottom: 5 },
  glyph: { fontSize: 21 },
});
