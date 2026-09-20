import { ScrollView } from "react-native";
import { GroupWorkSuggestions } from "../../src/work/GroupWorkSuggestions";
import { SpaceAvatar } from "../../src/avatars/SpaceAvatar";
import { AvatarEditor } from "../../src/avatars/AvatarEditor";
import { NotificationSettings } from "../../src/notifications/NotificationSettings";
import { ChatBackgroundEditor } from "../../src/backgrounds/ChatBackgroundEditor";
import { ChatBackgroundSurface, useChatBackgroundColors } from "../../src/backgrounds/ChatBackgroundSurface";
import { Icon } from "../../src/ui/Icon";
import { createThemedStyles } from "../../src/theme/themedStyles";
import { KeyboardScreen } from "../../src/components/KeyboardLayout";
import NetInfo, { useNetInfo } from "@react-native-community/netinfo";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { getMediaInfo, removeStabilizedMedia, stabilizeMediaForOutbox } from "../../src/chat/mediaFile";
import { invalidateCachedMedia, resolveCachedMedia } from "../../src/chat/mediaCache";
import Constants from "expo-constants";
import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, ActivityIndicator, FlatList, Image, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/auth/SessionProvider";
import { createClientId, MessageOutbox } from "../../src/chat/outbox";
import { groupReplyJobs, groupReplyProgress, startGroupReplyRefresh } from "../../src/chat/groupReplyStatus";
import { createPersistentOutboxStore } from "../../src/chat/persistentOutbox";
import { contentSizeAction, createViewportIntent, updateNearBottom, type ViewportIntent } from "../../src/chat/viewportPolicy";
import { AgentWorkbench } from "../../src/components/AgentWorkbench";
import { AgentProposalCard } from "../../src/components/AgentProposalCard";
import { EnterSendTextInput } from "../../src/components/EnterSendTextInput";
import { ImageViewer } from "../../src/components/ImageViewer";
import { createChatRepository } from "../../src/data/chatRepository";
import type { AgentFeedbackRating, AgentJob, AgentProposal, AgentRequest, ChatMessage, MentionTarget, PetObservationStatus, QueuedMessage } from "../../src/data/types";
import { AppButton } from "../../src/ui/common";
import { colors, radii, spacing } from "../../src/theme/tokens";
import { useAppTheme } from "../../src/theme/ThemeProvider";
import { spaceInviteUrl } from "../../src/lib/publicLinks";

import { coalesceRefresh, latestSentMessage, MessageCache, mergeMessages, newestCursor, type MessageCursor } from "../../src/chat/messageSync";
import { AvatarImage } from "../../src/avatars/AvatarImage";

const REACTIONS = ["👍", "❤️", "😂", "😢"] as const;

function dateLabel(value: string): string {
  const date = new Date(value); const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function VoiceContent({ url, seconds }: Readonly<{ url: string; seconds: number | null }>) {
  const { styles, colors } = useStyles();
  const player = useAudioPlayer(url);
  return <Pressable onPress={() => player.play()} style={styles.voice}><Text style={styles.voiceIcon}>▷</Text><View style={styles.wave}><View style={styles.waveLine} /><View style={[styles.waveLine, { height: 18 }]} /><View style={styles.waveLine} /><View style={[styles.waveLine, { height: 14 }]} /></View><Text style={styles.voiceTime}>{Math.max(1, Math.round(seconds ?? 1))}″</Text></Pressable>;
}

function MediaContent({ message, signedUrl, onOpenImage }: Readonly<{ message: ChatMessage; signedUrl: string | null; onOpenImage(): void }>) {
  const { styles, colors } = useStyles();
  if (!message.mediaPath) return null;
  if (!signedUrl) return <ActivityIndicator color={colors.mint} style={{ margin: 15 }} />;
  if (message.kind === "image") return <Pressable accessibilityRole="button" accessibilityLabel="全屏查看图片" onPress={(event) => { event.stopPropagation(); onOpenImage(); }}><Image source={{ uri: signedUrl }} resizeMode="cover" style={styles.messageImage} /></Pressable>;
  if (message.kind === "voice") return <VoiceContent url={signedUrl} seconds={message.mediaDurationSeconds} />;
  return null;
}

function MessageText({ message, mine }: Readonly<{ message: ChatMessage; mine: boolean }>) {
  const { styles, colors } = useStyles();
  const background=useChatBackgroundColors(`group:${message.spaceId}`);
  const text = message.text ?? "";
  const labels = [...new Set((message.mentions ?? []).map((mention) => `@${mention.displayText}`).filter(Boolean))];
  if (!labels.length) return <Text style={[styles.messageText, {color:mine?background.userText:background.text}]}>{text}</Text>;
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((left, right) => right.length - left.length);
  const matcher = new RegExp(`(${escaped.join("|")})`, "g");
  return <Text style={[styles.messageText, {color:mine?background.userText:background.text}]}>{text.split(matcher).map((part, index) => labels.includes(part) ? <Text key={`${part}:${index}`} style={styles.mentionText}>{part}</Text> : part)}</Text>;
}

function MessageRow({ message, mine, signedUrl, selected, agentJob, proposal, currentUserId, feedbackSubmitted, onSelect, onOpenImage, onReply, onReact, onRetry, onRetryAgent, onAgentFeedback, onProposalVote }: Readonly<{
  message: ChatMessage; mine: boolean; signedUrl: string | null; selected: boolean; agentJob?: AgentJob | null; proposal?: AgentProposal | null; currentUserId: string; feedbackSubmitted: boolean; onSelect(): void; onOpenImage(): void; onReply(): void; onReact(emoji: string): void; onRetry(): void; onRetryAgent(): void; onAgentFeedback(rating: AgentFeedbackRating): void; onProposalVote(decision: "approve" | "reject"): void;
}>) {
  const { styles, colors } = useStyles();
  const background=useChatBackgroundColors(`group:${message.spaceId}`);
  const isAgent = message.actorKind !== "human";
  const reactionEntries = Object.entries(message.reactions).filter(([, users]) => users.length > 0);
  const bubbleStyle = [styles.bubble, mine ? styles.bubbleMine : isAgent ? styles.bubbleAgent : styles.bubbleOther, message.kind === "image" && styles.mediaBubble, {backgroundColor:mine?background.userBubble:background.bubble}];
  const bubbleContent = <>
    {message.replyPreview ? <View style={styles.replyQuote}><Text numberOfLines={2} style={styles.replyQuoteText}>{message.replyPreview}</Text></View> : null}
    <MediaContent message={message} signedUrl={signedUrl} onOpenImage={onOpenImage} />
    {proposal ? <AgentProposalCard proposal={proposal} currentUserId={currentUserId} onVote={onProposalVote} /> : message.text ? <MessageText message={message} mine={mine} /> : null}
  </>;
  return (
    <View style={[styles.messageWrap, mine && styles.messageWrapMine]}>
      {!isAgent ? <AvatarImage reference={message.senderAvatarUrl} name={message.actorName} size={36}/> : <View style={[styles.senderAvatar,styles.senderAvatarAgent]}><Text style={styles.senderAvatarText}>{message.actorKind === "pet"?"✦":"A"}</Text></View>}
      <View style={[styles.messageColumn, mine && styles.messageColumnMine]}>
        {!mine ? <Text style={[styles.senderName, isAgent && styles.agentName]}>{message.actorName}{isAgent ? " · AI" : ""}</Text> : null}
        {message.kind === "image" || message.kind === "voice" || proposal ? <View style={proposal ? styles.proposalBubble : bubbleStyle}>{bubbleContent}</View> : <Pressable accessibilityRole="button" accessibilityLabel={`消息：${message.text ?? message.kind}`} onPress={onSelect} onLongPress={onSelect} style={bubbleStyle}>{bubbleContent}</Pressable>}
        {message.delegationRequestId ? <Text style={styles.delegatedLabel}>{message.delegationConfirmedAt && message.delegationConfirmedBy ? "异宠代本人发布 · 本人已确认" : "由异宠代发 · 历史记录"}</Text> : null}
        <View style={[styles.metaRow, mine && styles.metaRowMine]}><Text style={styles.meta}>{dateLabel(message.createdAt)}</Text>{mine && message.deliveryState !== "sent" ? <Pressable onPress={message.deliveryState === "failed" ? onRetry : undefined}><Text style={[styles.meta, message.deliveryState === "failed" && styles.failed]}>{message.deliveryState === "preparing" ? "正在准备" : message.deliveryState === "uploading" ? "上传中" : message.deliveryState === "pending" ? "发送中" : "发送失败 · 重试"}</Text></Pressable> : null}</View>
        {mine && agentJob && (agentJob.status === "queued" || agentJob.status === "running") ? <View style={styles.agentProgress}><ActivityIndicator size="small" color={colors.mint} /><Text style={styles.agentProgressText}>{groupReplyProgress(agentJob)}</Text></View> : null}
        {mine && agentJob && (agentJob.status === "failed" || agentJob.status === "blocked") ? <Pressable disabled={agentJob.retryable === false || agentJob.errorCode === "legacy_route_review_required"} onPress={agentJob.retryable === false || agentJob.errorCode === "legacy_route_review_required" ? undefined : onRetryAgent} style={styles.agentProgress}><Text style={styles.agentFailed}>{agentJob.retryable === false || agentJob.errorCode === "legacy_route_review_required" ? "异宠回应暂不可重试" : "异宠回应失败 · 点击手动重试"}</Text></Pressable> : null}
        {reactionEntries.length ? <View style={styles.reactionSummary}>{reactionEntries.map(([emoji, users]) => <Pressable key={emoji} onPress={() => onReact(emoji)} style={styles.reactionPill}><Text style={styles.reactionText}>{emoji} {users.length}</Text></Pressable>)}</View> : null}
        {selected ? <><View style={[styles.actions, mine && styles.actionsMine]}><Pressable accessibilityRole="button" accessibilityLabel="回复消息" onPress={onReply}><Text style={styles.actionText}>回复</Text></Pressable>{REACTIONS.map((emoji) => <Pressable accessibilityRole="button" accessibilityLabel={`回应 ${emoji}`} key={emoji} onPress={() => onReact(emoji)}><Text style={styles.actionEmoji}>{emoji}</Text></Pressable>)}</View>{isAgent ? <View style={styles.feedbackActions}>{feedbackSubmitted ? <Text style={styles.feedbackAction}>谢谢反馈，这条只能评价一次</Text> : <><Text style={styles.feedbackLabel}>这次回应：</Text>{([['natural', '自然'], ['irrelevant', '不相关'], ['intrusive', '打扰'], ['unsafe', '越界']] as const).map(([rating, label]) => <Pressable key={rating} accessibilityRole="button" accessibilityLabel={`评价异宠回应：${label}`} onPress={() => onAgentFeedback(rating)}><Text style={rating === "unsafe" ? styles.feedbackUnsafe : styles.feedbackAction}>{label}</Text></Pressable>)}</>}</View> : null}</> : null}
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { styles, colors } = useStyles();
  const [backgroundOpen,setBackgroundOpen]=useState(false);
  const [avatarOpen,setAvatarOpen]=useState(false);
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  const { spaceId, messageId: notificationMessageId } = useLocalSearchParams<{ spaceId: string; messageId?: string }>(); const { profile, isLoading: sessionLoading, isLocalDemo } = useSession(); const insets = useSafeAreaInsets(); const netInfo = useNetInfo();
  const { theme } = useAppTheme();
  const repository = useMemo(() => profile ? createChatRepository(profile) : null, [profile?.id, profile?.nickname]); const outbox = useMemo(() => new MessageOutbox(createPersistentOutboxStore(profile?.id ?? "signed-out")), [profile?.id]);
  const cache = useMemo(() => new MessageCache(profile?.id ?? "signed-out",spaceId),[profile?.id,spaceId]);
  const cursorRef = useRef<MessageCursor | null>(null);
  const generationRef = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const draftRevisionRef = useRef(0);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]); const [loading, setLoading] = useState(true); const [loadingOlder, setLoadingOlder] = useState(false); const [hasOlder, setHasOlder] = useState(true);
  const [agentJobs, setAgentJobs] = useState<readonly AgentJob[]>([]);
  const [agentRequests, setAgentRequests] = useState<readonly AgentRequest[]>([]);
  const [feedbackSent, setFeedbackSent] = useState<ReadonlySet<string>>(new Set());
  const [text, setText] = useState(""); const [replying, setReplying] = useState<ChatMessage | null>(null); const [selectedId, setSelectedId] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [suggestionsOpen,setSuggestionsOpen]=useState(false);
  const [menu, setMenu] = useState(false); const [invite, setInvite] = useState<string | null>(null); const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [workbenchOpen, setWorkbenchOpen] = useState(false); const [previewMessage, setPreviewMessage] = useState<ChatMessage | null>(null); const [previewLoading, setPreviewLoading] = useState(false); const [unseenNewMessage, setUnseenNewMessage] = useState(false);
  const [observationOpen, setObservationOpen] = useState(false); const [observations, setObservations] = useState<readonly PetObservationStatus[]>([]); const [panelBusy, setPanelBusy] = useState(false);
  const [mentionTargets, setMentionTargets] = useState<readonly MentionTarget[]>([]); const [mentionQuery, setMentionQuery] = useState<string | null>(null); const [selectedMentions, setSelectedMentions] = useState<readonly MentionTarget[]>([]);
  const [voiceMode, setVoiceMode] = useState(false); const [recordCancelled, setRecordCancelled] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messagesRef = useRef<readonly ChatMessage[]>([]);
  const nearBottomRef = useRef(true); const initialScrollDoneRef = useRef(false); const newestMessageKeyRef = useRef<string | null>(null);
  const pendingViewportIntentRef = useRef<ViewportIntent | null>(null);
  const viewportMetricsRef = useRef({ contentHeight: 0, viewportHeight: 0, offsetY: 0 });
  const viewportSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownMessageSettledOffsetRef = useRef<number | null>(null);
  const lastMarkedReadKeyRef = useRef<string | null>(null);
  const locatedNotificationMessageRef = useRef<string | null>(null);
  const recordingActiveRef = useRef(false); const voicePressHeldRef = useRef(false); const recordStartYRef = useRef<number | null>(null); const cancelRecordingRef = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY); const recorderState = useAudioRecorderState(recorder, 250);
  const connected = netInfo.isConnected !== false;
  const [spaceIdentity, setSpaceIdentity] = useState<{ ownerId: string; spaceId: string; name: string } | null>(null);
  const spaceName = spaceIdentity?.ownerId === profile?.id && spaceIdentity?.spaceId === spaceId ? spaceIdentity.name : "群聊";

  const publishMessages = useCallback((next: readonly ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const markLatestRead = useCallback(() => {
    const newest = latestSentMessage(messagesRef.current);
    if (!repository || !newest || !nearBottomRef.current) return;
    const key = `${newest.senderId}:${newest.clientId}`;
    if (lastMarkedReadKeyRef.current === key) return;
    lastMarkedReadKeyRef.current = key;
    void repository.markRead(spaceId, newest.id).catch(() => { if (lastMarkedReadKeyRef.current === key) lastMarkedReadKeyRef.current = null; });
  }, [repository, spaceId]);

  const settleViewportAtEnd = useCallback((animated: boolean) => {
    if (viewportSettleTimerRef.current) clearTimeout(viewportSettleTimerRef.current);
    let attempt = 0;
    const scrollAfterLayout = () => {
      const shouldAnimate = attempt === 0 ? animated : false;
      if (Platform.OS === "web") {
        const scrollNode = (typeof document !== "undefined" ? document.querySelector('[data-testid="chat-message-list"]') : null) as HTMLElement | null;
        if (scrollNode) scrollNode.scrollTop = scrollNode.scrollHeight;
        if (scrollNode && scrollNode.scrollHeight - scrollNode.clientHeight - scrollNode.scrollTop <= 48) {
          ownMessageSettledOffsetRef.current = scrollNode.scrollTop;
          viewportSettleTimerRef.current = null;
          pendingViewportIntentRef.current = null;
          nearBottomRef.current = true;
          setUnseenNewMessage(false);
          markLatestRead();
          return;
        }
      } else listRef.current?.scrollToEnd({ animated: shouldAnimate });
      attempt += 1;
      if (attempt < 24) {
        viewportSettleTimerRef.current = setTimeout(scrollAfterLayout, 80);
        return;
      }
      viewportSettleTimerRef.current = null;
      pendingViewportIntentRef.current = null;
      nearBottomRef.current = updateNearBottom(viewportMetricsRef.current);
      if (nearBottomRef.current) {
        setUnseenNewMessage(false);
        markLatestRead();
      }
    };
    requestAnimationFrame(scrollAfterLayout);
  }, [markLatestRead]);

  const loadLatest = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    if (!repository || !profile) return;
    const generation = ++generationRef.current;
    let disposed = false;
    let revoked = false;
    let initialized = false;
    let hasMore = true;
    const valid = () => !disposed && !revoked && generationRef.current === generation;
    cursorRef.current = null;
    initialScrollDoneRef.current = false;
    publishMessages([]); setLoading(true); setAgentJobs([]); setAgentRequests([]); setSignedUrls({}); setSpaceIdentity(null);
    const apply = (remote: readonly ChatMessage[]) => {
      if (!valid()) return;
      const current = messagesRef.current;
      const next = mergeMessages(current,remote);
      const previousNewest = current.at(-1); const nextNewest = next.at(-1);
      const previousKey = previousNewest ? `${previousNewest.senderId}:${previousNewest.clientId}` : null;
      const nextKey = nextNewest ? `${nextNewest.senderId}:${nextNewest.clientId}` : null;
      if (nextKey && previousKey !== nextKey) {
        if (!initialScrollDoneRef.current) {
          initialScrollDoneRef.current = true;
          pendingViewportIntentRef.current = createViewportIntent("initial", viewportMetricsRef.current.contentHeight, viewportMetricsRef.current.offsetY);
        } else if (!pendingViewportIntentRef.current) {
          if (nearBottomRef.current) pendingViewportIntentRef.current = createViewportIntent("incoming", viewportMetricsRef.current.contentHeight, viewportMetricsRef.current.offsetY);
          else setUnseenNewMessage(true);
        }
        newestMessageKeyRef.current = nextKey;
      }
      publishMessages(next);
      const newestReadable = latestSentMessage(next);
      if (!current.length && newestReadable) {
        const readKey = `${newestReadable.senderId}:${newestReadable.clientId}`;
        lastMarkedReadKeyRef.current = readKey;
        void repository.markRead(spaceId, newestReadable.id).catch(() => { if (lastMarkedReadKeyRef.current === readKey) lastMarkedReadKeyRef.current = null; });
      }
      void cache.save({messages:next,cursor:cursorRef.current,hasOlder:hasMore}).catch(() => undefined);
    };
    const fail = async (reason: unknown) => {
      if (!valid()) return;
      const detail = String((reason as {message?:string})?.message ?? reason);
      if (/not_space_member|unauthenticated|permission denied/i.test(detail)) {
        revoked=true;publishMessages([]); setAgentJobs([]); setAgentRequests([]); setMentionTargets([]); setObservations([]); setSignedUrls({}); setSpaceIdentity(null); await cache.clear();
        if(disposed||generationRef.current!==generation)return;
        setError("已无法访问这个群，相关缓存已清理。");
      } else setError("暂未同步最新消息，可保留输入后重试。");
      setLoading(false);
    };
    const auxiliary = coalesceRefresh(async () => {
      await Promise.allSettled([
        repository.getSpaceName(spaceId).then(name => { if (valid()) setSpaceIdentity({ ownerId: profile.id, spaceId, name }); }).catch(fail),
        repository.listAgentJobs(spaceId).then((rows) => { if(valid()) setAgentJobs(rows); }),
        repository.listAgentRequests(spaceId).then((rows) => { if(valid()) setAgentRequests(rows); }),
      ]);
    });
    const sync = coalesceRefresh(async () => {
      if (!valid()) return;
      if (!cursorRef.current) {
        const recent = await repository.listMessages(spaceId,null,50);
        if (!valid()) return;
        hasMore = recent.length === 50;
        cursorRef.current = newestCursor(recent);
        apply(recent); setHasOlder(hasMore);
      } else {
        for (;;) {
          const page = await repository.syncMessages(spaceId,cursorRef.current!);
          if (!valid()) return;
          cursorRef.current = newestCursor(page,cursorRef.current);
          apply(page);
          if (page.length < 100) break;
        }
      }
      if(valid()) { setLoading(false); setError(null); }
    });
    refreshRef.current = async () => { if (initialized) { await sync().catch(fail); void auxiliary(); } };
    const start = async () => {
      const cached = await cache.load();
      if (!valid()) return;
      if(cached) { cursorRef.current=cached.cursor; hasMore=cached.hasOlder; apply(cached.messages); setHasOlder(hasMore); setLoading(false); }
      const pending = await outbox.list();
      if(!valid()) return;
      apply(pending.filter((q) => q.spaceId===spaceId && q.senderId===profile.id).map((q) => ({
        id:q.clientId,clientId:q.clientId,spaceId:q.spaceId,senderId:q.senderId,actorKind:"human" as const,actorName:profile.nickname,
        senderAvatarUrl:profile.avatarUrl,kind:q.kind,text:q.text,mediaPath:q.localMediaUri ?? null,mediaDurationSeconds:q.mediaDurationSeconds ?? null,
        replyToMessageId:q.replyToMessageId ?? null,replyPreview:q.replyPreview ?? null,createdAt:q.createdAt,deliveryState:q.attempts ? "failed" as const : "pending" as const,reactions:{},
      })));
      initialized = true;
      void auxiliary();
      await sync().catch(fail);
    };
    void start().catch(fail);
    const unsubscribe = repository.subscribe(spaceId,(event) => {
      if (!initialized || !valid()) return;
      if (event?.kind === "auxiliary") { void auxiliary(); return; }
      // Reconcile loaded IDs on permission or reaction changes; absence removes hidden rows.
      if (event?.kind === "permission" || event?.ids?.length) {
        const ids = event.kind === "permission" ? messagesRef.current.filter((m) => m.deliveryState === "sent").map((m)=>m.id) : event.ids ?? [];
        void (async () => {
          for(let i=0;i<ids.length;i+=100) {
            const batch=ids.slice(i,i+100);
            const rows=await repository.getMessagesByIds(spaceId,batch);
            if(!valid()) return;
            publishMessages(messagesRef.current.filter((m) => !batch.includes(m.id)));
            apply(rows);
          }
        })().catch(fail);
      }
      void sync().catch(fail);
      // A reply message can arrive even when the matching job event was lost.
      if (event?.kind === "connected" || event?.kind === "messages") void auxiliary();
    });
    const foreground = AppState.addEventListener("change", (state) => { if (state === "active" && initialized) void refreshRef.current(); });
    return () => { disposed=true; generationRef.current++; unsubscribe(); foreground.remove(); refreshRef.current=async()=>undefined; };
  }, [cache,outbox,profile?.id,repository,spaceId,publishMessages]);

  const flush = useCallback(async () => {
    if (!repository || !connected) return;
    const generation = generationRef.current;
    const completedMedia: string[] = [];
    const failed = await outbox.flush(async (queued) => {
      if (generation !== generationRef.current) throw new Error("会话已切换");
      if (queued.senderId !== profile!.id) throw new Error("待发送消息不属于当前账号");
      if (queued.localMediaUri) {
        publishMessages(messagesRef.current.map((message) => message.clientId === queued.clientId ? { ...message, deliveryState: "uploading" } : message));
      }
      const receipt = await repository.sendMessage(queued, profile!.nickname);
      if (generation === generationRef.current && queued.spaceId === spaceId) {
        const next = mergeMessages(messagesRef.current,[receipt]);
        publishMessages(next);
        void cache.save({messages:next,cursor:cursorRef.current,hasOlder:true}).catch(()=>undefined);
      }
      if (queued.localMediaUri) completedMedia.push(queued.localMediaUri);
    });
    void loadLatest();
    await Promise.allSettled(completedMedia.map((uri) => removeStabilizedMedia(uri)));
    if(generation !== generationRef.current) return;
    const failedIds = new Set(failed.map((item) => item.clientId));
    publishMessages(messagesRef.current.map((message) => failedIds.has(message.clientId) && message.deliveryState !== "sent" ? { ...message, deliveryState: "failed" } : message));
  }, [cache, connected, loadLatest, outbox, profile, publishMessages, repository, spaceId]);

  useEffect(() => { const unsubscribe = NetInfo.addEventListener((state) => { if (state.isConnected) { void loadLatest(); void flush(); } }); return unsubscribe; }, [flush]);
  useEffect(() => { if (connected) void flush(); }, [connected, flush]);
  useEffect(() => { void repository?.listMentionTargets(spaceId).then(setMentionTargets).catch(() => setMentionTargets([])); }, [repository, spaceId]);
  useEffect(() => {
    if (!repository || loading || !notificationMessageId || locatedNotificationMessageRef.current === notificationMessageId) return;
    let cancelled = false;
    void (async () => {
      let available = messagesRef.current;
      if (!available.some((message) => message.id === notificationMessageId)) {
        const around = await repository.listMessagesAround(spaceId, notificationMessageId, 50);
        available = mergeMessages(around, messagesRef.current);
        if (!cancelled) publishMessages(available);
      }
      const index = available.findIndex((message) => message.id === notificationMessageId);
      if (cancelled || index < 0) return;
      locatedNotificationMessageRef.current = notificationMessageId;
      setSelectedId(notificationMessageId);
      setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }), 120);
    })().catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "无法定位被提及的消息"); });
    return () => { cancelled = true; };
  }, [loading, notificationMessageId, publishMessages, repository, spaceId]);
  useEffect(() => () => { if (viewportSettleTimerRef.current) clearTimeout(viewportSettleTimerRef.current); }, []);
  useEffect(() => {
    if (!profile || !repository) return;
    for (const message of messages) {
      if (!message.mediaPath || signedUrls[message.mediaPath] || message.deliveryState !== "sent") continue;
      void resolveCachedMedia(profile.id, message.mediaPath, () => repository.createSignedMediaUrl(message.mediaPath!)).then((url) => setSignedUrls((current) => ({ ...current, [message.mediaPath!]: url }))).catch(() => undefined);
    }
  }, [messages, profile?.id, repository, signedUrls]);
  const jobByMessage = useMemo(() => groupReplyJobs(messages, agentJobs, mentionTargets), [messages, agentJobs, mentionTargets]);
  const waitingForReply = messages.some((message) => message.senderId === profile?.id
    && ["queued", "running"].includes(jobByMessage.get(message.id)?.status ?? ""));
  useFocusEffect(useCallback(() => {
    if (!connected || !waitingForReply) return;
    // Realtime is the fast path; this only repairs missed events for an actual
    // pending reply, while this chat is focused and the app is in the foreground.
    return startGroupReplyRefresh(() => refreshRef.current(), () => AppState.currentState === "active");
  }, [connected, waitingForReply, spaceId, profile?.id]));
  if (sessionLoading) return <View style={styles.center}><ActivityIndicator color={colors.coral} /></View>;
  if (!profile || !repository) return <Redirect href="/login" />;

  const enqueueAndSend = async (partial: Pick<QueuedMessage, "kind" | "text"> & Partial<QueuedMessage>) => {
    const activeMentions = selectedMentions.filter((target) => (partial.text ?? "").includes(`@${target.displayName}`));
    const queued: QueuedMessage = {
      clientId: partial.clientId ?? createClientId(), spaceId, senderId: profile.id, kind: partial.kind, text: partial.text,
      localMediaUri: partial.localMediaUri, mediaMimeType: partial.mediaMimeType, mediaSizeBytes: partial.mediaSizeBytes, mediaDurationSeconds: partial.mediaDurationSeconds,
      mentionedUserIds: partial.mentionedUserIds ?? activeMentions.filter((target) => target.kind === "user").map((target) => target.id),
      mentionedPetIds: partial.mentionedPetIds ?? activeMentions.filter((target) => target.kind === "pet").map((target) => target.id),
      replyToMessageId: replying?.id ?? null, replyPreview: replying?.text?.slice(0, 80) ?? (replying ? `[${replying.kind}]` : null), createdAt: new Date().toISOString(), attempts: 0,
    };
    const revision = draftRevisionRef.current;
    await outbox.enqueue(queued);
    setReplying((current) => current?.id === queued.replyToMessageId ? null : current);
    if (draftRevisionRef.current === revision && partial.kind === "text") { setMentionQuery(null); setSelectedMentions([]); }
    pendingViewportIntentRef.current = createViewportIntent("own_message", viewportMetricsRef.current.contentHeight, viewportMetricsRef.current.offsetY);
    ownMessageSettledOffsetRef.current = null;
    newestMessageKeyRef.current = `${profile.id}:${queued.clientId}`;
    publishMessages(mergeMessages(messagesRef.current, [{ id: queued.clientId, clientId: queued.clientId, spaceId, senderId: profile.id, actorKind: "human", actorName: profile.nickname, kind: queued.kind, text: queued.text, mediaPath: queued.localMediaUri ?? null, mediaDurationSeconds: queued.mediaDurationSeconds ?? null, replyToMessageId: queued.replyToMessageId ?? null, replyPreview: queued.replyPreview ?? null, createdAt: queued.createdAt, deliveryState: connected ? (queued.localMediaUri ? "preparing" : "pending") : "failed", reactions: {}, mentions: activeMentions.map((target) => ({ kind: target.kind, targetId: target.id, displayText: target.displayName })) }]));
    settleViewportAtEnd(false);
    await flush();
    const settledOffset = ownMessageSettledOffsetRef.current;
    const userMovedAway = settledOffset !== null && viewportMetricsRef.current.offsetY < settledOffset - 96;
    if (!userMovedAway) {
      pendingViewportIntentRef.current = createViewportIntent("own_message", viewportMetricsRef.current.contentHeight, viewportMetricsRef.current.offsetY);
      settleViewportAtEnd(false);
    }
    ownMessageSettledOffsetRef.current = null;
  };

  const updateComposerText = (value: string) => {
    draftRevisionRef.current += 1;
    setText(value);
    const match = value.match(/(?:^|\s)@([^\s@]*)$/u);
    setMentionQuery(match ? match[1] : null);
  };

  const chooseMention = (target: MentionTarget) => {
    draftRevisionRef.current += 1;
    setText((current) => current.replace(/(?:^|\s)@[^\s@]*$/u, (match) => `${match.startsWith(" ") ? " " : ""}@${target.displayName} `));
    setSelectedMentions((current) => current.some((item) => item.kind === target.kind && item.id === target.id) ? current : [...current, target]);
    setMentionQuery(null);
  };

  const sendTextMessage = (submittedText = text) => {
    const message = submittedText.trim();
    if (!message) return;
    const revision = ++draftRevisionRef.current;
    setText("");
    void enqueueAndSend({ kind: "text", text: message }).catch((reason) => {
      if (draftRevisionRef.current === revision) setText(submittedText);
      setError(reason instanceof Error ? reason.message : "发送失败，草稿已保留。");
    });
  };

  const pickImage = async () => {
    try {
    setMenu(false); const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.82, allowsEditing: false });
    if (result.canceled) return; const asset = result.assets[0];
    if ((asset.fileSize ?? 0) > 8 * 1024 * 1024) { setError("图片不能超过 8 MB"); return; }
    const clientId = createClientId();
    const stableUri = await stabilizeMediaForOutbox(asset.uri, profile.id, clientId);
    await enqueueAndSend({ clientId, kind: "image", text: null, localMediaUri: stableUri, mediaMimeType: asset.mimeType ?? "image/jpeg", mediaSizeBytes: asset.fileSize });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片无法读取，请重新选择。"); }
  };

  const startVoice = async () => {
    if (recordingActiveRef.current) return;
    try {
      setError(null); setRecordCancelled(false); cancelRecordingRef.current = false;
      const permission = await requestRecordingPermissionsAsync(); if (!permission.granted) { setError("需要麦克风权限才能录制语音"); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!voicePressHeldRef.current) { await setAudioModeAsync({ allowsRecording: false }); return; }
      await recorder.prepareToRecordAsync();
      if (!voicePressHeldRef.current) { await setAudioModeAsync({ allowsRecording: false }); return; }
      recorder.record({ forDuration: 60 }); recordingActiveRef.current = true;
    } catch (reason) {
      recordingActiveRef.current = false;
      setError(reason instanceof Error ? reason.message : "录音无法开始，请检查麦克风权限。");
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  };
  const stopVoice = async (send: boolean) => {
    if (!recordingActiveRef.current) return;
    recordingActiveRef.current = false;
    try {
      const seconds = Math.min(60, Math.max(0, recorderState.durationMillis / 1000));
      if (recorderState.isRecording) await recorder.stop();
      const uri = recorder.uri;
      if (!send || cancelRecordingRef.current) return;
      if (seconds < 0.6) { setError("录音时间太短"); return; }
      if (!uri) { setError("没有取得录音文件"); return; }
      const media = await getMediaInfo(uri); if (media.size > 5 * 1024 * 1024) { setError("语音不能超过 5 MB"); return; }
      const clientId = createClientId();
      const stableUri = await stabilizeMediaForOutbox(uri, profile.id, clientId);
      await enqueueAndSend({ clientId, kind: "voice", text: null, localMediaUri: stableUri, mediaMimeType: media.mimeType || "audio/mp4", mediaSizeBytes: media.size, mediaDurationSeconds: seconds });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "录音无法读取，请重试。"); }
    finally {
      recordStartYRef.current = null; cancelRecordingRef.current = false; setRecordCancelled(false);
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  };

  const loadOlder = async () => {
    const first = messages.find((item) => item.deliveryState === "sent"); if (!first || loadingOlder || !hasOlder) return; setLoadingOlder(true);
    pendingViewportIntentRef.current = createViewportIntent("history_loaded", viewportMetricsRef.current.contentHeight, viewportMetricsRef.current.offsetY);
    try { const older = await repository.listMessages(spaceId, { at:first.createdAt,id:first.id }, 50); if (older.length) publishMessages(mergeMessages(older, messagesRef.current)); else pendingViewportIntentRef.current = null; setHasOlder(older.length === 50); }
    finally { setLoadingOlder(false); }
  };

  const invitePeople = async () => {
    try {
      const options = {
        platform: Platform.OS,
        browserOrigin: Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : undefined,
        publicAppUrl: process.env.EXPO_PUBLIC_APP_URL ?? Constants.expoConfig?.extra?.publicAppUrl,
      };
      spaceInviteUrl("validate", options);
      const result = await repository.createSpaceInvite(spaceId);
      setInvite(spaceInviteUrl(result.token, options));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "邀请创建失败，请稍后重试。"); }
  };
  const loadObservations = async () => { setPanelBusy(true); try { setObservations(await repository.listPetObservation(spaceId)); } catch (reason) { setError(reason instanceof Error ? reason.message : "观察授权加载失败"); } finally { setPanelBusy(false); } };
  const openObservation = () => { setMenu(false); setObservationOpen(true); void loadObservations(); };
  const updatePetControl = async (operation: () => Promise<void>) => { setPanelBusy(true); try { await operation(); const [nextObservation, nextMessages] = await Promise.all([repository.listPetObservation(spaceId), repository.listMessages(spaceId, null, 50)]); setObservations(nextObservation); publishMessages(nextMessages); } catch (reason) { setError(reason instanceof Error ? reason.message : "权限更新失败"); } finally { setPanelBusy(false); } };
  const refreshSignedImage = async (message: ChatMessage) => {
    if (!message.mediaPath) return; setPreviewLoading(true);
    try { await invalidateCachedMedia(profile.id, message.mediaPath); const url = await resolveCachedMedia(profile.id, message.mediaPath, () => repository.createSignedMediaUrl(message.mediaPath!)); setSignedUrls((current) => ({ ...current, [message.mediaPath!]: url })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "图片访问地址刷新失败"); }
    finally { setPreviewLoading(false); }
  };
  const openImage = (message: ChatMessage) => { setSelectedId(null); setPreviewMessage(message); if (message.mediaPath && !signedUrls[message.mediaPath]) void refreshSignedImage(message); };
  const proposalById = new Map(agentRequests.flatMap((request) => request.proposal ? [[request.proposal.id, request.proposal] as const] : []));
  const filteredMentionTargets = mentionQuery === null ? [] : mentionTargets
    .filter((target) => target.displayName.toLocaleLowerCase().includes(mentionQuery.toLocaleLowerCase()))
    .slice(0, 8);

  return (
    <KeyboardScreen keyboardVerticalOffset={0} style={[styles.page, { backgroundColor: theme.page }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: theme.card, borderBottomColor: theme.line }]}><Pressable accessibilityRole="button" accessibilityLabel="返回会话列表" onPress={() => router.back()} style={styles.headerButton}><Text style={styles.headerButtonText}>‹</Text></Pressable><Pressable accessibilityLabel="修改群头像" onPress={()=>setAvatarOpen(true)}><SpaceAvatar spaceId={spaceId} name={spaceName} size={34} /></Pressable><View style={styles.headerTitleWrap}><Text numberOfLines={1} style={styles.headerTitle}>{spaceName}</Text><Text style={[styles.headerStatus, { color: theme.accent }]}>{isLocalDemo ? "本地演示" : connected ? "实时连接" : "离线缓存 · 权限待联网核实"}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="打开空间主 Agent" onPress={() => setWorkbenchOpen(true)} style={[styles.agentHeaderButton, { backgroundColor: theme.secondary, borderRadius: theme.radius }]}><Text style={[styles.agentHeaderText, { color: theme.accent }]}>A</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="设置群聊背景" style={styles.headerButton} onPress={()=>setBackgroundOpen(true)}><Icon name="image" color={theme.text}/></Pressable></View>
      {error ? <Pressable onPress={() => setError(null)} style={styles.errorBar}><Text style={styles.errorBarText}>{error}</Text></Pressable> : null}
      <AvatarEditor visible={avatarOpen} onClose={()=>setAvatarOpen(false)} target={{kind:"space",id:spaceId}} />
      <Modal visible={notificationsOpen} transparent animationType="slide" onRequestClose={()=>setNotificationsOpen(false)}><View style={styles.overlay}><View style={styles.panelCard}><Pressable onPress={()=>setNotificationsOpen(false)}><Text style={styles.close}>关闭</Text></Pressable><NotificationSettings spaceId={spaceId}/></View></View></Modal>
      <ChatBackgroundSurface threadKey={`group:${spaceId}`} style={{flex:1,minHeight:0}}>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.coral} /></View> : (
        <FlatList testID="chat-message-list" ref={listRef} style={[styles.messageList, Platform.OS === "web" && ({ overflowAnchor: "none" } as never)]} data={messages} keyExtractor={(item) => `${item.senderId}:${item.clientId}`} contentContainerStyle={[styles.messages, Platform.OS === "web" && ({ overflowAnchor: "none" } as never)]}
          disableVirtualization={Platform.OS === "web"}
          initialNumToRender={Platform.OS === "web" ? 1000 : 18}
          maxToRenderPerBatch={Platform.OS === "web" ? 1000 : 18}
          updateCellsBatchingPeriod={Platform.OS === "web" ? 1 : 50}
          scrollEventThrottle={32}
          onScrollToIndexFailed={({ index, averageItemLength }) => { listRef.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: false }); setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }), 120); }}
          onContentSizeChange={(_, contentHeight) => {
            viewportMetricsRef.current.contentHeight = contentHeight;
            const intent = pendingViewportIntentRef.current;
            if (!intent) return;
            const action = contentSizeAction(intent, contentHeight);
            if (action.kind === "wait") return;
            if (action.kind === "scroll_to_end") {
              setUnseenNewMessage(false);
              settleViewportAtEnd(action.animated);
            } else {
              pendingViewportIntentRef.current = null;
              requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: action.offset, animated: false }));
            }
          }}
          onScroll={(event) => {
            viewportMetricsRef.current = { contentHeight: event.nativeEvent.contentSize.height, viewportHeight: event.nativeEvent.layoutMeasurement.height, offsetY: event.nativeEvent.contentOffset.y };
            nearBottomRef.current = updateNearBottom(viewportMetricsRef.current);
            if (nearBottomRef.current) { setUnseenNewMessage(false); markLatestRead(); }
          }}
          ListHeaderComponent={hasOlder ? <Pressable disabled={loadingOlder} onPress={() => void loadOlder()} style={styles.loadOlder}><Text style={styles.loadOlderText}>{loadingOlder ? "加载中…" : "加载更早的消息"}</Text></Pressable> : null}
          renderItem={({ item }) => <MessageRow message={item} mine={item.senderId === profile.id} signedUrl={item.mediaPath ? signedUrls[item.mediaPath] ?? (item.deliveryState !== "sent" ? item.mediaPath : null) : null} selected={selectedId === item.id} agentJob={jobByMessage.get(item.id)} proposal={item.agentProposalId ? proposalById.get(item.agentProposalId) : null} currentUserId={profile.id} feedbackSubmitted={feedbackSent.has(item.id)} onSelect={() => setSelectedId(selectedId === item.id ? null : item.id)} onOpenImage={() => openImage(item)} onReply={() => { setReplying(item); setSelectedId(null); }} onReact={(emoji) => { setSelectedId(null); void repository.toggleReaction(item.id, emoji, profile.id).then(loadLatest); }} onRetry={() => void flush()} onRetryAgent={() => void repository.retryAgentDispatch(item.id).then(loadLatest).catch((reason) => setError(reason instanceof Error ? reason.message : "异宠重试失败"))} onAgentFeedback={(rating) => { setSelectedId(null); void repository.feedbackAgentMessage(item.id, spaceId, rating).then(() => setFeedbackSent((current) => new Set([...current, item.id]))).catch((reason) => setError(reason instanceof Error ? reason.message : "反馈提交失败")); }} onProposalVote={(decision) => { const proposalId = item.agentProposalId; if (!proposalId) return; void repository.voteAgentProposal(proposalId, decision).then(loadLatest).catch((reason) => setError(reason instanceof Error ? reason.message : "投票失败")); }} />}
        />
      )}
      {unseenNewMessage ? <Pressable onPress={() => { pendingViewportIntentRef.current = createViewportIntent("incoming", viewportMetricsRef.current.contentHeight, viewportMetricsRef.current.offsetY); setUnseenNewMessage(false); settleViewportAtEnd(true); }} style={styles.newMessagePrompt}><Text style={styles.newMessageText}>有新消息 ↓</Text></Pressable> : null}
      {replying ? <View style={styles.replying}><View style={{ flex: 1 }}><Text style={styles.replyingLabel}>回复 {replying.actorName}</Text><Text numberOfLines={1} style={styles.replyingText}>{replying.text ?? `[${replying.kind}]`}</Text></View><Pressable onPress={() => setReplying(null)}><Text style={styles.close}>×</Text></Pressable></View> : null}
      {mentionQuery !== null ? <View style={styles.mentionPanel}>{filteredMentionTargets.length ? filteredMentionTargets.map((target) => <Pressable key={`${target.kind}:${target.id}`} onPress={() => chooseMention(target)} style={styles.mentionItem}><AvatarImage reference={target.avatarUrl} name={target.displayName} size={34} /><View style={{ flex: 1 }}><Text style={styles.mentionName}>{target.displayName}</Text><Text style={styles.mentionMeta}>{target.kind === "pet" ? `异宠 · ${target.ownerName ?? "空间成员"}` : "空间成员"}</Text></View></Pressable>) : <Text style={styles.mentionEmpty}>没有匹配的成员或异宠</Text>}</View> : null}
      {voiceMode ? <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 9), backgroundColor: theme.card, borderTopColor: theme.line }]}><Pressable accessibilityRole="button" accessibilityLabel="返回键盘输入" onPress={() => setVoiceMode(false)} style={[styles.plus, { backgroundColor: theme.secondary, borderRadius: theme.radius }]}><Text style={styles.keyboardIcon}>⌨</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="按住说话，松开发送，上滑取消" onPressIn={(event) => { voicePressHeldRef.current = true; recordStartYRef.current = event.nativeEvent.pageY; void startVoice(); }} onTouchMove={(event) => { const startY = recordStartYRef.current; if (startY === null) return; const cancelled = startY - event.nativeEvent.pageY > 55; cancelRecordingRef.current = cancelled; setRecordCancelled(cancelled); }} onPressOut={() => { voicePressHeldRef.current = false; void stopVoice(!cancelRecordingRef.current); }} style={[styles.holdToTalk, recorderState.isRecording && styles.holdToTalkActive, recordCancelled && styles.holdToTalkCancel]}><Text style={styles.holdToTalkText}>{recorderState.isRecording ? recordCancelled ? "松开取消" : `松开发送 · ${Math.min(60, Math.round(recorderState.durationMillis / 1000))} 秒` : "按住说话"}</Text><Text style={styles.holdToTalkHint}>{recorderState.isRecording ? "上滑取消" : "最长 60 秒"}</Text></Pressable></View> : <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 9), backgroundColor: theme.card, borderTopColor: theme.line }]}><Pressable accessibilityRole="button" accessibilityLabel="添加图片、语音、邀请或权限" onPress={() => setMenu(true)} style={[styles.plus, { backgroundColor: theme.secondary, borderRadius: theme.radius }]}><Text style={styles.plusText}>＋</Text></Pressable><EnterSendTextInput accessibilityLabel="消息内容" value={text} onChangeText={updateComposerText} onSend={sendTextMessage} maxLength={4000} placeholder="发消息… 输入 @ 提及成员或异宠" placeholderTextColor={theme.muted} style={[styles.composerInput, { backgroundColor: theme.secondary, borderRadius: theme.radius, borderColor: theme.line }]} /><Pressable accessibilityRole="button" accessibilityLabel="发送消息" disabled={!text.trim()} onPress={() => sendTextMessage()} style={[styles.send, { backgroundColor: theme.primary, borderRadius: theme.radius }, !text.trim() && styles.sendDisabled]}><Text style={styles.sendText}>发送</Text></Pressable></View>}
      </ChatBackgroundSurface>
      <ChatBackgroundEditor visible={backgroundOpen} onClose={()=>setBackgroundOpen(false)} threadKey={`group:${spaceId}`}/>
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}><Pressable style={styles.overlay} onPress={() => setMenu(false)}><View style={styles.menuGrid}><Pressable style={styles.menuItem} onPress={()=>{setMenu(false);router.push({pathname:"/search" as never,params:{spaceId}});}}><Text style={styles.menuLabel}>搜索本群</Text></Pressable><Pressable style={styles.menuItem} onPress={()=>{setMenu(false);setSuggestionsOpen(true);}}><Text style={styles.menuLabel}>群待办识别</Text></Pressable><Pressable style={styles.menuItem} onPress={()=>{setMenu(false);setNotificationsOpen(true);}}><Text style={styles.menuIcon}>◌</Text><Text style={styles.menuLabel}>消息设置</Text></Pressable><Pressable style={styles.menuItem} onPress={()=>{setMenu(false);router.push({pathname:"/group-items" as never,params:{spaceId}});}}><Text style={styles.menuIcon}>✓</Text><Text style={styles.menuLabel}>群事项</Text></Pressable><Pressable onPress={() => void pickImage()} style={styles.menuItem}><Text style={styles.menuIcon}>▧</Text><Text style={styles.menuLabel}>图片</Text></Pressable><Pressable onPress={() => { setMenu(false); setVoiceMode(true); }} style={styles.menuItem}><Text style={styles.menuIcon}>◉</Text><Text style={styles.menuLabel}>语音</Text></Pressable><Pressable onPress={() => { setMenu(false); void invitePeople(); }} style={styles.menuItem}><Text style={styles.menuIcon}>＋</Text><Text style={styles.menuLabel}>邀请成员</Text></Pressable><Pressable onPress={openObservation} style={styles.menuItem}><Text style={styles.menuIcon}>◎</Text><Text style={styles.menuLabel}>异宠权限</Text></Pressable></View></Pressable></Modal>
      <Modal visible={suggestionsOpen} animationType="slide" onRequestClose={()=>setSuggestionsOpen(false)}><KeyboardScreen style={{flex:1,backgroundColor:theme.page}}><AppButton label="返回群聊" variant="quiet" onPress={()=>setSuggestionsOpen(false)}/><ScrollView contentContainerStyle={{padding:16}}><GroupWorkSuggestions spaceId={spaceId}/></ScrollView></KeyboardScreen></Modal>
      <AgentWorkbench visible={workbenchOpen} spaceId={spaceId} repository={repository} onClose={() => setWorkbenchOpen(false)} onPublished={() => void loadLatest()} />
      <ImageViewer visible={Boolean(previewMessage)} url={previewMessage?.mediaPath ? signedUrls[previewMessage.mediaPath] ?? (previewMessage.deliveryState !== "sent" ? previewMessage.mediaPath : null) : null} loading={previewLoading} onClose={() => setPreviewMessage(null)} onRetry={() => { if (previewMessage) void refreshSignedImage(previewMessage); }} />
      <Modal visible={Boolean(invite)} transparent animationType="fade" onRequestClose={() => setInvite(null)}><View style={styles.overlayCenter}><View style={styles.inviteCard}><Text style={styles.inviteTitle}>7 天空间邀请</Text><Text selectable style={styles.inviteLink}>{invite}</Text><Text style={styles.inviteNote}>双人空间最多 2 人，群空间最多 20 人。邀请链接在 7 天后失效。</Text><AppButton label="完成" onPress={() => setInvite(null)} /></View></View></Modal>
      <Modal visible={observationOpen} transparent animationType="fade" onRequestClose={() => setObservationOpen(false)}><View style={styles.overlayCenter}><View style={styles.panelCard}><View style={styles.panelHead}><View style={{ flex: 1 }}><Text style={styles.inviteTitle}>异宠权限与观察</Text><Text style={styles.inviteNote}>观察未来对话需全员同意。静音只影响你看到的异宠消息；超过半数成员投暂停票后，该异宠停止在本空间参与，人类聊天不受影响。</Text></View><Pressable onPress={() => setObservationOpen(false)}><Text style={styles.close}>×</Text></Pressable></View>{panelBusy ? <ActivityIndicator color={colors.mint} /> : observations.map((item) => <View key={item.petId} style={styles.petPermission}><View><Text style={styles.permissionTitle}>{item.petName} <Text style={styles.permissionOwner}>· {item.ownerName} 的异宠</Text></Text><Text style={item.unanimousConsent ? styles.enabled : styles.waiting}>{item.unanimousConsent ? "全员已同意 · 正在观察" : "尚未全员同意 · 不会分析"}</Text><Text style={item.pausedByVote ? styles.waiting : styles.enabled}>{item.pausedByVote ? "过半成员已暂停参与" : "当前可参与空间"}</Text></View><View style={styles.permissionControls}><Pressable accessibilityRole="button" onPress={() => void updatePetControl(() => repository.setPetObservationConsent(spaceId, item.petId, !item.ownConsent))} style={[styles.consentButton, item.ownConsent && styles.consentButtonOn]}><Text style={styles.consentText}>{item.ownConsent ? "撤回观察同意" : "同意观察"}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void updatePetControl(() => repository.setPetLocalMute(spaceId, item.petId, !item.ownMuted))} style={[styles.consentButton, item.ownMuted && styles.consentButtonOn]}><Text style={styles.consentText}>{item.ownMuted ? "取消静音" : "仅我静音"}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void updatePetControl(() => repository.votePetPause(spaceId, item.petId, !item.ownPauseVote))} style={[styles.consentButton, item.ownPauseVote && styles.consentButtonOn]}><Text style={styles.consentText}>{item.ownPauseVote ? "撤回暂停票" : "投暂停票"}</Text></Pressable></View></View>)}</View></View></Modal>
    </KeyboardScreen>
  );
}

const useStyles = createThemedStyles((colors, theme) => ({
  page: { flex: 1, height: Platform.OS === "web" ? ("100dvh" as never) : undefined, overflow: "hidden", backgroundColor: colors.canvas }, center: { flex: 1, justifyContent: "center" }, header: { flexShrink: 0, minHeight: 68, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.canvasRaised },
  headerButton: { width: 46, height: 46, flexShrink: 0, alignItems: "center", justifyContent: "center" }, headerButtonText: { color: colors.text, fontSize: 38, fontWeight: "300" }, more: { color: colors.text, fontSize: 18, letterSpacing: 2 }, agentHeaderButton: { width: 38, height: 38, flexShrink: 0, borderRadius: 14, backgroundColor: colors.mintDeep, borderWidth: 1, borderColor: colors.mint, alignItems: "center", justifyContent: "center" }, agentHeaderText: { color: colors.mint, fontWeight: "700", fontSize: 16 }, headerTitleWrap: { flex: 1, alignItems: "center" }, headerTitle: { color: colors.text, fontWeight: "700", fontSize: 17 }, headerStatus: { color: colors.mint, fontSize: 10, marginTop: 2 },
  messageList: { flex: 1, minHeight: 0 },
  errorBar: { backgroundColor: theme.userBubble, padding: 8 }, errorBarText: { color: theme.danger, textAlign: "center", fontSize: 12 }, messages: { padding: spacing.md, gap: 10, paddingBottom: spacing.lg }, loadOlder: { alignSelf: "center", padding: spacing.sm }, loadOlderText: { color: colors.mint, fontSize: 12 },
  messageWrap: { width: "88%", alignSelf: "flex-start", flexDirection: "row", gap: 9, alignItems: "flex-start" }, messageWrapMine: { alignSelf: "flex-end", flexDirection: "row-reverse" }, senderAvatar: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }, senderAvatarAgent: { backgroundColor: colors.mintDeep, borderWidth: 1, borderColor: colors.mint }, senderAvatarText: { color: colors.text, fontWeight: "700" },
  messageColumn: { flex: 1, minWidth: 0, alignItems: "flex-start" }, messageColumnMine: { alignItems: "flex-end" }, senderName: { color: colors.textMuted, fontSize: 11, marginLeft: 4, marginBottom: 4 }, agentName: { color: colors.mint },
  bubble: { maxWidth: "100%", flexShrink: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, overflow: "hidden" }, bubbleOther: { backgroundColor: colors.surface }, bubbleMine: { backgroundColor: colors.coralSoft, borderTopRightRadius: 5 }, bubbleAgent: { backgroundColor: colors.mintDeep, borderWidth: 1, borderColor: theme.line }, mediaBubble: { padding: 4 },
  proposalBubble: { width: "100%", maxWidth: 480 },
  messageText: { flexShrink: 1, color: colors.text, fontSize: 16, lineHeight: 23 }, messageTextMine: { color: colors.textDark }, mentionText: { color: colors.mint, fontWeight: "700" }, replyQuote: { borderLeftWidth: 3, borderLeftColor: colors.lavender, backgroundColor: theme.secondary, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 7, borderRadius: 5 }, replyQuoteText: { color: colors.textMuted, fontSize: 12 },
  metaRow: { flexDirection: "row", gap: 8, marginTop: 4, marginLeft: 4 }, metaRowMine: { justifyContent: "flex-end", marginRight: 4 }, meta: { color: colors.textMuted, fontSize: 9 }, failed: { color: theme.danger },
  actions: { flexDirection: "row", gap: 11, backgroundColor: colors.canvasRaised, borderWidth: 1, borderColor: colors.line, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7, marginTop: 5, alignItems: "center" }, actionsMine: { alignSelf: "flex-end" }, actionText: { color: colors.mint, fontWeight: "600", fontSize: 12 }, actionEmoji: { fontSize: 16 }, reactionSummary: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }, reactionPill: { backgroundColor: colors.surfaceSoft, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 3 }, reactionText: { color: colors.text, fontSize: 11 },
  agentProgress: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, paddingHorizontal: 4 }, agentProgressText: { color: colors.mint, fontSize: 10 }, agentFailed: { color: theme.danger, fontSize: 10, fontWeight: "600" }, feedbackActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center", backgroundColor: colors.canvasRaised, borderRadius: radii.md, paddingHorizontal: 10, paddingVertical: 7, marginTop: 5 }, feedbackLabel: { color: colors.textMuted, fontSize: 10 }, feedbackAction: { color: colors.mint, fontSize: 10, fontWeight: "600" }, feedbackUnsafe: { color: theme.danger, fontSize: 10, fontWeight: "600" },
  messageImage: { width: 220, height: 165, borderRadius: 13 }, voice: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, minWidth: 155, minHeight: 42 }, voiceIcon: { color: colors.mint, fontSize: 22 }, wave: { flexDirection: "row", alignItems: "center", gap: 3, flex: 1 }, waveLine: { width: 3, height: 10, borderRadius: 2, backgroundColor: colors.mint }, voiceTime: { color: colors.textMuted },
  delegatedLabel: { color: colors.lavender, fontSize: 9, marginTop: 3 }, replying: { flexShrink: 0, backgroundColor: colors.canvasRaised, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 8 }, replyingLabel: { color: colors.mint, fontSize: 11, fontWeight: "600" }, replyingText: { color: colors.textMuted, fontSize: 12 }, close: { color: colors.textMuted, fontSize: 25, padding: 8 },
  composer: { flexShrink: 0, flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 9, paddingTop: 9, backgroundColor: colors.canvasRaised, borderTopWidth: 1, borderTopColor: colors.line }, plus: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }, plusText: { color: colors.text, fontSize: 27 }, composerInput: { flex: 1, minWidth: 0, minHeight: 42, maxHeight: 116, backgroundColor: colors.surface, borderRadius: 15, color: colors.text, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 10 }, send: { flexShrink: 0, minHeight: 42, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center" }, sendDisabled: { opacity: .35 }, sendText: { color: colors.white, fontWeight: "700" },
  mentionPanel: { flexShrink: 0, maxHeight: 270, marginHorizontal: 9, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.canvasRaised, paddingVertical: 5, overflow: "hidden" }, mentionItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9 }, mentionAvatar: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }, mentionAvatarPet: { backgroundColor: colors.mintDeep, borderWidth: 1, borderColor: colors.mint }, mentionAvatarText: { color: colors.text, fontWeight: "700" }, mentionName: { color: colors.text, fontWeight: "600" }, mentionMeta: { color: colors.textMuted, fontSize: 10, marginTop: 2 }, mentionEmpty: { color: colors.textMuted, padding: 14, textAlign: "center" },
  keyboardIcon: { color: colors.mint, fontSize: 20 }, holdToTalk: { flex: 1, minHeight: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, holdToTalkActive: { borderColor: colors.mint, backgroundColor: colors.mintDeep }, holdToTalkCancel: { borderColor: colors.coral, backgroundColor: theme.userBubble }, holdToTalkText: { color: colors.text, fontWeight: "700" }, holdToTalkHint: { color: colors.textMuted, fontSize: 9, marginTop: 2 },
  newMessagePrompt: { position: "absolute", bottom: 78, alignSelf: "center", backgroundColor: colors.mintDeep, borderWidth: 1, borderColor: colors.mint, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 8 }, newMessageText: { color: colors.mint, fontWeight: "700", fontSize: 11 },
  recording: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: spacing.md, backgroundColor: colors.canvasRaised }, recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.coral }, recordText: { flex: 1, color: colors.text }, stopText: { color: colors.mint, fontWeight: "700" },
  overlay: { flex: 1, backgroundColor: theme.overlay, justifyContent: "flex-end" }, menuGrid: { backgroundColor: colors.canvasRaised, padding: spacing.lg, paddingBottom: 36, flexDirection: "row", justifyContent: "space-around", flexWrap: "wrap", gap: spacing.md, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl }, menuItem: { alignItems: "center", gap: 7, width: 76 }, menuIcon: { width: 54, height: 54, textAlign: "center", textAlignVertical: "center", lineHeight: 54, borderRadius: 18, backgroundColor: colors.surface, color: colors.mint, fontSize: 24, overflow: "hidden" }, menuLabel: { color: colors.textMuted, fontSize: 12 },
  overlayCenter: { flex: 1, backgroundColor: theme.overlay, alignItems: "center", justifyContent: "center", padding: spacing.lg }, inviteCard: { width: "100%", maxWidth: 480, borderRadius: radii.xl, backgroundColor: colors.canvasRaised, padding: spacing.lg, gap: spacing.md }, inviteTitle: { color: colors.text, fontSize: 21, fontWeight: "700" }, inviteLink: { color: colors.mint, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md }, inviteNote: { color: colors.textMuted, lineHeight: 20 },
  panelCard: { width: "100%", maxWidth: 620, maxHeight: "84%", borderRadius: radii.xl, backgroundColor: colors.canvasRaised, padding: spacing.lg, gap: spacing.md }, panelHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 }, petPermission: { gap: 10, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md }, permissionControls: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, permissionTitle: { color: colors.text, fontWeight: "700" }, permissionOwner: { color: colors.textMuted, fontWeight: "500" }, enabled: { color: colors.mint, fontSize: 11, marginTop: 4 }, waiting: { color: theme.danger, fontSize: 11, marginTop: 4 }, consentButton: { borderRadius: radii.pill, backgroundColor: colors.mintDeep, paddingHorizontal: 12, paddingVertical: 8 }, consentButtonOn: { backgroundColor: "#593448" }, consentText: { color: colors.text, fontSize: 11, fontWeight: "600" }, petCareRow: { gap: 8 }, careCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: 10, gap: 8 }, careActions: { flexDirection: "row", gap: spacing.lg }, careAction: { color: colors.mint, fontWeight: "700" }, storyList: { maxHeight: 330 }, story: { backgroundColor: colors.surface, borderRadius: radii.md, padding: 12, gap: 6, marginBottom: 8 }, storyPet: { color: colors.lavender, fontWeight: "700", fontSize: 12 }, storyText: { color: colors.text, lineHeight: 20 }, shareStory: { color: colors.mint, fontWeight: "600", fontSize: 12 },
}));
