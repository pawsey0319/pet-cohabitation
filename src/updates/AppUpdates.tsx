import { useEffect, useState, useSyncExternalStore } from "react";
import { Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule } from "expo-modules-core";
import * as Updates from "expo-updates";
import { createUpdateController } from "./controller";
import { APPLICATION_ID, fetchRelease, type InstalledApp } from "./release";
import { useAppTheme } from "../theme/ThemeProvider";

function readNativeApp() {
  try {
    return Platform.OS === "android" && typeof requireOptionalNativeModule === "function"
      ? requireOptionalNativeModule<{ nativeApplicationVersion?: string; nativeBuildVersion?: string; applicationId?: string }>("ExpoApplication") : null;
  } catch { return null; }
}
const nativeApp = readNativeApp();
export const installedApp: InstalledApp = { version: nativeApp?.nativeApplicationVersion ?? Updates.runtimeVersion, versionCode: nativeApp?.nativeBuildVersion ? Number(nativeApp.nativeBuildVersion) : null, runtimeVersion: Updates.runtimeVersion, channel: Updates.channel, applicationId: nativeApp?.applicationId ?? (Updates.channel === "preview" ? APPLICATION_ID : null) };
const controller = createUpdateController({
  installed: installedApp, supported: Platform.OS === "android" && !__DEV__, otaEnabled: Updates.isEnabled,
  release: fetchRelease,
  checkOTA: async () => {
    const result = await Updates.checkForUpdateAsync();
    return { isAvailable: result.isAvailable, isRollBackToEmbedded: result.isRollBackToEmbedded, manifest: "manifest" in result ? result.manifest : undefined };
  },
  fetchOTA: async () => {
    const result = await Updates.fetchUpdateAsync();
    return { isNew: result.isNew, isRollBackToEmbedded: result.isRollBackToEmbedded, manifest: "manifest" in result ? result.manifest : undefined };
  },
  reload: () => Updates.reloadAsync(), openURL: url => Linking.openURL(url),
});
const useUpdateState = () => useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

export function AppUpdatePanel() {
  const state = useUpdateState();
  const dark = useAppTheme().theme.isDark, ink = dark ? "#F4F3EF" : "#202522", muted = dark ? "#BDBFB7" : "#60665F";
  const busy = state.phase === "checking" || state.phase === "downloading";
  const primary = state.phase === "native" ? "下载并更新" : state.phase === "available" ? "下载体验更新" : state.phase === "ready" ? "重新打开并应用更新" : "检查更新";
  const act = () => state.phase === "ready" ? controller.apply() : ["native", "available"].includes(state.phase) ? controller.download() : controller.check();
  return <View style={{ gap: 14, padding: 18 }}>
    <Text style={{ fontSize: 19, color: ink, fontWeight: "600" }}>应用更新</Text>
    <Text style={{ color: muted }}>当前安装版本 {installedApp.version ?? "未识别"}{installedApp.versionCode ? `（${installedApp.versionCode}）` : ""}</Text>
    <Text style={{ color: muted, fontSize: 12 }}>体验更新：{Updates.updateId ? Updates.updateId.slice(0, 8) : "安装包内置版本"}</Text>
    <Text style={{ color: ink, lineHeight: 23 }} accessibilityLiveRegion="polite">{state.message || "在这里获取云端发布的新版本。"}</Text>
    {state.release?.notes.map((note, index) => <Text key={index} style={{ color: muted, lineHeight: 22 }}>· {note}</Text>)}
    {state.release ? <Text style={{ color: muted }}>安装包约 {Math.ceil(state.release.bytes / 1024 / 1024)} MB。安卓会要求你确认安装。</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act()} style={{ backgroundColor: dark ? "#B4C7AC" : "#344D36", borderRadius: 12, padding: 14, opacity: busy ? .6 : 1 }}><Text style={{ textAlign: "center", fontWeight: "600", color: dark ? "#172317" : "white" }}>{busy ? state.phase === "checking" ? "正在检查…" : "正在准备更新…" : primary}</Text></Pressable>
    <Text style={{ color: muted, fontSize: 12, lineHeight: 20 }}>普通界面与功能修复可直接云端更新。需要升级安装包时，从这里下载并覆盖安装，账号和资料会保留。</Text>
  </View>;
}

export function AppUpdateNotice() {
  const state = useUpdateState(); const [dismissed, setDismissed] = useState(true);
  const dark = useAppTheme().theme.isDark;
  useEffect(() => {
    if (Platform.OS !== "android" || __DEV__) return;
    const timer = setTimeout(() => void controller.check(), 3500);
    return () => clearTimeout(timer);
  }, []);
  const code = state.release?.versionCode;
  useEffect(() => {
    let active = true;
    if (!code || state.phase !== "native") return;
    void AsyncStorage.getItem(`pet-update-dismissed:${code}`).then(value => { if (active) setDismissed(value === "1"); }).catch(() => {});
    return () => { active = false; };
  }, [code, state.phase]);
  const close = () => { setDismissed(true); if (code) void AsyncStorage.setItem(`pet-update-dismissed:${code}`, "1").catch(() => {}); };
  return <Modal visible={!dismissed && !!state.release && ["native", "downloading", "handedOff", "error"].includes(state.phase)} transparent animationType="fade" onRequestClose={close}>
    <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,.35)" }}><View style={{ borderRadius: 18, backgroundColor: dark ? "#222722" : "#FAFAF7" }}><AppUpdatePanel /><Pressable accessibilityRole="button" onPress={close} style={{ padding: 16 }}><Text style={{ color: dark ? "#BDBFB7" : "#60665F", textAlign: "center" }}>稍后再说</Text></Pressable></View></View>
  </Modal>;
}
