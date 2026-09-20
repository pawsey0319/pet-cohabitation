import { SpaceAvatar } from "../../../src/avatars/SpaceAvatar";
import { Icon } from "../../../src/ui/Icon";
import { KeyboardScreen } from "../../../src/components/KeyboardLayout";
import { createThemedStyles } from "../../../src/theme/themedStyles";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../../src/auth/SessionProvider";
import { createChatRepository } from "../../../src/data/chatRepository";
import type { ChatSpace, RelationshipKind } from "../../../src/data/types";
import { AppButton, DemoBanner, EmptyState } from "../../../src/ui/common";
import { colors, radii, spacing } from "../../../src/theme/tokens";
import { useAppTheme } from "../../../src/theme/ThemeProvider";
import { JoinSpaceSheet } from "../../../src/components/JoinSpaceSheet";

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
  const { styles, colors } = useStyles();
  const { profile, isLocalDemo } = useSession(); const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const repository = useMemo(() => createChatRepository(profile!), [profile]);
  const [spaces, setSpaces] = useState<readonly ChatSpace[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false); const [name, setName] = useState(""); const [kind, setKind] = useState<RelationshipKind>("friend_pair"); const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [query,setQuery]=useState("");
  const filteredSpaces=spaces.filter(space=>space.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const load = useCallback(async () => {
    try { setSpaces(await repository.listSpaces(profile!.id)); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "会话加载失败"); }
    finally { setLoading(false); }
  }, [profile, repository]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const spaceSubscriptionKey = spaces.map((space) => space.id).sort().join(",");
  useEffect(() => {
    if (!spaceSubscriptionKey) return;
    const unsubscribers = spaceSubscriptionKey.split(",").filter(Boolean).map((spaceId) => repository.subscribe(spaceId, () => void load()));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [load, repository, spaceSubscriptionKey]);

  const create = async () => {
    if (!name.trim()) return; setBusy(true);
    try { const id = await repository.createSpace({ name: name.trim(), kind }); setCreating(false); setName(""); router.push({ pathname: "/chat/[spaceId]", params: { spaceId: id } }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败"); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top, backgroundColor: theme.page }]}>
      {isLocalDemo ? <DemoBanner /> : null}
      <View style={styles.header}>
        <Text style={styles.title}>消息</Text>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="通过邀请链接加入群聊" onPress={() => setJoining(true)} style={[styles.labeledButton, { backgroundColor: theme.card, borderRadius: theme.radius }]}>
            <Icon name="link" color={theme.text} size={21}/>
            <Text style={[styles.actionLabel, { color: theme.accent }]}>加入群聊</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="新建关系空间" onPress={() => setCreating(true)} style={[styles.newButton, { backgroundColor: theme.card, borderRadius: theme.radius }]}><Icon name="plus" color={theme.text}/></Pressable>
        </View>
      </View>
      <View style={styles.search}><Icon name="search" color={theme.muted} size={18}/><TextInput accessibilityLabel="搜索会话" value={query} onChangeText={setQuery} placeholder="筛选会话" placeholderTextColor={theme.muted} style={styles.searchInput}/><Pressable accessibilityRole="button" onPress={()=>router.push({pathname:"/search" as never,params:{q:query}})} style={{minHeight:44,justifyContent:"center"}}><Text style={{color:theme.primary}}>搜索内容</Text></Pressable></View>
      {error ? <Pressable onPress={() => void load()} style={styles.error}><Text style={styles.errorText}>{error} · 点击重试</Text></Pressable> : null}
      {loading ? <ActivityIndicator style={styles.loading} color={colors.coral} /> : (
        <FlatList
          data={filteredSpaces} keyExtractor={(item) => item.id} contentContainerStyle={filteredSpaces.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<EmptyState icon="◌" title={query ? "没有找到会话" : "还没有关系空间"} body={query ? "换个关键词试试。" : "创建一个空间，邀请熟悉的人加入。"} />}
          renderItem={({ item, index }) => (
            <Pressable onPress={() => router.push({ pathname: "/chat/[spaceId]", params: { spaceId: item.id } })} style={[styles.row, index > 0 && styles.rowBorder, index > 0 && { borderTopColor: theme.line }]}>
              <SpaceAvatar spaceId={item.id} name={item.name} size={48} />
              <View style={styles.rowBody}><View style={styles.rowTop}><Text numberOfLines={1} style={styles.name}>{item.name}</Text><Text style={styles.time}>{formatTime(item.lastMessageAt)}</Text></View><View style={styles.rowBottom}><Text numberOfLines={1} style={styles.preview}>{item.lastMessage ?? `${item.memberCount}/${item.maxMembers} 人 · 等第一条消息`}</Text>{item.unreadCount > 0 ? <View style={styles.unread}><Text style={styles.unreadText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text></View> : null}</View></View>
            </Pressable>
          )}
        />
      )}
      <JoinSpaceSheet visible={joining} onClose={() => setJoining(false)} onOpenInvite={(token) => router.push({ pathname: "/invite/[token]", params: { token } })} />
      <Modal animationType="fade" transparent visible={creating} onRequestClose={() => setCreating(false)}>
        <KeyboardScreen style={{flex:1}}><Pressable style={styles.overlay} onPress={() => setCreating(false)}><Pressable style={[styles.sheet, { backgroundColor: theme.card, borderRadius: theme.radius + 10 }]} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>新建关系空间</Text>
          <TextInput value={name} onChangeText={setName} placeholder="给这个空间起个名字" placeholderTextColor={colors.textMuted} style={styles.input} maxLength={40} />
          <View style={styles.kindList}>{kinds.map((option) => <Pressable key={option.value} onPress={() => setKind(option.value)} style={[styles.kind, kind === option.value && styles.kindSelected]}><Text style={styles.kindLabel}>{option.label}</Text><Text style={styles.kindNote}>{option.note}</Text></Pressable>)}</View>
          <AppButton label={busy ? "正在创建…" : "创建空间"} disabled={busy || !name.trim()} onPress={() => void create()} />
        </Pressable></Pressable></KeyboardScreen>
      </Modal>
    </View>
  );
}

const useStyles = createThemedStyles((colors, theme) => ({
  search:{marginHorizontal:16,marginBottom:12,flexDirection:"row",alignItems:"center",gap:8,backgroundColor:theme.secondary,borderRadius:8,paddingHorizontal:12,minHeight:44},searchInput:{flex:1,fontSize:16,color:theme.text,minHeight:44},
  page: { flex: 1, backgroundColor: colors.canvas }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: 4, paddingBottom: 4 },
  eyebrow: { color: colors.mint, fontSize: 11, fontWeight: "600", letterSpacing: 1.4 }, title: { color: colors.text, fontSize: 20, fontWeight: "600" },
  newButton: { width: 43, height: 43, borderRadius: 16, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }, newButtonText: { color: theme.danger, fontSize: 27, lineHeight: 29 },
  headerActions: { flexDirection: "row", gap: 9 }, bellText: { fontSize: 21, fontWeight: "700" },
  labeledButton: { width: 59, minHeight: 50, alignItems: "center", justifyContent: "center", gap: 1 },
  actionLabel: { fontSize: 10, fontWeight: "600" },
  list: { paddingHorizontal: spacing.md, paddingBottom: 16 }, emptyList: { flexGrow: 1, justifyContent: "center" }, loading: { marginTop: 50 },
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: 15, paddingHorizontal: 7 }, rowBorder: { borderTopWidth: 1, borderTopColor: colors.line },
  avatar: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }, avatarCircle: { backgroundColor: colors.mintDeep }, avatarText: { color: colors.lavenderSoft, fontWeight: "700" },
  rowBody: { flex: 1, gap: 7, justifyContent: "center" }, rowTop: { flexDirection: "row", gap: 10, alignItems: "center" }, rowBottom: { flexDirection: "row", gap: 10, alignItems: "center" },
  name: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "500" }, time: { color: colors.textMuted, fontSize: 11 }, preview: { flex: 1, color: colors.textMuted, fontSize: 14 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }, unreadText: { color: colors.white, fontSize: 11, fontWeight: "700" },
  error: { marginHorizontal: spacing.md, backgroundColor: theme.userBubble, borderRadius: radii.md, padding: spacing.sm }, errorText: { color: theme.danger, textAlign: "center" },
  overlay: { flex: 1, backgroundColor: theme.overlay, justifyContent: "flex-end", padding: spacing.md }, sheet: { width: "100%", maxWidth: 560, alignSelf: "center", backgroundColor: colors.canvasRaised, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md },
  sheetTitle: { color: colors.text, fontSize: 22, fontWeight: "700" }, input: { minHeight: 50, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: spacing.md }, kindList: { gap: 8 },
  kind: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, padding: 13, flexDirection: "row", justifyContent: "space-between" }, kindSelected: { borderColor: colors.mint, backgroundColor: colors.mintDeep }, kindLabel: { color: colors.text, fontWeight: "600" }, kindNote: { color: colors.textMuted },
}));
