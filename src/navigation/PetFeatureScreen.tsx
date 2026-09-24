import { PetSectionNav } from "../components/PetSectionNav";
import { usePetSection } from "../pets/PetSectionScope";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardScreen, KeyboardScrollView } from "../components/KeyboardLayout";
import { useAppTheme } from "../theme/ThemeProvider";
import { Icon } from "../ui/Icon";

export function PetFeatureScreen({ title, description, children, scroll = true }: { title: string; description?: string; children: ReactNode; scroll?: boolean }) {
  const section = usePetSection();
  const { theme } = useAppTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const content = <View style={{ width: "100%", maxWidth: 760, alignSelf: "center", padding: 16, gap: 16 }}>{description ? <Text style={{ color: theme.muted, fontSize: 15, lineHeight: 23 }}>{description}</Text> : null}{children}</View>;
  return <KeyboardScreen style={{ flex: 1, backgroundColor: theme.page, paddingTop: insets.top }}>
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 56, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: theme.line, backgroundColor: theme.card }}>
      {!section ? <Pressable accessibilityRole="button" accessibilityLabel="返回异宠" onPress={() => router.canGoBack() ? router.back() : router.replace("/pet" as Href)} style={{ width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}><Icon name="back" color={theme.text} /></Pressable> : null}
      <Text accessibilityRole="header" style={{ flex: 1, color: theme.text, fontSize: 20, fontWeight: "600" }}>{title}</Text>
    </View>
    {section ? <PetSectionNav value={section.section} onChange={section.navigate} /> : null}
    {scroll ? <KeyboardScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>{content}</KeyboardScrollView> : content}
  </KeyboardScreen>;
}
