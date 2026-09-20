import { ActivityIndicator, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../src/auth/SessionProvider";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { AppButton } from "../src/ui/common";
import { WorkItemsPanel } from "../src/work/WorkItemsPanel";
import { workRouteParam } from "../src/work/routeParams";

export default function GroupItemsScreen() {
  const { profile, isLoading } = useSession();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ spaceId?: string | string[]; itemId?: string | string[] }>();
  const spaceId = workRouteParam(params.spaceId);
  const itemId = workRouteParam(params.itemId);
  if (isLoading) return <ActivityIndicator color={theme.accent} />;
  if (!profile) return <Redirect href="/login" />;
  const back = () => {
    if (router.canGoBack()) router.back();
    else if (spaceId) router.replace({ pathname: "/chat/[spaceId]", params: { spaceId } });
    else router.replace("/chats");
  };
  return <View style={{ flex: 1, paddingTop: insets.top + 8, paddingBottom: insets.bottom, backgroundColor: theme.page, gap: 8 }}>
    <View style={{ alignItems: "flex-start", paddingHorizontal: 16 }}><AppButton label="返回群聊" variant="quiet" onPress={back} /></View>
    {spaceId ? <WorkItemsPanel spaceId={spaceId} initialItemId={itemId} /> : <Text style={{ padding: 16, color: theme.muted }}>群聊信息不完整，请返回群聊后重新打开群事项。</Text>}
  </View>;
}
