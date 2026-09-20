import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useSession } from "../auth/SessionProvider";
import { KeyboardScreen, KeyboardScrollView, KeyboardTextInput } from "../components/KeyboardLayout";
import { createRequestId } from "../lib/uuid";
import { useAppTheme } from "../theme/ThemeProvider";
import { AvatarImage } from "./AvatarImage";
import { applyAvatar, generateAvatar, getAvatarJob, getAvatarState, resolveAvatarUrl, uploadAvatar } from "./repository";
import { avatarError, type AvatarJob, type AvatarState, type AvatarTarget } from "./types";

export function AvatarEditor(props: { visible: boolean; onClose(): void; target?: AvatarTarget; onApplied?(): void | Promise<void> }) {
  const { profile } = useSession();
  if (!props.visible || !profile) return null;
  const target = props.target ?? { kind: "profile", id: profile.id };
  return <VisibleAvatarEditor key={`${profile.id}:${target.kind}:${target.id}`} {...props} target={target} ownerId={profile.id} />;
}
function VisibleAvatarEditor({ onClose, target, ownerId, onApplied }: { onClose(): void; target: AvatarTarget; ownerId: string; onApplied?(): void | Promise<void> }) {
  const { theme } = useAppTheme(); const { profile, isLocalDemo, refreshProfile } = useSession();
  const active = useRef(true); const operation = useRef<{ uri: string; uploadId: string } | null>(null);
  const applyId = useRef(createRequestId()); const generation = useRef<{ prompt: string; id: string } | null>(null);
  const resetId = useRef(createRequestId());
  const [state, setState] = useState<AvatarState | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false); const [photo, setPhoto] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [position, setPosition] = useState<"start" | "center" | "end">("center"); const [cropped, setCropped] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null); const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(""); const [job, setJob] = useState<AvatarJob | null>(null);
  const generating = job?.status === "queued" || job?.status === "running";
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (isLocalDemo) { setNotice("登录后可以保存头像。相册选择与裁切可先预览。"); return; }
    void getAvatarState(ownerId, target).then(value => { if (active.current) setState(value); }).catch(reason => { if (active.current) setNotice(avatarError(reason)); });
    if (target.kind === "profile") void getAvatarJob(ownerId).then(value => { if (active.current && value) { setJob(value); setPrompt(value.prompt); generation.current = { prompt: value.prompt, id: value.request_id }; } }).catch(() => undefined);
  }, [ownerId, target.id, target.kind, isLocalDemo]);
  useEffect(() => {
    if (!photo) return; let current = true; setCropped(null);
    const side = Math.min(photo.width, photo.height); const offset = position === "start" ? 0 : position === "end" ? 1 : .5;
    void ImageManipulator.manipulateAsync(photo.uri, [{ crop: { originX: Math.floor((photo.width - side) * offset), originY: Math.floor((photo.height - side) * offset), width: side, height: side } }, { resize: { width: 768 } }], { compress: .9, format: ImageManipulator.SaveFormat.JPEG }).then(result => {
      if (current) { setCropped(result.uri); operation.current = { uri: result.uri, uploadId: createRequestId() }; applyId.current = createRequestId(); }
    }).catch(() => { if (current) setNotice("图片无法裁切，请换一张试试。"); });
    return () => { current = false; };
  }, [photo, position]);
  useEffect(() => {
    if (!generating || !job) return;
    let current = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await getAvatarJob(ownerId, job.request_id); if (current) setJob(next); }
      catch { if (current) setNotice("连接暂时中断，生成任务已保留，正在尝试恢复。"); }
      if (current) timer = setTimeout(() => void poll(), 4000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { current = false; clearTimeout(timer); };
  }, [ownerId, job?.request_id, generating]);
  useEffect(() => {
    if (job?.status !== "succeeded" || !job.asset_id) return; let current = true;
    void resolveAvatarUrl(ownerId, `avatar://${job.asset_id}`).then(url => { if (current && url) { setPreview(url); setAssetId(job.asset_id); setPhoto(null); setCropped(null); applyId.current = createRequestId(); } }).catch(() => { if (current) setNotice("图片已生成，预览加载失败，请重新打开。 "); });
    return () => { current = false; };
  }, [ownerId, job?.status, job?.asset_id]);
  const run = async (action: () => Promise<void>) => { setWorking(true); setNotice(null); try { await action(); } catch (reason) { if (active.current) setNotice(avatarError(reason)); } finally { if (active.current) setWorking(false); } };
  const choose = () => run(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1, selectionLimit: 1 });
    if (!result.canceled && result.assets[0] && active.current) { const item = result.assets[0]; setPhoto({ uri: item.uri, width: item.width, height: item.height }); setPosition("center"); setAssetId(null); setPreview(null); }
  });
  const save = (reset = false) => run(async () => {
    if (!state || isLocalDemo) throw new Error("unauthenticated");
    let chosen = reset ? null : assetId;
    if (!reset && cropped && operation.current) {
      const asset = await uploadAvatar(ownerId, operation.current.uri, operation.current.uploadId);
      if (!active.current) return; chosen = asset.id; setAssetId(asset.id);
    }
    const next = await applyAvatar(ownerId, target, chosen, state.version, reset ? resetId.current : applyId.current);
    if (!active.current) return; setState(next);
    // The apply receipt is authoritative even if a subsequent list refresh fails.
    await refreshProfile().catch(() => undefined); await Promise.resolve(onApplied?.()).catch(() => undefined);
    if (active.current) onClose();
  });
  const create = () => run(async () => {
    const text = prompt.trim();
    if (!generation.current || generation.current.prompt !== text || job?.status === "failed") generation.current = { prompt: text, id: createRequestId() };
    const result = await generateAvatar(ownerId, generation.current.id, text); if (active.current) setJob(result);
  });
  const button = (label: string, onPress: () => void, disabled = false, primary = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: 48, padding: 14, borderRadius: 12, alignItems: "center", backgroundColor: primary ? theme.primary : theme.cardSoft, opacity: disabled ? .45 : 1 }}><Text style={{ color: primary ? theme.onPrimary : theme.text, fontWeight: "600" }}>{label}</Text></Pressable>;
  const image = cropped ?? preview;
  return <Modal visible animationType="slide" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, backgroundColor: theme.page }}><View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12 }}><Text style={{ color: theme.text, fontSize: 20, fontWeight: "600" }}>{target.kind === "profile" ? "个人头像" : "群头像"}</Text>{button("关闭", onClose)}</View>
    <KeyboardScreen style={{ flex: 1 }}><KeyboardScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View style={{ alignItems: "center", padding: 16 }}>{image ? <Image source={{ uri: image }} style={{ width: 176, height: 176, borderRadius: 24 }} /> : <AvatarImage reference={state?.reference} name={profile?.nickname ?? "头像"} size={176} />}</View>
      <Text style={{ color: theme.muted, lineHeight: 21 }}>先预览，再保存。{target.kind === "space" ? "只有群主可修改，恢复默认后显示成员拼图。" : "保存后，你的聊天伙伴会看到新头像。"}</Text>
      {button("从相册选择并裁切", () => void choose(), working)}
      {photo ? <View style={{ flexDirection: "row", gap: 8 }}>{([['start', '保留上方/左侧'], ['center', '居中'], ['end', '保留下方/右侧']] as const).map(([value, label]) => <View key={value} style={{ flex: 1 }}>{button(label, () => setPosition(value), working, position === value)}</View>)}</View> : null}
      {target.kind === "profile" ? <><Text style={{ color: theme.text, fontWeight: "600" }}>让 AI 设计头像</Text><KeyboardTextInput accessibilityLabel="头像设计描述" value={prompt} onChangeText={setPrompt} maxLength={600} multiline placeholder="例如：浅绿色背景上的小狐狸，简洁温暖" placeholderTextColor={theme.muted} style={{ minHeight: 100, padding: 14, borderRadius: 12, color: theme.text, backgroundColor: theme.card }} /><Text style={{ color: theme.muted, fontSize: 13 }}>头像与背景共用每天 12 次设计额度；生成后由你决定是否使用。</Text>{button(generating ? "正在生成，可稍后回来查看" : "生成头像", () => void create(), working || !!generating || prompt.trim().length < 4 || isLocalDemo, true)}{generating ? <ActivityIndicator color={theme.primary} /> : null}{job?.status === "failed" ? <Text style={{ color: theme.danger }}>{avatarError(new Error(job.error_code ?? ""))}</Text> : null}</> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, lineHeight: 22 }}>{notice}</Text> : null}
      {button(working ? "正在保存…" : "保存头像", () => void save(), working || !state || (!cropped && !assetId), true)}
      {button(target.kind === "space" ? "恢复默认成员拼图" : "恢复默认头像", () => void save(true), working || !state)}
    </KeyboardScrollView></KeyboardScreen>
  </SafeAreaView></Modal>;
}
