import { createThemedStyles } from "../../src/theme/themedStyles";
import { KeyboardScreen } from "../../src/components/KeyboardLayout";
import { Link, Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSession } from "../../src/auth/SessionProvider";
import { AppButton, AppField, DemoBanner, Surface } from "../../src/ui/common";
import { colors, spacing } from "../../src/theme/tokens";

export default function LoginScreen() {
  const { styles, colors } = useStyles();
  const { login, profile, isLocalDemo } = useSession();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [email, setEmail] = useState(isLocalDemo ? "demo@example.com" : "");
  const [password, setPassword] = useState(isLocalDemo ? "demo-password" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const destination = next?.startsWith("/invite/") ? next as `/invite/${string}` : "/pet" as const;
  if (profile) return <Redirect href={destination} />;

  const submit = async () => {
    setBusy(true); setError(null);
    try { await login(email.trim(), password); router.replace(destination); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "登录失败"); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardScreen style={styles.page}>
      {isLocalDemo ? <DemoBanner /> : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}><Text style={styles.mark}>◉</Text><Text style={styles.eyebrow}>异宠共生空间</Text><Text style={styles.title}>回来看看，彼此最近过得怎样</Text></View>
        <Surface style={styles.card}>
          <AppField label="邮箱" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <AppField label="密码" value={password} onChangeText={setPassword} secureTextEntry error={error} />
          {busy ? <ActivityIndicator color={colors.coral} /> : <AppButton label={isLocalDemo ? "进入本地体验" : "登录"} onPress={() => void submit()} disabled={!email || !password} />}
          <Text style={styles.tip}>还没有账号？ <Link href={{ pathname: "/register", params: next ? { next } : {} }} style={styles.link}>使用邀请码注册</Link></Text>
        </Surface>
      </ScrollView>
    </KeyboardScreen>
  );
}

const useStyles = createThemedStyles((colors, theme) => ({
  page: { flex: 1, backgroundColor: colors.canvas }, content: { flexGrow: 1, justifyContent: "center", width: "100%", maxWidth: 480, alignSelf: "center", padding: spacing.lg, gap: spacing.xl },
  brand: { gap: spacing.sm }, mark: { color: colors.mint, fontSize: 38 }, eyebrow: { color: theme.danger, textTransform: "uppercase", letterSpacing: 2, fontWeight: "600" },
  title: { color: colors.text, fontSize: 31, lineHeight: 39, fontWeight: "700" }, card: { gap: spacing.md }, tip: { textAlign: "center", color: colors.textMuted }, link: { color: colors.mint, fontWeight: "600" },
}));
