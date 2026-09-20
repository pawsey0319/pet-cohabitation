import { View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../../src/theme/ThemeProvider";
import { WorkItemsPanel } from "../../src/work/WorkItemsPanel";
import { workRouteParam } from "../../src/work/routeParams";

export default function ItemsScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ itemId?: string | string[]; spaceId?: string | string[] }>();
  const spaceId = workRouteParam(params.spaceId);
  const itemId = workRouteParam(params.itemId);
  if (spaceId) return <Redirect href={{ pathname: "/group-items", params: { spaceId, ...(itemId ? { itemId } : {}) } }} />;
  return <View style={{ flex: 1, paddingTop: insets.top + 8, backgroundColor: theme.page }}><WorkItemsPanel initialItemId={itemId} /></View>;
}
