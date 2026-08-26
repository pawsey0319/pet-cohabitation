import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/auth/SessionProvider";
import type { AdminDemoMetrics, DemoSettings } from "../../src/data/types";
import { isLocalDemoMode, requireSupabase } from "../../src/lib/supabase";
import { colors, radii, spacing } from "../../src/theme/tokens";
import { Surface } from "../../src/ui/common";

function mapSettings(row: Record<string, any>): DemoSettings {
  return { registrationEnabled: row.registration_enabled, imageGenerationEnabled: row.image_generation_enabled, implicitPetRepliesEnabled: row.implicit_pet_replies_enabled, agentWorkbenchEnabled: row.agent_workbench_enabled, structuredPetOnboardingEnabled: row.structured_pet_onboarding_enabled, maxRegisteredUsers: row.max_registered_users, globalDailyImageLimit: row.global_daily_image_limit, testEndsAt: row.test_ends_at, purgeAfterDays: row.purge_after_days, evolutionThresholdMode: row.evolution_threshold_mode ?? "standard" };
}

function mapMetrics(row: Record<string, any>): AdminDemoMetrics {
  return { registeredUsers: Number(row.registered_users), spaces: Number(row.spaces), jobsToday: Number(row.jobs_today), jobsSucceededToday: Number(row.jobs_succeeded_today), jobsFailedToday: Number(row.jobs_failed_today), modelRunsToday: Number(row.model_runs_today), imageRunsToday: Number(row.image_runs_today), modelSuccessRate: Number(row.model_success_rate), averageLatencyMs: Number(row.average_latency_ms), feedback: row.feedback ?? {}, recentErrors: row.recent_errors ?? [] };
}

export default function AdminStatusScreen() {
  const { profile, isLoading } = useSession();
  const insets = useSafeAreaInsets();
  const [metrics, setMetrics] = useState<AdminDemoMetrics | null>(null);
  const [settings, setSettings] = useState<DemoSettings | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isLocalDemoMode) {
      setMetrics({ registeredUsers: 1, spaces: 2, jobsToday: 0, jobsSucceededToday: 0, jobsFailedToday: 0, modelRunsToday: 0, imageRunsToday: 0, modelSuccessRate: 100, averageLatencyMs: 0, feedback: {}, recentErrors: [] });
      setSettings({ registrationEnabled: true, imageGenerationEnabled: true, implicitPetRepliesEnabled: false, agentWorkbenchEnabled: true, structuredPetOnboardingEnabled: true, maxRegisteredUsers: 21, globalDailyImageLimit: 400, testEndsAt: null, purgeAfterDays: 30, evolutionThresholdMode: "standard" });
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const client = requireSupabase();
      const [metricResult, settingsResult] = await Promise.all([client.rpc("admin_demo_metrics"), client.from("demo_settings").select("*").eq("id", true).single()]);
      if (metricResult.error) throw metricResult.error;
      if (settingsResult.error) throw settingsResult.error;
      setMetrics(mapMetrics(metricResult.data));
      setSettings(mapSettings(settingsResult.data));
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "状态加载失败"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.coral} /></View>;
  if (!profile) return <Redirect href="/login" />;
  if (!profile.isAdmin) return <Redirect href="/me" />;

  const update = async (patch: Record<string, boolean | string>) => {
    if (isLocalDemoMode) {
      setSettings((current) => current ? { ...current, registrationEnabled: typeof patch.registration_enabled === "boolean" ? patch.registration_enabled : current.registrationEnabled, imageGenerationEnabled: typeof patch.image_generation_enabled === "boolean" ? patch.image_generation_enabled : current.imageGenerationEnabled, implicitPetRepliesEnabled: typeof patch.implicit_pet_replies_enabled === "boolean" ? patch.implicit_pet_replies_enabled : current.implicitPetRepliesEnabled, agentWorkbenchEnabled: typeof patch.agent_workbench_enabled === "boolean" ? patch.agent_workbench_enabled : current.agentWorkbenchEnabled, structuredPetOnboardingEnabled: typeof patch.structured_pet_onboarding_enabled === "boolean" ? patch.structured_pet_onboarding_enabled : current.structuredPetOnboardingEnabled, evolutionThresholdMode: patch.evolution_threshold_mode === "accelerated" ? "accelerated" : patch.evolution_threshold_mode === "standard" ? "standard" : current.evolutionThresholdMode } : current);
      return;
    }
    setBusy(true);
    try { const { error: updateError } = await requireSupabase().from("demo_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", true); if (updateError) throw updateError; await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "设置更新失败"); setBusy(false); }
  };

  const cards = metrics ? [["注册人数", `${metrics.registeredUsers} / ${settings?.maxRegisteredUsers ?? 21}`], ["关系空间", String(metrics.spaces)], ["今日模型调用", String(metrics.modelRunsToday)], ["今日图像调用", `${metrics.imageRunsToday} / ${settings?.globalDailyImageLimit ?? 400}`], ["模型成功率", `${metrics.modelSuccessRate}%`], ["平均耗时", `${metrics.averageLatencyMs} ms`]] : [];
  return <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}>
    <Pressable onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
    <View><Text style={styles.eyebrow}>ADMIN / 不展示私聊正文</Text><Text style={styles.title}>Demo 运行状态</Text></View>
    {error ? <Pressable onPress={() => void load()} style={styles.error}><Text style={styles.errorText}>{error} · 点击重试</Text></Pressable> : null}
    {busy && !metrics ? <ActivityIndicator color={colors.coral} /> : <View style={styles.grid}>{cards.map(([label, value]) => <Surface key={label} style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></Surface>)}</View>}
    {settings ? <Surface style={styles.controls}><Text style={styles.sectionTitle}>即时控制</Text><Text style={styles.copy}>发生费用异常、模型越界或集中失败时，可立即关闭对应能力；基础人类聊天不受影响。</Text>
      <View style={styles.control}><View style={styles.controlText}><Text style={styles.controlTitle}>允许邀请码注册</Text><Text style={styles.controlNote}>关闭后现有账号仍可登录</Text></View><Switch value={settings.registrationEnabled} disabled={busy} onValueChange={(value) => void update({ registration_enabled: value })} /></View>
      <View style={styles.control}><View style={styles.controlText}><Text style={styles.controlTitle}>允许图像生成</Text><Text style={styles.controlNote}>关闭后私聊和人类聊天继续可用</Text></View><Switch value={settings.imageGenerationEnabled} disabled={busy} onValueChange={(value) => void update({ image_generation_enabled: value })} /></View>
      <View style={styles.control}><View style={styles.controlText}><Text style={styles.controlTitle}>新版空间主 Agent 面板</Text><Text style={styles.controlNote}>成员主动打开面板后才会处理请求</Text></View><Switch value={settings.agentWorkbenchEnabled} disabled={busy} onValueChange={(value) => void update({ agent_workbench_enabled: value })} /></View>
      <View style={styles.control}><View style={styles.controlText}><Text style={styles.controlTitle}>新版异宠设定流程</Text><Text style={styles.controlNote}>使用结构化期望生成，不再要求五轮孵化对话</Text></View><Switch value={settings.structuredPetOnboardingEnabled} disabled={busy} onValueChange={(value) => void update({ structured_pet_onboarding_enabled: value })} /></View>
      <View style={styles.control}><View style={styles.controlText}><Text style={styles.controlTitle}>允许异宠隐式回应</Text><Text style={styles.controlNote}>明确 @ 异宠仍可回应</Text></View><Switch value={settings.implicitPetRepliesEnabled} disabled={busy} onValueChange={(value) => void update({ implicit_pet_replies_enabled: value })} /></View>
      <View style={styles.control}><View style={styles.controlText}><Text style={styles.controlTitle}>加速验证自动进化</Text><Text style={styles.controlNote}>{settings.evolutionThresholdMode === "accelerated" ? "3 个活跃日 / 12 次有效互动 / 3 类经历" : "正式节奏：14 个活跃日 / 30 次有效互动 / 3 类经历"}</Text></View><Switch value={settings.evolutionThresholdMode === "accelerated"} disabled={busy} onValueChange={(value) => void update({ evolution_threshold_mode: value ? "accelerated" : "standard" })} /></View>
    </Surface> : null}
    <Surface style={styles.controls}><Text style={styles.sectionTitle}>今日任务</Text><Text style={styles.copy}>成功 {metrics?.jobsSucceededToday ?? 0} · 失败 {metrics?.jobsFailedToday ?? 0} · 总计 {metrics?.jobsToday ?? 0}</Text>{metrics?.recentErrors.length ? metrics.recentErrors.map((item) => <View key={item.error_code} style={styles.errorRow}><Text numberOfLines={1} style={styles.errorCode}>{item.error_code}</Text><Text style={styles.errorCount}>{item.total}</Text></View>) : <Text style={styles.good}>暂无模型错误</Text>}</Surface>
    <Surface style={styles.controls}><Text style={styles.sectionTitle}>异宠回应反馈</Text><Text style={styles.copy}>自然 {metrics?.feedback.natural ?? 0} · 不相关 {metrics?.feedback.irrelevant ?? 0} · 打扰 {metrics?.feedback.intrusive ?? 0} · 越界 {metrics?.feedback.unsafe ?? 0}</Text></Surface>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas }, center: { flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }, content: { width: "100%", maxWidth: 760, alignSelf: "center", padding: spacing.lg, paddingBottom: 100, gap: spacing.md }, back: { color: colors.mint, fontWeight: "800" }, eyebrow: { color: colors.mint, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, title: { color: colors.text, fontSize: 31, fontWeight: "900" }, grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, metric: { width: "31%", minWidth: 150, flexGrow: 1 }, metricValue: { color: colors.coralSoft, fontSize: 24, fontWeight: "900" }, metricLabel: { color: colors.textMuted, marginTop: 4 }, controls: { gap: spacing.md }, sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900" }, copy: { color: colors.textMuted, lineHeight: 20 }, control: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line }, controlText: { flex: 1 }, controlTitle: { color: colors.text, fontWeight: "800" }, controlNote: { color: colors.textMuted, fontSize: 11, marginTop: 3 }, error: { backgroundColor: "#603345", borderRadius: radii.md, padding: spacing.sm }, errorText: { color: colors.coralSoft, textAlign: "center" }, errorRow: { flexDirection: "row", gap: spacing.sm }, errorCode: { flex: 1, color: colors.coralSoft, fontSize: 12 }, errorCount: { color: colors.text, fontWeight: "900" }, good: { color: colors.mint, fontWeight: "800" },
});
