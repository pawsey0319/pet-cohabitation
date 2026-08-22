import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../src/auth/SessionProvider";
import { colors } from "../src/theme/tokens";

export default function IndexRoute() {
  const { profile, isLoading } = useSession();
  if (isLoading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.coral} /></View>;
  return <Redirect href={profile ? "/chats" : "/login"} />;
}
