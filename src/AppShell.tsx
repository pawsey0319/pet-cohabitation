import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomNav, type AppTab } from "./components/BottomNav";
import { HomeScreen } from "./screens/HomeScreen";
import { useAppState } from "./state/AppState";
import { colors, spacing, typography } from "./theme/tokens";

function PlaceholderScreen({ tab }: Readonly<{ tab: Exclude<AppTab, "home"> }>) {
  const { state } = useAppState();
  const isSpace = tab === "space";

  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderKicker}>{isSpace ? "RELATIONSHIP SPACES" : "LIFELONG PET"}</Text>
      <Text style={styles.placeholderTitle}>{isSpace ? "空间" : state.pet.name}</Text>
      <Text style={styles.placeholderBody}>
        {isSpace
          ? `${state.spaces.length} 个关系空间已就位，详细互动将在下一阶段接入。`
          : "异宠档案与成长轨迹将在下一阶段接入。"}
      </Text>
    </View>
  );
}

export function AppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");

  return (
    <View style={styles.app}>
      <View style={styles.screen}>
        {activeTab === "home" ? <HomeScreen /> : <PlaceholderScreen tab={activeTab} />}
      </View>
      <View style={styles.navWidth}>
        <BottomNav activeTab={activeTab} onChange={setActiveTab} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    minHeight: "100%",
    backgroundColor: colors.canvas,
  },
  screen: {
    flex: 1,
  },
  navWidth: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  placeholderKicker: {
    color: colors.coral,
    fontSize: typography.eyebrow,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  placeholderTitle: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: typography.display,
    fontWeight: "900",
  },
  placeholderBody: {
    maxWidth: 420,
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 24,
    textAlign: "center",
  },
});
