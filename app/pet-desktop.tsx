import { Redirect, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { useRouter, type Href } from "expo-router";
import { DesktopPetSettings } from "../src/desktopPet/DesktopPetSettings";
import { PetFeatureScreen } from "../src/navigation/PetFeatureScreen";
import { OwnedPetGate, useOwnedPet } from "../src/navigation/useOwnedPet";
import { SettingsRow } from "../src/ui/SettingsRow";
import { useAppTheme } from "../src/theme/ThemeProvider";
export function PetDesktopPanel() {
  const state = useOwnedPet(); const pet = state.dashboard?.pet; const router = useRouter(); const { theme } = useAppTheme();
  return <PetFeatureScreen title="桌面异宠" description="安静待在你放置的位置。需要时点击聊天，不需要时随时隐藏。">
    <OwnedPetGate state={state}>{pet ? <>
      <DesktopPetSettings key={`${state.profile?.id}:${pet.id}`} petId={pet.id} />
      <SettingsRow title="确认透明形象" note="预览异宠本体，检查边缘和完整性" icon="image" onPress={() => router.push("/pet-growth" as Href)} />
      <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 22 }}>显隐和位置只影响当前设备。桌宠默认关闭，不开机自启；停止桌宠不会删除已发送的聊天。</Text>
    </> : null}</OwnedPetGate>
  </PetFeatureScreen>;
}

export default function LegacyPetRoute() { const params = useLocalSearchParams(); return <Redirect href={{ pathname: "/pet", params: { ...params, section: "desktop" } }} />; }
