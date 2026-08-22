import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSession } from "../../src/auth/SessionProvider";
import { colors } from "../../src/theme/tokens";

function TabGlyph({ glyph, focused }: Readonly<{ glyph: string; focused: boolean }>) {
  return <Text style={[styles.glyph, focused && styles.glyphActive]}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { profile, isLoading } = useSession();
  if (isLoading) return <View style={styles.loading}><ActivityIndicator color={colors.coral} /></View>;
  if (!profile) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.coralSoft,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: styles.bar,
      tabBarLabelStyle: styles.label,
    }}>
      <Tabs.Screen name="chats/index" options={{ title: "消息", tabBarIcon: ({ focused }) => <TabGlyph glyph="◍" focused={focused} /> }} />
      <Tabs.Screen name="pet" options={{ title: "异宠", tabBarIcon: ({ focused }) => <TabGlyph glyph="✦" focused={focused} /> }} />
      <Tabs.Screen name="me" options={{ title: "我的", tabBarIcon: ({ focused }) => <TabGlyph glyph="○" focused={focused} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  bar: { backgroundColor: colors.canvasRaised, borderTopColor: colors.line, height: 68, paddingTop: 7 }, label: { fontSize: 12, fontWeight: "700", paddingBottom: 5 },
  glyph: { color: colors.textMuted, fontSize: 21 }, glyphActive: { color: colors.coral },
});
