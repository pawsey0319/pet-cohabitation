import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { PetFeatureScreen } from "../src/navigation/PetFeatureScreen";
import { OwnedPetGate, useOwnedPet } from "../src/navigation/useOwnedPet";
import { InteractionSettingsPanel } from "../src/memory/InteractionSettingsPanel";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { AppButton, Surface } from "../src/ui/common";
import { SettingsRow } from "../src/ui/SettingsRow";
import type { PetReplyStyle } from "../src/theme/preferences";
export default function PetSettingsRoute() {
  const state = useOwnedPet(); const pet = state.dashboard?.pet; const router = useRouter();
  const { theme, preferences, update, save, dirty, saving } = useAppTheme(); const [error, setError] = useState("");
  return <PetFeatureScreen title="相处设置" description="你明确选择的相处方式优先。临时需要可以只对今天或当前话题生效。">
    <OwnedPetGate state={state}>{pet ? <>
      {!state.isLocalDemo ? <InteractionSettingsPanel petId={pet.id} /> : <Text style={{ color: theme.muted }}>演示模式不写入云端相处设置。</Text>}
      <Surface style={{ gap: 12 }}><Text style={{ color: theme.text, fontSize: 17, fontWeight: "600" }}>回答组织方式</Text><Text style={{ color: theme.muted, lineHeight: 22 }}>用于查询和整理信息时的默认篇幅。不会扩大可以读取的群或资料范围。</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{([["concise", "简洁"], ["balanced", "均衡"], ["detailed", "详细"]] as [PetReplyStyle, string][]).map(([value, label]) => <AppButton key={value} label={label} variant={preferences.petReplyStyle === value ? "primary" : "secondary"} onPress={() => update({ petReplyStyle: value })} />)}</View>
        <AppButton label={saving ? "正在保存" : "保存回答偏好"} disabled={!dirty || saving} onPress={() => { setError(""); void save().then(() => setError("已保存，后续回应会使用这项偏好。")).catch(() => setError("保存失败，设置仍保留在这里，请重试。")); }} />
        {error ? <Text accessibilityRole="alert" style={{ color: theme.text }}>{error}</Text> : null}
      </Surface>
      <SettingsRow title="能力与授权" note="允许谁发起、可用范围与执行记录" icon="settings" onPress={() => router.push("/pet-capabilities" as Href)} />
      <SettingsRow title="性格变化" note="查看学习依据、暂停学习或恢复底色" icon="pet" onPress={() => router.push("/pet-personality" as Href)} />
      <SettingsRow title="群关系理解" note="各群分别查看和管理" icon="messages" onPress={() => router.push("/pet-relations" as Href)} />
      <SettingsRow title="桌面异宠" note="开启、隐藏和停止桌宠" icon="settings" onPress={() => router.push("/pet-desktop" as Href)} />
      <SettingsRow title="历史对话" note="陪伴及早期消息管家原始记录" icon="memory" onPress={() => router.push("/pet-history" as Href)} />
    </> : null}</OwnedPetGate>
  </PetFeatureScreen>;
}
