import { Link, Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from "react-native";
import { useSession } from "../../src/auth/SessionProvider";
import { AppButton, AppField, DemoBanner, Surface } from "../../src/ui/common";
import { colors, spacing } from "../../src/theme/tokens";

export default function RegisterScreen() {
  const { register, profile, isLocalDemo } = useSession();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [inviteCode, setInviteCode] = useState(isLocalDemo ? "LOCAL-DEMO" : "");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const destination = next?.startsWith("/invite/") ? next as `/invite/${string}` : "/chats" as const;
  if (profile) return <Redirect href={destination} />;
  const submit = async () => {
    setBusy(true); setError(null);
    try { await register({ inviteCode: inviteCode.trim(), email: email.trim(), password, nickname: nickname.trim() }); router.replace(destination); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "注册失败"); }
    finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.page}>
      {isLocalDemo ? <DemoBanner /> : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>加入一个只属于熟人的小空间</Text>
        <Text style={styles.subtitle}>这里没有陌生人匹配。注册邀请码由管理员发放，关系空间通过 7 天邀请链接加入。</Text>
        <Surface style={styles.card}>
          <AppField label="注册邀请码" value={inviteCode} onChangeText={setInviteCode} autoCapitalize="characters" />
          <AppField label="昵称" value={nickname} onChangeText={setNickname} maxLength={30} />
          <AppField label="邮箱" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <AppField label="密码（至少 8 位）" value={password} onChangeText={setPassword} secureTextEntry error={error} />
          {busy ? <ActivityIndicator color={colors.coral} /> : <AppButton label="创建账号" onPress={() => void submit()} disabled={!inviteCode || !email || password.length < 8 || !nickname.trim()} />}
          <Text style={styles.tip}><Link href={{ pathname: "/login", params: next ? { next } : {} }} style={styles.link}>返回登录</Link></Text>
        </Surface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas }, content: { flexGrow: 1, justifyContent: "center", width: "100%", maxWidth: 480, alignSelf: "center", padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 30, lineHeight: 38, fontWeight: "900" }, subtitle: { color: colors.textMuted, lineHeight: 22 }, card: { gap: spacing.md }, tip: { textAlign: "center" }, link: { color: colors.mint, fontWeight: "800" },
});
