import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../../src/auth/SessionProvider";
import { createChatRepository } from "../../../src/data/chatRepository";
import type { ChatSpace, RelationshipKind } from "../../../src/data/types";
import { AppButton, DemoBanner, EmptyState } from "../../../src/ui/common";
import { colors, radii, spacing } from "../../../src/theme/tokens";

function formatTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value); const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

const kinds: readonly { value: RelationshipKind; label: string; note: string }[] = [
  { value: "friend_pair", label: "好友双人", note: "最多 2 人" },
  { value: "lover_pair", label: "恋人双人", note: "最多 2 人" },
  { value: "friend_circle", label: "密友小圈", note: "最多 20 人" },
];

export default function ChatsScreen() {
  const { profile, isLocalDemo } = useSession(); const insets = useSafeAreaInsets();
  const repository = useMemo(() => createChatRepository(profile!), [profile]);
  const [spaces, setSpaces] = useState<readonly ChatSpace[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false); const [name, setName] = useState(""); const [kind, setKind] = useState<RelationshipKind>("friend_pair"); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setSpaces(await repository.listSpaces(profile!.id)); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "会话加载失败"); }
    finally { setLoading(false); }
  }, [profile, repository]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const create = async () => {
    if (!name.trim()) return; setBusy(true);
    try { const id = await repository.createSpace({ name: name.trim(), kind }); setCreating(false); setName(""); router.push({ pathname: "/chat/[spaceId]", params: { spaceId: id } }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败"); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      {isLocalDemo ? <DemoBanner /> : null}
      <View style={styles.header}>
        <View><Text style={styles.eyebrow}>只和认识的人</Text><Text style={styles.title}>消息</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="新建关系空间" onPress={() => setCreating(true)} style={styles.newButton}><Text style={styles.newButtonText}>＋</Text></Pressable>
      </View>
      {error ? <Pressable onPress={() => void load()} style={styles.error}><Text style={styles.errorText}>{error} · 点击重试</Text></Pressable> : null}
      {loading ? <ActivityIndicator style={styles.loading} color={colors.coral} /> : (
        <FlatList
          data={spaces} keyExtractor={(item) => item.id} contentContainerStyle={spaces.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<EmptyState icon="◌" title="还没有关系空间" body="创建好友、恋人或密友小圈，再通过邀请链接让熟人加入。" />}
          renderItem={({ item, index }) => (
            <Pressable onPress={() => router.push({ pathname: "/chat/[spaceId]", params: { spaceId: item.id } })} style={[styles.row, index > 0 && styles.rowBorder]}>
              <View style={[styles.avatar, item.kind === "friend_circle" && styles.avatarCircle]}><Text style={styles.avatarText}>{item.name.slice(0, 2)}</Text></View>
              <View style={styles.rowBody}><View style={styles.rowTop}><Text numberOfLines={1} style={styles.name}>{item.name}</Text><Text style={styles.time}>{formatTime(item.lastMessageAt)}</Text></View><View style={styles.rowBottom}><Text numberOfLines={1} style={styles.preview}>{item.lastMessage ?? `${item.memberCount}/${item.maxMembers} 人 · 等第一条消息`}</Text>{item.unreadCount > 0 ? <View style={styles.unread}><Text style={styles.unreadText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text></View> : null}</View></View>
            </Pressable>
          )}
        />
      )}
      <Modal animationType="fade" transparent visible={creating} onRequestClose={() => setCreating(false)}>
        <Pressable style={styles.overlay} onPress={() => setCreating(false)}><Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>新建关系空间</Text>
          <TextInput value={name} onChangeText={setName} placeholder="给这个空间起个名字" placeholderTextColor={colors.textMuted} style={styles.input} maxLength={40} />
          <View style={styles.kindList}>{kinds.map((option) => <Pressable key={option.value} onPress={() => setKind(option.value)} style={[styles.kind, kind === option.value && styles.kindSelected]}><Text style={styles.kindLabel}>{option.label}</Text><Text style={styles.kindNote}>{option.note}</Text></Pressable>)}</View>
          <AppButton label={busy ? "正在创建…" : "创建空间"} disabled={busy || !name.trim()} onPress={() => void create()} />
        </Pressable></Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  eyebrow: { color: colors.mint, fontSize: 11, fontWeight: "800", letterSpacing: 1.4 }, title: { color: colors.text, fontSize: 32, fontWeight: "900" },
  newButton: { width: 43, height: 43, borderRadius: 16, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }, newButtonText: { color: colors.coralSoft, fontSize: 27, lineHeight: 29 },
  list: { paddingHorizontal: spacing.md, paddingBottom: 90 }, emptyList: { flexGrow: 1, justifyContent: "center" }, loading: { marginTop: 50 },
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: 15, paddingHorizontal: 7 }, rowBorder: { borderTopWidth: 1, borderTopColor: colors.line },
  avatar: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }, avatarCircle: { backgroundColor: colors.mintDeep }, avatarText: { color: colors.lavenderSoft, fontWeight: "900" },
  rowBody: { flex: 1, gap: 7, justifyContent: "center" }, rowTop: { flexDirection: "row", gap: 10, alignItems: "center" }, rowBottom: { flexDirection: "row", gap: 10, alignItems: "center" },
  name: { flex: 1, color: colors.text, fontSize: 17, fontWeight: "800" }, time: { color: colors.textMuted, fontSize: 11 }, preview: { flex: 1, color: colors.textMuted, fontSize: 14 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }, unreadText: { color: colors.white, fontSize: 11, fontWeight: "900" },
  error: { marginHorizontal: spacing.md, backgroundColor: "#5B3040", borderRadius: radii.md, padding: spacing.sm }, errorText: { color: colors.coralSoft, textAlign: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(5,4,16,.72)", justifyContent: "flex-end", padding: spacing.md }, sheet: { width: "100%", maxWidth: 560, alignSelf: "center", backgroundColor: colors.canvasRaised, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md },
  sheetTitle: { color: colors.text, fontSize: 22, fontWeight: "900" }, input: { minHeight: 50, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: spacing.md }, kindList: { gap: 8 },
  kind: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, padding: 13, flexDirection: "row", justifyContent: "space-between" }, kindSelected: { borderColor: colors.mint, backgroundColor: colors.mintDeep }, kindLabel: { color: colors.text, fontWeight: "800" }, kindNote: { color: colors.textMuted },
});
