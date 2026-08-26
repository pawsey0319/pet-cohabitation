import NetInfo, { useNetInfo } from "@react-native-community/netinfo";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/auth/SessionProvider";
import { AsyncStorageOutboxStore, createClientId, MessageOutbox } from "../../src/chat/outbox";
import { updateNearBottom } from "../../src/chat/viewportPolicy";
import { AgentWorkbench } from "../../src/components/AgentWorkbench";
import { EnterSendTextInput } from "../../src/components/EnterSendTextInput";
import { ImageViewer } from "../../src/components/ImageViewer";
import { createChatRepository } from "../../src/data/chatRepository";
import type { AgentFeedbackRating, AgentJob, ChatMessage, PetCornerStory, PetObservationStatus, QueuedMessage } from "../../src/data/types";
import { AppButton } from "../../src/ui/common";
import { colors, radii, spacing } from "../../src/theme/tokens";

const REACTIONS = ["👍", "❤️", "😂", "😢"] as const;

function mergeMessages(...groups: readonly (readonly ChatMessage[])[]): readonly ChatMessage[] {
  const byKey = new Map<string, ChatMessage>();
  groups.flat().forEach((message) => byKey.set(`${message.senderId}:${message.clientId}`, message));
  return [...byKey.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function dateLabel(value: string): string {
  const date = new Date(value); const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function VoiceContent({ url, seconds }: Readonly<{ url: string; seconds: number | null }>) {
  const player = useAudioPlayer(url);
  return <Pressable onPress={() => player.play()} style={styles.voice}><Text style={styles.voiceIcon}>▷</Text><View style={styles.wave}><View style={styles.waveLine} /><View style={[styles.waveLine, { height: 18 }]} /><View style={styles.waveLine} /><View style={[styles.waveLine, { height: 14 }]} /></View><Text style={styles.voiceTime}>{Math.max(1, Math.round(seconds ?? 1))}″</Text></Pressable>;
}

function MediaContent({ message, signedUrl, onOpenImage }: Readonly<{ message: ChatMessage; signedUrl: string | null; onOpenImage(): void }>) {
  if (!message.mediaPath) return null;
  if (!signedUrl) return <ActivityIndicator color={colors.mint} style={{ margin: 15 }} />;
  if (message.kind === "image") return <Pressable accessibilityRole="button" accessibilityLabel="全屏查看图片" onPress={(event) => { event.stopPropagation(); onOpenImage(); }}><Image source={{ uri: signedUrl }} resizeMode="cover" style={styles.messageImage} /></Pressable>;
  if (message.kind === "voice") return <VoiceContent url={signedUrl} seconds={message.mediaDurationSeconds} />;
  return null;
}

function MessageRow({ message, mine, signedUrl, selected, agentJob, feedbackSubmitted, onSelect, onOpenImage, onReply, onReact, onRetry, onRetryAgent, onAgentFeedback }: Readonly<{
  message: ChatMessage; mine: boolean; signedUrl: string | null; selected: boolean; agentJob?: AgentJob | null; feedbackSubmitted: boolean; onSelect(): void; onOpenImage(): void; onReply(): void; onReact(emoji: string): void; onRetry(): void; onRetryAgent(): void; onAgentFeedback(rating: AgentFeedbackRating): void;
}>) {
  const isAgent = message.actorKind !== "human";
  const reactionEntries = Object.entries(message.reactions).filter(([, users]) => users.length > 0);
  const bubbleStyle = [styles.bubble, mine ? styles.bubbleMine : isAgent ? styles.bubbleAgent : styles.bubbleOther, message.kind === "image" && styles.mediaBubble];
  const bubbleContent = <>
    {message.replyPreview ? <View style={styles.replyQuote}><Text numberOfLines={2} style={styles.replyQuoteText}>{message.replyPreview}</Text></View> : null}
    <MediaContent message={message} signedUrl={signedUrl} onOpenImage={onOpenImage} />
    {message.text ? <Text style={[styles.messageText, mine && styles.messageTextMine]}>{message.text}</Text> : null}
  </>;
  return (
    <View style={[styles.messageWrap, mine && styles.messageWrapMine]}>
      {!mine ? <View style={[styles.senderAvatar, isAgent && styles.senderAvatarAgent]}><Text style={styles.senderAvatarText}>{message.actorKind === "pet" ? "✦" : message.actorKind === "space_agent" ? "A" : message.actorName.slice(0, 1)}</Text></View> : null}
      <View style={[styles.messageColumn, mine && styles.messageColumnMine]}>
        {!mine ? <Text style={[styles.senderName, isAgent && styles.agentName]}>{message.actorName}{isAgent ? " · AI" : ""}</Text> : null}
        {message.kind === "image" || message.kind === "voice" ? <View style={bubbleStyle}>{bubbleContent}</View> : <Pressable accessibilityRole="button" accessibilityLabel={`消息：${message.text ?? message.kind}`} onPress={onSelect} onLongPress={onSelect} style={bubbleStyle}>{bubbleContent}</Pressable>}
        {message.delegationRequestId ? <Text style={styles.delegatedLabel}>由异宠代发 · 主人本次明确原文</Text> : null}
        <View style={[styles.metaRow, mine && styles.metaRowMine]}><Text style={styles.meta}>{dateLabel(message.createdAt)}</Text>{mine && message.deliveryState !== "sent" ? <Pressable onPress={message.deliveryState === "failed" ? onRetry : undefined}><Text style={[styles.meta, message.deliveryState === "failed" && styles.failed]}>{message.deliveryState === "pending" ? "发送中" : "发送失败 · 重试"}</Text></Pressable> : null}</View>
        {mine && agentJob && (agentJob.status === "queued" || agentJob.status === "running") ? <View style={styles.agentProgress}><ActivityIndicator size="small" color={colors.mint} /><Text style={styles.agentProgressText}>异宠正在想…</Text></View> : null}
        {mine && agentJob?.status === "failed" ? <Pressable onPress={onRetryAgent} style={styles.agentProgress}><Text style={styles.agentFailed}>异宠回应失败 · 点击重试</Text></Pressable> : null}
        {reactionEntries.length ? <View style={styles.reactionSummary}>{reactionEntries.map(([emoji, users]) => <Pressable key={emoji} onPress={() => onReact(emoji)} style={styles.reactionPill}><Text style={styles.reactionText}>{emoji} {users.length}</Text></Pressable>)}</View> : null}
        {selected ? <><View style={[styles.actions, mine && styles.actionsMine]}><Pressable accessibilityRole="button" accessibilityLabel="回复消息" onPress={onReply}><Text style={styles.actionText}>回复</Text></Pressable>{REACTIONS.map((emoji) => <Pressable accessibilityRole="button" accessibilityLabel={`回应 ${emoji}`} key={emoji} onPress={() => onReact(emoji)}><Text style={styles.actionEmoji}>{emoji}</Text></Pressable>)}</View>{isAgent ? <View style={styles.feedbackActions}>{feedbackSubmitted ? <Text style={styles.feedbackAction}>谢谢反馈，这条只能评价一次</Text> : <><Text style={styles.feedbackLabel}>这次回应：</Text>{([['natural', '自然'], ['irrelevant', '不相关'], ['intrusive', '打扰'], ['unsafe', '越界']] as const).map(([rating, label]) => <Pressable key={rating} accessibilityRole="button" accessibilityLabel={`评价异宠回应：${label}`} onPress={() => onAgentFeedback(rating)}><Text style={rating === "unsafe" ? styles.feedbackUnsafe : styles.feedbackAction}>{label}</Text></Pressable>)}</>}</View> : null}</> : null}
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>(); const { profile, isLoading: sessionLoading, isLocalDemo } = useSession(); const insets = useSafeAreaInsets(); const netInfo = useNetInfo();
  const repository = useMemo(() => profile ? createChatRepository(profile) : null, [profile]); const outbox = useMemo(() => new MessageOutbox(new AsyncStorageOutboxStore()), []);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]); const [loading, setLoading] = useState(true); const [loadingOlder, setLoadingOlder] = useState(false); const [hasOlder, setHasOlder] = useState(true);
  const [agentJobs, setAgentJobs] = useState<readonly AgentJob[]>([]);
  const [feedbackSent, setFeedbackSent] = useState<ReadonlySet<string>>(new Set());
  const [text, setText] = useState(""); const [replying, setReplying] = useState<ChatMessage | null>(null); const [selectedId, setSelectedId] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false); const [invite, setInvite] = useState<string | null>(null); const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [workbenchOpen, setWorkbenchOpen] = useState(false); const [previewMessage, setPreviewMessage] = useState<ChatMessage | null>(null); const [previewLoading, setPreviewLoading] = useState(false); const [unseenNewMessage, setUnseenNewMessage] = useState(false);
  const [observationOpen, setObservationOpen] = useState(false); const [cornerOpen, setCornerOpen] = useState(false); const [observations, setObservations] = useState<readonly PetObservationStatus[]>([]); const [stories, setStories] = useState<readonly PetCornerStory[]>([]); const [panelBusy, setPanelBusy] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const nearBottomRef = useRef(true); const initialScrollDoneRef = useRef(false); const newestMessageKeyRef = useRef<string | null>(null); const forceOwnScrollRef = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY); const recorderState = useAudioRecorderState(recorder, 250);
  const connected = netInfo.isConnected !== false;

  const loadLatest = useCallback(async () => {
    if (!repository) return;
    try {
      const [remote, jobs] = await Promise.all([repository.listMessages(spaceId, null, 50), repository.listAgentJobs(spaceId)]);
      const queued = (await outbox.list()).filter((item) => item.spaceId === spaceId).map<ChatMessage>((item) => ({
        id: item.clientId, clientId: item.clientId, spaceId: item.spaceId, senderId: item.senderId, actorKind: "human", actorName: profile!.nickname, kind: item.kind,
        text: item.text, mediaPath: item.localMediaUri ?? null, mediaDurationSeconds: item.mediaDurationSeconds ?? null, replyToMessageId: item.replyToMessageId ?? null, replyPreview: item.replyPreview ?? null,
        createdAt: item.createdAt, deliveryState: connected ? "pending" : "failed", reactions: {},
      }));
      setMessages((current) => mergeMessages(current.filter((item) => item.createdAt < (remote[0]?.createdAt ?? "")), remote, queued));
      setAgentJobs(jobs); setHasOlder(remote.length === 50); setError(null); await repository.markRead(spaceId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "消息加载失败"); }
    finally { setLoading(false); }
  }, [connected, outbox, profile, repository, spaceId]);

  const flush = useCallback(async () => {
    if (!repository || !connected) return;
    const failed = await outbox.flush(async (queued) => { await repository.sendMessage(queued, profile!.nickname); });
    await loadLatest();
    const failedIds = new Set(failed.map((item) => item.clientId));
    setMessages((current) => current.map((message) => failedIds.has(message.clientId) ? { ...message, deliveryState: "failed" } : message));
  }, [connected, loadLatest, outbox, profile, repository]);

  useEffect(() => {
    void loadLatest();
    const unsubscribe = repository?.subscribe(spaceId, () => void loadLatest());
    // Postgres Changes is primary. A quiet poll repairs missed events after laptop sleep,
    // proxy/WebSocket interruption, or a Realtime tenant reconnect.
    const recoveryPoll = setInterval(() => void loadLatest(), 3_000);
    return () => { clearInterval(recoveryPoll); unsubscribe?.(); };
  }, [loadLatest, repository, spaceId]);
  useEffect(() => { const unsubscribe = NetInfo.addEventListener((state) => { if (state.isConnected) void flush(); }); return unsubscribe; }, [flush]);
  useEffect(() => { if (connected) void flush(); }, [connected, flush]);
  useEffect(() => {
    for (const message of messages) {
      if (!message.mediaPath || signedUrls[message.mediaPath] || message.deliveryState !== "sent") continue;
      void repository?.createSignedMediaUrl(message.mediaPath).then((url) => setSignedUrls((current) => ({ ...current, [message.mediaPath!]: url }))).catch(() => undefined);
    }
  }, [messages, repository, signedUrls]);
  useEffect(() => {
    const newest = messages.at(-1); if (!newest) return;
    const key = `${newest.senderId}:${newest.clientId}`;
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true; newestMessageKeyRef.current = key;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
      return;
    }
    if (newestMessageKeyRef.current === key) return;
    newestMessageKeyRef.current = key;
    if (forceOwnScrollRef.current || nearBottomRef.current) {
      forceOwnScrollRef.current = false; setUnseenNewMessage(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } else setUnseenNewMessage(true);
  }, [messages]);

  if (sessionLoading) return <View style={styles.center}><ActivityIndicator color={colors.coral} /></View>;
  if (!profile || !repository) return <Redirect href="/login" />;

  const enqueueAndSend = async (partial: Pick<QueuedMessage, "kind" | "text"> & Partial<QueuedMessage>) => {
    const queued: QueuedMessage = {
      clientId: createClientId(), spaceId, senderId: profile.id, kind: partial.kind, text: partial.text,
      localMediaUri: partial.localMediaUri, mediaMimeType: partial.mediaMimeType, mediaSizeBytes: partial.mediaSizeBytes, mediaDurationSeconds: partial.mediaDurationSeconds,
      replyToMessageId: replying?.id ?? null, replyPreview: replying?.text?.slice(0, 80) ?? (replying ? `[${replying.kind}]` : null), createdAt: new Date().toISOString(), attempts: 0,
    };
    await outbox.enqueue(queued); setReplying(null); setText(""); forceOwnScrollRef.current = true;
    setMessages((current) => mergeMessages(current, [{ id: queued.clientId, clientId: queued.clientId, spaceId, senderId: profile.id, actorKind: "human", actorName: profile.nickname, kind: queued.kind, text: queued.text, mediaPath: queued.localMediaUri ?? null, mediaDurationSeconds: queued.mediaDurationSeconds ?? null, replyToMessageId: queued.replyToMessageId ?? null, replyPreview: queued.replyPreview ?? null, createdAt: queued.createdAt, deliveryState: connected ? "pending" : "failed", reactions: {} }]));
    await flush();
  };

  const sendTextMessage = (submittedText = text) => {
    const message = submittedText.trim();
    if (!message) return;
    setText("");
    void enqueueAndSend({ kind: "text", text: message });
  };

  const pickImage = async () => {
    setMenu(false); const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.82, allowsEditing: false });
    if (result.canceled) return; const asset = result.assets[0];
    if ((asset.fileSize ?? 0) > 8 * 1024 * 1024) { setError("图片不能超过 8 MB"); return; }
    await enqueueAndSend({ kind: "image", text: null, localMediaUri: asset.uri, mediaMimeType: asset.mimeType ?? "image/jpeg", mediaSizeBytes: asset.fileSize });
  };

  const startVoice = async () => {
    setMenu(false); const permission = await requestRecordingPermissionsAsync(); if (!permission.granted) { setError("需要麦克风权限才能录制语音"); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }); await recorder.prepareToRecordAsync(); recorder.record({ forDuration: 60 });
  };
  const stopVoice = async () => {
    const seconds = Math.min(60, Math.max(1, recorderState.durationMillis / 1000)); await recorder.stop(); const uri = recorder.uri;
    await setAudioModeAsync({ allowsRecording: false }); if (!uri) { setError("没有取得录音文件"); return; }
    const blob = await (await fetch(uri)).blob(); if (blob.size > 5 * 1024 * 1024) { setError("语音不能超过 5 MB"); return; }
    await enqueueAndSend({ kind: "voice", text: null, localMediaUri: uri, mediaMimeType: blob.type || "audio/mp4", mediaSizeBytes: blob.size, mediaDurationSeconds: seconds });
  };

  const loadOlder = async () => {
    const first = messages.find((item) => item.deliveryState === "sent"); if (!first || loadingOlder || !hasOlder) return; setLoadingOlder(true);
    try { const older = await repository.listMessages(spaceId, first.createdAt, 50); setMessages((current) => mergeMessages(older, current)); setHasOlder(older.length === 50); }
    finally { setLoadingOlder(false); }
  };

  const invitePeople = async () => { const result = await repository.createSpaceInvite(spaceId); const origin = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "https://your-app.vercel.app"; setInvite(`${origin}/invite/${result.token}`); };
  const loadObservations = async () => { setPanelBusy(true); try { setObservations(await repository.listPetObservation(spaceId)); } catch (reason) { setError(reason instanceof Error ? reason.message : "观察授权加载失败"); } finally { setPanelBusy(false); } };
  const openObservation = () => { setMenu(false); setObservationOpen(true); void loadObservations(); };
  const openCorner = async () => { setMenu(false); setCornerOpen(true); setPanelBusy(true); try { const [nextStories, nextPets] = await Promise.all([repository.listPetCorner(spaceId), repository.listPetObservation(spaceId)]); setStories(nextStories); setObservations(nextPets); } catch (reason) { setError(reason instanceof Error ? reason.message : "宠物角加载失败"); } finally { setPanelBusy(false); } };
  const care = async (petId: string, action: "care" | "feed" | "play") => { setPanelBusy(true); try { await repository.interactWithPet(spaceId, petId, action); setStories(await repository.listPetCorner(spaceId)); } catch (reason) { setError(reason instanceof Error ? reason.message : "互动失败"); } finally { setPanelBusy(false); } };
  const updatePetControl = async (operation: () => Promise<void>) => { setPanelBusy(true); try { await operation(); const [nextObservation, nextMessages] = await Promise.all([repository.listPetObservation(spaceId), repository.listMessages(spaceId, null, 50)]); setObservations(nextObservation); setMessages(nextMessages); } catch (reason) { setError(reason instanceof Error ? reason.message : "权限更新失败"); } finally { setPanelBusy(false); } };
  const refreshSignedImage = async (message: ChatMessage) => {
    if (!message.mediaPath) return; setPreviewLoading(true);
    try { const url = await repository.createSignedMediaUrl(message.mediaPath); setSignedUrls((current) => ({ ...current, [message.mediaPath!]: url })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "图片访问地址刷新失败"); }
    finally { setPreviewLoading(false); }
  };
  const openImage = (message: ChatMessage) => { setSelectedId(null); setPreviewMessage(message); if (message.mediaPath && !signedUrls[message.mediaPath]) void refreshSignedImage(message); };
  const jobByMessage = new Map(agentJobs.filter((job) => job.sourceMessageId).map((job) => [job.sourceMessageId!, job]));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0} style={styles.page}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}><Pressable accessibilityRole="button" accessibilityLabel="返回会话列表" onPress={() => router.back()} style={styles.headerButton}><Text style={styles.headerButtonText}>‹</Text></Pressable><View style={styles.headerTitleWrap}><Text style={styles.headerTitle}>关系空间</Text><Text style={styles.headerStatus}>{isLocalDemo ? "本地演示" : connected ? "实时连接" : "离线 · 消息会稍后重试"}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="打开空间主 Agent" onPress={() => setWorkbenchOpen(true)} style={styles.agentHeaderButton}><Text style={styles.agentHeaderText}>A</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="聊天更多功能" onPress={() => setMenu(true)} style={styles.headerButton}><Text style={styles.more}>•••</Text></Pressable></View>
      {error ? <Pressable onPress={() => setError(null)} style={styles.errorBar}><Text style={styles.errorBarText}>{error}</Text></Pressable> : null}
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.coral} /></View> : (
        <FlatList ref={listRef} style={styles.messageList} data={messages} keyExtractor={(item) => `${item.senderId}:${item.clientId}`} contentContainerStyle={styles.messages}
          scrollEventThrottle={32}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScroll={(event) => { nearBottomRef.current = updateNearBottom({ contentHeight: event.nativeEvent.contentSize.height, viewportHeight: event.nativeEvent.layoutMeasurement.height, offsetY: event.nativeEvent.contentOffset.y }); if (nearBottomRef.current) setUnseenNewMessage(false); }}
          ListHeaderComponent={hasOlder ? <Pressable disabled={loadingOlder} onPress={() => void loadOlder()} style={styles.loadOlder}><Text style={styles.loadOlderText}>{loadingOlder ? "加载中…" : "加载更早的消息"}</Text></Pressable> : null}
          renderItem={({ item }) => <MessageRow message={item} mine={item.senderId === profile.id} signedUrl={item.mediaPath ? signedUrls[item.mediaPath] ?? (item.deliveryState !== "sent" ? item.mediaPath : null) : null} selected={selectedId === item.id} agentJob={jobByMessage.get(item.id)} feedbackSubmitted={feedbackSent.has(item.id)} onSelect={() => setSelectedId(selectedId === item.id ? null : item.id)} onOpenImage={() => openImage(item)} onReply={() => { setReplying(item); setSelectedId(null); }} onReact={(emoji) => { setSelectedId(null); void repository.toggleReaction(item.id, emoji, profile.id).then(loadLatest); }} onRetry={() => void flush()} onRetryAgent={() => void repository.retryAgentDispatch(item.id).then(loadLatest).catch((reason) => setError(reason instanceof Error ? reason.message : "异宠重试失败"))} onAgentFeedback={(rating) => { setSelectedId(null); void repository.feedbackAgentMessage(item.id, spaceId, rating).then(() => setFeedbackSent((current) => new Set([...current, item.id]))).catch((reason) => setError(reason instanceof Error ? reason.message : "反馈提交失败")); }} />}
        />
      )}
      {unseenNewMessage ? <Pressable onPress={() => { setUnseenNewMessage(false); nearBottomRef.current = true; listRef.current?.scrollToEnd({ animated: true }); }} style={styles.newMessagePrompt}><Text style={styles.newMessageText}>有新消息 ↓</Text></Pressable> : null}
      {replying ? <View style={styles.replying}><View style={{ flex: 1 }}><Text style={styles.replyingLabel}>回复 {replying.actorName}</Text><Text numberOfLines={1} style={styles.replyingText}>{replying.text ?? `[${replying.kind}]`}</Text></View><Pressable onPress={() => setReplying(null)}><Text style={styles.close}>×</Text></Pressable></View> : null}
      {recorderState.isRecording ? <View style={styles.recording}><View style={styles.recordDot} /><Text style={styles.recordText}>正在录音 {Math.min(60, Math.round(recorderState.durationMillis / 1000))} / 60 秒</Text><Pressable onPress={() => void stopVoice()}><Text style={styles.stopText}>停止并发送</Text></Pressable></View> : (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 9) }]}><Pressable accessibilityRole="button" accessibilityLabel="添加图片语音或玩法" onPress={() => setMenu(true)} style={styles.plus}><Text style={styles.plusText}>＋</Text></Pressable><EnterSendTextInput accessibilityLabel="消息内容" value={text} onChangeText={setText} onSend={sendTextMessage} maxLength={4000} placeholder="发消息…" placeholderTextColor={colors.textMuted} style={styles.composerInput} /><Pressable accessibilityRole="button" accessibilityLabel="发送消息" disabled={!text.trim()} onPress={() => sendTextMessage()} style={[styles.send, !text.trim() && styles.sendDisabled]}><Text style={styles.sendText}>发送</Text></Pressable></View>
      )}
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}><Pressable style={styles.overlay} onPress={() => setMenu(false)}><View style={styles.menuGrid}><Pressable onPress={() => void pickImage()} style={styles.menuItem}><Text style={styles.menuIcon}>▧</Text><Text style={styles.menuLabel}>图片</Text></Pressable><Pressable onPress={() => void startVoice()} style={styles.menuItem}><Text style={styles.menuIcon}>◉</Text><Text style={styles.menuLabel}>短语音</Text></Pressable><Pressable onPress={() => { setMenu(false); void invitePeople(); }} style={styles.menuItem}><Text style={styles.menuIcon}>＋</Text><Text style={styles.menuLabel}>邀请成员</Text></Pressable><Pressable onPress={openCorner} style={styles.menuItem}><Text style={styles.menuIcon}>✦</Text><Text style={styles.menuLabel}>宠物角</Text></Pressable><Pressable onPress={openObservation} style={styles.menuItem}><Text style={styles.menuIcon}>◎</Text><Text style={styles.menuLabel}>观察授权</Text></Pressable></View></Pressable></Modal>
      <AgentWorkbench visible={workbenchOpen} spaceId={spaceId} repository={repository} onClose={() => setWorkbenchOpen(false)} onPublished={() => void loadLatest()} />
      <ImageViewer visible={Boolean(previewMessage)} url={previewMessage?.mediaPath ? signedUrls[previewMessage.mediaPath] ?? (previewMessage.deliveryState !== "sent" ? previewMessage.mediaPath : null) : null} loading={previewLoading} onClose={() => setPreviewMessage(null)} onRetry={() => { if (previewMessage) void refreshSignedImage(previewMessage); }} />
      <Modal visible={Boolean(invite)} transparent animationType="fade" onRequestClose={() => setInvite(null)}><View style={styles.overlayCenter}><View style={styles.inviteCard}><Text style={styles.inviteTitle}>7 天空间邀请</Text><Text selectable style={styles.inviteLink}>{invite}</Text><Text style={styles.inviteNote}>双人空间只能补足至 2 人，群空间最多 20 人；上限由数据库事务强制执行。</Text><AppButton label="完成" onPress={() => setInvite(null)} /></View></View></Modal>
      <Modal visible={observationOpen} transparent animationType="fade" onRequestClose={() => setObservationOpen(false)}><View style={styles.overlayCenter}><View style={styles.panelCard}><View style={styles.panelHead}><View style={{ flex: 1 }}><Text style={styles.inviteTitle}>异宠权限与观察</Text><Text style={styles.inviteNote}>观察未来对话需全员同意。静音只影响你看到的异宠消息；超过半数成员投暂停票后，该异宠停止在本空间参与，人类聊天不受影响。</Text></View><Pressable onPress={() => setObservationOpen(false)}><Text style={styles.close}>×</Text></Pressable></View>{panelBusy ? <ActivityIndicator color={colors.mint} /> : observations.map((item) => <View key={item.petId} style={styles.petPermission}><View><Text style={styles.permissionTitle}>{item.petName} <Text style={styles.permissionOwner}>· {item.ownerName} 的异宠</Text></Text><Text style={item.unanimousConsent ? styles.enabled : styles.waiting}>{item.unanimousConsent ? "全员已同意 · 正在观察" : "尚未全员同意 · 不会分析"}</Text><Text style={item.pausedByVote ? styles.waiting : styles.enabled}>{item.pausedByVote ? "过半成员已暂停参与" : "当前可参与空间"}</Text></View><View style={styles.permissionControls}><Pressable accessibilityRole="button" onPress={() => void updatePetControl(() => repository.setPetObservationConsent(spaceId, item.petId, !item.ownConsent))} style={[styles.consentButton, item.ownConsent && styles.consentButtonOn]}><Text style={styles.consentText}>{item.ownConsent ? "撤回观察同意" : "同意观察"}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void updatePetControl(() => repository.setPetLocalMute(spaceId, item.petId, !item.ownMuted))} style={[styles.consentButton, item.ownMuted && styles.consentButtonOn]}><Text style={styles.consentText}>{item.ownMuted ? "取消静音" : "仅我静音"}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void updatePetControl(() => repository.votePetPause(spaceId, item.petId, !item.ownPauseVote))} style={[styles.consentButton, item.ownPauseVote && styles.consentButtonOn]}><Text style={styles.consentText}>{item.ownPauseVote ? "撤回暂停票" : "投暂停票"}</Text></Pressable></View></View>)}</View></View></Modal>
      <Modal visible={cornerOpen} transparent animationType="fade" onRequestClose={() => setCornerOpen(false)}><View style={styles.overlayCenter}><View style={styles.panelCard}><View style={styles.panelHead}><View style={{ flex: 1 }}><Text style={styles.inviteTitle}>宠物角</Text><Text style={styles.inviteNote}>照顾和玩耍留在这里，不会自动打扰主聊天。你可以手动分享一条高光。</Text></View><Pressable onPress={() => setCornerOpen(false)}><Text style={styles.close}>×</Text></Pressable></View><View style={styles.petCareRow}>{observations.map((item) => <View key={item.petId} style={styles.careCard}><Text style={styles.permissionTitle}>{item.petName}</Text><View style={styles.careActions}><Pressable disabled={panelBusy || !item.participationEnabled} onPress={() => void care(item.petId, "care")}><Text style={styles.careAction}>陪伴</Text></Pressable><Pressable disabled={panelBusy || !item.participationEnabled} onPress={() => void care(item.petId, "feed")}><Text style={styles.careAction}>投喂</Text></Pressable><Pressable disabled={panelBusy || !item.participationEnabled} onPress={() => void care(item.petId, "play")}><Text style={styles.careAction}>玩耍</Text></Pressable></View></View>)}</View>{panelBusy ? <ActivityIndicator color={colors.mint} /> : null}<FlatList data={stories} keyExtractor={(item) => item.id} style={styles.storyList} ListEmptyComponent={<Text style={styles.inviteNote}>这里还没有故事，先陪一只异宠玩一会儿吧。</Text>} renderItem={({ item }) => <View style={styles.story}><Text style={styles.storyPet}>{item.petName} 的小故事</Text><Text style={styles.storyText}>{item.content}</Text><Pressable onPress={() => { setCornerOpen(false); void enqueueAndSend({ kind: "text", text: `[宠物角高光] ${item.content}` }); }}><Text style={styles.shareStory}>分享到主聊天</Text></Pressable></View>} /></View></View></Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, height: Platform.OS === "web" ? ("100dvh" as never) : undefined, overflow: "hidden", backgroundColor: colors.canvas }, center: { flex: 1, justifyContent: "center" }, header: { flexShrink: 0, minHeight: 68, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.canvasRaised },
  headerButton: { width: 46, height: 46, flexShrink: 0, alignItems: "center", justifyContent: "center" }, headerButtonText: { color: colors.text, fontSize: 38, fontWeight: "300" }, more: { color: colors.text, fontSize: 18, letterSpacing: 2 }, agentHeaderButton: { width: 38, height: 38, flexShrink: 0, borderRadius: 14, backgroundColor: colors.mintDeep, borderWidth: 1, borderColor: colors.mint, alignItems: "center", justifyContent: "center" }, agentHeaderText: { color: colors.mint, fontWeight: "900", fontSize: 16 }, headerTitleWrap: { flex: 1, alignItems: "center" }, headerTitle: { color: colors.text, fontWeight: "900", fontSize: 17 }, headerStatus: { color: colors.mint, fontSize: 10, marginTop: 2 },
  messageList: { flex: 1, minHeight: 0 },
  errorBar: { backgroundColor: "#603345", padding: 8 }, errorBarText: { color: colors.coralSoft, textAlign: "center", fontSize: 12 }, messages: { padding: spacing.md, gap: 10, paddingBottom: spacing.lg }, loadOlder: { alignSelf: "center", padding: spacing.sm }, loadOlderText: { color: colors.mint, fontSize: 12 },
  messageWrap: { width: "88%", alignSelf: "flex-start", flexDirection: "row", gap: 9, alignItems: "flex-start" }, messageWrapMine: { alignSelf: "flex-end", flexDirection: "row-reverse" }, senderAvatar: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }, senderAvatarAgent: { backgroundColor: colors.mintDeep, borderWidth: 1, borderColor: colors.mint }, senderAvatarText: { color: colors.text, fontWeight: "900" },
  messageColumn: { flex: 1, minWidth: 0, alignItems: "flex-start" }, messageColumnMine: { alignItems: "flex-end" }, senderName: { color: colors.textMuted, fontSize: 11, marginLeft: 4, marginBottom: 4 }, agentName: { color: colors.mint },
  bubble: { maxWidth: "100%", flexShrink: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, overflow: "hidden" }, bubbleOther: { backgroundColor: colors.surface }, bubbleMine: { backgroundColor: colors.coralSoft, borderTopRightRadius: 5 }, bubbleAgent: { backgroundColor: colors.mintDeep, borderWidth: 1, borderColor: "rgba(125,226,196,.35)" }, mediaBubble: { padding: 4 },
  messageText: { flexShrink: 1, color: colors.text, fontSize: 16, lineHeight: 23 }, messageTextMine: { color: colors.textDark }, replyQuote: { borderLeftWidth: 3, borderLeftColor: colors.lavender, backgroundColor: "rgba(0,0,0,.13)", paddingHorizontal: 8, paddingVertical: 5, marginBottom: 7, borderRadius: 5 }, replyQuoteText: { color: colors.textMuted, fontSize: 12 },
  metaRow: { flexDirection: "row", gap: 8, marginTop: 4, marginLeft: 4 }, metaRowMine: { justifyContent: "flex-end", marginRight: 4 }, meta: { color: colors.textMuted, fontSize: 9 }, failed: { color: colors.coralSoft },
  actions: { flexDirection: "row", gap: 11, backgroundColor: colors.canvasRaised, borderWidth: 1, borderColor: colors.line, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7, marginTop: 5, alignItems: "center" }, actionsMine: { alignSelf: "flex-end" }, actionText: { color: colors.mint, fontWeight: "800", fontSize: 12 }, actionEmoji: { fontSize: 16 }, reactionSummary: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }, reactionPill: { backgroundColor: colors.surfaceSoft, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 3 }, reactionText: { color: colors.text, fontSize: 11 },
  agentProgress: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, paddingHorizontal: 4 }, agentProgressText: { color: colors.mint, fontSize: 10 }, agentFailed: { color: colors.coralSoft, fontSize: 10, fontWeight: "800" }, feedbackActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center", backgroundColor: colors.canvasRaised, borderRadius: radii.md, paddingHorizontal: 10, paddingVertical: 7, marginTop: 5 }, feedbackLabel: { color: colors.textMuted, fontSize: 10 }, feedbackAction: { color: colors.mint, fontSize: 10, fontWeight: "800" }, feedbackUnsafe: { color: colors.coralSoft, fontSize: 10, fontWeight: "800" },
  messageImage: { width: 220, height: 165, borderRadius: 13 }, voice: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, minWidth: 155, minHeight: 42 }, voiceIcon: { color: colors.mint, fontSize: 22 }, wave: { flexDirection: "row", alignItems: "center", gap: 3, flex: 1 }, waveLine: { width: 3, height: 10, borderRadius: 2, backgroundColor: colors.mint }, voiceTime: { color: colors.textMuted },
  delegatedLabel: { color: colors.lavender, fontSize: 9, marginTop: 3 }, replying: { flexShrink: 0, backgroundColor: colors.canvasRaised, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 8 }, replyingLabel: { color: colors.mint, fontSize: 11, fontWeight: "800" }, replyingText: { color: colors.textMuted, fontSize: 12 }, close: { color: colors.textMuted, fontSize: 25, padding: 8 },
  composer: { flexShrink: 0, flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 9, paddingTop: 9, backgroundColor: colors.canvasRaised, borderTopWidth: 1, borderTopColor: colors.line }, plus: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }, plusText: { color: colors.text, fontSize: 27 }, composerInput: { flex: 1, minWidth: 0, minHeight: 42, maxHeight: 116, backgroundColor: colors.surface, borderRadius: 15, color: colors.text, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 10 }, send: { flexShrink: 0, minHeight: 42, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center" }, sendDisabled: { opacity: .35 }, sendText: { color: colors.white, fontWeight: "900" },
  newMessagePrompt: { position: "absolute", bottom: 78, alignSelf: "center", backgroundColor: colors.mintDeep, borderWidth: 1, borderColor: colors.mint, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 8 }, newMessageText: { color: colors.mint, fontWeight: "900", fontSize: 11 },
  recording: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: spacing.md, backgroundColor: colors.canvasRaised }, recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.coral }, recordText: { flex: 1, color: colors.text }, stopText: { color: colors.mint, fontWeight: "900" },
  overlay: { flex: 1, backgroundColor: "rgba(4,3,13,.6)", justifyContent: "flex-end" }, menuGrid: { backgroundColor: colors.canvasRaised, padding: spacing.lg, paddingBottom: 36, flexDirection: "row", justifyContent: "space-around", flexWrap: "wrap", gap: spacing.md, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl }, menuItem: { alignItems: "center", gap: 7, width: 76 }, menuIcon: { width: 54, height: 54, textAlign: "center", textAlignVertical: "center", lineHeight: 54, borderRadius: 18, backgroundColor: colors.surface, color: colors.mint, fontSize: 24, overflow: "hidden" }, menuLabel: { color: colors.textMuted, fontSize: 12 },
  overlayCenter: { flex: 1, backgroundColor: "rgba(4,3,13,.75)", alignItems: "center", justifyContent: "center", padding: spacing.lg }, inviteCard: { width: "100%", maxWidth: 480, borderRadius: radii.xl, backgroundColor: colors.canvasRaised, padding: spacing.lg, gap: spacing.md }, inviteTitle: { color: colors.text, fontSize: 21, fontWeight: "900" }, inviteLink: { color: colors.mint, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md }, inviteNote: { color: colors.textMuted, lineHeight: 20 },
  panelCard: { width: "100%", maxWidth: 620, maxHeight: "84%", borderRadius: radii.xl, backgroundColor: colors.canvasRaised, padding: spacing.lg, gap: spacing.md }, panelHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 }, petPermission: { gap: 10, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md }, permissionControls: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, permissionTitle: { color: colors.text, fontWeight: "900" }, permissionOwner: { color: colors.textMuted, fontWeight: "500" }, enabled: { color: colors.mint, fontSize: 11, marginTop: 4 }, waiting: { color: colors.coralSoft, fontSize: 11, marginTop: 4 }, consentButton: { borderRadius: radii.pill, backgroundColor: colors.mintDeep, paddingHorizontal: 12, paddingVertical: 8 }, consentButtonOn: { backgroundColor: "#593448" }, consentText: { color: colors.text, fontSize: 11, fontWeight: "800" }, petCareRow: { gap: 8 }, careCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: 10, gap: 8 }, careActions: { flexDirection: "row", gap: spacing.lg }, careAction: { color: colors.mint, fontWeight: "900" }, storyList: { maxHeight: 330 }, story: { backgroundColor: colors.surface, borderRadius: radii.md, padding: 12, gap: 6, marginBottom: 8 }, storyPet: { color: colors.lavender, fontWeight: "900", fontSize: 12 }, storyText: { color: colors.text, lineHeight: 20 }, shareStory: { color: colors.mint, fontWeight: "800", fontSize: 12 },
});
