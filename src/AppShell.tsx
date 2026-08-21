import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomNav, type AppTab } from "./components/BottomNav";
import { HomeScreen } from "./screens/HomeScreen";
import { PetScreen } from "./screens/PetScreen";
import { SpaceScreen } from "./screens/SpaceScreen";
import { useAppState } from "./state/AppState";
import { colors } from "./theme/tokens";

export function AppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const { dispatch, isHydrated } = useAppState();
  const insets = useSafeAreaInsets();

  if (!isHydrated) {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="正在载入本机共生档案"
        testID="app-safe-area"
        style={[styles.app, styles.loading, { paddingLeft: insets.left, paddingRight: insets.right }]}
      >
        <Text style={styles.loadingText}>正在载入本机共生档案…</Text>
      </View>
    );
  }

  return (
    <View
      testID="app-safe-area"
      style={[styles.app, { paddingLeft: insets.left, paddingRight: insets.right }]}
    >
      <View testID="app-safe-top" style={[styles.screen, { paddingTop: insets.top }]}>
        {activeTab === "home" ? (
          <HomeScreen onOpenSpace={(spaceId) => {
            dispatch({ type: "SET_ACTIVE_SPACE", spaceId });
            setActiveTab("space");
          }} />
        ) : activeTab === "space" ? <SpaceScreen /> : <PetScreen />}
      </View>
      <View
        testID="app-safe-bottom"
        style={[styles.navWidth, { paddingBottom: insets.bottom }]}
      >
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
  loading: {
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
});
