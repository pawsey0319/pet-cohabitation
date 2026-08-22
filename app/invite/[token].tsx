import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSession } from "../../src/auth/SessionProvider";
import { createChatRepository } from "../../src/data/chatRepository";
import { AppButton, Surface } from "../../src/ui/common";
import { colors, spacing } from "../../src/theme/tokens";

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>(); const { profile, isLoading } = useSession();
  const repository = useMemo(() => profile ? createChatRepository(profile) : null, [profile]); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  if (isLoading) return <View style={styles.page}><ActivityIndicator color={colors.coral} /></View>;
  if (!profile) return <Redirect href={{ pathname: "/login", params: { next: `/invite/${token}` } }} />;
  const join = async () => { setBusy(true); setError(null); try { const spaceId = await repository!.joinSpace(token); router.replace({ pathname: "/chat/[spaceId]", params: { spaceId } }); } catch (reason) { setError(reason instanceof Error ? reason.message : "加入失败"); } finally { setBusy(false); } };
  return <View style={styles.page}><Surface style={styles.card}><Text style={styles.icon}>✦</Text><Text style={styles.title}>有人邀请你进入关系空间</Text><Text style={styles.copy}>邀请链接 7 天有效。加入后，空间内所有异宠的对话观察都会暂停，直到当前成员重新一致同意。</Text>{error ? <Text style={styles.error}>{error}</Text> : null}{busy ? <ActivityIndicator color={colors.coral} /> : <AppButton label="接受邀请" onPress={() => void join()} />}</Surface></View>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center", padding: spacing.lg }, card: { width: "100%", maxWidth: 460, alignItems: "center", gap: spacing.md }, icon: { color: colors.mint, fontSize: 38 }, title: { color: colors.text, fontSize: 23, fontWeight: "900", textAlign: "center" }, copy: { color: colors.textMuted, lineHeight: 22, textAlign: "center" }, error: { color: colors.coralSoft, textAlign: "center" } });
