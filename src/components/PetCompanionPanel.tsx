import { usePetSection } from "../pets/PetSectionScope";
import { privateSendQueue, type PrivateQueuedSend } from "../pets/privateSendQueue";
import type { PrivateStreamEvent, PrivateChatOptions } from "../pets/streamClient";
import { VisionAttachmentPicker } from "../vision/VisionAttachmentPicker";
import { VisionMessageImage } from "../vision/VisionMessageImage";
import { prepareVisionAttachment } from "../vision/repository";
import { visionError, type VisionAttachment } from "../vision/types";
import NetInfo from "@react-native-community/netinfo";
import { createThemedStyles } from "../theme/themedStyles";
import { KeyboardScreen } from "./KeyboardLayout";
import { petReplyFailureText, petReplyStage } from "../pets/replyStatus";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { DraggablePetStage } from "./DraggablePetStage";
import { PetDisplayControls, type usePetDisplay } from "../avatars/petDisplay";
import { newPrivateRequestId } from "../pets/requestId";
import { loadPrivateDraft, savePrivateDraft } from "../pets/privateDraft";
import { PreferenceMemoryPanel } from "./PreferenceMemoryPanel";
import type { MemoryEvidencePage, PreferenceAction, PetCompanionContext, PetPersonalMemory, PetPrivateMessage, SavePetMemoryInput } from "../data/types";
import { currentPrivateMessages, PERSONAL_MEMORY_LENGTH, PERSONAL_MEMORY_LIMIT, privateContinuation } from "../pets/companion";
import { colors, radii, spacing } from "../theme/tokens";
import { AppButton, Surface } from "../ui/common";
import { EnterSendTextInput } from "./EnterSendTextInput";
import { ChatBackgroundEditor } from "../backgrounds/ChatBackgroundEditor";
import { ChatBackgroundSurface, useChatBackgroundColors } from "../backgrounds/ChatBackgroundSurface";
import { Icon } from "../ui/Icon";
import { MemoryEvolutionPanel } from "../memory/MemoryEvolutionPanel";
import { InteractionSettingsPanel } from "../memory/InteractionSettingsPanel";
import { MemoryContinuationCard, MemoryReviewPanel, MemorySavedIndicator, getLifeMemoryNotices } from "../memory/MemoryReviewPanel";
import { requireSupabase } from "../lib/supabase";
import { mutateMemory } from "../memory/repository";
import { useSystemVoice } from "../voice/useSystemVoice";
import { SpeakButton, VoiceInputButton, VoiceInputPanel } from "../voice/VoiceControls";

type Props = Readonly<{
  petName: string;
  ownerId?: string;
  petId?: string;
  onSource?(id: string): void;
  onSearch?(): void;
  onManageMemory?(): void;
  onSettings?(): void;
  onDesktopPet?(): void;
  incubating: boolean;
  portrait?: ReactNode | ((size: number) => ReactNode);
  portraitPetId?: string;
  originalPortrait?: ReactNode;
  display?: ReturnType<typeof usePetDisplay>;
  navigation?: ReactNode;
  messages: readonly PetPrivateMessage[];
  context: PetCompanionContext;
  enteredAt: number;
  busy: boolean;
  onSend(content: string, requestId?: string, onEvent?:(event:PrivateStreamEvent)=>void, options?:PrivateChatOptions): Promise<void>;
  onStop?(requestId:string):Promise<void>;
  onLoadOlder?():Promise<boolean>;
  renderActions?(sourceMessageId:string):ReactNode;
  onUpdatePreference?(input: PreferenceAction): Promise<void>;
  onListEvidence?(key: string, offset?: number): Promise<MemoryEvidencePage>;
  onRetryExtraction?(): Promise<void>;
  onSaveMemory(input: SavePetMemoryInput): Promise<void>;
  onRemoveMemory(id: string): Promise<void>;
  onNewConversation(): Promise<void>;
}>;

function requestHasReply(messages: readonly PetPrivateMessage[], requestId: string): boolean {
  const source=messages.find(message=>message.role==="owner"&&message.requestKey===requestId&&
    (message.conversationKind==="companion"||message.conversationKind===undefined));
  return Boolean(source&&(source.replyStatus==="succeeded"||messages.some(message=>message.role==="pet"&&message.inReplyToId===source.id)));
}

export function PetCompanionPanel(props: Props) {
  const sectionVisible = usePetSection()?.visible ?? true;
  const visibleRef = useRef(sectionVisible); visibleRef.current = sectionVisible;
  const lastVisibleOffset = useRef(0);
  const { styles, colors } = useStyles();
  const background = useChatBackgroundColors("companion");
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const [panelHeight, setPanelHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  const [voiceOpen,setVoiceOpen]=useState(false);
  const { petName, messages, context, busy } = props;
  const [draft, setDraft] = useState("");
  const [attachment,setAttachment]=useState<VisionAttachment|null>(null);const attachmentRef=useRef(attachment);attachmentRef.current=attachment;
  const [editor, setEditor] = useState<SavePetMemoryInput | null>(null);
  const [removing, setRemoving] = useState<PetPersonalMemory | null>(null);
  const [resetting, setResetting] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [dismissedEntry, setDismissedEntry] = useState<number | null>(null);
  const [dismissedSource, setDismissedSource] = useState<string | null>(null);
  const [checkedContinuation, setCheckedContinuation] = useState<string | null>(null);
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendError,setSendError]=useState<{requestId:string;message:string}|null>(null);
  const [confirmingRequest,setConfirmingRequest]=useState<string|null>(null);
  const thread = useRef<ScrollView>(null);
  const followsLatest = useRef(true);
  const transcriptGeometry = useRef("");
  const keepLatestVisible = () => { if (visibleRef.current && followsLatest.current) thread.current?.scrollToEnd({ animated: false }); };
  const restoreScroll = () => {
    if (!visibleRef.current) return;
    if (followsLatest.current) keepLatestVisible();
    else thread.current?.scrollTo({y:lastVisibleOffset.current,animated:false});
  };
  useEffect(() => {
    if (!sectionVisible) return;
    const frame = requestAnimationFrame(restoreScroll);
    return () => cancelAnimationFrame(frame);
  }, [sectionVisible]);
  const pending = useRef(false);
  const [sending, setSending] = useState(false);
  const queue=useMemo(()=>privateSendQueue(props.ownerId??"local-preview"),[props.ownerId]);
  const [queued,setQueued]=useState<readonly PrivateQueuedSend[]>([]);
  const [partial,setPartial]=useState<{requestId:string;content:string;revision?:number}|null>(null);
  const [olderBusy,setOlderBusy]=useState(false),[hasOlder,setHasOlder]=useState(true);
  const senderRef=useRef(props.onSend);senderRef.current=props.onSend;
  const activeRef=useRef(true);
  const draftRef=useRef(draft);draftRef.current=draft;
  const lastSubmitted=useRef<{text:string;at:number}|null>(null);
  const draftVersion=useRef(0);
  const request = useRef<{content:string;id:string;attachment?:VisionAttachment}|null>(null);
  const latestMessages=useRef(messages);
  latestMessages.current=messages;
  const [draftReady,setDraftReady]=useState(!props.ownerId);
  useEffect(()=>{
    let active=true;const ownerId=props.ownerId;if(!ownerId)return;
    void loadPrivateDraft(ownerId).then(async(saved)=>{
      if(!active||!saved)return;
      if(requestHasReply(latestMessages.current,saved.id)){
        await savePrivateDraft(ownerId,null);
      }else{request.current={...saved,content:saved.content.trim()};setDraft(saved.content);setAttachment(saved.attachment??null);attachmentRef.current=saved.attachment??null;}
    }).catch(()=>undefined).finally(()=>{if(active)setDraftReady(true);});
    return()=>{active=false;};
  },[props.ownerId]);
  const drain=()=>queue.flush(async(row,signal)=>{
    if(!activeRef.current){const reason=new Error("页面已离开，消息留在队列中。");reason.name="QueuePaused";throw reason;}
    setSending(true);setPartial(null);setConfirmingRequest(null);
    try{
      let image=row.attachment;
      if(image){
        if(!props.ownerId)throw new Error("请登录后发送图片。");
        try{const prepared=await prepareVisionAttachment(props.ownerId,image);if(signal.aborted)throw new Error("已停止发送这张图片。");if(!activeRef.current){const pause=new Error("页面已离开，图片已保留。");pause.name="QueuePaused";throw pause;}if(!await queue.recordUploaded(row.id,prepared.asset))throw new Error("已停止发送这张图片。");image=prepared;}
        catch(reason){if(reason instanceof Error&&reason.name==="QueuePaused")throw reason;throw new Error(signal.aborted?"已停止发送这张图片。":visionError(reason));}
      }
      if(signal.aborted)throw new Error("已停止这次回答。");
      await senderRef.current(row.content,row.id,(event)=>{
      if(!activeRef.current)return;
      if(event.type==="text")setPartial({requestId:row.id,content:event.content??"",revision:event.revision});
      if(event.type==="phase"&&event.phase==="confirming")setConfirmingRequest(row.id);
      if(event.type==="done"||event.type==="error")setPartial(null);
    },{signal,contextRevision:context.revision,...(image?.asset?{imageAssetId:image.asset.id,imageAssetVersion:image.asset.version}:{})});}finally{if(activeRef.current){setSending(false);setPartial(null);setConfirmingRequest(null);}}
  });
  const drainRef=useRef(drain);drainRef.current=drain;
  useEffect(()=>{
    activeRef.current=true;
    const remove=queue.subscribe(rows=>{if(activeRef.current)setQueued(rows);});
    void queue.load().then(async()=>{
      for(const row of queue.snapshot())if(requestHasReply(latestMessages.current,row.id))await queue.remove(row.id);
      if(activeRef.current)void drainRef.current();
    });
    const network=NetInfo.addEventListener(state=>{if(state.isConnected&&activeRef.current)void drainRef.current();});
    return()=>{activeRef.current=false;remove();network();};
  },[queue]);
  useEffect(()=>{
    setSendError(current=>current&&requestHasReply(messages,current.requestId)?null:current);
    const completed=queued.filter(row=>requestHasReply(messages,row.id)).map(row=>row.id);
    if(!completed.length)return;
    void queue.acknowledgeCompleted(completed).then(()=>activeRef.current?drainRef.current():undefined).catch(()=>{if(activeRef.current)setError("回答已收到，本机队列暂未更新，请重新打开对话。");});
  },[messages,queue,queued]);
  useEffect(()=>{
    if(partial?.revision!==undefined&&context.revision!==undefined&&partial.revision!==context.revision)setPartial(null);
  },[context.revision,partial?.revision]);
  useEffect(()=>{
    if(!draftReady||sending||pending.current||!request.current||!requestHasReply(messages,request.current.id))return;
    const sent=request.current;request.current=null;
    if(draftRef.current.trim()===sent.content&&attachmentRef.current?.uploadId===sent.attachment?.uploadId){setDraft("");setAttachment(null);attachmentRef.current=null;if(props.ownerId)void savePrivateDraft(props.ownerId,null).catch(()=>undefined);}
  },[messages,sending,draftReady,props.ownerId]);
  const latestMessageId = messages.at(-1)?.id;
  useEffect(() => { if (visibleRef.current) { followsLatest.current = true; keepLatestVisible(); } }, [latestMessageId]);
  const safeMessages = messages.filter((message)=>(message.conversationKind === undefined || message.conversationKind === "companion") && !context.excludedMessageIds?.includes(message.id));
  const activeMessages = currentPrivateMessages(safeMessages, context.contextStartedAt);
  const listed = showHistory ? messages : activeMessages;
  const candidateContinuation = dismissedEntry === props.enteredAt || props.incubating ? null : privateContinuation(safeMessages, context.contextStartedAt, props.enteredAt, context.preferences);
  const continuation = candidateContinuation?.message.id === dismissedSource || (props.petId && candidateContinuation?.message.id !== checkedContinuation) ? null : candidateContinuation;
  useEffect(() => {
    let active = true; const id = candidateContinuation?.message.id;
    if (props.petId && id) void requireSupabase().from("pet_memory_dismissals").select("fragment_key").eq("fragment_key", `chat:${id}`).maybeSingle().then(result => { if (active && !result.error) { if (result.data) setDismissedSource(id); setCheckedContinuation(id); } });
    return () => { active = false; };
  }, [props.petId, candidateContinuation?.message.id]);
  const dismissContinuation = () => {
    setDismissedEntry(props.enteredAt);
    if (continuation && props.petId) { setDismissedSource(continuation.message.id); void mutateMemory({ action: "dismiss", request_id: newPrivateRequestId(), input: { fragment_key: `chat:${continuation.message.id}` } }).catch(() => setError("本次已收起，但跨设备保存尚未确认。")); }
  };
  const noticeSources = listed.slice(-visibleCount).filter(row => row.role === "owner" && !row.imageAssetId && !row.id.startsWith("pending:")).map(row => row.id).join(",");
  useEffect(() => {
    let active = true; if (!props.petId) return;
    setMemoryCounts({});
    void getLifeMemoryNotices(noticeSources ? noticeSources.split(",") : []).then(value => { if (active) setMemoryCounts(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [props.petId, noticeSources, context.revision]);
  const updateDraft = (value:string, requestId?:string) => {
    // Android input methods can deliver a final text event after pressing Send.
    if(!draftReady||!activeRef.current)return;
    if(lastSubmitted.current?.text===value && Date.now()-lastSubmitted.current.at<250 && draftRef.current==="")return;
    draftVersion.current++;
    setDraft(value);
    const content=value.trim();
    if(!content&&!attachmentRef.current)request.current=null;
    else if(requestId||request.current?.content!==content)request.current={content,id:requestId??newPrivateRequestId(),...(attachmentRef.current?{attachment:attachmentRef.current}:{})};
    if(props.ownerId)void savePrivateDraft(props.ownerId,request.current?{...request.current,content:value}:null)
      .catch(()=>setError("草稿暂时未能保存在本机，请先保留输入内容。"));
  };
  const updateAttachment=(value:VisionAttachment|null)=>{
    if(!draftReady||!activeRef.current)return;draftVersion.current++;setAttachment(value);attachmentRef.current=value;
    request.current=draftRef.current.trim()||value?{content:draftRef.current.trim(),id:newPrivateRequestId(),...(value?{attachment:value}:{})}:null;
    if(props.ownerId)void savePrivateDraft(props.ownerId,request.current?{...request.current,content:draftRef.current}:null).catch(()=>setError("图片草稿暂未保存在本机，请稍后重试。"));
  };
  const voice = useSystemVoice({ scopeKey: `companion:${props.petId ?? "preview"}`, onTranscript: text => updateDraft([draftRef.current, text].filter(Boolean).join("\n")) });
  useEffect(()=>{if(voice.error)setVoiceOpen(true);},[voice.error]);

  const run = async (operation: () => Promise<void>) => {
    if (pending.current || !draftReady) return;
    pending.current = true; setError(null); setNotice(null);
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "暂时没有完成，请重试"); }
    finally { pending.current = false; }
  };
  const send = async(value=draft)=>{
    const content=value.trim();if(!content||!draftReady)return;
    const image=attachmentRef.current;const submitted={content,id:request.current?.content===content&&request.current.attachment?.uploadId===image?.uploadId?request.current.id:newPrivateRequestId(),...(image?{attachment:image}:{})};
    const revision=++draftVersion.current;
    lastSubmitted.current={text:value,at:Date.now()};request.current=null;draftRef.current="";setDraft("");setAttachment(null);attachmentRef.current=null;setError(null);setSendError(null);setShowHistory(false);setDismissedEntry(props.enteredAt);
    try{
      await queue.enqueue(submitted.id,submitted.content,submitted.attachment);
      if(props.ownerId && draftVersion.current===revision)await savePrivateDraft(props.ownerId,null);
      await drainRef.current();
      const failed=queue.snapshot().find(row=>row.id===submitted.id&&row.status==="failed");
      if(failed&&activeRef.current&&!requestHasReply(latestMessages.current,submitted.id)){
        setSendError({requestId:submitted.id,message:failed.error??"暂时没有完成，请重试"});
        if(draftVersion.current===revision){const restored={...submitted,attachment:failed.attachment??submitted.attachment};request.current=restored;setDraft(value);setAttachment(restored.attachment??null);attachmentRef.current=restored.attachment??null;if(props.ownerId)await savePrivateDraft(props.ownerId,restored);}
      }
    }catch(reason){if(activeRef.current&&!requestHasReply(latestMessages.current,submitted.id)){setSendError({requestId:submitted.id,message:reason instanceof Error?reason.message:"消息暂未保存，请重试。"});if(draftVersion.current===revision){request.current=submitted;setDraft(value);setAttachment(submitted.attachment??null);attachmentRef.current=submitted.attachment??null;}}}
  };
  const stop = async(row:PrivateQueuedSend)=>{
    try{
      await queue.remove(row.id);setPartial(null);
      if(row.status==="sending"){if(!props.onStop)throw new Error("本机已停止等待，服务器停止状态尚未确认。");await props.onStop(row.id);}
      setNotice("已停止这次回答，已发送的消息和已创建的事项仍然保留。");void drainRef.current();
    }catch(reason){setError(reason instanceof Error?reason.message:"本机已停止等待，服务器停止状态尚未确认。");}
  };
  const edit = (value: SavePetMemoryInput) => { setEditor(value); setError(null); setNotice(null); };
  const memoryLength = [...(editor?.content.trim() ?? "")].length;

  return <View style={styles.panel} onLayout={event => setPanelHeight(event.nativeEvent.layout.height)}>
    <View style={styles.heading}>
      <View style={styles.headingCopy}><Text style={styles.title}>{petName}</Text><Text style={styles.muted}>你的异宠</Text></View>
      {props.onSearch ? <Pressable accessibilityRole="button" accessibilityLabel="搜索消息事项和记忆" style={styles.headerAction} onPress={props.onSearch}><Icon name="search" color={colors.text} /></Pressable> : null}
      {!props.onManageMemory ? <Pressable accessibilityRole="button" accessibilityLabel="管理记忆" style={styles.headerAction} onPress={() => setMemoryOpen(true)}><Icon name="memory" color={colors.text} /><Text style={styles.headerLabel}>记忆</Text></Pressable> : null}
      {props.onSettings ? <Pressable accessibilityRole="button" accessibilityLabel="相处设置" style={styles.headerAction} onPress={props.onSettings}><Icon name="settings" color={colors.text} /></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="设置陪伴聊天背景" style={styles.headerAction} onPress={() => setBackgroundOpen(true)}><Icon name="image" color={colors.text} /></Pressable>
    </View>
    {props.navigation}
    <ChatBackgroundSurface threadKey="companion" style={styles.chatBody}>
    <ScrollView ref={thread} testID="companion-transcript" style={styles.thread} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled"
      onLayout={restoreScroll} onContentSizeChange={keepLatestVisible} scrollEventThrottle={32}
      onScrollBeginDrag={() => { followsLatest.current = false; }} onTouchMove={() => { followsLatest.current = false; }}
      {...(Platform.OS === "web" ? { onWheel: () => { followsLatest.current = false; } } : {})}
      onScroll={event => {
        if (!visibleRef.current) return;
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        lastVisibleOffset.current = contentOffset.y;
        const geometry = `${contentSize.height}:${layoutMeasurement.height}:${layoutMeasurement.width}`;
        if (transcriptGeometry.current !== geometry) {
          transcriptGeometry.current = geometry;
          keepLatestVisible();
        } else followsLatest.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 64;
      }}>
    {continuation ? <View style={styles.reunion} accessibilityLabel="私聊接续">
      <View style={styles.row}><Text style={styles.reunionTitle}>{continuation.isReunion ? "欢迎回来，慢慢接着聊" : "上次的话，还可以接着聊"}</Text><Pressable accessibilityRole="button" accessibilityLabel="收起私聊接续" onPress={dismissContinuation}><Text style={styles.muted}>收起</Text></Pressable></View>
      <Text style={styles.muted}>上次你说 · {new Date(continuation.message.createdAt).toLocaleString("zh-CN")}</Text>
      <Text style={styles.quote} numberOfLines={1}>“{continuation.message.content}”</Text>
      <View style={styles.row}><Pressable accessibilityRole="button" disabled={busy} onPress={() => { updateDraft(`我想接着聊这件事：${continuation.message.content.slice(0, 500)}`); setDismissedEntry(props.enteredAt); }}><Text style={styles.action}>接着聊这件事</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => setResetting(true)}><Text style={styles.muted}>聊点新的</Text></Pressable></View>
    </View> : null}
    {props.petId && !props.incubating && dismissedEntry !== props.enteredAt ? <MemoryContinuationCard key={`${props.petId}:${context.revision}:${props.enteredAt}`} petId={props.petId} onContinue={fragment => { updateDraft(`我想接着聊这件事：${fragment.title}`); setDismissedEntry(props.enteredAt); }} onNewTopic={() => setResetting(true)} /> : null}

    <View style={styles.row}><Text style={styles.muted}>{context.contextStartedAt ? "这一段对话" : "最近的对话"}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => setResetting(true)}><Text style={styles.action}>开启新话题</Text></Pressable></View>
    {showHistory ? <Text style={styles.muted}>历史记录供你回看。新话题不会自动接续之前的对话。</Text> : null}
    {messages.length > activeMessages.length ? <Pressable accessibilityRole="button" onPress={() => { followsLatest.current=false;setShowHistory((value) => !value); setVisibleCount(20); }}><Text style={styles.history}>{showHistory ? "回到当前对话" : "查看之前的聊天记录"}</Text></Pressable> : null}
    {props.onLoadOlder&&hasOlder?<Pressable disabled={olderBusy} onPress={()=>{followsLatest.current=false;setOlderBusy(true);void props.onLoadOlder!().then(more=>{setHasOlder(more);setShowHistory(true);setVisibleCount(count=>count+50);}).catch(()=>setError("历史记录暂未加载，请重试。")).finally(()=>setOlderBusy(false));}}><Text style={styles.history}>{olderBusy?"正在加载更早记录…":"加载更早的聊天记录"}</Text></Pressable>:null}

      {listed.length > visibleCount ? <Pressable accessibilityRole="button" onPress={() => setVisibleCount((count) => count + 20)}><Text style={styles.history}>查看更多对话</Text></Pressable> : null}
      {!listed.length ? <Text style={styles.empty}>{context.contextStartedAt ? "新的话题，从你想说的地方开始。你保存的记忆仍会保留。" : "我在这里。今天想从什么说起？"}</Text> : null}
      {listed.slice(-visibleCount).map((message) => <View key={message.id} style={[styles.bubble, message.role === "owner" ? styles.owner : styles.pet, {backgroundColor:message.role === "owner" ? background.userBubble : background.bubble}]}>
        <Text selectable style={[styles.message, {color:message.role === "owner" ? background.userText : background.text}]}>{message.content}</Text>
        {message.imageAssetId ? <VisionMessageImage assetId={message.imageAssetId} sourceMessageId={message.id.startsWith("pending:")?undefined:message.id} onDeleted={()=>{setNotice("图片已删除，相关理解与记忆已停用。");}} /> : null}
        {message.role === "pet" ? <SpeakButton voice={voice} messageId={message.id} text={message.content} /> : null}
        {!message.imageAssetId&&memoryCounts[message.id] ? <MemorySavedIndicator count={memoryCounts[message.id]} onOpen={() => props.onManageMemory ? props.onManageMemory() : setMemoryOpen(true)} /> : null}
        {!message.imageAssetId&&message.role === "owner" && (message.conversationKind === "companion" || message.conversationKind === undefined) ? <Pressable accessibilityRole="button" accessibilityLabel={`记住这句：${message.content.slice(0, 30)}`} disabled={busy || context.memories.length >= PERSONAL_MEMORY_LIMIT} onPress={() => edit({ content: message.content, sourceMessageId: message.id })}><Text style={styles.pin}>记住这句</Text></Pressable> : null}
        {message.role === "owner" && message.replyStatus && message.replyStatus !== "succeeded" ? <View>
          <Text style={styles.source}>{message.replyStatus === "failed" ? petReplyFailureText(message.replyErrorCode) : petReplyStage(message.replyStatus).title}</Text>
          {message.requestKey && (message.conversationKind === "companion" || message.conversationKind === undefined) ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => {const original=message.imageAssetId?{uploadId:message.imageAssetId,uri:"",asset:{id:message.imageAssetId,version:message.imageAssetVersion??1,state:"active" as const}}:null;setAttachment(original);attachmentRef.current=original;updateDraft(message.content,message.requestKey ?? undefined);}}><Text style={styles.pin}>重新载入这条消息</Text></Pressable> : null}
        </View> : null}
        {!message.imageAssetId&&message.role==="owner"&&props.renderActions?props.renderActions(message.id):null}
        {message.recallSources?.length ? <Text style={styles.source}>群聊来源：{[...new Set(message.recallSources.map((source) => source.spaceName))].join("、")}</Text> : null}
      </View>)}
      {queued.filter(row=>!requestHasReply(messages,row.id)).map(row=><View key={row.id} style={styles.reunion}>
        {!messages.some(message=>message.role==="owner"&&message.requestKey===row.id)?<Text style={styles.message}>{row.content}</Text>:null}
        {row.attachment?.uri&&!messages.some(message=>message.role==="owner"&&message.requestKey===row.id)?<Image accessibilityLabel="排队的图片" source={{uri:row.attachment.uri}} style={{width:80,height:80}} resizeMode="contain"/>:null}
        <View style={styles.row}><Text style={styles.muted}>{row.status==="queued"?"已排队，将按顺序回应":row.status==="sending"?confirmingRequest===row.id?"连接中断，正在核对服务器回答…":row.attachment&&!row.attachment.asset?"正在上传图片":"正在回应":row.error??"回答中断"}</Text>
          {row.status==="failed"?<Pressable accessibilityLabel="重试排队消息" onPress={()=>{void queue.retry(row.id).then(()=>drainRef.current()).catch(reason=>setError(reason instanceof Error?reason.message:"暂未重试"));}}><Text style={styles.action}>重试</Text></Pressable>:null}
          <Pressable accessibilityLabel="停止当前回答" onPress={()=>void stop(row)}><Text style={styles.action}>{row.status==="queued"?"取消排队":"停止"}</Text></Pressable>
        </View>
      </View>)}
      {partial?.content?<View accessibilityLabel="正在生成的临时回答" style={[styles.bubble,styles.pet]}><Text style={styles.message}>{partial.content}</Text><Text style={styles.muted}>生成中</Text></View>:null}
      {busy&&!partial?.content ? <ActivityIndicator color={colors.mint} accessibilityLabel="正在回应" /> : null}
    </ScrollView>
    <View style={styles.composer}>
      <EnterSendTextInput accessibilityLabel="异宠私聊输入" value={draft} onChangeText={updateDraft} onSend={(value) => void send(value)} editable={draftReady} maxLength={4000} placeholder={props.incubating ? "说说你喜欢怎样相处…" : "今天有什么想和它说的…"} placeholderTextColor={colors.textMuted} style={styles.input} />
      <Pressable accessibilityRole="button" accessibilityLabel="发送私聊" disabled={!draftReady || !draft.trim()} onPress={() => void send()} style={[styles.send, (!draftReady || !draft.trim()) && styles.disabled]}><Text style={styles.sendText}>发送</Text></Pressable>
    </View>
    {props.petId?<VisionAttachmentPicker compact value={attachment} onChange={updateAttachment} disabled={!draftReady} trailing={<VoiceInputButton compact voice={voice} expanded={voiceOpen} onToggle={()=>setVoiceOpen(value=>!value)}/>}/>:<View style={{flexDirection:"row"}}><VoiceInputButton compact voice={voice} expanded={voiceOpen} onToggle={()=>setVoiceOpen(value=>!value)}/></View>}
    {voiceOpen||["starting","listening","processing"].includes(voice.status)?<VoiceInputPanel voice={voice} onClose={()=>setVoiceOpen(false)}/>:null}
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {error && !editor && !removing && !resetting ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!error&&sendError&&!requestHasReply(messages,sendError.requestId)&&!editor&&!removing&&!resetting?<Text accessibilityRole="alert" style={styles.error}>{sendError.message}</Text>:null}
    </ChatBackgroundSurface>
    <ChatBackgroundEditor visible={sectionVisible && (backgroundOpen)} onClose={() => setBackgroundOpen(false)} threadKey="companion" />
    <Modal visible={sectionVisible && (appearanceOpen)} transparent animationType="fade" onRequestClose={() => setAppearanceOpen(false)}>
      <KeyboardScreen style={styles.overlay}><Surface style={styles.modal}>
        <View style={styles.row}><Text style={styles.title}>形象与透明效果</Text><AppButton label="返回聊天" variant="quiet" onPress={() => setAppearanceOpen(false)} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
          {props.originalPortrait ? <View style={{ alignItems: "center", gap: 6 }}><Text style={styles.muted}>原图对照</Text>{props.originalPortrait}</View> : null}
          {props.display ? <PetDisplayControls display={props.display} /> : null}
        </ScrollView>
      </Surface></KeyboardScreen>
    </Modal>

    <Modal visible={sectionVisible && (memoryOpen && !editor && !removing && !resetting)} transparent animationType="fade" onRequestClose={() => setMemoryOpen(false)}>
      <KeyboardScreen style={styles.overlay}><Surface style={styles.memoryModal}>
      <View style={styles.row}><Text style={styles.title}>它记住的你</Text><AppButton label="返回聊天" variant="quiet" onPress={() => setMemoryOpen(false)} /></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.memoryList}>
    {memoryOpen && props.petId ? <>
      {!props.onSettings ? <InteractionSettingsPanel petId={props.petId} /> : null}
      <MemoryEvolutionPanel petId={props.petId} onSource={id => { setMemoryOpen(false); props.onSource?.(id); }} />
      <MemoryReviewPanel key={`${props.petId}:${context.revision}`} petId={props.petId} onSource={id => { setMemoryOpen(false); props.onSource?.(id); }} />
    </> : null}
    {props.onUpdatePreference && props.onListEvidence && props.onRetryExtraction ? <PreferenceMemoryPanel preferences={context.preferences??[]} pending={context.pendingExtractions??0} failed={context.failedExtractions??0} busy={busy} onUpdate={props.onUpdatePreference} onListEvidence={props.onListEvidence} onRetry={props.onRetryExtraction}/> : null}
    <View style={styles.memoryHeader}><View style={styles.headingCopy}><Text style={styles.memoryTitle}>你希望我记住的</Text><Text style={styles.muted}>仅用于你们的私聊 · {context.memories.length}/{PERSONAL_MEMORY_LIMIT} 件事</Text></View><Pressable accessibilityRole="button" onPress={() => setManualOpen((value) => !value)}><Text style={styles.action}>{manualOpen ? "收起记忆" : "查看记忆"}</Text></Pressable></View>
    {manualOpen ? <View style={styles.memoryList}>
      {!context.memories.length ? <Text style={styles.muted}>还没有保存的记忆。由你决定哪些偏好或经历值得留下。</Text> : null}
      {context.memories.map((memory) => <View key={memory.id} style={styles.memory}>
        <Text style={styles.message}>{memory.content}</Text>
        <Text style={styles.source}>{memory.sourceMessageId ? "来自你标记的私聊" : "由你亲手记下"} · {new Date(memory.updatedAt).toLocaleDateString("zh-CN")}</Text>
        {memory.sourceMessageId&&context.excludedMessageIds?.includes(memory.sourceMessageId)?<Text style={styles.source}>关联来源已停用，不用于回应。手动编辑可以重新确认内容。</Text>:null}
        <View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel={`编辑记忆：${memory.content}`} disabled={busy} onPress={() => edit({ id: memory.id, content: memory.content, sourceMessageId: memory.sourceMessageId })}><Text style={styles.action}>编辑</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`移出记忆：${memory.content}`} disabled={busy} onPress={() => { setError(null); setRemoving(memory); }}><Text style={styles.remove}>移出记忆</Text></Pressable></View>
        {(context.manualHistory??[]).filter((item)=>item.memoryId===memory.id).slice(0,3).map((item)=><Text key={item.id} style={styles.source}>过去版本 · {new Date(item.createdAt).toLocaleDateString("zh-CN")}：{item.content}</Text>)}
      </View>)}
    </View> : null}
    <AppButton label="记下一件事" variant="quiet" disabled={busy || context.memories.length >= PERSONAL_MEMORY_LIMIT} onPress={() => edit({ content: "" })} />

      </ScrollView></Surface></KeyboardScreen>
    </Modal>
    <Modal visible={sectionVisible && (Boolean(editor))} transparent animationType="fade" onRequestClose={() => { if (!busy) setEditor(null); }}>
      <KeyboardScreen style={styles.overlay}><Surface style={styles.modal}>
        <Text style={styles.title}>{editor?.id ? "更新这条记忆" : "你希望它记住什么？"}</Text>
        <Text style={styles.muted}>{editor?.id ? "更新后按你的最新想法回应，过去的版本保留作变化记录。当前话题可以继续。" : "写下一个偏好、一件经历，或你喜欢的相处方式。保存后可随时编辑。"}</Text>
        <TextInput accessibilityLabel="个人记忆内容" value={editor?.content ?? ""} onChangeText={(content) => setEditor((value) => value ? { ...value, content } : value)} multiline style={[styles.input, styles.memoryInput]} placeholder="例如：我累的时候，先听我说，别急着给建议。" placeholderTextColor={colors.textMuted} editable={!busy} />
        <Text style={memoryLength > PERSONAL_MEMORY_LENGTH ? styles.error : styles.muted}>{memoryLength}/{PERSONAL_MEMORY_LENGTH} 字{memoryLength > PERSONAL_MEMORY_LENGTH ? "，请选取最想留下的部分" : ""}</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.buttons}><AppButton label="取消" variant="quiet" disabled={busy} onPress={() => setEditor(null)} /><AppButton label="保存记忆" disabled={busy || !memoryLength || memoryLength > PERSONAL_MEMORY_LENGTH} onPress={() => void run(async () => { if (!editor) return; await props.onSaveMemory(editor); setEditor(null); setMemoryOpen(!props.onManageMemory); setNotice("已经记下。以后可以按你的最新想法更新。"); })} /></View>
      </Surface></KeyboardScreen>
    </Modal>
    <Modal visible={sectionVisible && (Boolean(removing) || resetting)} transparent animationType="fade" onRequestClose={() => { if (!busy) { setRemoving(null); setResetting(false); } }}>
      <KeyboardScreen style={styles.overlay}><Surface style={styles.modal}>
        <Text style={styles.title}>{removing ? "把这件事移出记忆？" : "从一个新话题开始"}</Text>
        <Text style={styles.muted}>{removing ? "这条保存的记忆会被删除，已关联内容不再用于后续回应。原始聊天仍可回看，其他话题可以继续。" : "之前的聊天仍可回看，接下来不会自动接着旧话题。你主动保存的记忆会保留。"}</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.buttons}><AppButton label="取消" variant="quiet" disabled={busy} onPress={() => { setRemoving(null); setResetting(false); }} /><AppButton label={removing ? "确认移出记忆" : "开始新话题"} disabled={busy} onPress={() => void run(async () => { if (removing) { await props.onRemoveMemory(removing.id); setNotice("已经移出保存的记忆，其他话题可以继续。"); } else { const resetRevision=draftVersion.current; await props.onNewConversation(); if(draftVersion.current===resetRevision){draftVersion.current++;setDraft("");draftRef.current="";setAttachment(null);attachmentRef.current=null;request.current=null;if(props.ownerId)await savePrivateDraft(props.ownerId,null);} setNotice("我们从这里重新开始。之前的聊天仍可回看。"); } setRemoving(null); setResetting(false); setShowHistory(false); setDismissedEntry(props.enteredAt); })} /></View>
      </Surface></KeyboardScreen>
    </Modal>
  </View>;
}

const useStyles = createThemedStyles((colors, theme) => ({
  panel: { flex: 1, minHeight: 0, backgroundColor:theme.card }, heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal:16, minHeight:64 }, headingCopy: { flex: 1, gap: 3 }, petStage:{alignItems:"center",paddingVertical:8}, chatBody:{flex:1,minHeight:0,padding:16,gap:12}, headerAction:{minWidth:48,minHeight:48,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:6},headerLabel:{fontSize:13,color:theme.text}, seed: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.mintDeep, alignItems: "center", justifyContent: "center" }, seedGlyph: { color: colors.mint, fontSize: 28 },
  kicker: { color: colors.mint, fontSize: 11 }, title: { color: colors.text, fontSize: 20, fontWeight: "600" }, muted: { color: colors.textMuted, fontSize: 12, lineHeight: 19 }, row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" }, action: { color: colors.mint, fontSize: 13, fontWeight: "700", paddingVertical: 4 },
  reunion: { backgroundColor: colors.mintDeep, borderRadius: radii.md, padding: spacing.sm, gap: 4 }, reunionTitle: { color: colors.text, fontWeight: "600" }, quote: { color: colors.text, lineHeight: 22 },
  thread: { flexGrow: 0, flexShrink: 1, minHeight: 0 }, messages: { gap: 10, paddingVertical: 5 }, empty: { color: colors.textMuted, paddingVertical: 18, lineHeight: 23 }, bubble: { maxWidth: "90%", borderRadius: 16, padding: 12, gap: 7 }, owner: { alignSelf: "flex-end", backgroundColor: colors.coralSoft }, pet: { alignSelf: "flex-start", backgroundColor: colors.mintDeep }, message: { color: colors.text, fontSize:16, lineHeight: 25 }, ownerText: { color: colors.textDark }, pin: { color: colors.textDark, fontSize: 11, paddingVertical: 3 }, source: { color: colors.textMuted, fontSize: 11, lineHeight: 18 }, history: { color: colors.mint, textAlign: "center", fontSize: 12, padding: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 }, input: { borderWidth:1,borderColor:theme.line,flex: 1, minHeight: 48, maxHeight: 120, padding: 12, backgroundColor: colors.surface, borderRadius: 8, fontSize:16, color: colors.text, textAlignVertical: "top" }, send: { minHeight: 48, paddingHorizontal: 16, borderRadius: 8, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center" }, sendText: { color: colors.white, fontWeight: "600" }, disabled: { opacity: .4 },
  memoryHeader: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md }, memoryTitle: { color: colors.text, fontSize: 15, fontWeight: "600" }, memoryList: { gap: 10 }, memory: { backgroundColor: colors.surface, borderRadius: 14, padding: 12, gap: 8 }, remove: { color: theme.danger, fontSize: 12, paddingVertical: 4 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.overlay, padding: spacing.md }, memoryModal: { width: "100%", maxWidth: 600, maxHeight: "95%", gap: 12 }, modal: { width: "100%", maxWidth: 480, maxHeight: "95%", gap: spacing.sm }, memoryInput: { flex: 0, minHeight: 64, maxHeight: 120 }, buttons: { flexDirection: "row", justifyContent: "flex-end", gap: 8 }, notice: { color: colors.mint, fontSize: 12, lineHeight: 20 }, error: { color: theme.danger, fontSize: 12, lineHeight: 20 },
}));
