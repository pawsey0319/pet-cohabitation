import { createThemedStyles } from "../theme/themedStyles";
import { KeyboardScreen } from "./KeyboardLayout";
import Constants from "expo-constants";
import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { parseSpaceInviteLink } from "../lib/publicLinks";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, spacing } from "../theme/tokens";
import { AppButton } from "../ui/common";

export function JoinSpaceSheet({ visible, onClose, onOpenInvite }: Readonly<{
  visible: boolean;
  onClose(): void;
  onOpenInvite(token: string): void;
}>) {
  const { styles, colors } = useStyles();
  const { theme } = useAppTheme();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = () => { setLink(""); setError(null); onClose(); };
  const open = () => {
    try {
      const token = parseSpaceInviteLink(link, {
        platform: Platform.OS,
        browserOrigin: Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : undefined,
        publicAppUrl: process.env.EXPO_PUBLIC_APP_URL ?? Constants.expoConfig?.extra?.publicAppUrl,
      });
      close();
      onOpenInvite(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法打开群邀请，请检查链接。");
    }
  };
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <KeyboardScreen style={styles.overlay}>
      <Pressable accessibilityLabel="关闭群邀请" accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={close} />
      <View style={[styles.card, { backgroundColor: theme.card, borderRadius: theme.radius + 10 }]}>
        <Text style={styles.title}>通过邀请链接加入群聊</Text>
        <Text style={styles.copy}>让群成员从聊天里的「＋ → 邀请成员」复制链接给你。粘贴完整链接后，下一页点击「接受邀请」，无需重新注册。</Text>
        <TextInput accessibilityLabel="群邀请链接" value={link} onChangeText={(value) => { setLink(value); setError(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…/invite/…" placeholderTextColor={colors.textMuted} style={[styles.input, { backgroundColor: theme.page }]} />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <AppButton label="打开群邀请" disabled={!link.trim()} onPress={open} />
        <AppButton label="取消" variant="quiet" onPress={close} />
      </View>
    </KeyboardScreen>
  </Modal>;
}

const useStyles = createThemedStyles((colors, theme) => ({
  overlay: { flex: 1, backgroundColor: theme.overlay, justifyContent: "center", padding: spacing.md },
  card: { width: "100%", maxWidth: 500, alignSelf: "center", padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 21, fontWeight: "700" },
  copy: { color: colors.textMuted, fontSize: 14, lineHeight: 22 },
  input: { minHeight: 52, borderRadius: 16, color: colors.text, paddingHorizontal: 14, fontSize: 14 },
  error: { color: theme.danger, fontSize: 13, lineHeight: 20 },
}));
