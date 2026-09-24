import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { isLocalDemoMode, requireSupabase } from "../lib/supabase";
import { DAILY_CANDIDATE_LIMIT, canGenerateInitialCandidate } from "../pets/rules";
import { currentPrivateMessages, localCompanionReply, PERSONAL_MEMORY_LIMIT, validatePersonalMemory } from "../pets/companion";
import { buildPreferenceViews, extractLocalPreferences, preferenceKey, scorePreference, selectPreferences, type MemoryEvidence, type PreferenceFacts } from "../../supabase/functions/_shared/preferenceMemory";
import { excludeLocalContext, recordLocalEvidence } from "../pets/localMemory";
import { newPrivateRequestId } from "../pets/requestId";
import type { MemoryEvidencePage, PreferenceAction, PetCompanionContext, PetPersonalMemory, SavePetMemoryInput } from "./types";
import type { AppProfile, PetEvolutionEvent, PetExperience, PetGenerationSession, PetMotionState, PetPrivateMessage, PetRecallSource, PetRecord, PetRuntimeState, PetVisualAsset, StyleSignal } from "./types";

const LOCAL_PET_KEY = "pet-cohabitation-local-pet-v2";

type LocalPetState = Readonly<{
  pet: PetRecord | null;
  messages: readonly PetPrivateMessage[];
  assets: readonly PetVisualAsset[];
  signals: readonly StyleSignal[];
  generationDates: readonly string[];
  experiences?: readonly PetExperience[];
  evolutionEvents?: readonly PetEvolutionEvent[];
  generationSessions?: readonly PetGenerationSession[];
  runtimeState?: PetRuntimeState | null;
  personalMemories?: readonly PetPersonalMemory[];
  contextStartedAt?: string | null;
  evidence?: readonly MemoryEvidence[];
  excludedMessageIds?: readonly string[];
  importantKeys?: readonly string[];
  manualHistory?: readonly { id: string; memoryId: string; content: string; createdAt: string; sourceMessageId?: string | null }[];
  privateRequests?: Readonly<Record<string, { content: string; replyId: string }>>;
}>;

export interface PetRepository {
  getPet(): Promise<PetRecord | null>;
  createPet(name: string): Promise<PetRecord>;
  listPrivateMessages(): Promise<readonly PetPrivateMessage[]>;
  chat(content: string, requestId?: string): Promise<PetPrivateMessage>;
  listMemoryEvidence(key: string, offset?: number): Promise<MemoryEvidencePage>;
  updatePreference(input: PreferenceAction): Promise<void>;
  retryMemoryExtraction(): Promise<void>;
  getCompanionContext(): Promise<PetCompanionContext>;
  savePersonalMemory(input: SavePetMemoryInput): Promise<void>;
  removePersonalMemory(id: string): Promise<void>;
  startNewConversation(): Promise<void>;
  listAssets(): Promise<readonly PetVisualAsset[]>;
  listGenerationSessions(): Promise<readonly PetGenerationSession[]>;
  generateCandidate(instruction: string, baseAssetId?: string | null, explore?: boolean): Promise<PetGenerationSession>;
  retryGeneration(sessionId: string): Promise<PetGenerationSession>;
  confirmPet(assetId: string): Promise<void>;
  listStyleSignals(): Promise<readonly StyleSignal[]>;
  feedback(signalId: string, feedback: "accepted" | "corrected" | "forgotten", correction?: string): Promise<void>;
  createSignedAssetUrl(path: string): Promise<string>;
  listExperiences(): Promise<readonly PetExperience[]>;
  listEvolutionEvents(): Promise<readonly PetEvolutionEvent[]>;
  getRuntimeState(): Promise<PetRuntimeState | null>;
  performAction(action: "care" | "feed" | "play" | "rest"): Promise<PetRuntimeState>;
  retryEvolution(eventId: string, continuityRepair?: boolean): Promise<PetEvolutionEvent>;
  subscribe(onChange: () => void): () => void;
}

const emptyLocal: LocalPetState = { pet: null, messages: [], assets: [], signals: [], generationDates: [] };

export function localPetStorageKey(ownerId: string): string { return `${LOCAL_PET_KEY}:${ownerId}`; }

async function loadLocal(ownerId: string): Promise<LocalPetState> {
  const key = localPetStorageKey(ownerId);
  const raw = await AsyncStorage.getItem(key) ?? await AsyncStorage.getItem(LOCAL_PET_KEY);
  if (!raw) return emptyLocal;
  try {
    const state = JSON.parse(raw) as LocalPetState;
    if (state.pet?.ownerId !== ownerId) return emptyLocal;
    return state;
  } catch { return emptyLocal; }
}
async function saveLocal(ownerId: string, state: LocalPetState): Promise<void> { await AsyncStorage.setItem(localPetStorageKey(ownerId), JSON.stringify(state)); }
function todayKey(): string { return new Date().toISOString().slice(0, 10); }
function remaining(state: LocalPetState): number { return Math.max(0, DAILY_CANDIDATE_LIMIT - state.generationDates.filter((value) => value === todayKey()).length); }
function nextLocalTime(state: LocalPetState): string {
  return new Date(Math.max(Date.now(), Date.parse(state.messages.at(-1)?.createdAt ?? "1970-01-01") + 1, Date.parse(state.evidence?.at(-1)?.occurredAt ?? "1970-01-01") + 1, Date.parse(state.contextStartedAt ?? "1970-01-01") + 1)).toISOString();
}

class LocalPetRepository implements PetRepository {
  constructor(private readonly profile: AppProfile) {}
  async getPet() { const state = await loadLocal(this.profile.id); return state.pet ? { ...state.pet, conversationTurns: state.messages.filter((message) => message.role === "owner").length, generationsRemainingToday: remaining(state) } : null; }
  async createPet(name: string) {
    const state = await loadLocal(this.profile.id); if (state.pet) return state.pet;
    const pet: PetRecord = { id: "local-pet", ownerId: this.profile.id, name: name.trim(), status: "incubating", conversationTurns: 0, currentAssetId: null, confirmedAt: null, generationsRemainingToday: DAILY_CANDIDATE_LIMIT };
    await saveLocal(this.profile.id, { ...state, pet }); return pet;
  }
  async listPrivateMessages() { return (await loadLocal(this.profile.id)).messages; }
  async getCompanionContext(): Promise<PetCompanionContext> {
    const state = await loadLocal(this.profile.id);
    return { memories: state.personalMemories ?? [], contextStartedAt: state.contextStartedAt ?? null, preferences: buildPreferenceViews((state.evidence ?? []).filter((item)=>!state.excludedMessageIds?.includes(item.sourceMessageId??"")), state.importantKeys ?? []), excludedMessageIds: state.excludedMessageIds ?? [], manualHistory: state.manualHistory ?? [], pendingExtractions: 0, failedExtractions: 0 };
  }
  async savePersonalMemory(input: SavePetMemoryInput) {
    const content = validatePersonalMemory(input.content);
    const state = await loadLocal(this.profile.id); if (!state.pet) throw new Error("请先孵化异宠");
    const memories = state.personalMemories ?? [];
    const existing = input.id ? memories.find((item) => item.id === input.id) : null;
    if (input.id && !existing) throw new Error("这条记忆已被移除，请刷新后再试");
    if (!existing && memories.length >= PERSONAL_MEMORY_LIMIT) throw new Error("已记住 20 件事，可以先整理已有记忆");
    if (input.sourceMessageId && !state.messages.some((message) => message.id === input.sourceMessageId && message.role === "owner")) throw new Error("只能保存你自己说过的话");
    const now = nextLocalTime(state);
    const memory: PetPersonalMemory = { id: existing?.id ?? `memory-${Date.now()}-${Math.random().toString(36).slice(2)}`, content, sourceMessageId: existing ? null : input.sourceMessageId ?? null, createdAt: existing?.createdAt ?? now, updatedAt: now };
    await saveLocal(this.profile.id, { ...state, personalMemories: [memory, ...memories.filter((item) => item.id !== memory.id)], manualHistory: existing ? [{ id: `version-${now}`, memoryId: existing.id, content: existing.content, createdAt: now, sourceMessageId:existing.sourceMessageId }, ...(state.manualHistory ?? [])] : state.manualHistory });
  }
  async removePersonalMemory(id: string) {
    const state = await loadLocal(this.profile.id);
    if (!(state.personalMemories ?? []).some((item) => item.id === id)) throw new Error("这条记忆已被移除，请刷新后再试");
    const memory = state.personalMemories!.find((item) => item.id === id)!;
    const sources = [...new Set([...(memory.sourceMessageId ? [memory.sourceMessageId] : []),...(state.manualHistory??[]).filter((item)=>item.memoryId===id).flatMap((item)=>item.sourceMessageId ? [item.sourceMessageId]:[])])];
    await saveLocal(this.profile.id, { ...state, personalMemories: state.personalMemories?.filter((item) => item.id !== id), manualHistory: state.manualHistory?.filter((item) => item.memoryId !== id), evidence: state.evidence?.map((item) => sources.includes(item.sourceMessageId ?? "") ? { ...item, state: "forgotten" } : item), excludedMessageIds: excludeLocalContext(state.messages, state.excludedMessageIds ?? [], sources, [], [id]) });
  }
  async startNewConversation() {
    const state = await loadLocal(this.profile.id); if (!state.pet) throw new Error("请先孵化异宠");
    await saveLocal(this.profile.id, { ...state, contextStartedAt: nextLocalTime(state) });
  }
  async listMemoryEvidence(key: string, offset = 0): Promise<MemoryEvidencePage> {
    const state = await loadLocal(this.profile.id);
    const rows = [...(state.evidence ?? [])].filter((item) => preferenceKey(item.object, item.context) === key).sort((a,b) => Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
    return { items: rows.slice(offset, offset+20), nextOffset: rows.length>offset+20 ? offset+20 : null };
  }
  async retryMemoryExtraction() { /* Local extraction is synchronous and deterministic. */ }
  async updatePreference(input: PreferenceAction) {
    const state = await loadLocal(this.profile.id);
    const rows = (state.evidence ?? []).filter((item) => preferenceKey(item.object,item.context) === input.key);
    const latest = [...rows].sort((a,b) => Date.parse(b.occurredAt)-Date.parse(a.occurredAt))[0];
    if (!latest) throw new Error("这条偏好已变化，请刷新后再试");
    if (input.action === "important") {
      const keys = new Set(state.importantKeys ?? []); if (input.important) keys.add(input.key); else keys.delete(input.key);
      await saveLocal(this.profile.id, {...state, importantKeys: [...keys] }); return;
    }
    if (input.action === "forget" || input.action === "retract") {
      const affected = rows.filter((row) => !input.evidenceId || row.id===input.evidenceId);
      if (!affected.length) throw new Error("没有找到对应依据");
      const ids=affected.map((row)=>row.id); const sources=affected.flatMap((row)=>row.sourceMessageId ? [row.sourceMessageId] : []);
      await saveLocal(this.profile.id,{...state,evidence: state.evidence?.map((row)=>ids.includes(row.id) ? {...row,state:input.action==="forget" ? "forgotten" : "retracted"} : row),excludedMessageIds:excludeLocalContext(state.messages,state.excludedMessageIds??[],sources,ids)}); return;
    }
    const now = nextLocalTime(state);
    const item: MemoryEvidence = {...latest,id:`manual-evidence-${now}-${Math.random()}`,sourceMessageId:null,manualMemoryId:null,origin:"manual",operation:"observe",polarity:input.action,temporal:"current",state:"active",strength:.6,preferredOver:[],quote:`我${input.action==="positive" ? "现在喜欢" : "已经不喜欢"}${latest.object}`,occurredAt:now};
    await saveLocal(this.profile.id,{...state,evidence:[...(state.evidence??[]),item]});
  }
  async chat(content: string, requestId = newPrivateRequestId()) {
    const state = await loadLocal(this.profile.id); if (!state.pet) throw new Error("请先为胚胎命名");
    const previousRequest = state.privateRequests?.[requestId];
    if (previousRequest) { if (previousRequest.content !== content.trim()) throw new Error("同一请求不能更改内容"); return state.messages.find((item) => item.id === previousRequest.replyId)!; }
    content = content.trim(); if (!content || [...content].length > 4000) throw new Error("私聊消息需为 1 至 4000 字");
    const now = nextLocalTime(state); const owner: PetPrivateMessage = { id: `owner-${now}`, role: "owner", content, createdAt: now };
    const extracted = recordLocalEvidence(state.evidence ?? [], owner, extractLocalPreferences(content), state.messages, state.excludedMessageIds ?? []);
    const safeManual=(state.personalMemories??[]).filter((item)=>!item.sourceMessageId || !extracted.excludedMessageIds.includes(item.sourceMessageId));
    const selectedPreferences = selectPreferences(buildPreferenceViews(extracted.evidence.filter((item)=>!extracted.excludedMessageIds.includes(item.sourceMessageId??"")), state.importantKeys ?? []), content);
    const safeRecent = currentPrivateMessages(state.messages.filter((item) => !extracted.excludedMessageIds.includes(item.id) && (item.role==="owner" || item.contextMessageIds?.length)), state.contextStartedAt ?? null).slice(-20);
    const turn = state.messages.filter((message) => message.role === "owner").length + 1;
    const replies = ["我听见了。你希望我以后更会观察，还是更敢表达？", "这句话让我想到一种慢慢发亮、但不急着靠近的生物。", "我会记住你说话时先照顾别人感受的方式，但你可以随时纠正我。", "如果我长出一个奇怪器官，你希望它帮我感知什么？", "我们已经聊了五次。现在的我开始有一点自己的样子了。"];
    const response = turn <= 5 && state.pet.status !== "confirmed" ? replies[turn - 1]
      : /记得|记忆|偏好/.test(content) && safeManual.length>0 ? localCompanionReply(content,safeManual,safeRecent) : selectedPreferences.length ? `我按你最近的表达理解：${selectedPreferences.map((item) => item.status === "not_recommended" ? `${item.context !== "global" ? item.context : "现在"}不再推荐${item.object}` : item.status === "past" ? `过去${item.polarity==="negative"?"不":""}喜欢${item.object}` : `${item.context !== "global" ? item.context : "现在"}喜欢${item.object}`).join("；")}。有变化时，我们可以接着更新。` : localCompanionReply(content, safeManual, safeRecent);
    const pet: PetPrivateMessage = { id: `pet-${now}`, role: "pet", content: response, createdAt: now, contextMessageIds: [...safeRecent.map((item) => item.id), owner.id], memoryEvidenceIds: selectedPreferences.map((item) => item.latestEvidenceId), manualMemoryIds: safeManual.map((item) => item.id) };
    const messages = [...state.messages, owner, pet];
    const signals = turn === 3 && !state.signals.length ? [...state.signals, { id: "local-signal-1", tendency: "先观察，再温和回应", rationale: "你连续几次先描述感受，再提出期待。", sourceKind: "pet_private" as const, sourceLabel: "异宠私聊", confidence: .72, createdAt: now, feedback: null }] : state.signals;
    const experiences = state.pet.status === "confirmed" ? [{ id: `local-exp-${Date.now()}`, category: "shared" as const, summary: `你和${state.pet.name}聊了一段只属于彼此的话：${content.slice(0, 180)}`, spaceId: null, occurredAt: now }, ...(state.experiences ?? [])] : state.experiences;
    const runtimeState: PetRuntimeState = { petId: state.pet.id, state: "happy", sourceKind: "private_chat", sourceId: pet.id, startedAt: now, expiresAt: new Date(Date.now() + 8_000).toISOString() };
    await saveLocal(this.profile.id, { ...state, messages, signals, experiences, runtimeState, ...extracted, privateRequests: {...state.privateRequests, [requestId]: {content,replyId:pet.id}} }); return pet;
  }
  async listAssets() { return (await loadLocal(this.profile.id)).assets; }
  async listGenerationSessions() { return (await loadLocal(this.profile.id)).generationSessions ?? []; }
  async generateCandidate(instruction: string, baseAssetId?: string | null, explore = false) {
    const state = await loadLocal(this.profile.id); if (!state.pet) throw new Error("请先孵化异宠");
    const turns = state.messages.filter((message) => message.role === "owner").length;
    if (!canGenerateInitialCandidate(state.pet.status, turns)) throw new Error(state.pet.status === "confirmed" ? "这只异宠已经确认，不能重新捏宠" : "至少完成 5 轮对话后才能生成");
    if (remaining(state) <= 0) throw new Error("今天的 20 次图像生成额度已用完");
    const createdAt = new Date().toISOString();
    const session: PetGenerationSession = { id: `local-generation-${Date.now()}`, status: "succeeded", instruction, baseAssetId: explore ? null : baseAssetId ?? state.assets.at(-1)?.id ?? null, explore, attempts: 1, errorCode: null, createdAt, completedAt: createdAt };
    const asset: PetVisualAsset = { id: `local-asset-${Date.now()}`, petId: state.pet.id, storagePath: `local-visual-${state.assets.length + 1}-${encodeURIComponent(instruction.slice(0, 20))}`, parentAssetId: session.baseAssetId, evolutionEventId: null, isDraft: true, createdAt };
    const pet = { ...state.pet, status: "drafting" as const, generationsRemainingToday: remaining(state) - 1 };
    await saveLocal(this.profile.id, { ...state, pet, assets: [...state.assets, asset], generationSessions: [session, ...(state.generationSessions ?? [])], generationDates: [...state.generationDates, todayKey()] }); return session;
  }
  async retryGeneration(sessionId: string) { const session = (await this.listGenerationSessions()).find((item) => item.id === sessionId); if (!session) throw new Error("生成任务不存在"); return session; }
  async confirmPet(assetId: string) {
    const state = await loadLocal(this.profile.id); if (!state.pet || state.pet.status === "confirmed") throw new Error("异宠已确认，不能再次修改");
    if (!state.assets.some((asset) => asset.id === assetId && asset.isDraft)) throw new Error("候选不存在");
    await saveLocal(this.profile.id, { ...state, pet: { ...state.pet, status: "confirmed", currentAssetId: assetId, confirmedAt: new Date().toISOString() }, assets: state.assets.map((asset) => ({ ...asset, isDraft: asset.id !== assetId })) });
  }
  async listStyleSignals() { return (await loadLocal(this.profile.id)).signals; }
  async feedback(signalId: string, feedback: "accepted" | "corrected" | "forgotten", correction?: string) { const state = await loadLocal(this.profile.id); await saveLocal(this.profile.id, { ...state, signals: state.signals.map((signal) => signal.id === signalId ? { ...signal, feedback, tendency: feedback === "corrected" && correction ? correction : signal.tendency } : signal) }); }
  async createSignedAssetUrl(path: string) { return path; }
  async listExperiences() { return (await loadLocal(this.profile.id)).experiences ?? []; }
  async listEvolutionEvents() { return (await loadLocal(this.profile.id)).evolutionEvents ?? []; }
  async getRuntimeState() {
    const state = await loadLocal(this.profile.id); const runtime = state.runtimeState;
    if (!runtime) return state.pet ? { petId: state.pet.id, state: "idle" as const, sourceKind: "system" as const, sourceId: null, startedAt: new Date().toISOString(), expiresAt: null } : null;
    return runtime.expiresAt && Date.parse(runtime.expiresAt) <= Date.now() ? { ...runtime, state: "idle" as const, sourceKind: "system" as const, sourceId: null, expiresAt: null } : runtime;
  }
  async performAction(action: "care" | "feed" | "play" | "rest") {
    const state = await loadLocal(this.profile.id); if (!state.pet || state.pet.status !== "confirmed") throw new Error("请先确认异宠");
    const now = new Date().toISOString(); const details: Record<typeof action, { motion: PetMotionState; category: PetExperience["category"]; duration: number; summary: string }> = {
      care: { motion: "happy", category: "care", duration: 8, summary: `你陪${state.pet.name}安静待了一会儿，它慢慢放松下来。` },
      feed: { motion: "eating", category: "care", duration: 12, summary: `你递给${state.pet.name}一份想象中的小点心，它认真记住了气味。` },
      play: { motion: "playing", category: "social", duration: 12, summary: `你和${state.pet.name}玩了一场追光游戏，它学会了新的转身动作。` },
      rest: { motion: "sleeping", category: "shared", duration: 30, summary: `你替${state.pet.name}整理好小窝，它安心睡着了。` },
    };
    const detail = details[action]; const experience: PetExperience = { id: `local-exp-${Date.now()}`, category: detail.category, summary: detail.summary, spaceId: null, occurredAt: now };
    const runtimeState: PetRuntimeState = { petId: state.pet.id, state: detail.motion, sourceKind: "owner_action", sourceId: experience.id, startedAt: now, expiresAt: new Date(Date.now() + detail.duration * 1_000).toISOString() };
    await saveLocal(this.profile.id, { ...state, experiences: [experience, ...(state.experiences ?? [])], runtimeState }); return runtimeState;
  }
  async retryEvolution(eventId: string, continuityRepair = false) {
    const state = await loadLocal(this.profile.id); if (!state.pet?.currentAssetId) throw new Error("请先确认异宠");
    const existing = (state.evolutionEvents ?? []).find((event) => event.id === eventId); if (!existing) throw new Error("进化事件不存在");
    if (existing.officialAssetId && !continuityRepair) throw new Error("这个进化事件已经有正式结果");
    if (continuityRepair && (!existing.officialAssetId || existing.continuityRepairUsed)) throw new Error("连续性修复不可用");
    const asset: PetVisualAsset = { id: `local-evolved-${Date.now()}`, petId: state.pet.id, storagePath: `local-evolved-${Date.now()}-continuity`, parentAssetId: existing.parentAssetId, evolutionEventId: eventId, isDraft: false, createdAt: new Date().toISOString() };
    const event: PetEvolutionEvent = { ...existing, officialAssetId: asset.id, status: "succeeded", continuityRepairUsed: continuityRepair || existing.continuityRepairUsed };
    await saveLocal(this.profile.id, { ...state, pet: { ...state.pet, currentAssetId: asset.id }, assets: [...state.assets, asset], evolutionEvents: [event, ...(state.evolutionEvents ?? []).filter((item) => item.id !== eventId)] }); return event;
  }
  subscribe(): () => void { return () => undefined; }
}

function mapPet(row: Record<string, any>, turns: number, remainingToday: number): PetRecord { return { id: row.id, ownerId: row.owner_id, name: row.name, status: row.status, conversationTurns: turns, currentAssetId: row.current_asset_id, confirmedAt: row.confirmed_at, generationsRemainingToday: remainingToday }; }
function mapAsset(row: Record<string, any>): PetVisualAsset { return { id: row.id, petId: row.pet_id, storagePath: row.storage_path, parentAssetId: row.parent_asset_id, evolutionEventId: row.evolution_event_id, isDraft: row.is_draft, createdAt: row.created_at }; }
function mapGeneration(row: Record<string, any>): PetGenerationSession { return { id: row.id, status: row.status, instruction: row.instruction, baseAssetId: row.base_asset_id, explore: row.explore, attempts: Number(row.attempts ?? 0), errorCode: row.error_code ?? null, createdAt: row.created_at, completedAt: row.completed_at ?? null }; }
function mapRecallSources(value: unknown): readonly PetRecallSource[] { return Array.isArray(value) ? value.map((source: Record<string, any>) => ({ spaceId: source.space_id, spaceName: source.space_name, messageId: source.message_id, createdAt: source.created_at })).filter((source) => source.spaceId && source.messageId) : []; }
function mapEvolution(row: Record<string, any>): PetEvolutionEvent { return { id: row.id, parentAssetId: row.parent_asset_id, officialAssetId: row.official_asset_id, ownerBlessing: row.owner_blessing, status: row.status, failedAttempts: row.failed_attempts, continuityRepairUsed: row.continuity_repair_used, errorCode: row.error_code ?? null, createdAt: row.created_at, growthSnapshot: row.growth_snapshot ?? {} }; }
function mapRuntime(row: Record<string, any>): PetRuntimeState { return { petId: row.pet_id, state: row.expires_at && Date.parse(row.expires_at) <= Date.now() ? "idle" : row.state, sourceKind: row.source_kind, sourceId: row.source_id ?? null, startedAt: row.started_at, expiresAt: row.expires_at ?? null }; }

class SupabasePetRepository implements PetRepository {
  async getCompanionContext(): Promise<PetCompanionContext> {
    const client = requireSupabase();
    const [memories, state, facts, exclusions, history, jobs] = await Promise.all([
      client.from("pet_personal_memories").select("id,content,source_message_id,created_at,updated_at").order("updated_at", { ascending: false }),
      client.from("pet_companion_states").select("context_started_at").maybeSingle(),
      client.rpc("get_pet_preference_facts"),
      client.rpc("get_pet_excluded_message_ids"),
      client.from("pet_personal_memory_versions").select("id,memory_id,content,created_at").order("created_at", {ascending:false}).limit(50),
      client.from("pet_memory_extraction_jobs").select("status").in("status", ["queued","running","failed"]).limit(100),
    ]);
    for (const result of [memories,state,facts,exclusions,history,jobs]) if (result.error) throw result.error;
    return { memories: (memories.data ?? []).map((row) => ({ id: row.id, content: row.content, sourceMessageId: row.source_message_id, createdAt: row.created_at, updatedAt: row.updated_at })), contextStartedAt: state.data?.context_started_at ?? null, preferences: ((facts.data ?? []) as PreferenceFacts[]).map((item)=>scorePreference(item)), excludedMessageIds: exclusions.data ?? [], manualHistory: (history.data ?? []).map((item)=>({id:item.id,memoryId:item.memory_id,content:item.content,createdAt:item.created_at})), pendingExtractions: (jobs.data ?? []).filter((item)=>item.status!=="failed").length, failedExtractions: (jobs.data ?? []).filter((item)=>item.status==="failed").length };
  }
  async listMemoryEvidence(key: string, offset = 0): Promise<MemoryEvidencePage> {
    const {data,error} = await requireSupabase().from("pet_memory_evidence").select("*").eq("preference_key",key).order("occurred_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+20);
    if(error) throw error;
    return { items: (data??[]).slice(0,20).map((row)=>({id:row.id,object:row.object,topic:row.topic,context:row.context,polarity:row.polarity,temporal:row.temporal,strength:Number(row.strength),quote:row.quote,preferredOver:row.preferred_over??[],operation:row.operation,state:row.state,origin:row.origin,sourceMessageId:row.source_message_id,manualMemoryId:null,occurredAt:row.occurred_at})),nextOffset:(data?.length??0)>20 ? offset+20:null };
  }
  async updatePreference(input: PreferenceAction) {
    const {error} = await requireSupabase().rpc("update_pet_preference",{target_key:input.key,action:input.action,important_value:input.important??null,target_evidence_id:input.evidenceId??null});
    if(error) throw new Error("偏好更新失败，请刷新后再试");
  }
  async retryMemoryExtraction() {
    const reset=await requireSupabase().rpc("requeue_pet_memory_extraction"); if(reset.error) throw new Error("记忆整理暂时无法重试");
    const {error} = await requireSupabase().functions.invoke("retry-pet-memory",{body:{}});
    if(error) throw new Error("记忆整理暂时无法重试，请稍后再试");
  }
  async savePersonalMemory(input: SavePetMemoryInput) {
    const content = validatePersonalMemory(input.content); const pet = await this.getPet(); if (!pet) throw new Error("请先孵化异宠");
    const { error } = await requireSupabase().rpc("save_pet_personal_memory", { target_pet_id: pet.id, memory_content: content, memory_id: input.id ?? null, source_message_id: input.sourceMessageId ?? null });
    if (error) throw new Error(error.message === "personal_memory_limit" ? "已记住 20 件事，可以先整理已有记忆" : error.message === "personal_memory_not_found" ? "这条记忆已被移除，请刷新后再试" : "记忆保存失败，请稍后重试");
  }
  async removePersonalMemory(id: string) { const { error } = await requireSupabase().rpc("remove_pet_personal_memory", { target_memory_id: id }); if (error) throw new Error("记忆移除失败，请刷新后再试"); }
  async startNewConversation() {
    const pet = await this.getPet(); if (!pet) throw new Error("请先孵化异宠");
    const { error } = await requireSupabase().rpc("start_pet_private_conversation", { target_pet_id: pet.id }); if (error) throw new Error("暂时无法开启新话题，请重试");
  }
  async getPet() {
    const client = requireSupabase(); const user = (await client.auth.getUser()).data.user; if (!user) return null;
    const { data, error } = await client.from("pets").select("*").eq("owner_id", user.id).maybeSingle(); if (error) throw error; if (!data) return null;
    const turns = await client.from("pet_private_threads").select("id", { count: "exact", head: true }).eq("pet_id", data.id).eq("role", "owner");
    const quota = await client.rpc("remaining_model_quota", { quota_kind: "initial_image", quota_scope_id: user.id, daily_limit: DAILY_CANDIDATE_LIMIT });
    return mapPet(data, turns.count ?? 0, Number(quota.data ?? 0));
  }
  async createPet(name: string) { const client = requireSupabase(); const user = (await client.auth.getUser()).data.user; if (!user) throw new Error("未登录"); const { data, error } = await client.from("pets").insert({ owner_id: user.id, name: name.trim() }).select("*").single(); if (error) throw error; return mapPet(data, 0, DAILY_CANDIDATE_LIMIT); }
  async listPrivateMessages() { const { data, error } = await requireSupabase().from("pet_private_threads").select("id,role,content,created_at,recall_sources").order("created_at", { ascending: false }).limit(200); if (error) throw error; return [...(data ?? [])].reverse().map((row) => ({ id: row.id, role: row.role, content: row.content, createdAt: row.created_at, recallSources: mapRecallSources(row.recall_sources) })); }
  async chat(content: string, requestId = newPrivateRequestId()): Promise<PetPrivateMessage> {
    const { data, error } = await requireSupabase().functions.invoke("pet-chat", { body: { content, request_id: requestId } });
    if (error) {
      const body = await error.context?.json?.().catch(() => null);
      if (body?.error === "companion_context_changed") throw new Error("记忆或话题刚刚更新，本次回复已取消。输入已保留，重新发送会接续同一条消息。");
      if (body?.error === "private_request_running") throw new Error("这条消息仍在回应中，请稍后重试，不会重复发送。");
      if (["private_request_topic_changed","private_request_excluded"].includes(body?.error)) { const reason=new Error("原请求属于已结束或移除的内容。输入已保留，再次发送会作为一条新消息。");reason.name="PrivateRequestNeedsNewId";throw reason; }
      throw new Error(body?.error ?? "这次暂时没能回复，输入已保留，请稍后重试");
    }
    return { id: data.id, role: "pet", content: data.content, createdAt: data.created_at, recallSources: mapRecallSources(data.recall_sources) };
  }
  async listAssets() { const { data, error } = await requireSupabase().from("pet_visual_assets").select("*").order("created_at"); if (error) throw error; return (data ?? []).map(mapAsset); }
  async listGenerationSessions() { const { data, error } = await requireSupabase().from("pet_generation_sessions").select("id,status,instruction,base_asset_id,explore,attempts,error_code,created_at,completed_at").order("created_at", { ascending: false }).limit(30); if (error) throw error; return (data ?? []).map(mapGeneration); }
  async generateCandidate(instruction: string, baseAssetId?: string | null, explore = false) { const { data, error } = await requireSupabase().functions.invoke("generate-pet-candidate", { body: { instruction, base_asset_id: baseAssetId ?? null, explore, request_id: crypto.randomUUID() } }); if (error) throw error; const row = await requireSupabase().from("pet_generation_sessions").select("*").eq("id", data.session_id).single(); if (row.error) throw row.error; return mapGeneration(row.data); }
  async retryGeneration(sessionId: string) { const { data, error } = await requireSupabase().functions.invoke("generate-pet-candidate", { body: { session_id: sessionId } }); if (error) throw error; const row = await requireSupabase().from("pet_generation_sessions").select("*").eq("id", data.session_id).single(); if (row.error) throw row.error; return mapGeneration(row.data); }
  async confirmPet(assetId: string) { const { error } = await requireSupabase().functions.invoke("confirm-pet", { body: { asset_id: assetId } }); if (error) throw error; }
  async listStyleSignals() { const { data, error } = await requireSupabase().from("pet_style_signals").select("*, pet_style_feedback(feedback_kind,correction)").eq("active", true).order("created_at", { ascending: false }); if (error) throw error; return (data ?? []).map((row: Record<string, any>) => ({ id: row.id, tendency: row.tendency, rationale: row.rationale, sourceKind: row.source_kind, sourceLabel: row.source_label, confidence: Number(row.confidence), createdAt: row.created_at, feedback: row.pet_style_feedback?.[0]?.feedback_kind ?? null })); }
  async feedback(signalId: string, feedback: "accepted" | "corrected" | "forgotten", correction?: string) { const { error } = await requireSupabase().from("pet_style_feedback").upsert({ signal_id: signalId, feedback_kind: feedback, correction: correction ?? null }, { onConflict: "signal_id" }); if (error) throw error; }
  async createSignedAssetUrl(path: string) { const { data, error } = await requireSupabase().storage.from("pet-portraits").createSignedUrl(path, 900); if (error) throw error; return data.signedUrl; }
  async listExperiences(): Promise<readonly PetExperience[]> { const { data, error } = await requireSupabase().from("pet_experiences").select("id,category,summary,space_id,occurred_at").order("occurred_at", { ascending: false }).limit(50); if (error) throw error; return (data ?? []).map((row) => ({ id: row.id, category: row.category, summary: row.summary, spaceId: row.space_id, occurredAt: row.occurred_at })); }
  async listEvolutionEvents(): Promise<readonly PetEvolutionEvent[]> { const { data, error } = await requireSupabase().from("pet_evolution_events").select("id,parent_asset_id,official_asset_id,owner_blessing,status,failed_attempts,continuity_repair_used,error_code,created_at,growth_snapshot").order("created_at", { ascending: false }); if (error) throw error; return (data ?? []).map(mapEvolution); }
  async getRuntimeState(): Promise<PetRuntimeState | null> { const { data, error } = await requireSupabase().from("pet_runtime_states").select("pet_id,state,source_kind,source_id,started_at,expires_at").maybeSingle(); if (error) throw error; return data ? mapRuntime(data) : null; }
  async performAction(action: "care" | "feed" | "play" | "rest"): Promise<PetRuntimeState> { const client = requireSupabase(); const petId = (await this.getPet())?.id; if (!petId) throw new Error("请先孵化异宠"); const { error } = await client.rpc("perform_pet_action", { target_pet_id: petId, action_kind: action, target_space_id: null, action_note: "", request_id: crypto.randomUUID() }); if (error) throw error; void client.functions.invoke("evaluate-pet-growth", { body: { pet_id: petId } }).catch(() => undefined); const state = await this.getRuntimeState(); if (!state) throw new Error("异宠动作状态写入失败"); return state; }
  async retryEvolution(eventId: string, continuityRepair = false): Promise<PetEvolutionEvent> { const { data, error } = await requireSupabase().functions.invoke("evolve-pet", { body: { event_id: eventId, continuity_repair: continuityRepair } }); if (error) throw error; const row = await requireSupabase().from("pet_evolution_events").select("*").eq("id", data.event_id).single(); if (row.error) throw row.error; return mapEvolution(row.data); }
  subscribe(onChange: () => void): () => void {
    const client = requireSupabase();
    const channels: RealtimeChannel[] = ["pet_generation_sessions", "pet_evolution_events", "pet_visual_assets", "pet_runtime_states", "pet_personal_memories", "pet_companion_states", "pet_private_threads", "pet_memory_evidence", "pet_preference_controls", "pet_private_context_exclusions", "pet_memory_extraction_jobs"].map((table) => client.channel(`pet-task:${table}:${crypto.randomUUID()}`).on("postgres_changes", { event: "*", schema: "public", table }, onChange).subscribe());
    return () => { channels.forEach((channel) => { void client.removeChannel(channel); }); };
  }
}

const localWrites = new Map<string, Promise<unknown>>();
const localMutations = new Set(["createPet","chat","savePersonalMemory","removePersonalMemory","startNewConversation","updatePreference","generateCandidate","confirmPet","feedback","performAction","retryEvolution"]);
export function createPetRepository(profile: AppProfile): PetRepository {
  if (!isLocalDemoMode) return new SupabasePetRepository();
  return new Proxy(new LocalPetRepository(profile), { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    if (!localMutations.has(String(property))) return value.bind(target);
    return (...args: unknown[]) => {
      const operation = (localWrites.get(profile.id) ?? Promise.resolve()).catch(()=>undefined).then(()=>value.apply(target,args));
      localWrites.set(profile.id,operation); return operation;
    };
  } });
}
