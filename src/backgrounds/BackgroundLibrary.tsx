import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { KeyboardScreen, KeyboardScrollView, KeyboardTextInput } from "../components/KeyboardLayout";
import { createRequestId } from "../lib/uuid";
import { useChatBackground } from "./ChatBackgroundProvider";
import { BackgroundArtwork } from "./ChatBackgroundSurface";
import { listBackgrounds, manageBackground, type BackgroundCursor, type BackgroundImpact } from "./management";
import type { ChatBackgroundAsset } from "./types";
export function BackgroundLibrary(props: { visible: boolean; onClose(): void; onSelect(asset: ChatBackgroundAsset): void; onEdit(asset: ChatBackgroundAsset): void; onDeleted?(assetId: string): void }) {
  const { profile } = useSession(); if (!props.visible || !profile) return null;
  return <VisibleLibrary key={profile.id} {...props} ownerId={profile.id} />;
}
function VisibleLibrary({ ownerId, onClose, onSelect, onEdit, onDeleted }: { ownerId: string; onClose(): void; onSelect(asset: ChatBackgroundAsset): void; onEdit(asset: ChatBackgroundAsset): void; onDeleted?(assetId: string): void }) {
  const { theme } = useAppTheme(); const background = useChatBackground(); const active = useRef(true); const requestIds = useRef(new Map<string, string>());
  const [assets, setAssets] = useState<ChatBackgroundAsset[]>([]); const [cursor, setCursor] = useState<BackgroundCursor | null>(null);
  const [favoriteOnly, setFavoriteOnly] = useState(false); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ChatBackgroundAsset | null>(null); const [name, setName] = useState("");
  const [impact, setImpact] = useState<BackgroundImpact | null>(null);
  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center", opacity: disabled ? .45 : 1 }}><Text style={{ color: theme.primary, fontSize: 14 }}>{label}</Text></Pressable>;
  const run = async (action: () => Promise<void>) => { setBusy(true); setNotice(null); try { await action(); } catch (reason) { if (active.current) setNotice(reason instanceof Error ? reason.message : "暂时未完成"); } finally { if (active.current) setBusy(false); } };
  const load = async (more = false) => { const page = await listBackgrounds(ownerId, more ? cursor ?? undefined : undefined, favoriteOnly); if (active.current) { setAssets(old => more ? [...new Map([...old, ...page.assets].map(item => [item.id, item])).values()] : page.assets); setCursor(page.cursor); } };
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { void run(() => load()); }, [favoriteOnly]);
  const mutate = async (asset: ChatBackgroundAsset, action: string, input: Record<string, unknown>) => {
    const payload = { action, asset_id: asset.id, expected_version: asset.version ?? 1, ...input };
    const key = JSON.stringify(payload); const requestId = requestIds.current.get(key) ?? createRequestId(); requestIds.current.set(key, requestId);
    await manageBackground(ownerId, { ...payload, request_id: requestId });
    if (!active.current) return;
    if (action === "delete") { background.acceptDeletedAsset(asset.id); setAssets(old => old.filter(row => row.id !== asset.id)); onDeleted?.(asset.id); }
    try { await background.refresh(); await load(); } catch { if (active.current) setNotice("修改已保存，列表暂未同步，可以稍后刷新。"); }
  };
  const remove = () => run(async () => {
    if (!impact) return; const asset = assets.find(item => item.id === impact.asset_id); if (!asset) return;
    await mutate({ ...asset, version: impact.asset_version }, "delete", { settings_version: impact.settings_version });
    if (active.current) setImpact(null);
  });
  return <Modal visible animationType="slide" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, backgroundColor: theme.page }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 }}><Text style={{ color: theme.text, fontWeight: "600", fontSize: 20 }}>我的背景</Text>{button("关闭", onClose)}</View>
    <KeyboardScreen style={{ flex: 1 }}><KeyboardScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: "row" }}>{button(favoriteOnly ? "查看全部" : "只看收藏", () => setFavoriteOnly(value => !value), busy)}{button("刷新", () => void run(() => load()), busy)}</View>
      {assets.map(asset => <View key={asset.id} style={{ backgroundColor: theme.card, borderRadius: 12, padding: 12, gap: 6 }}><Pressable accessibilityRole="button" onPress={() => { onSelect(asset); onClose(); }} style={{ flexDirection: "row", gap: 12 }}><BackgroundArtwork selection={{ presetId: null, assetId: asset.id, palette: "warm" }} style={{ width: 72, height: 92, borderRadius: 8 }} /><View style={{ flex: 1, gap: 6 }}><Text style={{ color: theme.text, fontWeight: "600" }}>{asset.name ?? "我的背景"}{asset.favorite ? " ★" : ""}</Text><Text numberOfLines={2} style={{ color: theme.muted, fontSize: 12 }}>{asset.prompt ?? "相册上传"}</Text>{asset.parent_asset_id ? <Text style={{ color: theme.muted, fontSize: 12 }}>基于原图的新版本</Text> : null}</View></Pressable>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{button("命名", () => { setRenaming(asset); setName(asset.name ?? "我的背景"); }, busy)}{button(asset.favorite ? "取消收藏" : "收藏", () => void run(() => mutate(asset, "favorite", { favorite: !asset.favorite })), busy)}{button("继续设计", () => { onEdit(asset); onClose(); }, busy || !background.canEdit)}{button("删除", () => void run(async () => { const preview = await manageBackground<BackgroundImpact>(ownerId, { action: "impact", asset_id: asset.id }); if (active.current) setImpact(preview); }), busy)}</View>
      </View>)}
      {!assets.length && !busy ? <Text style={{ color: theme.muted }}>{favoriteOnly ? "还没有收藏的背景。" : "还没有保存的背景。"}</Text> : null}
      {cursor ? button(busy ? "加载中…" : "加载更多", () => void run(() => load(true)), busy) : null}
      {!background.canEdit ? <Text style={{ color: theme.muted, fontSize: 12 }}>原图编辑暂未启用，可以先上传或生成新背景。</Text> : null}
      {renaming ? <View style={{ gap: 8, padding: 14, borderRadius: 12, backgroundColor: theme.cardSoft }}><Text style={{ color: theme.text }}>给背景起个名字</Text><KeyboardTextInput accessibilityLabel="背景名称" value={name} onChangeText={setName} maxLength={60} style={{ color: theme.text, minHeight: 48, padding: 10, backgroundColor: theme.card, borderRadius: 8 }} />{button("保存名称", () => void run(async () => { await mutate(renaming, "rename", { name: name.trim() }); if (active.current) setRenaming(null); }), busy || !name.trim())}{button("取消", () => setRenaming(null), busy)}</View> : null}
      {impact ? <View style={{ gap: 8, padding: 14, borderRadius: 12, backgroundColor: theme.cardSoft }}><Text style={{ color: theme.text, fontWeight: "600" }}>删除这张背景？</Text><Text style={{ color: theme.muted, lineHeight: 21 }}>{impact.affected.length ? `以下聊天会恢复继承或默认背景：${impact.affected.map(row => row.label).join("、")}` : "当前没有聊天使用这张背景。"}{impact.is_global ? " 未单独设置背景的其他聊天也会恢复默认。" : ""} 已生成的子版本会保留。</Text>{button("确认删除", () => void remove(), busy)}{button("保留背景", () => setImpact(null), busy)}</View> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger }}>{notice}</Text> : null}
    </KeyboardScrollView></KeyboardScreen>
  </SafeAreaView></Modal>;
}
