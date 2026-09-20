import { Icon } from "../../src/ui/Icon";
import { createThemedStyles } from "../../src/theme/themedStyles";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSession } from "../../src/auth/SessionProvider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../src/theme/tokens";
import { useAppTheme } from "../../src/theme/ThemeProvider";

export default function TabsLayout() {
  const { styles, colors } = useStyles();
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
      tabBarStyle: [styles.bar, { height: 64 + insets.bottom, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: theme.card, borderTopColor: theme.line }],
      tabBarLabelStyle: styles.label,
    }}>
      <Tabs.Screen name="chats/index" options={{ title: "消息", tabBarIcon: ({ focused }) => <Icon name="messages" color={focused ? theme.accent : theme.muted} /> }} />
      <Tabs.Screen name="pet" options={{ title: "异宠", tabBarIcon: ({ focused }) => <Icon name="pet" color={focused ? theme.accent : theme.muted} /> }} />
      <Tabs.Screen name="items" options={{ title: "事项", tabBarIcon: ({ focused }) => <Icon name="check" color={focused ? theme.accent : theme.muted} /> }} />
      <Tabs.Screen name="me" options={{ title: "我的", tabBarIcon: ({ focused }) => <Icon name="user" color={focused ? theme.accent : theme.muted} /> }} />
    </Tabs>
  );
}

const useStyles = createThemedStyles((colors, theme) => ({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  bar: { backgroundColor: colors.canvasRaised, borderTopColor: colors.line, height: 68, paddingTop: 6 }, label: { fontSize: 11, fontWeight: "500", paddingBottom: 0 },
  glyph: { fontSize: 21 },
}));
