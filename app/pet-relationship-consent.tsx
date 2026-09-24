import { Text } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useSession } from "../src/auth/SessionProvider";
import { PetFeatureScreen } from "../src/navigation/PetFeatureScreen";
import { RelationshipConsentPanel } from "../src/personality/RelationshipConsentPanel";
import { workRouteParam } from "../src/work/routeParams";
import { useAppTheme } from "../src/theme/ThemeProvider";
export default function RelationshipConsentRoute() {
  const { profile, isLocalDemo } = useSession(); const { theme } = useAppTheme();
  const params = useLocalSearchParams<{ spaceId?: string | string[]; petId?: string | string[] }>();
  const spaceId = workRouteParam(params.spaceId), petId = workRouteParam(params.petId);
  if (!profile) return <Redirect href="/login" />;
  return <PetFeatureScreen title="群关系学习授权">{!isLocalDemo && spaceId && petId ? <RelationshipConsentPanel key={`${profile.id}:${spaceId}:${petId}`} ownerId={profile.id} spaceId={spaceId} petId={petId} /> : <Text style={{ color: theme.muted }}>请从已加入群聊的群工具选择一只异宠，再管理授权。</Text>}</PetFeatureScreen>;
}
