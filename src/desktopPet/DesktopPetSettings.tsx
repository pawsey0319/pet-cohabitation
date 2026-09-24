import { useEffect, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { getDesktopPetModule } from "./native";
import type { DesktopPetStatus } from "./contracts";

export function DesktopPetSettings({ petId }: { petId: string }) {
  const { profile, isLocalDemo } = useSession(), { theme } = useAppTheme();
  const [state, setState] = useState<DesktopPetStatus | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const native = getDesktopPetModule();
  useEffect(() => {
    if (!native) return;
    let mounted = true;
    const refresh = () => { void native.status().then(value => { if (mounted) setState(value); }).catch(() => undefined); };
    refresh(); const listener = native.addListener("onDesktopPetState", refresh);
    const app = AppState.addEventListener("change", value => { if (value === "active") refresh(); });
    return () => { mounted = false; listener.remove(); app.remove(); };
  }, [native]);
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); if (native) setState(await native.status()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "暂时未完成，请重试。"); }
    finally { setBusy(false); }
  };
  const button = (label: string, action: () => Promise<unknown>) => <Pressable key={label} accessibilityRole="button" disabled={busy} onPress={() => void perform(action)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }}><Text style={{ color: theme.primary }}>{label}</Text></Pressable>;
  if (Platform.OS !== "android") return <Text>Windows 桌宠需安装独立桌宠程序；网页保留完整陪伴功能。</Text>;
  if (!native) return <Text>桌面异宠需要安装新版安卓 APK。当前版本仍可使用 App 内陪伴。</Text>;
  const running = state?.running && state.ownerId === profile?.id && state.petId === petId;
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.text, fontWeight: "700", fontSize: 17 }}>桌面异宠</Text>
    <Text style={{ color: theme.text }}>在桌面和其他 App 上方陪伴你。可以拖动、点击聊天、长按隐藏或停止；不会自动开机启动。</Text>
    <Text style={{ color: theme.text }}>{running ? !state.imageReady ? "正在验证并载入透明形象" : state.hidden ? "已隐藏，可从通知或这里恢复" : "已开启，后台通知可随时关闭" : "尚未开启"}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {!state?.permission ? button("允许悬浮显示", () => native.requestPermission()) : !running ? button("开启桌宠", async () => {
        if (!profile || isLocalDemo) throw new Error("请登录真实账号并确认透明异宠形象。");
        await native.start(profile.id, petId);
      }) : <>{button(state.hidden ? "显示桌宠" : "隐藏桌宠", () => state.hidden ? native.show() : native.hide())}{button("停止桌宠", () => native.stop(profile!.id))}
        {button("缩小", () => native.setSize((state.size ?? 112) - 20))}{button("放大", () => native.setSize((state.size ?? 112) + 20))}</>}
    </View>
    {error || state?.error ? <Text accessibilityRole="alert" style={{ color: theme.text }}>{error ?? state?.error}</Text> : null}
  </View>;
}
