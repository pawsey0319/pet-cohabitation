import { WorkActionCard } from "../../src/work/WorkActionCard";
import { StewardActionCard } from "../../src/work/StewardActionCard";
import type { PrivateStreamEvent, PrivateChatOptions } from "../../src/pets/streamClient";
import { usePetDisplay, PetDisplayControls } from "../../src/avatars/petDisplay";
import { ChatBackgroundEditor } from "../../src/backgrounds/ChatBackgroundEditor";
import { ChatBackgroundSurface, useChatBackgroundColors } from "../../src/backgrounds/ChatBackgroundSurface";
import { Icon } from "../../src/ui/Icon";
import { PetSectionNav } from "../../src/components/PetSectionNav";
import { createThemedStyles } from "../../src/theme/themedStyles";
import { PetCompanionPanel } from "../../src/components/PetCompanionPanel";
import type { PetCompanionContext } from "../../src/data/types";
import { KeyboardScreen, KeyboardScrollView, KeyboardTextInput } from "../../src/components/KeyboardLayout";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { mergePrivateHistory } from "../../src/pets/privateHistory";
import { MemorySourceModal, type MemorySourceTarget } from "../../src/memory/MemorySourceModal";
import { MemoryReviewPanel } from "../../src/memory/MemoryReviewPanel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRequestId } from "../../src/lib/uuid";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/auth/SessionProvider";
import { GenerativePetPreview } from "../../src/components/GenerativePetPreview";
import { LivingPetPortrait } from "../../src/components/LivingPetPortrait";
import { DraggablePetStage } from "../../src/components/DraggablePetStage";
import { EnterSendTextInput } from "../../src/components/EnterSendTextInput";
import { createChatRepository } from "../../src/data/chatRepository";
import { createPetRepository } from "../../src/data/petRepository";
import type {
  ChatSpace,
  PetEvolutionEvent,
  PetExpectations,
  PetExperience,
  PetGenerationSession,
  PetPrivateMessage,
  PetRecord,
  PetRuntimeState,
  PetVisualAsset,
  StyleSignal,
} from "../../src/data/types";
import { hasCompletePetExpectations } from "../../src/pets/rules";
import { petReplyFailureText, petReplyStage } from "../../src/pets/replyStatus";
import { AppButton, DemoBanner, Surface } from "../../src/ui/common";
import { colors, radii, spacing } from "../../src/theme/tokens";
import { useAppTheme } from "../../src/theme/ThemeProvider";

function CandidateVisual({
  asset,
  url,
  size = 250,
  transparent = false,
}: Readonly<{ asset: PetVisualAsset; url?: string | null; size?: number; transparent?: boolean }>) {
  const { styles, colors } = useStyles();
  return asset.storagePath.startsWith("local-") ? (
    <GenerativePetPreview seed={asset.storagePath} size={size} />
  ) : url ? (
    <Image
      source={{ uri: url }}
      resizeMode="contain"
      style={{ width: size, height: size, borderRadius: transparent ? 0 : 28 }}
    />
  ) : (
    <ActivityIndicator color={colors.mint} />
  );
}

function SignalCard({
  signal,
  onFeedback,
  onCorrect,
}: Readonly<{
  signal: StyleSignal;
  onFeedback(kind: "accepted" | "forgotten"): void;
  onCorrect(): void;
}>) {
  const { styles, colors } = useStyles();
  return (
    <Surface
      style={[
        styles.signal,
        signal.feedback === "forgotten" && styles.forgotten,
      ]}
    >
      <View style={styles.signalHead}>
        <Text style={styles.signalTitle}>{signal.tendency}</Text>
        <Text style={styles.confidence}>
          {Math.round(signal.confidence * 100)}%
        </Text>
      </View>
      <Text style={styles.signalBody}>{signal.rationale}</Text>
      <Text style={styles.signalSource}>
        来源：{signal.sourceLabel} ·{" "}
        {new Date(signal.createdAt).toLocaleDateString("zh-CN")}
      </Text>
      <Text style={styles.signalImpact}>
        可能影响：异宠之后的措辞、动作与外观倾向；不会直接规定终态。
      </Text>
      <View style={styles.signalActions}>
        <Pressable onPress={() => onFeedback("accepted")}>
          <Text
            style={[
              styles.signalAction,
              signal.feedback === "accepted" && styles.signalActionActive,
            ]}
          >
            认可
          </Text>
        </Pressable>
        <Pressable onPress={onCorrect}>
          <Text
            style={[
              styles.signalAction,
              signal.feedback === "corrected" && styles.signalActionActive,
            ]}
          >
            纠正
          </Text>
        </Pressable>
        <Pressable onPress={() => onFeedback("forgotten")}>
          <Text style={styles.forget}>忘记</Text>
        </Pressable>
      </View>
    </Surface>
  );
}

function ReplyProgress({
  message,
  busy,
  onRetry,
}: Readonly<{ message: PetPrivateMessage; busy: boolean; onRetry(): void }>) {
  const { styles, colors } = useStyles();
  if (!message.replyStatus || message.replyStatus === "succeeded") return null;
  if (message.replyStatus === "failed")
    return (
      <View
        accessibilityRole="alert"
        style={[styles.replyProgress, styles.replyFailed]}
      >
        <View style={styles.replyProgressCopy}>
          <Text style={styles.replyFailedTitle}>回答中断</Text>
          <Text style={styles.replyProgressDetail}>
            {petReplyFailureText(message.replyErrorCode)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重试异宠回答"
          disabled={busy || !message.requestKey}
          onPress={onRetry}
          style={[
            styles.retryReply,
            (busy || !message.requestKey) && styles.disabled,
          ]}
        >
          <Text style={styles.retryReplyText}>重试</Text>
        </Pressable>
      </View>
    );
  const stage = petReplyStage(message.replyStatus);
  return (
    <View
      accessibilityLabel={`异宠处理状态：${stage.title}`}
      style={styles.replyProgress}
    >
      <ActivityIndicator size="small" color={colors.mint} />
      <View style={styles.replyProgressCopy}>
        <Text style={styles.replyProgressTitle}>{stage.title}</Text>
        <Text style={styles.replyProgressDetail}>{stage.detail}</Text>
      </View>
    </View>
  );
}

export default function PetRoute() {
  const { styles, colors } = useStyles();
  const [backgroundOpen,setBackgroundOpen]=useState(false);
  const stewardBackground=useChatBackgroundColors("steward");
  const { profile, isLocalDemo } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ messageId?: string; memoryId?: string; memory_id?: string }>();
  const [sourceTarget, setSourceTarget] = useState<MemorySourceTarget | null>(null);
  const insets = useSafeAreaInsets();
  const repository = useMemo(
    () => (profile ? createPetRepository(profile) : null),
    [profile],
  );
  const chatRepository = useMemo(
    () => (profile ? createChatRepository(profile) : null),
    [profile],
  );
  const { theme } = useAppTheme();
  const [pet, setPet] = useState<PetRecord | null>(null);
  const petDisplay = usePetDisplay(pet?.status === "confirmed" ? pet.id : null,pet?.currentAssetId);
  const [messages, setMessages] = useState<readonly PetPrivateMessage[]>([]);
  const [assets, setAssets] = useState<readonly PetVisualAsset[]>([]);
  const [signals, setSignals] = useState<readonly StyleSignal[]>([]);
  const [experiences, setExperiences] = useState<readonly PetExperience[]>([]);
  const [events, setEvents] = useState<readonly PetEvolutionEvent[]>([]);
  const [runtime, setRuntime] = useState<PetRuntimeState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [generationSessions, setGenerationSessions] = useState<
    readonly PetGenerationSession[]
  >([]);
  const [spaceDigests, setSpaceDigests] = useState<readonly ChatSpace[]>([]);
  const [name, setName] = useState("");
  const [chat, setChat] = useState("");
  const [instruction, setInstruction] = useState("请根据这份期待形成第一版");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [appearance, setAppearance] = useState("");
  const [personality, setPersonality] = useState("");
  const [companionship, setCompanionship] = useState("");
  const [excludedFeatures, setExcludedFeatures] = useState("");
  const [additionalDescription, setAdditionalDescription] = useState("");
  const [expectationVersion, setExpectationVersion] = useState(0);
  const [seedSummary, setSeedSummary] = useState<string | null>(null);
  const activeOwner = useRef(profile?.id); activeOwner.current = profile?.id;
  const messageOwner = useRef<string | undefined>(undefined);
  const loadSequence = useRef(0);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [companion, setCompanion] = useState<PetCompanionContext | null>(null);
  const [enteredAt, setEnteredAt] = useState(Date.now());
  useFocusEffect(useCallback(() => { setEnteredAt(Date.now()); }, []));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadWarnings, setLoadWarnings] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [correcting, setCorrecting] = useState<StyleSignal | null>(null);
  const [correction, setCorrection] = useState("");
  const [petSection, setPetSection] = useState<
    "companion" | "steward" | "growth"
  >("companion");
  useEffect(() => {
    setSourceTarget(null);
    const messageId = params.messageId, memoryId = params.memoryId ?? params.memory_id;
    if (typeof messageId === "string") { setPetSection("companion"); setSourceTarget({ kind: "message", id: messageId }); }
    else if (typeof memoryId === "string") { setPetSection("companion"); setSourceTarget({ kind: "memory", id: memoryId }); }
  }, [profile?.id, params.messageId, params.memoryId, params.memory_id]);
  const closeSource = () => { setSourceTarget(null); router.setParams({ messageId: undefined, memoryId: undefined, memory_id: undefined }); };

  const load = useCallback(async () => {
    if (!repository) return;
    const ownerId = profile?.id;
    const sequence = ++loadSequence.current;
    try {
      const dashboard = await repository.getDashboard();
      if (activeOwner.current !== ownerId || sequence !== loadSequence.current) return;
      const nextPet = dashboard.pet;
      const nextExpectations = dashboard.expectations;
      setPet(nextPet);
      setRuntime(dashboard.runtimeState);
      setGenerationSessions(dashboard.latestGeneration ? [dashboard.latestGeneration] : []);
      setSelectedAssetId(
        nextPet?.status === "confirmed"
          ? nextPet.currentAssetId
          : (dashboard.currentAsset?.id ?? null),
      );
      if (nextExpectations) {
        setName(nextExpectations.name);
        setAppearance(nextExpectations.appearance);
        setPersonality(nextExpectations.personality);
        setCompanionship(nextExpectations.companionship);
        setExcludedFeatures(nextExpectations.excludedFeatures);
        setAdditionalDescription(nextExpectations.additionalDescription);
        setExpectationVersion(nextExpectations.version ?? 0);
        setSeedSummary(nextExpectations.seedSummary ?? null);
      } else if (nextPet) setName(nextPet.name);
      setError(null);
      setLoading(false);
      if (!nextPet) {
        setLoadedOwner(ownerId ?? null); setCompanion(null);
        setMessages([]); setAssets([]); setSignals([]); setExperiences([]); setEvents([]); setLoadWarnings([]);
        return;
      }

      const sections = await Promise.allSettled([
        repository.listPrivateMessages(), repository.listAssets(), repository.listStyleSignals(),
        repository.listExperiences(), repository.listEvolutionEvents(), repository.listGenerationSessions(),
        nextPet.status === "confirmed" ? repository.getCompanionContext() : Promise.resolve(null),
      ]);
      if (activeOwner.current !== ownerId || sequence !== loadSequence.current) return;
      setLoadedOwner(ownerId ?? null);
      const warnings: string[] = [];
      if (sections[0].status === "fulfilled") {
        const page = sections[0].value; const sameOwner = messageOwner.current === ownerId; messageOwner.current = ownerId;
        setMessages(current => mergePrivateHistory(sameOwner ? current : [], page, true));
      } else warnings.push("私聊记录暂时无法加载");
      if (sections[1].status === "fulfilled") {
        setAssets(sections[1].value);
        if (nextPet.status !== "confirmed") setSelectedAssetId(sections[1].value.at(-1)?.id ?? dashboard.currentAsset?.id ?? null);
      } else {
        setAssets(dashboard.currentAsset ? [dashboard.currentAsset] : []); warnings.push("异宠图片暂时无法加载");
      }
      if (sections[2].status === "fulfilled") setSignals(sections[2].value); else warnings.push("成长札记暂时无法加载");
      if (sections[3].status === "fulfilled") setExperiences(sections[3].value); else warnings.push("成长经历暂时无法加载");
      if (sections[4].status === "fulfilled") setEvents(sections[4].value); else warnings.push("进化记录暂时无法加载");
      if (sections[5].status === "fulfilled") setGenerationSessions(sections[5].value); else warnings.push("生成历史暂时无法加载");
      if (sections[6].status === "fulfilled") setCompanion(sections[6].value); else warnings.push("记忆暂时无法加载，请稍后刷新");
      setLoadWarnings(warnings);
    } catch (reason) {
      if (activeOwner.current === ownerId && sequence === loadSequence.current) setError(reason instanceof Error ? reason.message : "异宠档案加载失败");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [repository, profile?.id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (chatRepository)
      void chatRepository
        .listSpaces(profile?.id ?? "")
        .then(setSpaceDigests)
        .catch(() => undefined);
  }, [chatRepository, profile?.id]);
  useEffect(() => {
    let running=false; let dirty=false; let active=true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh=async()=>{
      if(!active||running)return;
      dirty=false; running=true;
      try{await load();}finally{running=false;if(active&&dirty)timer=setTimeout(()=>void refresh(),200);}
    };
    const unsubscribe=repository?.subscribe(()=>{
      dirty=true;
      if(!running){clearTimeout(timer);timer=setTimeout(()=>void refresh(),200);}
    });
    return()=>{active=false;clearTimeout(timer);unsubscribe?.();};
  }, [load, repository]);
  useEffect(() => {
    if (!runtime?.expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [runtime?.expiresAt]);
  useEffect(() => {
    for (const asset of assets) {
      if (asset.storagePath.startsWith("local-") || urls[asset.storagePath])
        continue;
      void repository
        ?.createSignedAssetUrl(asset.storagePath)
        .then((url) =>
          setUrls((current) => ({ ...current, [asset.storagePath]: url })),
        ).catch(() => undefined);
    }
  }, [assets, repository, urls]);
  const sendChat = useCallback(
    async (submittedText = chat, requestKey: string = createRequestId()) => {
      const content = submittedText.trim();
      if (!content || busy || !repository) return;
      setBusy(true);
      setError(null);
      setChat("");
      const optimistic: PetPrivateMessage = {
        id: `pending:${requestKey}`,
        role: "owner",
        content,
        createdAt: new Date().toISOString(),
        requestKey,
        replyStatus: "queued",
        conversationKind: "steward",
        replyPhaseUpdatedAt: new Date().toISOString(),
      };
      setMessages((current) =>
        current.some((message) => message.requestKey === requestKey)
          ? current
          : [...current, optimistic],
      );
      try {
        await repository.chat(content, requestKey, "steward");
      } catch {
        setError(
          "异宠回答没有完成。问题已经保留，请查看对应消息下方的状态并重试。",
        );
      } finally {
        await load();
        setBusy(false);
      }
    },
    [busy, chat, load, repository],
  );
  if (!profile || !repository) return <Redirect href="/login" />;
  if (loadedOwner !== profile.id) return <View style={{flex:1,justifyContent:"center",padding:24}}><ActivityIndicator /><Text style={styles.copy}>{error ?? "正在加载当前账号的异宠…"}</Text><AppButton label="重新加载" onPress={() => void load()} /></View>;
  const selected = assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    act(async () => {
      await repository.createPet(name.trim());
    });
  const expectations: PetExpectations = {
    name: pet?.name ?? name.trim(),
    appearance,
    personality,
    companionship,
    excludedFeatures,
    additionalDescription,
    version: expectationVersion,
  };
  const expectationsReady = hasCompletePetExpectations(expectations);
  const saveExpectations = () =>
    act(async () => {
      const saved = await repository.saveExpectations(expectations);
      setExpectationVersion(saved.version ?? expectationVersion);
      setSeedSummary(saved.seedSummary ?? null);
    });
  const generate = (explore = false) =>
    act(async () => {
      await repository.generateCandidate(
        instruction.trim(),
        explore ? null : selectedAssetId,
        explore,
        expectations,
      );
    });
  const confirm = () =>
    act(async () => {
      if (!selectedAssetId) return;
      await repository.confirmPet(selectedAssetId);
      setConfirming(false);
    });
  const repair = (eventId: string) =>
    act(async () => {
      await repository.retryEvolution(eventId, true);
    });
  const latestGeneration = generationSessions[0] ?? null;
  const generationActive =
    latestGeneration?.status === "queued" ||
    latestGeneration?.status === "running";
  const evolutionActive = events.some(
    (event) => event.status === "queued" || event.status === "running",
  );
  const motionState =
    runtime?.expiresAt && Date.parse(runtime.expiresAt) <= now
      ? ("idle" as const)
      : (runtime?.state ?? "idle");

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.coral} />
      </View>
    );
  const companionAction = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try { await operation(); } finally { await load(); setBusy(false); }
  };
  const sendCompanion = async (content:string, requestId=createRequestId(), onEvent?:(event:PrivateStreamEvent)=>void, options?:PrivateChatOptions) => {
    const ownerId=profile.id;
    if(options?.signal?.aborted)throw new Error("已停止这次回答。");
    setBusy(true);
    setMessages(current=>current.some(message=>message.requestKey===requestId)?current:[...current,{
      id:`pending:${requestId}`,role:"owner",content,requestKey:requestId,replyStatus:"queued",conversationKind:"companion",createdAt:new Date().toISOString(),imageAssetId:options?.imageAssetId??null,imageAssetVersion:options?.imageAssetVersion??null,
    }]);
    try{
      const reply=await repository.chat(content,requestId,"companion",{...options,onEvent});
      if(activeOwner.current!==ownerId)return;
      setMessages(current=>{
        const updated=current.map(message=>message.role==="owner"&&message.requestKey===requestId?
          {...message,id:reply.inReplyToId??message.id,replyStatus:"succeeded" as const,replyErrorCode:null}:message);
        return updated.some(message=>message.id===reply.id)?updated:[...updated,reply];
      });
    }finally{
      if(activeOwner.current===ownerId){setBusy(false);void load();}
    }
  };
  if (pet?.status === "confirmed" && petSection === "companion") return (
    <KeyboardScreen style={{flex:1,minHeight:0,backgroundColor:theme.page,paddingTop:insets.top}}>
      {loadWarnings.length ? <Pressable onPress={() => void load()}><Text style={styles.copy}>{loadWarnings.join("；")} · 点击重试</Text></Pressable> : null}
      {companion ? <PetCompanionPanel key={`companion:${profile.id}`} ownerId={profile.id} petId={isLocalDemo ? undefined : pet.id} petName={pet.name} incubating={false}
        onSource={id => setSourceTarget({ kind: "message", id })} onSearch={() => router.push("/search" as Href)}
        navigation={<PetSectionNav value={petSection} onChange={setPetSection} />}
        portraitPetId={pet.id} display={petDisplay}
        originalPortrait={selected ? <CandidateVisual asset={selected} url={urls[selected.storagePath]} size={160} transparent /> : undefined}
        portrait={selected ? size => <LivingPetPortrait state={motionState} compact><CandidateVisual asset={selected} url={petDisplay.url ?? urls[selected.storagePath]} size={size} transparent /></LivingPetPortrait> : undefined}
        messages={messages.filter(message=>message.conversationKind!=="steward")} context={companion} enteredAt={enteredAt} busy={busy}
        onSend={sendCompanion}
        onStop={requestId=>repository.stopPrivateReply(requestId)}
        renderActions={sourceMessageId=>!sourceMessageId.startsWith("pending:")?<WorkActionCard sourceMessageId={sourceMessageId}/>:null}
        onLoadOlder={async()=>{
          const first=messages.filter(m=>!m.id.startsWith("pending:")).at(0);if(!first)return false;
          const older=await repository.listPrivateMessages({at:first.createdAt,id:first.id});
          if (activeOwner.current !== profile.id) return false;
          setMessages(current=>mergePrivateHistory(current,older));
          return older.length===50;
        }}
        onUpdatePreference={input => companionAction(() => repository.updatePreference(input))}
        onListEvidence={(key,offset) => repository.listMemoryEvidence(key,offset)}
        onRetryExtraction={() => companionAction(() => repository.retryMemoryExtraction())}
        onSaveMemory={input => companionAction(() => repository.savePersonalMemory(input))}
        onRemoveMemory={id => companionAction(() => repository.removePersonalMemory(id))}
        onNewConversation={() => companionAction(() => repository.startNewConversation())} />
        : <View style={{padding:24}}><Text style={styles.copy}>正在加载你们的对话与记忆…</Text><AppButton label="重新加载" onPress={() => void load()} /></View>}
      {!isLocalDemo ? <MemorySourceModal key={`memory-source:${profile.id}`} ownerId={profile.id} petId={pet.id} target={sourceTarget} onClose={closeSource} /> : null}
    </KeyboardScreen>
  );
  return (
    <KeyboardScreen style={{ flex: 1 }}><KeyboardScrollView
      style={[styles.page, { backgroundColor: theme.page }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {isLocalDemo ? <DemoBanner /> : null}
      <View>
        <Text style={styles.eyebrow}>异宠</Text>
        <Text style={styles.title}>{pet ? pet.name : "孵化你的异宠"}</Text>
      </View>
      {error ? (
        <Pressable onPress={() => void load()} style={styles.error}>
          <Text style={styles.errorText}>{error} · 点击重试</Text>
        </Pressable>
      ) : null}
      {loadWarnings.length ? (
        <Pressable onPress={() => void load()} style={styles.warning}>
          <Text style={styles.warningText}>{loadWarnings.join("；")} · 点击重试</Text>
        </Pressable>
      ) : null}
      {latestGeneration &&
      (generationActive || latestGeneration.status === "failed") ? (
        <Surface style={styles.taskCard}>
          <View style={styles.taskHead}>
            <View>
              <Text style={styles.sectionTitle}>
                {generationActive ? "异宠外观正在生成" : "这次外观生成失败"}
              </Text>
              <Text style={styles.copy}>
                {latestGeneration.status === "queued"
                  ? (latestGeneration.progressLabel ?? "已排队，可以离开页面，完成后会自动出现。")
                  : latestGeneration.status === "running"
                    ? `${latestGeneration.progressLabel ?? "正在连接模型"} · 第 ${latestGeneration.attempts || 1} 次尝试`
                    : `原因：${latestGeneration.errorCode ?? "模型暂时不可用"}`}
              </Text>
            </View>
            {generationActive ? (
              <ActivityIndicator color={colors.coral} />
            ) : null}
          </View>
          {latestGeneration.status === "failed" &&
          latestGeneration.retryable !== false && latestGeneration.attempts < 2 ? (
            <AppButton
              label="用同一任务重试"
              variant="quiet"
              disabled={busy}
              onPress={() =>
                void act(() =>
                  repository
                    .retryGeneration(latestGeneration.id)
                    .then(() => undefined),
                )
              }
            />
          ) : null}
        </Surface>
      ) : null}
      {!pet ? (
        <Surface style={styles.naming}>
          <Text style={styles.sectionTitle}>先给异宠一个名字</Text>
          <Text style={styles.copy}>
            再说说你期待的样子、性格和相处方式，一起认识你的异宠。
          </Text>
          <KeyboardTextInput
            value={name}
            onChangeText={setName}
            maxLength={24}
            placeholder="例如：芽芽"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <AppButton
            label={busy ? "正在创建…" : "下一步：填写期待"}
            disabled={busy || !name.trim()}
            onPress={create}
          />
        </Surface>
      ) : (
        <>
          {pet.status !== "confirmed" ? (
            <Surface style={styles.expectationCard}>
              <View>
                <Text style={styles.stageLabel}>初始期待 · 确认前可修改</Text>
                <Text style={styles.stageTitle}>
                  告诉模型你希望它成为怎样的生命
                </Text>
                <Text style={styles.copy}>
                  文本模型会把这些期待编排成人格种子、视觉 Prompt
                  和排除约束，再交给图像模型生成原创 2D 全身异宠。
                </Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>外观期待 *</Text>
                <KeyboardTextInput
                  value={appearance}
                  onChangeText={setAppearance}
                  multiline
                  maxLength={2000}
                  placeholder="例如：像会收集月光的软体生物，有不对称触角和透明鳍"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.expectationInput]}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>性格期待 *</Text>
                <KeyboardTextInput
                  value={personality}
                  onChangeText={setPersonality}
                  multiline
                  maxLength={2000}
                  placeholder="例如：安静敏锐，有自己的判断，不一味迎合"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.expectationInput]}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>相处方式 *</Text>
                <KeyboardTextInput
                  value={companionship}
                  onChangeText={setCompanionship}
                  multiline
                  maxLength={2000}
                  placeholder="例如：平时先倾听，需要时直接提醒，也会主动分享见闻"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.expectationInput]}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>排除特征</Text>
                <KeyboardTextInput
                  value={excludedFeatures}
                  onChangeText={setExcludedFeatures}
                  multiline
                  maxLength={1200}
                  placeholder="例如：不要人脸、翅膀、普通猫狗轮廓、过度可爱"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.expectationInput]}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>补充描述</Text>
                <KeyboardTextInput
                  value={additionalDescription}
                  onChangeText={setAdditionalDescription}
                  multiline
                  maxLength={2000}
                  placeholder="任何无法归入上面几项的期待"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.expectationInput]}
                />
              </View>
              {seedSummary ? (
                <View style={styles.seedSummary}>
                  <Text style={styles.seedSummaryLabel}>模型理解摘要</Text>
                  <Text style={styles.copy}>{seedSummary}</Text>
                </View>
              ) : null}
              <View style={styles.buttonRow}>
                <View style={styles.flex}>
                  <AppButton
                    label="保存设定草稿"
                    variant="quiet"
                    disabled={busy || !expectationsReady}
                    onPress={() => void saveExpectations()}
                  />
                </View>
                {pet.status === "incubating" ? (
                  <View style={styles.flex}>
                    <AppButton
                      label={
                        generationActive ? "后台生成中…" : "生成第一张异宠"
                      }
                      disabled={busy || generationActive || !expectationsReady}
                      onPress={() => void generate(false)}
                    />
                  </View>
                ) : null}
              </View>
            </Surface>
          ) : null}
          {pet.status === "drafting" && selected ? (
            <Surface style={styles.visualCard}>
              <View style={styles.visualHeader}>
                <View>
                  <Text style={styles.stageLabel}>尚未确认 · 可自由修改</Text>
                  <Text style={styles.stageTitle}>
                    这是当前草稿，不是最终承诺
                  </Text>
                </View>
                <Text style={styles.quota}>
                  今日剩余 {pet.generationsRemainingToday}
                </Text>
              </View>
              <View style={styles.visual}>
                <CandidateVisual
                  asset={selected}
                  url={urls[selected.storagePath]}
                />
              </View>
              <FlatList
                horizontal
                data={assets}
                keyExtractor={(item) => item.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.candidates}
                renderItem={({ item, index }) => (
                  <Pressable
                    onPress={() => setSelectedAssetId(item.id)}
                    style={[
                      styles.candidate,
                      selectedAssetId === item.id && styles.candidateSelected,
                    ]}
                  >
                    <CandidateVisual
                      asset={item}
                      url={urls[item.storagePath]}
                      size={74}
                    />
                    <Text style={styles.candidateLabel}>候选 {index + 1}</Text>
                  </Pressable>
                )}
              />
              <KeyboardTextInput
                value={instruction}
                onChangeText={setInstruction}
                multiline
                placeholder="用自然语言继续修改，例如：不要这么可爱"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.instruction]}
              />
              <View style={styles.buttonRow}>
                <View style={styles.flex}>
                  <AppButton
                    label={
                      generationActive
                        ? "后台生成中…"
                        : busy
                          ? "正在提交…"
                          : "基于当前修改"
                    }
                    disabled={busy || generationActive || !instruction.trim()}
                    onPress={() => void generate(false)}
                  />
                </View>
                <View style={styles.flex}>
                  <AppButton
                    label="重新探索方向"
                    variant="secondary"
                    disabled={busy || generationActive || !instruction.trim()}
                    onPress={() => void generate(true)}
                  />
                </View>
              </View>
              <AppButton
                label="选择这张并确认"
                variant="quiet"
                disabled={busy || generationActive}
                onPress={() => setConfirming(true)}
              />
            </Surface>
          ) : null}
          {pet.status === "confirmed" ? (
            <PetSectionNav value={petSection} onChange={section=>{setPetSection(section);if(section==="companion")setEnteredAt(Date.now());}}/>
          ) : null}
          {pet.status === "confirmed" &&
          selected &&
          petSection !== "steward" ? (
            <Surface style={[styles.confirmed, petSection === "growth" && {backgroundColor:"transparent",borderWidth:0,shadowOpacity:0,elevation:0}]}>
              <Text style={styles.stageLabel}>
                {petSection === "growth"
                  ? "成长档案 · 同一生命继续变化"
                  : "陪伴 · 你的长期伙伴"}
              </Text>
              <DraggablePetStage ownerId={profile.id} petId={pet.id}>{size =>
                <LivingPetPortrait state={motionState} compact>
                  <CandidateVisual
                    asset={selected}
                    url={petDisplay.url ?? urls[selected.storagePath]}
                    size={size}
                    transparent
                  />
                </LivingPetPortrait>
              }</DraggablePetStage>
              {petSection === "companion" ? (
                <View style={styles.petActions}>
                  {(
                    [
                      ["care", "陪伴"],
                      ["feed", "投喂"],
                      ["play", "玩耍"],
                      ["rest", "休息"],
                    ] as const
                  ).map(([action, label]) => (
                    <Pressable
                      key={action}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      disabled={busy}
                      onPress={() =>
                        void act(() =>
                          repository
                            .performAction(action)
                            .then(() => undefined),
                        )
                      }
                      style={[styles.petAction, busy && styles.disabled]}
                    >
                      <Text style={styles.petActionText}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {petSection === "growth" ? (
                <>
                  <PetDisplayControls display={petDisplay} />
                  <Text style={styles.stageTitle}>我们的相处足迹</Text>
                  <View style={styles.lineage}>
                    <Text style={styles.lineageText}>
                      形态谱系 · 第{" "}
                      {assets.filter((asset) => !asset.isDraft).length || 1}{" "}
                      个生命阶段
                    </Text>
                  </View>
                  {evolutionActive ? (
                    <View style={styles.taskInline}>
                      <ActivityIndicator color={colors.coral} />
                      <Text style={styles.copy}>
                        长久积累正在变成新的生命阶段，可以先离开页面。
                      </Text>
                    </View>
                  ) : events[0]?.status === "failed" ? (
                    <View style={styles.taskInline}>
                      <Text style={styles.errorText}>
                        自动进化暂时失败：
                        {events[0].errorCode ?? "AI 暂时离线，可稍后重试"}
                      </Text>
                      <AppButton
                        label="沿用同一成长事件重试"
                        variant="quiet"
                        disabled={busy || events[0].failedAttempts >= 2}
                        onPress={() =>
                          void act(() =>
                            repository
                              .retryEvolution(events[0].id)
                              .then(() => undefined),
                          )
                        }
                      />
                    </View>
                  ) : (
                    <View style={styles.growthNotice}>
                      <Text style={styles.growthNoticeText}>
                        它正在从每一次聊天、陪伴和共同经历里慢慢形成自己。
                      </Text>
                    </View>
                  )}
                  <View style={styles.experienceList}>
                    <Text style={styles.sectionTitle}>形态变化的经历依据</Text>
                    {experiences.length ? (
                      experiences.slice(0, 3).map((experience) => (
                        <View key={experience.id} style={styles.experience}>
                          <Text style={styles.experienceText}>
                            {experience.summary}
                          </Text>
                          <Text style={styles.signalSource}>
                            {new Date(experience.occurredAt).toLocaleString(
                              "zh-CN",
                            )}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.copy}>
                        目前还没有足够的形态变化经历记录。
                      </Text>
                    )}
                  </View>
                  {!isLocalDemo ? <MemoryReviewPanel key={`${pet.id}:${companion?.revision}`} petId={pet.id} onSource={id => setSourceTarget({ kind: "message", id })} /> : null}
                  {events[0]?.status === "succeeded" &&
                  events[0].officialAssetId === pet.currentAssetId &&
                  !events[0].continuityRepairUsed ? (
                    <AppButton
                      label="报告：与上一形态完全断裂"
                      variant="quiet"
                      disabled={busy || evolutionActive}
                      onPress={() => void repair(events[0].id)}
                    />
                  ) : null}
                  <Text style={styles.repairNote}>
                    连续性修复只会沿用同一事件重试一次，不能借此重新捏宠。
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.stageTitle}>
                    它会陪你进入不同关系空间
                  </Text>
                  <Text style={styles.copy}>
                    动作状态会跨设备同步。长时间没打开应用时，它会安静生活和等待，不会死亡、退化或责怪你。
                  </Text>
                </>
              )}
            </Surface>
          ) : null}
          {pet.status === "confirmed" && petSection === "steward" ? (
            <>
              <Surface style={styles.digestCard}>
                <View style={styles.chatHead}>
                  <Text style={styles.sectionTitle}>各群消息管家</Text>
                  <Text style={styles.private}>
                    已读、未读都可回忆 · 从加入后开始
                  </Text>
                </View>
                {spaceDigests.length ? (
                  spaceDigests.map((space) => (
                    <View key={space.id} style={styles.digestRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.digestName}>{space.name}</Text>
                        <Text numberOfLines={1} style={styles.digestMessage}>
                          {space.lastMessage ?? "还没有消息"}
                        </Text>
                      </View>
                      <View style={styles.digestCount}>
                        <Text style={styles.digestCountText}>
                          {space.unreadCount > 0
                            ? `${space.unreadCount} 条未读`
                            : "当前无未读"}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.copy}>
                    加入关系空间后，这里会出现各群最近消息和未读数。即使消息已经读过，也可以直接在下面让异宠帮你回忆。
                  </Text>
                )}
              </Surface>
              <ChatBackgroundSurface threadKey="steward" style={[styles.chatCard,{padding:16,borderRadius:12}]}>
                <View style={styles.chatHead}>
                  <Text style={styles.sectionTitle}>消息管家</Text><Pressable accessibilityRole="button" accessibilityLabel="设置消息管家背景" onPress={()=>setBackgroundOpen(true)} style={{minWidth:48,minHeight:48,alignItems:"center",justifyContent:"center"}}><Icon name="image" color={colors.text}/></Pressable>
                  <Text style={styles.private}>
                    仅主人可见 · 按明确群名检索可读历史
                  </Text>
                </View>
                <View style={styles.thread}>
                  {messages.filter(message => message.conversationKind !== "companion").slice(-12).map((message) => (
                    <View key={message.id} style={styles.privateTurn}>
                      <View
                        style={[
                          styles.privateMessage,
                          {backgroundColor:message.role === "owner" ? stewardBackground.userBubble : stewardBackground.bubble},
                          message.role === "owner"
                            ? styles.ownerMessage
                            : styles.petMessage,
                          {backgroundColor:message.role === "owner" ? stewardBackground.userBubble : stewardBackground.bubble},
                        ]}
                      >
                        <Text
                          style={[
                            styles.privateText,
                            message.role === "owner" && styles.ownerText,
                            {color:message.role === "owner" ? stewardBackground.userText : stewardBackground.text},
                          ]}
                        >
                          {message.content}
                        </Text>
                        {message.role === "pet" &&
                        message.recallSources?.length ? (
                          <Text style={styles.memorySource}>
                            消息来源：
                            {[
                              ...new Map(
                                message.recallSources.map((source) => [
                                  source.spaceId,
                                  source,
                                ]),
                              ).values(),
                            ]
                              .map(
                                (source) =>
                                  `${source.spaceName} · ${new Date(source.createdAt).toLocaleDateString("zh-CN")}`,
                              )
                              .join("；")}
                          </Text>
                        ) : null}
                        {message.agentRequestId ? (
                          <Text style={styles.agentRequestLabel}>
                            已进入
                            {message.targetSpaceName
                              ? `“${message.targetSpaceName}”`
                              : ""}
                            主 Agent 请求链 · 可追溯
                          </Text>
                        ) : null}
                      </View>
                      {message.role === "owner" && !message.id.startsWith("pending:") ? <StewardActionCard key={`steward-action:${message.id}`} sourceMessageId={message.id}/> : null}
                      {message.role === "owner" ? (
                        <ReplyProgress
                          message={message}
                          busy={busy}
                          onRetry={() =>
                            void sendChat(
                              message.content,
                              message.requestKey ?? createRequestId(),
                            )
                          }
                        />
                      ) : null}
                    </View>
                  ))}
                </View>
      <View style={styles.chatComposer}>
                  <EnterSendTextInput
                    accessibilityLabel="异宠私聊输入"
                    value={chat}
                    onChangeText={setChat}
                    onSend={(value) => void sendChat(value)}
                    editable={!busy}
                    placeholder="可问已读或未读群聊，也可让它整理委托…"
                    placeholderTextColor={colors.textMuted}
                    style={styles.chatInput}
                  />
                  <Pressable
                    disabled={busy || !chat.trim()}
                    onPress={() => void sendChat()}
                    style={[
                      styles.chatSend,
                      (busy || !chat.trim()) && styles.disabled,
                    ]}
                  >
                    <Text style={styles.chatSendText}>发送</Text>
                  </Pressable>
                </View>
              </ChatBackgroundSurface>
            </>
          ) : null}
          {pet.status !== "confirmed" || petSection === "growth" ? (
            <View style={styles.signalSection}>
              <Text style={styles.sectionTitle}>我观察到的倾向</Text>
              <Text style={styles.copy}>
                只展示概括性依据，不展示其他成员私密原文。遗忘后，该信号不再进入后续模型提示词。
              </Text>
              {signals.length ? (
                signals.map((signal) => (
                  <SignalCard
                    key={signal.id}
                    signal={signal}
                    onFeedback={(kind) =>
                      void act(() => repository.feedback(signal.id, kind))
                    }
                    onCorrect={() => {
                      setCorrecting(signal);
                      setCorrection(signal.tendency);
                    }}
                  />
                ))
              ) : (
                <Surface>
                  <Text style={styles.copy}>
                    继续相处后，这里会出现可以认可、纠正或忘记的成长札记。
                  </Text>
                </Surface>
              )}
            </View>
          ) : null}
        </>
      )}
      {busy ? <ActivityIndicator color={colors.coral} /> : null}
      <Modal
        transparent
        visible={confirming}
        animationType="fade"
        onRequestClose={() => setConfirming(false)}
      >
        <KeyboardScreen style={styles.overlay}>
          <Surface style={styles.confirmModal}>
            <Text style={styles.confirmTitle}>要让它成为正式形态吗？</Text>
            <Text style={styles.copy}>
              确认后不能选择历史候选替换、不能重新探索，也不能通过直接 API
              重捏。以后只能在长期经历中软连续进化。
            </Text>
            <AppButton
              label="再看一看"
              variant="quiet"
              onPress={() => setConfirming(false)}
            />
            <AppButton label="我确认这是它" onPress={confirm} />
          </Surface>
        </KeyboardScreen>
      </Modal>
      <Modal
        transparent
        visible={Boolean(correcting)}
        animationType="fade"
        onRequestClose={() => setCorrecting(null)}
      >
        <KeyboardScreen style={styles.overlay}>
          <Surface style={styles.confirmModal}>
            <Text style={styles.confirmTitle}>你希望它怎样理解？</Text>
            <Text style={styles.copy}>
              用你自己的话改写这条观察。之后模型只使用纠正后的表达。
            </Text>
            <TextInput
              value={correction}
              onChangeText={setCorrection}
              multiline
              maxLength={1000}
              style={[styles.input, styles.instruction]}
            />
            <AppButton
              label="取消"
              variant="quiet"
              onPress={() => setCorrecting(null)}
            />
            <AppButton
              label="保存纠正"
              disabled={!correction.trim() || busy}
              onPress={() => {
                const signal = correcting;
                if (!signal) return;
                void act(async () => {
                  await repository.feedback(
                    signal.id,
                    "corrected",
                    correction.trim(),
                  );
                  setCorrecting(null);
                });
              }}
            />
          </Surface>
        </KeyboardScreen>
      </Modal>
    <ChatBackgroundEditor visible={backgroundOpen} onClose={()=>setBackgroundOpen(false)} threadKey="steward"/>
    </KeyboardScrollView>
    {pet && !isLocalDemo ? <MemorySourceModal key={`memory-source:${profile.id}`} ownerId={profile.id} petId={pet.id} target={sourceTarget} onClose={closeSource} /> : null}
    </KeyboardScreen>
  );
}

const useStyles = createThemedStyles((colors, theme) => ({
  page: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, backgroundColor: colors.canvas, justifyContent: "center" },
  sectionTabs: { flexDirection: "row", borderWidth: 1, padding: 5, gap: 5 },
  sectionTab: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTabText: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: 110,
    gap: spacing.md,
  },
  eyebrow: {
    color: colors.mint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "600" },
  naming: { gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  copy: { color: colors.textMuted, lineHeight: 21 },
  input: {
    minHeight: 49,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  expectationCard: { gap: spacing.md },
  field: { gap: 6 },
  fieldLabel: { color: colors.text, fontSize: 12, fontWeight: "600" },
  expectationInput: { minHeight: 66, textAlignVertical: "top" },
  seedSummary: {
    backgroundColor: colors.mintDeep,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: 4,
  },
  seedSummaryLabel: { color: colors.mint, fontSize: 11, fontWeight: "700" },
  stage: { gap: spacing.sm },
  stageLabel: {
    color: colors.mint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  stageTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.coral },
  progressText: { color: colors.textMuted, fontSize: 12 },
  visualCard: { gap: spacing.md },
  visualHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  quota: { color: theme.danger, fontSize: 11, fontWeight: "600" },
  visual: { alignItems: "center", minHeight: 260, justifyContent: "center" },
  candidates: { gap: 8 },
  candidate: {
    width: 88,
    padding: 6,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
    overflow: "hidden",
  },
  candidateSelected: { borderColor: colors.mint },
  candidateLabel: { color: colors.textMuted, fontSize: 10 },
  instruction: { minHeight: 76, textAlignVertical: "top" },
  buttonRow: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  confirmed: { alignItems: "stretch", gap: spacing.md },
  lineage: {
    alignSelf: "center",
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.mintDeep,
  },
  lineageText: { color: colors.mint, fontSize: 12, fontWeight: "600" },
  ready: { gap: spacing.md },
  petActions: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  petAction: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  petActionText: { color: colors.mint, fontWeight: "700", fontSize: 12 },
  growthNotice: {
    backgroundColor: colors.mintDeep,
    borderRadius: radii.md,
    padding: 12,
  },
  growthNoticeText: { color: colors.mint, lineHeight: 20, textAlign: "center" },
  experienceList: { gap: 8 },
  experience: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: 10,
    gap: 4,
  },
  experienceText: { color: colors.text, lineHeight: 19 },
  repairNote: { color: colors.textMuted, fontSize: 11, textAlign: "center" },
  chatCard: { gap: spacing.md },
  chatHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 4,
  },
  private: { color: colors.mint, fontSize: 11 },
  thread: { gap: 8 },
  privateTurn: { gap: 6 },
  privateMessage: { maxWidth: "82%", borderRadius: 15, padding: 10 },
  ownerMessage: { alignSelf: "flex-end", backgroundColor: colors.coralSoft },
  petMessage: { alignSelf: "flex-start", backgroundColor: colors.mintDeep },
  privateText: { color: colors.text, lineHeight: 20 },
  ownerText: { color: colors.textDark },
  memorySource: {
    color: colors.mint,
    fontSize: 10,
    marginTop: 7,
    lineHeight: 15,
  },
  replyProgress: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.mintDeep,
  },
  replyFailed: { borderColor: colors.coralSoft },
  replyProgressCopy: { flex: 1, gap: 2 },
  replyProgressTitle: { color: colors.mint, fontSize: 11, fontWeight: "700" },
  replyFailedTitle: {
    color: theme.danger,
    fontSize: 11,
    fontWeight: "700",
  },
  replyProgressDetail: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
  },
  retryReply: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.coral,
  },
  retryReplyText: { color: colors.white, fontSize: 11, fontWeight: "700" },
  chatComposer: { flexShrink: 0, width: "100%", maxWidth: 720, alignSelf: "center", padding: 12, backgroundColor: colors.canvasRaised, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  chatInput: {
    flex: 1,
    minHeight: 45,
    maxHeight: 100,
    backgroundColor: colors.surface,
    borderRadius: 15,
    color: colors.text,
    padding: 11,
  },
  chatSend: {
    backgroundColor: colors.coral,
    minHeight: 45,
    borderRadius: 14,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  chatSendText: { color: colors.white, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  digestCard: { gap: 8 },
  digestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
  },
  digestName: { color: colors.text, fontWeight: "700" },
  digestMessage: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  digestCount: {
    backgroundColor: colors.mintDeep,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  digestCountText: { color: colors.mint, fontSize: 9, fontWeight: "700" },
  agentRequestLabel: { color: colors.lavender, fontSize: 10, marginTop: 7 },
  signalSection: { gap: spacing.md },
  signal: { gap: 8 },
  forgotten: { opacity: 0.5 },
  signalHead: { flexDirection: "row", justifyContent: "space-between" },
  signalTitle: { color: colors.text, fontWeight: "700", flex: 1 },
  confidence: { color: colors.mint, fontWeight: "600" },
  signalBody: { color: colors.text, lineHeight: 20 },
  signalSource: { color: colors.textMuted, fontSize: 11 },
  signalImpact: { color: colors.lavender, fontSize: 12, lineHeight: 18 },
  signalActions: { flexDirection: "row", gap: spacing.lg, marginTop: 4 },
  signalAction: { color: colors.textMuted, fontWeight: "600" },
  signalActionActive: { color: colors.mint },
  forget: { color: theme.danger, fontWeight: "600" },
  error: {
    backgroundColor: theme.userBubble,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  errorText: { color: theme.danger, textAlign: "center" },
  warning: { backgroundColor: theme.secondary, borderRadius: radii.md, padding: spacing.sm },
  warningText: { color: colors.lavenderSoft, textAlign: "center", fontSize: 12, lineHeight: 18 },
  overlay: {
    flex: 1,
    backgroundColor: theme.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  confirmModal: { width: "100%", maxWidth: 480, gap: spacing.md },
  confirmTitle: { color: colors.text, fontSize: 22, fontWeight: "700" },
  taskCard: { gap: spacing.md, borderWidth: 1, borderColor: colors.coralSoft },
  taskHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  taskInline: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.sm,
    alignItems: "center",
  },
}));
