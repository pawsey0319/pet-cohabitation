import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/auth/SessionProvider";
import { APP_STORAGE_KEY, APP_INVALID_BACKUP_KEY } from "../../src/state/AppState";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppButton, DemoBanner, Surface } from "../../src/ui/common";
import { colors, radii, spacing } from "../../src/theme/tokens";

export default function MeScreen() {
  const { profile, logout, isLocalDemo } = useSession(); const insets = useSafeAreaInsets(); const [legacyCleared, setLegacyCleared] = useState(false);
  const signOut = async () => { await logout(); router.replace("/login"); };
  const clearLegacy = async () => { await AsyncStorage.multiRemove([APP_STORAGE_KEY, APP_INVALID_BACKUP_KEY]); setLegacyCleared(true); };
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
      {profile?.isAdmin ? <Pressable onPress={() => router.push("/admin/invites")} style={styles.admin}><Text style={styles.adminText}>管理员 · 创建注册邀请码</Text><Text style={styles.arrow}>›</Text></Pressable> : null}
      <AppButton label="退出登录" variant="danger" onPress={() => void signOut()} />
      <Text style={styles.version}>异宠共生 Web Demo · v1</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas }, content: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: spacing.md, paddingBottom: 100, gap: spacing.md }, title: { color: colors.text, fontSize: 32, fontWeight: "900" },
  profile: { flexDirection: "row", gap: spacing.md, alignItems: "center" }, avatar: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.white, fontSize: 22, fontWeight: "900" },
  profileBody: { flex: 1 }, name: { color: colors.text, fontSize: 20, fontWeight: "900" }, email: { color: colors.textMuted, marginTop: 3 }, section: { gap: spacing.md }, sectionTitle: { color: colors.lavenderSoft, fontSize: 17, fontWeight: "900" }, copy: { color: colors.textMuted, lineHeight: 21 },
  rule: { flexDirection: "row", gap: spacing.sm }, ruleIcon: { color: colors.mint }, ruleText: { color: colors.text, flex: 1 }, admin: { minHeight: 54, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, adminText: { color: colors.text, fontWeight: "800" }, arrow: { color: colors.mint, fontSize: 26 }, version: { color: colors.textMuted, textAlign: "center", fontSize: 12 },
});
