import { router } from "expo-router";
import { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/auth/SessionProvider";
import { APP_STORAGE_KEY, APP_INVALID_BACKUP_KEY } from "../../src/state/AppState";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppButton, DemoBanner, Surface } from "../../src/ui/common";
import { colors, radii, spacing } from "../../src/theme/tokens";
import { requireSupabase } from "../../src/lib/supabase";

export default function MeScreen() {
  const { profile, logout, isLocalDemo } = useSession(); const insets = useSafeAreaInsets(); const [legacyCleared, setLegacyCleared] = useState(false); const [dataBusy, setDataBusy] = useState(false); const [dataMessage, setDataMessage] = useState<string | null>(null); const [deleting, setDeleting] = useState(false); const [password, setPassword] = useState("");
  const signOut = async () => { await logout(); router.replace("/login"); };
  const clearLegacy = async () => { await AsyncStorage.multiRemove([APP_STORAGE_KEY, APP_INVALID_BACKUP_KEY]); setLegacyCleared(true); };
  const downloadJson = (data: unknown) => {
    if (Platform.OS !== "web" || typeof document === "undefined") { setDataMessage("当前 Demo 请在 Web 端导出数据"); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `pet-cohabitation-export-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const exportData = async () => { setDataBusy(true); setDataMessage(null); try { if (isLocalDemo) { const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("pet-cohabitation")); const rows = await AsyncStorage.multiGet(keys); downloadJson({ exported_at: new Date().toISOString(), local_demo: true, data: Object.fromEntries(rows.map(([key, value]) => [key, value ? JSON.parse(value) : null])) }); } else { const { data, error } = await requireSupabase().functions.invoke("export-my-data", { body: {} }); if (error) throw error; downloadJson(data); } setDataMessage("导出文件已生成"); } catch (reason) { setDataMessage(reason instanceof Error ? reason.message : "导出失败"); } finally { setDataBusy(false); } };
  const deleteAccount = async () => { setDataBusy(true); setDataMessage(null); try { if (isLocalDemo) { const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("pet-cohabitation")); await AsyncStorage.multiRemove(keys); } else { const { error } = await requireSupabase().functions.invoke("delete-account", { body: { password } }); if (error) throw error; } await logout().catch(() => undefined); setDeleting(false); router.replace("/login"); } catch (reason) { setDataMessage(reason instanceof Error ? reason.message : "注销失败"); } finally { setDataBusy(false); } };
  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}>
      {isLocalDemo ? <DemoBanner /> : null}
      <Text style={styles.title}>我的</Text>
      <Surface style={styles.profile}><View style={styles.avatar}><Text style={styles.avatarText}>{profile?.nickname.slice(0, 1)}</Text></View><View style={styles.profileBody}><Text style={styles.name}>{profile?.nickname}</Text><Text style={styles.email}>{profile?.email}</Text></View></Surface>
      <Surface style={styles.section}>
        <Text style={styles.sectionTitle}>隐私与数据边界</Text>
        <Text style={styles.copy}>Demo 使用 HTTPS、Supabase Auth 与行级权限。它不是端到端加密产品；模型只由服务端函数在获授权范围内调用。</Text>
        <View style={styles.rule}><Text style={styles.ruleIcon}>◌</Text><Text style={styles.ruleText}>不做陌生人、附近的人或公开宠物广场</Text></View>
        <View style={styles.rule}><Text style={styles.ruleIcon}>◌</Text><Text style={styles.ruleText}>确认后的初始宠物编辑永久关闭</Text></View>
      </Surface>
      <Surface style={styles.section}>
        <Text style={styles.sectionTitle}>旧本机原型数据</Text><Text style={styles.copy}>旧版 AsyncStorage 数据不会上传到新聊天系统。你可以在这里单独删除。</Text>
        <AppButton label={legacyCleared ? "旧数据已删除" : "删除旧原型数据"} variant="quiet" disabled={legacyCleared} onPress={() => void clearLegacy()} />
      </Surface>
      <Surface style={styles.section}><Text style={styles.sectionTitle}>我的数据</Text><Text style={styles.copy}>可以导出自己的账号、本人消息、异宠私聊、成长札记与形态谱系，不包含其他成员的私聊内容。</Text><AppButton label={dataBusy ? "处理中…" : "导出我的数据"} variant="quiet" disabled={dataBusy} onPress={() => void exportData()} /><AppButton label="注销账号并删除数据" variant="danger" disabled={dataBusy} onPress={() => { setPassword(""); setDeleting(true); }} />{dataMessage ? <Text style={styles.dataMessage}>{dataMessage}</Text> : null}</Surface>
      {profile?.isAdmin ? <><Pressable onPress={() => router.push("/admin/status")} style={styles.admin}><Text style={styles.adminText}>管理员 · Demo 运行状态</Text><Text style={styles.arrow}>›</Text></Pressable><Pressable onPress={() => router.push("/admin/invites")} style={styles.admin}><Text style={styles.adminText}>管理员 · 创建注册邀请码</Text><Text style={styles.arrow}>›</Text></Pressable></> : null}
      <AppButton label="退出登录" variant="danger" onPress={() => void signOut()} />
      <Text style={styles.version}>异宠共生 Web Demo · v1</Text>
      <Modal transparent visible={deleting} animationType="fade" onRequestClose={() => setDeleting(false)}><View style={styles.overlay}><Surface style={styles.deleteCard}><Text style={styles.deleteTitle}>确认注销账号</Text><Text style={styles.copy}>{isLocalDemo ? "本地体验数据会立即从当前浏览器删除，且无法恢复。" : "请输入当前密码再次验证。异宠私聊、草稿、画像和媒体会删除；关系空间中的本人消息会匿名化。"}</Text>{!isLocalDemo ? <TextInput accessibilityLabel="当前密码" secureTextEntry value={password} onChangeText={setPassword} placeholder="当前密码" placeholderTextColor={colors.textMuted} style={styles.password} /> : null}<AppButton label="取消" variant="quiet" disabled={dataBusy} onPress={() => setDeleting(false)} /><AppButton label={dataBusy ? "正在删除…" : "永久注销并删除"} variant="danger" disabled={dataBusy || (!isLocalDemo && password.length < 8)} onPress={() => void deleteAccount()} /></Surface></View></Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas }, content: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: spacing.md, paddingBottom: 100, gap: spacing.md }, title: { color: colors.text, fontSize: 32, fontWeight: "900" },
  profile: { flexDirection: "row", gap: spacing.md, alignItems: "center" }, avatar: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.white, fontSize: 22, fontWeight: "900" },
  profileBody: { flex: 1 }, name: { color: colors.text, fontSize: 20, fontWeight: "900" }, email: { color: colors.textMuted, marginTop: 3 }, section: { gap: spacing.md }, sectionTitle: { color: colors.lavenderSoft, fontSize: 17, fontWeight: "900" }, copy: { color: colors.textMuted, lineHeight: 21 },
  rule: { flexDirection: "row", gap: spacing.sm }, ruleIcon: { color: colors.mint }, ruleText: { color: colors.text, flex: 1 }, admin: { minHeight: 54, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, adminText: { color: colors.text, fontWeight: "800" }, arrow: { color: colors.mint, fontSize: 26 }, version: { color: colors.textMuted, textAlign: "center", fontSize: 12 },
  dataMessage: { color: colors.mint, textAlign: "center", fontSize: 12 }, overlay: { flex: 1, backgroundColor: "rgba(4,3,13,.78)", alignItems: "center", justifyContent: "center", padding: spacing.lg }, deleteCard: { width: "100%", maxWidth: 480, gap: spacing.md }, deleteTitle: { color: colors.text, fontSize: 22, fontWeight: "900" }, password: { minHeight: 50, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: spacing.md },
});
