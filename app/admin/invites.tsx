import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/auth/SessionProvider";
import { isLocalDemoMode, requireSupabase } from "../../src/lib/supabase";
import { AppButton, Surface } from "../../src/ui/common";
import { colors, spacing } from "../../src/theme/tokens";

export default function AdminInvitesScreen() {
  const { profile, isLoading } = useSession(); const insets = useSafeAreaInsets(); const [code, setCode] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  if (isLoading) return <View style={styles.loading}><Text style={styles.copy}>正在恢复会话…</Text></View>;
  if (!profile) return <Redirect href="/login" />; if (!profile.isAdmin) return <Redirect href="/me" />;
  const create = async () => { setBusy(true); setError(null); try { if (isLocalDemoMode) setCode(`DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`); else { const { data, error: rpcError } = await requireSupabase().rpc("create_signup_invite"); if (rpcError) throw rpcError; setCode(String(data)); } } catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败"); } finally { setBusy(false); } };
  return <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={styles.title}>注册邀请码</Text><Text style={styles.copy}>每个邀请码只能注册一个账号。邀请码默认 7 天有效；账号创建后即标记为已使用。</Text><Surface style={styles.codeCard}>{code ? <><Text style={styles.codeLabel}>新邀请码</Text><Text selectable style={styles.code}>{code}</Text></> : <View style={styles.placeholder}><Text style={styles.placeholderText}>点击下方按钮生成</Text></View>}{error ? <Text style={styles.error}>{error}</Text> : null}<AppButton label={busy ? "生成中…" : "创建单次邀请码"} disabled={busy} onPress={() => void create()} /></Surface></ScrollView>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: colors.canvas }, loading: { flex: 1, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" }, content: { width: "100%", maxWidth: 560, alignSelf: "center", padding: spacing.lg, gap: spacing.md }, back: { color: colors.mint, fontWeight: "800" }, title: { color: colors.text, fontSize: 30, fontWeight: "900" }, copy: { color: colors.textMuted, lineHeight: 22 }, codeCard: { gap: spacing.md }, codeLabel: { color: colors.textMuted, fontSize: 12 }, code: { color: colors.coralSoft, fontSize: 24, fontWeight: "900", letterSpacing: 2, textAlign: "center", paddingVertical: spacing.lg }, placeholder: { padding: spacing.xl }, placeholderText: { color: colors.textMuted, textAlign: "center" }, error: { color: colors.coralSoft } });
