import { chatWithStream, abortPrivateStream, withPrivateRequestCancellation, type PrivateChatOptions, type PrivateReplyRecovery } from "../pets/streamClient";
import { visionError } from "../vision/types";
import type { MessageCursor } from "../chat/messageSync";
import { currentPrivateMessages, localCompanionReply, PERSONAL_MEMORY_LIMIT, validatePersonalMemory } from "../pets/companion";
import { buildPreferenceViews, extractLocalPreferences, preferenceKey, scorePreference, selectPreferences, type MemoryEvidence, type PreferenceFacts } from "../../supabase/functions/_shared/preferenceMemory";
import { excludeLocalContext, recordLocalEvidence } from "../pets/localMemory";
import { newPrivateRequestId } from "../pets/requestId";
import type { MemoryEvidencePage, PreferenceAction, PetCompanionContext, PetPersonalMemory, PetChatMode, SavePetMemoryInput } from "./types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRequestId } from "../lib/uuid";
import { userFacingFunctionError } from "../lib/functionError";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { isLocalDemoMode, requireSupabase } from "../lib/supabase";
import { DAILY_CANDIDATE_LIMIT, canGenerateInitialCandidate } from "../pets/rules";
import type { AppProfile, PetDashboard, PetEvolutionEvent, PetExpectations, PetExperience, PetGenerationSession, PetMotionState, PetPrivateMessage, PetRecallSource, PetRecord, PetRuntimeState, PetVisualAsset, StyleSignal } from "./types";

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
  expectations?: PetExpectations | null;
  personalMemories?: readonly PetPersonalMemory[];
  contextStartedAt?: string | null;
  evidence?: readonly MemoryEvidence[];
  excludedMessageIds?: readonly string[];
  importantKeys?: readonly string[];
  manualHistory?: readonly { id: string; memoryId: string; content: string; createdAt: string; sourceMessageId?: string | null }[];
  privateRequests?: Readonly<Record<string, { content: string; replyId: string; mode: PetChatMode }>>;
}>;

export interface PetRepository {
  getDashboard(): Promise<PetDashboard>;
  getPet(): Promise<PetRecord | null>;
  createPet(name: string): Promise<PetRecord>;
  getExpectations(): Promise<PetExpectations | null>;
  saveExpectations(input: PetExpectations): Promise<PetExpectations>;
  listPrivateMessages(before?: MessageCursor): Promise<readonly PetPrivateMessage[]>;
  stopPrivateReply(requestId: string): Promise<void>;
  chat(content: string, requestKey?: string, mode?: PetChatMode, options?: PrivateChatOptions): Promise<PetPrivateMessage>;
  listMemoryEvidence(key: string, offset?: number): Promise<MemoryEvidencePage>;
  updatePreference(input: PreferenceAction): Promise<void>;
  retryMemoryExtraction(): Promise<void>;
  getCompanionContext(): Promise<PetCompanionContext>;
  savePersonalMemory(input: SavePetMemoryInput): Promise<void>;
  removePersonalMemory(id: string): Promise<void>;
  startNewConversation(): Promise<void>;
  listAssets(): Promise<readonly PetVisualAsset[]>;
  listGenerationSessions(): Promise<readonly PetGenerationSession[]>;
  generateCandidate(instruction: string, baseAssetId?: string | null, explore?: boolean, expectations?: PetExpectations): Promise<PetGenerationSession>;
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
  async getDashboard(): Promise<PetDashboard> {
    const state = await loadLocal(this.profile.id);
    const pet = await this.getPet();
    const currentAsset = pet?.currentAssetId ? state.assets.find((asset) => asset.id === pet.currentAssetId) ?? null : null;
    return { pet, expectations: state.expectations ?? null, currentAsset, runtimeState: await this.getRuntimeState(), latestGeneration: (state.generationSessions ?? [])[0] ?? null };
  }
  async getPet() { const state = await loadLocal(this.profile.id); return state.pet ? { ...state.pet, conversationTurns: state.messages.filter((message) => message.role === "owner").length, generationsRemainingToday: remaining(state) } : null; }
  async createPet(name: string) {
    const state = await loadLocal(this.profile.id); if (state.pet) return state.pet;
    const pet: PetRecord = { id: "local-pet", ownerId: this.profile.id, name: name.trim(), status: "incubating", conversationTurns: 0, currentAssetId: null, confirmedAt: null, generationsRemainingToday: DAILY_CANDIDATE_LIMIT };
    await saveLocal(this.profile.id, { ...state, pet }); return pet;
  }
  async getExpectations() { return (await loadLocal(this.profile.id)).expectations ?? null; }
  async saveExpectations(input: PetExpectations) {
    const state = await loadLocal(this.profile.id);
    if (state.pet?.status === "confirmed") throw new Error("异宠已确认，初始设定已永久锁定");
    const compiled: PetExpectations = {
      ...input,
      personalitySeedPrompt: `${input.name}以${input.personality}为初始倾向，并以${input.companionship}陪伴主人，同时保留自己的判断。`,
      visualSeedPrompt: `原创 2D 全身异宠：${input.appearance}；${input.additionalDescription}`,
      negativeSeedPrompt: `不要现有 IP、文字、水印；${input.excludedFeatures}`,
      seedSummary: `${input.name}是一只${input.personality}、会${input.companionship}的异宠。`,
      version: (state.expectations?.version ?? 0) + 1,
    };
    await saveLocal(this.profile.id, { ...state, expectations: compiled });
    return compiled;
  }
  async listPrivateMessages(before?:MessageCursor) { return (await loadLocal(this.profile.id)).messages.filter(m=>!before||m.createdAt<before.at||(m.createdAt===before.at&&m.id<before.id)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(-50); }
  async stopPrivateReply():Promise<void>{ return; }
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
  async chat(content: string, requestId = newPrivateRequestId(), mode: PetChatMode = "companion") {
    const state = await loadLocal(this.profile.id); if (!state.pet) throw new Error("请先为胚胎命名");
    const previousRequest = state.privateRequests?.[requestId];
    if (previousRequest) { if (previousRequest.content !== content.trim() || previousRequest.mode !== mode) throw new Error("同一请求不能更改内容"); return state.messages.find((item) => item.id === previousRequest.replyId)!; }
    content = content.trim(); if (!content || [...content].length > 4000) throw new Error("私聊消息需为 1 至 4000 字");
    const now = nextLocalTime(state); const owner: PetPrivateMessage = { id: `owner-${now}`, role: "owner", content, createdAt: now, conversationKind: mode, requestKey: requestId, replyStatus: "succeeded" };
    const extracted = recordLocalEvidence(state.evidence ?? [], owner, mode === "companion" ? extractLocalPreferences(content) : [], state.messages, state.excludedMessageIds ?? []);
    const safeManual=(mode === "companion" ? state.personalMemories??[] : []).filter((item)=>!item.sourceMessageId || !extracted.excludedMessageIds.includes(item.sourceMessageId));
    const selectedPreferences = mode === "companion" ? selectPreferences(buildPreferenceViews(extracted.evidence.filter((item)=>!extracted.excludedMessageIds.includes(item.sourceMessageId??"")), state.importantKeys ?? []), content) : [];
    const safeRecent = currentPrivateMessages(state.messages.filter((item) => item.conversationKind === mode && !extracted.excludedMessageIds.includes(item.id) && (item.role==="owner" || item.contextMessageIds?.length)), state.contextStartedAt ?? null).slice(-20);
    const turn = state.messages.filter((message) => message.role === "owner").length + 1;
    const response = mode === "steward" ? "请说出要查询的群聊，或需要主 Agent 处理的事情。"      : /记得|记忆|偏好/.test(content) && safeManual.length>0 ? localCompanionReply(content,safeManual,safeRecent) : selectedPreferences.length ? `我按你最近的表达理解：${selectedPreferences.map((item) => item.status === "not_recommended" ? `${item.context !== "global" ? item.context : "现在"}不再推荐${item.object}` : item.status === "past" ? `过去${item.polarity==="negative"?"不":""}喜欢${item.object}` : `${item.context !== "global" ? item.context : "现在"}喜欢${item.object}`).join("；")}。有变化时，我们可以接着更新。` : localCompanionReply(content, safeManual, safeRecent);
    const pet: PetPrivateMessage = { id: `pet-${now}`, role: "pet", content: response, createdAt: now, conversationKind: mode, inReplyToId: owner.id, contextMessageIds: [...safeRecent.map((item) => item.id), owner.id], memoryEvidenceIds: selectedPreferences.map((item) => item.latestEvidenceId), manualMemoryIds: safeManual.map((item) => item.id) };
    const messages = [...state.messages, owner, pet];
    const runtimeState: PetRuntimeState = { petId: state.pet.id, state: "happy", sourceKind: "private_chat", sourceId: pet.id, startedAt: now, expiresAt: new Date(Date.now() + 8_000).toISOString() };
    await saveLocal(this.profile.id, { ...state, messages, runtimeState, ...extracted, privateRequests: {...state.privateRequests, [requestId]: {content,replyId:pet.id,mode}} }); return pet;
  }
  async listAssets() { return (await loadLocal(this.profile.id)).assets; }
  async listGenerationSessions() { return (await loadLocal(this.profile.id)).generationSessions ?? []; }
  async generateCandidate(instruction: string, baseAssetId?: string | null, explore = false, expectations?: PetExpectations) {
    const state = await loadLocal(this.profile.id); if (!state.pet) throw new Error("请先孵化异宠");
    if (expectations) await this.saveExpectations(expectations);
    const refreshed = await loadLocal(this.profile.id);
    if (!refreshed.expectations) throw new Error("请先填写异宠外观、性格和相处方式");
    if (!refreshed.pet || !canGenerateInitialCandidate(refreshed.pet.status)) throw new Error("这只异宠已经确认，不能重新捏宠");
    if (remaining(refreshed) <= 0) throw new Error("今天的 20 次图像生成额度已用完");
    const createdAt = new Date().toISOString();
    const session: PetGenerationSession = { id: `local-generation-${Date.now()}`, status: "succeeded", instruction, baseAssetId: explore ? null : baseAssetId ?? refreshed.assets.at(-1)?.id ?? null, explore, attempts: 1, errorCode: null, createdAt, completedAt: createdAt };
    const asset: PetVisualAsset = { id: `local-asset-${Date.now()}`, petId: refreshed.pet.id, storagePath: `local-visual-${refreshed.assets.length + 1}-${encodeURIComponent(instruction.slice(0, 20))}`, parentAssetId: session.baseAssetId, evolutionEventId: null, isDraft: true, createdAt };
    const pet = { ...refreshed.pet, status: "drafting" as const, generationsRemainingToday: remaining(refreshed) - 1 };
    await saveLocal(this.profile.id, { ...refreshed, pet, assets: [...refreshed.assets, asset], generationSessions: [session, ...(refreshed.generationSessions ?? [])], generationDates: [...refreshed.generationDates, todayKey()] }); return session;
  }
  async retryGeneration(sessionId: string) { const session = (await this.listGenerationSessions()).find((item) => item.id === sessionId); if (!session) throw new Error("生成任务不存在"); return session; }
  async confirmPet(assetId: string) {
    const state = await loadLocal(this.profile.id); if (!state.pet || state.pet.status === "confirmed") throw new Error("异宠已确认，不能再次修改");
    if (!state.expectations?.personalitySeedPrompt || !state.expectations.visualSeedPrompt) throw new Error("请先完成异宠设定");
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
function mapGeneration(row: Record<string, any>): PetGenerationSession { return { id: row.id, status: row.status, instruction: row.instruction, baseAssetId: row.base_asset_id, explore: row.explore, attempts: Number(row.attempts ?? 0), errorCode: row.error_code ?? null, stage: row.stage ?? undefined, progressLabel: row.progress_label ?? null, retryable: row.retryable ?? undefined, createdAt: row.created_at, completedAt: row.completed_at ?? null }; }
function mapRecallSources(value: unknown): readonly PetRecallSource[] { return Array.isArray(value) ? value.map((source: Record<string, any>) => ({ spaceId: source.space_id, spaceName: source.space_name, messageId: source.message_id, createdAt: source.created_at })).filter((source) => source.spaceId && source.messageId) : []; }
function mapPrivateMessage(row: Record<string, any>): PetPrivateMessage { return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at, imageAssetId:row.image_asset_id??null,imageAssetVersion:row.image_asset_version??null,conversationKind: row.conversation_kind ?? "legacy", contextMessageIds: row.context_message_ids ?? [], memoryEvidenceIds: row.memory_evidence_ids ?? [], manualMemoryIds: row.manual_memory_ids ?? [], requestKey: row.request_key ?? null, replyStatus: row.reply_status ?? null, replyErrorCode: row.reply_error_code ?? null, replyPhaseUpdatedAt: row.reply_phase_updated_at ?? null, inReplyToId: row.in_reply_to_id ?? null, recallSources: mapRecallSources(row.recall_sources) }; }
function mapEvolution(row: Record<string, any>): PetEvolutionEvent { return { id: row.id, parentAssetId: row.parent_asset_id, officialAssetId: row.official_asset_id, ownerBlessing: row.owner_blessing, status: row.status, failedAttempts: row.failed_attempts, continuityRepairUsed: row.continuity_repair_used, errorCode: row.error_code ?? null, createdAt: row.created_at, growthSnapshot: row.growth_snapshot ?? {} }; }
function mapRuntime(row: Record<string, any>): PetRuntimeState { return { petId: row.pet_id, state: row.expires_at && Date.parse(row.expires_at) <= Date.now() ? "idle" : row.state, sourceKind: row.source_kind, sourceId: row.source_id ?? null, startedAt: row.started_at, expiresAt: row.expires_at ?? null }; }

export const PRIVATE_REPLY_RECOVERY_MS=30_000;
/** Read-only reconciliation after a lost response; never invokes pet-chat again. */
export async function recoverPrivateReply(request:PrivateReplyRecovery,signal:AbortSignal):Promise<Record<string,unknown>> {
  const client=requireSupabase(),controller=new AbortController(),mode=request.mode??"companion";
  const abort=()=>controller.abort(typeof signal.reason==="string"?signal.reason:"private_request_stopped");
  if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(()=>controller.abort("private_reply_confirmation_pending"),PRIVATE_REPLY_RECOVERY_MS);
  const stopped=()=>{if(controller.signal.aborted)throw new Error(String(controller.signal.reason??"private_reply_confirmation_pending"));};
  const assertOwner=async()=>{stopped();const session=(await client.auth.getSession()).data.session;stopped();if(session?.user.id!==request.ownerId)throw new Error("account_changed");};
  const guard=async(petId:string,source:Record<string,any>,ids:string[])=>{
    const results=await Promise.all([
      mode==="companion"?client.from("pet_companion_states").select("revision,context_started_at").eq("owner_id",request.ownerId).eq("pet_id",petId).abortSignal(controller.signal).maybeSingle():Promise.resolve({data:null,error:null}),
      mode==="companion"?client.from("pet_private_streams").select("status,revision").eq("owner_id",request.ownerId).eq("pet_id",petId).eq("request_id",request.requestId).abortSignal(controller.signal).maybeSingle():Promise.resolve({data:null,error:null}),
      client.from("pet_private_cancellations").select("request_id").eq("owner_id",request.ownerId).eq("pet_id",petId).eq("request_id",request.requestId).abortSignal(controller.signal).maybeSingle(),
      client.from("pet_private_context_exclusions").select("message_id").eq("owner_id",request.ownerId).eq("pet_id",petId).in("message_id",ids).abortSignal(controller.signal),
    ]);
    await assertOwner();
    if(results.some(result=>result.error))throw new Error("private_reply_confirmation_unavailable");
    const [state,stream,cancellation,exclusions]=results;
    if(cancellation.data||stream.data?.status==="cancelled")throw new Error("private_request_stopped");
    if(exclusions.data?.length)throw new Error("private_request_excluded");
    // The server applies companion topic/revision fences only to companion turns.
    if(mode!=="companion")return;
    const expected=request.revision??stream.data?.revision;
    if(!Number.isSafeInteger(expected))throw new Error("private_reply_confirmation_unavailable");
    if(stream.data?.status==="invalidated"||(state.data?.revision??0)!==expected||(stream.data&&stream.data.revision!==expected))throw new Error("companion_context_changed");
    // Conservatively reject a timestamp in the same millisecond as a new topic.
    if(state.data?.context_started_at&&Date.parse(source.created_at)<=Date.parse(state.data.context_started_at))throw new Error("private_request_topic_changed");
  };
  const poll=async()=>{
    for(;;){
      await assertOwner();
      const row=await client.from("pet_private_requests").select("pet_id,owner_message_id,reply_message_id").eq("owner_id",request.ownerId).eq("client_request_id",request.requestId).abortSignal(controller.signal).maybeSingle();
      await assertOwner();
      if(row.error||!row.data)throw new Error("private_reply_confirmation_unavailable");
      const req=row.data;
      const sourceResult=await client.from("pet_private_threads").select("id,created_at,conversation_kind,reply_status,reply_error_code").eq("owner_id",request.ownerId).eq("pet_id",req.pet_id).eq("id",req.owner_message_id).eq("role","owner").eq("request_key",request.requestId).abortSignal(controller.signal).maybeSingle();
      await assertOwner();
      const source=sourceResult.data;
      if(sourceResult.error||!source||source.conversation_kind!==mode)throw new Error("private_reply_confirmation_unavailable");
      const ids=[source.id,...(req.reply_message_id?[req.reply_message_id]:[])];
      await guard(req.pet_id,source,ids);
      if(req.reply_message_id){
        const reply=await client.from("pet_private_threads").select("*").eq("owner_id",request.ownerId).eq("pet_id",req.pet_id).eq("id",req.reply_message_id).eq("role","pet").eq("in_reply_to_id",source.id).eq("conversation_kind",mode).abortSignal(controller.signal).maybeSingle();
        await assertOwner();
        if(reply.error||!reply.data)throw new Error("private_reply_confirmation_unavailable");
        // Recheck after content download, including every source used by it.
        await guard(req.pet_id,source,[...ids,...(reply.data.context_message_ids??[])]);
        return reply.data;
      }
      if(source.reply_status==="failed")throw new Error(source.reply_error_code??"private_reply_failed");
      await new Promise<void>((resolve,reject)=>{
        const stop=()=>{clearTimeout(wait);controller.signal.removeEventListener("abort",stop);reject(new Error(String(controller.signal.reason)));};
        const wait=setTimeout(()=>{controller.signal.removeEventListener("abort",stop);resolve();},2000);
        controller.signal.addEventListener("abort",stop,{once:true});if(controller.signal.aborted)stop();
      });
    }
  };
  let rejectAbort:()=>void=()=>{};
  try{
    // abortSignal cancels actual reads; the race also bounds an uncooperative
    // transport or a pending Auth refresh that does not accept AbortSignal.
    const deadline=new Promise<never>((_resolve,reject)=>{rejectAbort=()=>reject(new Error(String(controller.signal.reason)));controller.signal.addEventListener("abort",rejectAbort,{once:true});if(controller.signal.aborted)rejectAbort();});
    return await Promise.race([poll(),deadline]);
  }finally{clearTimeout(timer);signal.removeEventListener("abort",abort);controller.signal.removeEventListener("abort",rejectAbort);}
}

export function privateReplyErrorMessage(code:string):string {
  if(code==="text_model_timeout")return "模型思考超时，问题已保留，可以沿用原请求重试。";
  if(code==="text_model_network_error")return "模型服务暂时无法连接，问题已保留，可以稍后重试。";
  if(code==="text_model_provider_session_required"||code==="text_model_http_400")return "文本服务拒绝了请求，需要修复服务连接。问题已保留，恢复后可重试。";
  if(code.startsWith("quota_exceeded"))return "今天的异宠回答额度已经用完，问题已保留。";
  if(code==="account_changed"||code==="unauthenticated")return "账号已切换或登录已过期，请重新打开对话。";
  if(code==="companion_context_changed")return "记忆刚刚更新，旧回复已取消。同一消息可以重试。";
  if(code==="private_request_stopped")return "已停止这次回答，已创建的事项仍然保留。";
  if(code==="private_reply_confirmation_pending")return "等待确认已超时，服务器可能仍在处理；可以稍后查看或沿用原请求重试。";
  if(code==="private_reply_confirmation_unavailable")return "连接中断，暂时无法核对回答；问题已保留，可以稍后沿用原请求重试。";
  if(/private_(request_running|conversation_busy)/.test(code))return "对话中还有回答正在处理，请稍后重试。";
  return "回答中断，可以重试这条消息，不会重复发送。";
}

class SupabasePetRepository implements PetRepository {
  private async getOwnedPetId(): Promise<string | null> {
    const client = requireSupabase();
    const user = (await client.auth.getUser()).data.user;
    if (!user) return null;
    const { data, error } = await client
      .from("pets")
      .select("id")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  }

  async getDashboard(): Promise<PetDashboard> {
    const { data, error } = await requireSupabase().rpc("get_my_pet_dashboard");
    if (error) throw error;
    const value = (data ?? {}) as Record<string, any>;
    const petRow = value.pet as Record<string, any> | null | undefined;
    const expectation = value.expectations as Record<string, any> | null | undefined;
    return {
      pet: petRow ? mapPet(petRow, Number(petRow.conversation_turns ?? 0), Number(petRow.generations_remaining_today ?? DAILY_CANDIDATE_LIMIT)) : null,
      expectations: expectation ? { name: petRow?.name ?? "", appearance: expectation.appearance_expectation ?? "", personality: expectation.personality_expectation ?? "", companionship: expectation.companionship_expectation ?? "", excludedFeatures: expectation.excluded_features ?? "", additionalDescription: expectation.additional_description ?? "", personalitySeedPrompt: expectation.personality_seed_prompt ?? null, visualSeedPrompt: expectation.visual_seed_prompt ?? null, negativeSeedPrompt: expectation.negative_seed_prompt ?? null, seedSummary: expectation.seed_summary ?? null, version: Number(expectation.version ?? 0) } : null,
      currentAsset: value.current_asset ? mapAsset(value.current_asset) : null,
      runtimeState: value.runtime_state ? mapRuntime(value.runtime_state) : null,
      latestGeneration: value.latest_generation ? mapGeneration(value.latest_generation) : null,
    };
  }

  async getPet() {
    const client = requireSupabase(); const user = (await client.auth.getUser()).data.user; if (!user) return null;
    const { data, error } = await client.from("pets").select("*").eq("owner_id", user.id).maybeSingle(); if (error) throw error; if (!data) return null;
    const turns = await client.from("pet_private_threads").select("id", { count: "exact", head: true }).eq("pet_id", data.id).eq("role", "owner");
    const quota = await client.rpc("remaining_model_quota", { quota_kind: "initial_image", quota_scope_id: user.id, daily_limit: DAILY_CANDIDATE_LIMIT });
    return mapPet(data, turns.count ?? 0, Number(quota.data ?? 0));
  }
  async createPet(name: string) { const client = requireSupabase(); const user = (await client.auth.getUser()).data.user; if (!user) throw new Error("未登录"); const { data, error } = await client.from("pets").insert({ owner_id: user.id, name: name.trim() }).select("*").single(); if (error) throw error; return mapPet(data, 0, DAILY_CANDIDATE_LIMIT); }
  async getExpectations(): Promise<PetExpectations | null> {
    const { data, error } = await requireSupabase().from("pet_expectation_drafts").select("*").maybeSingle();
    if (error) throw error; if (!data) return null;
    const pet = await this.getPet();
    return { name: pet?.name ?? "", appearance: data.appearance_expectation, personality: data.personality_expectation, companionship: data.companionship_expectation, excludedFeatures: data.excluded_features, additionalDescription: data.additional_description, personalitySeedPrompt: data.personality_seed_prompt, visualSeedPrompt: data.visual_seed_prompt, negativeSeedPrompt: data.negative_seed_prompt, seedSummary: data.seed_summary, version: data.version };
  }
  async saveExpectations(input: PetExpectations): Promise<PetExpectations> {
    const client = requireSupabase(); const user = (await client.auth.getUser()).data.user; if (!user) throw new Error("未登录");
    const pet = await this.getPet(); if (!pet) throw new Error("请先为异宠命名"); if (pet.status === "confirmed") throw new Error("异宠已确认，初始设定已永久锁定");
    const { data, error } = await client.from("pet_expectation_drafts").upsert({ pet_id: pet.id, owner_id: user.id, appearance_expectation: input.appearance.trim(), personality_expectation: input.personality.trim(), companionship_expectation: input.companionship.trim(), excluded_features: input.excludedFeatures.trim(), additional_description: input.additionalDescription.trim(), version: (input.version ?? 0) + 1, updated_at: new Date().toISOString() }, { onConflict: "pet_id" }).select("*").single();
    if (error) throw error;
    return { ...input, personalitySeedPrompt: data.personality_seed_prompt, visualSeedPrompt: data.visual_seed_prompt, negativeSeedPrompt: data.negative_seed_prompt, seedSummary: data.seed_summary, version: data.version };
  }
  async listPrivateMessages(before?:MessageCursor) {
    const pet=await this.getPet(); if(!pet)return [];
    const {data,error}=await requireSupabase().rpc("list_pet_private_history",{p_pet:pet.id,p_before_at:before?.at??null,p_before_id:before?.id??null,p_limit:before?50:200});
    if(error)throw error;return (data??[]).reverse().map(mapPrivateMessage);
  }
  async stopPrivateReply(requestId:string):Promise<void>{
    const pet=await this.getPet();if(!pet)throw new Error("异宠尚未建立");
    const {error}=await requireSupabase().rpc("stop_pet_private_reply",{p_pet:pet.id,p_request:requestId});
    if(error)throw error;abortPrivateStream(requestId);
  }
  async getCompanionContext(): Promise<PetCompanionContext> {
    const client = requireSupabase();
    const [memories, state, facts, exclusions, history, jobs] = await Promise.all([
      client.from("pet_personal_memories").select("id,content,source_message_id,created_at,updated_at").order("updated_at", { ascending: false }),
      client.from("pet_companion_states").select("context_started_at,revision").maybeSingle(),
      client.rpc("get_pet_preference_facts"),
      client.rpc("get_pet_excluded_message_ids"),
      client.from("pet_personal_memory_versions").select("id,memory_id,content,created_at").order("created_at", {ascending:false}).limit(50),
      client.from("pet_memory_extraction_jobs").select("status").in("status", ["queued","running","failed"]).limit(100),
    ]);
    for (const result of [memories,state,facts,exclusions,history,jobs]) if (result.error) throw result.error;
    return { memories: (memories.data ?? []).map((row) => ({ id: row.id, content: row.content, sourceMessageId: row.source_message_id, createdAt: row.created_at, updatedAt: row.updated_at })), contextStartedAt: state.data?.context_started_at ?? null, revision:state.data?.revision ?? 0, preferences: ((facts.data ?? []) as PreferenceFacts[]).map((item)=>scorePreference(item)), excludedMessageIds: exclusions.data ?? [], manualHistory: (history.data ?? []).map((item)=>({id:item.id,memoryId:item.memory_id,content:item.content,createdAt:item.created_at})), pendingExtractions: (jobs.data ?? []).filter((item)=>item.status!=="failed").length, failedExtractions: (jobs.data ?? []).filter((item)=>item.status==="failed").length };
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
  async chat(content: string, requestKey = createRequestId(), mode: PetChatMode = "companion", options?:PrivateChatOptions): Promise<PetPrivateMessage> { const client = requireSupabase();
    if(options?.signal?.aborted)throw new Error("已停止这次回答。");
    if(Boolean(options?.imageAssetId)!==Boolean(options?.imageAssetVersion)||options?.imageAssetId&&(mode!=="companion"||!Number.isSafeInteger(options.imageAssetVersion)||options.imageAssetVersion!<1))throw new Error("图片请求不完整，请重新选择。");
    if(mode==="companion"&&options?.onEvent&&!options.imageAssetId){
      try{return mapPrivateMessage(await chatWithStream(content,requestKey,options,recoverPrivateReply));}
      catch(reason){const code=reason instanceof Error?reason.message:"private_stream_interrupted";
        if(["private_request_excluded","private_request_topic_changed","private_request_stopped"].includes(code)){const error=new Error(code==="private_request_stopped"?"已停止这次回答，已创建的事项仍然保留。":"原消息已停用，重新发送会建立新请求。");error.name="PrivateRequestNeedsNewId";throw error;}
        throw new Error(privateReplyErrorMessage(code));
      }
    }
    try{return await withPrivateRequestCancellation(requestKey,options?.signal,async signal=>{
      const stopped=()=>{if(signal.aborted)throw new Error(String(signal.reason??"private_request_stopped"));};
      stopped();const session=(await client.auth.getSession()).data.session;if(!session)throw new Error("unauthenticated");stopped();
      const result=await client.functions.invoke("pet-chat",{body:{content,request_id:requestKey,mode,...(options?.imageAssetId?{image_asset_id:options.imageAssetId,image_asset_version:options.imageAssetVersion}:{})},headers:{Authorization:`Bearer ${session.access_token}`},signal}).catch(error=>({data:null,error}));
      stopped();
      if(result.error){
        let code:string|undefined;
        try{code=(await result.error.context?.json())?.error;}catch{}
        stopped();
        // An explicit business rejection is final. Only a lost transport response
        // may be reconciled, and image requests retain their vision-specific path.
        if(code)throw new Error(code);
        const status=result.error.context?.status;
        if(options?.imageAssetId||(status>=400&&status<500))throw new Error(status===401?"unauthenticated":"private_reply_failed");
        options?.onEvent?.({type:"phase",phase:"confirming",request_id:requestKey});
        const reply=await recoverPrivateReply({ownerId:session.user.id,requestId:requestKey,mode,revision:options?.contextRevision},signal);
        stopped();options?.onEvent?.({type:"done",request_id:requestKey,message:reply});
        // Reading an existing steward reply must not dispatch its action again.
        return {...mapPrivateMessage(reply),conversationKind:mode,agentRequestId:reply.agent_request_id as string??null,targetSpaceName:reply.target_space_name as string??null};
      }
      if((await client.auth.getSession()).data.session?.user.id!==session.user.id)throw new Error("account_changed");stopped();
      const data=result.data;
      if(!options?.imageAssetId&&data.agent_request_id)void client.functions.invoke("space-agent",{body:{request_id:data.agent_request_id}}).catch(()=>undefined);
      return {...mapPrivateMessage(data),conversationKind:mode,agentRequestId:data.agent_request_id??null,targetSpaceName:data.target_space_name??null};
    });}catch(reason){
      const code=reason instanceof Error?reason.message:"private_reply_failed";
      if(["private_request_excluded","private_request_topic_changed","private_request_stopped"].includes(code)){const error=new Error(code==="private_request_stopped"?privateReplyErrorMessage(code):"这条原消息已停用或话题已更新，重新发送将开始新的请求。");error.name="PrivateRequestNeedsNewId";throw error;}
      if(code.startsWith("vision_"))throw new Error(visionError(new Error(code)));
      throw new Error(privateReplyErrorMessage(code));
    }
  }
  async listAssets() { const petId = await this.getOwnedPetId(); if (!petId) return []; const { data, error } = await requireSupabase().from("pet_visual_assets").select("*").eq("pet_id", petId).order("created_at"); if (error) throw error; return (data ?? []).map(mapAsset); }
  async listGenerationSessions() { const petId = await this.getOwnedPetId(); if (!petId) return []; const { data, error } = await requireSupabase().from("pet_generation_sessions").select("id,status,instruction,base_asset_id,explore,attempts,error_code,stage,progress_label,retryable,created_at,completed_at").eq("pet_id", petId).order("created_at", { ascending: false }).limit(30); if (error) throw error; return (data ?? []).map(mapGeneration); }
  async generateCandidate(instruction: string, baseAssetId?: string | null, explore = false, expectations?: PetExpectations) { const { data, error } = await requireSupabase().functions.invoke("generate-pet-candidate", { body: { instruction: instruction.trim() || undefined, base_asset_id: baseAssetId ?? null, explore, expectations: expectations ? { appearance: expectations.appearance, personality: expectations.personality, companionship: expectations.companionship, excluded_features: expectations.excludedFeatures, additional_description: expectations.additionalDescription } : undefined, request_id: createRequestId() } }); if (error) throw await userFacingFunctionError(error, "异宠生成请求失败，请稍后重试。"); const row = await requireSupabase().from("pet_generation_sessions").select("*").eq("id", data.session_id).single(); if (row.error) throw row.error; return mapGeneration(row.data); }
  async retryGeneration(sessionId: string) { const { data, error } = await requireSupabase().functions.invoke("generate-pet-candidate", { body: { session_id: sessionId } }); if (error) throw await userFacingFunctionError(error, "异宠生成重试失败，请稍后再试。"); const row = await requireSupabase().from("pet_generation_sessions").select("*").eq("id", data.session_id).single(); if (row.error) throw row.error; return mapGeneration(row.data); }
  async confirmPet(assetId: string) { const { error } = await requireSupabase().functions.invoke("confirm-pet", { body: { asset_id: assetId } }); if (error) throw await userFacingFunctionError(error, "异宠确认失败，请稍后重试。"); }
  async listStyleSignals() { const petId = await this.getOwnedPetId(); if (!petId) return []; const { data, error } = await requireSupabase().from("pet_style_signals").select("*, pet_style_feedback(feedback_kind,correction)").eq("pet_id", petId).eq("active", true).order("created_at", { ascending: false }); if (error) throw error; return (data ?? []).map((row: Record<string, any>) => ({ id: row.id, tendency: row.tendency, rationale: row.rationale, sourceKind: row.source_kind, sourceLabel: row.source_label, confidence: Number(row.confidence), createdAt: row.created_at, feedback: row.pet_style_feedback?.[0]?.feedback_kind ?? null })); }
  async feedback(signalId: string, feedback: "accepted" | "corrected" | "forgotten", correction?: string) { const { error } = await requireSupabase().from("pet_style_feedback").upsert({ signal_id: signalId, feedback_kind: feedback, correction: correction ?? null }, { onConflict: "signal_id" }); if (error) throw error; }
  async createSignedAssetUrl(path: string) { const { data, error } = await requireSupabase().storage.from("pet-portraits").createSignedUrl(path, 900); if (error) throw error; return data.signedUrl; }
  async listExperiences(): Promise<readonly PetExperience[]> { const petId = await this.getOwnedPetId(); if (!petId) return []; const { data, error } = await requireSupabase().from("pet_experiences").select("id,category,summary,space_id,occurred_at").eq("pet_id", petId).order("occurred_at", { ascending: false }).limit(50); if (error) throw error; return (data ?? []).map((row) => ({ id: row.id, category: row.category, summary: row.summary, spaceId: row.space_id, occurredAt: row.occurred_at })); }
  async listEvolutionEvents(): Promise<readonly PetEvolutionEvent[]> { const petId = await this.getOwnedPetId(); if (!petId) return []; const { data, error } = await requireSupabase().from("pet_evolution_events").select("id,parent_asset_id,official_asset_id,owner_blessing,status,failed_attempts,continuity_repair_used,error_code,created_at,growth_snapshot").eq("pet_id", petId).order("created_at", { ascending: false }); if (error) throw error; return (data ?? []).map(mapEvolution); }
  async getRuntimeState(): Promise<PetRuntimeState | null> { const petId = await this.getOwnedPetId(); if (!petId) return null; const { data, error } = await requireSupabase().from("pet_runtime_states").select("pet_id,state,source_kind,source_id,started_at,expires_at").eq("pet_id", petId).maybeSingle(); if (error) throw error; return data ? mapRuntime(data) : null; }
  async performAction(action: "care" | "feed" | "play" | "rest"): Promise<PetRuntimeState> { const client = requireSupabase(); const petId = (await this.getPet())?.id; if (!petId) throw new Error("请先孵化异宠"); const { error } = await client.rpc("perform_pet_action", { target_pet_id: petId, action_kind: action, target_space_id: null, action_note: "", request_id: createRequestId() }); if (error) throw error; void client.functions.invoke("evaluate-pet-growth", { body: { pet_id: petId } }).catch(() => undefined); const state = await this.getRuntimeState(); if (!state) throw new Error("异宠动作状态写入失败"); return state; }
  async retryEvolution(eventId: string, continuityRepair = false): Promise<PetEvolutionEvent> { const { data, error } = await requireSupabase().functions.invoke("evolve-pet", { body: { event_id: eventId, continuity_repair: continuityRepair } }); if (error) throw error; const row = await requireSupabase().from("pet_evolution_events").select("*").eq("id", data.event_id).single(); if (row.error) throw row.error; return mapEvolution(row.data); }
  subscribe(onChange: () => void): () => void {
    const client = requireSupabase();
    const channels: RealtimeChannel[] = ["pet_generation_sessions", "pet_evolution_events", "pet_visual_assets", "pet_runtime_states", "pet_private_threads", "pet_personal_memories", "pet_companion_states", "pet_memory_evidence", "pet_preference_controls", "pet_private_context_exclusions", "pet_memory_extraction_jobs"].map((table) => client.channel(`pet-task:${table}:${createRequestId()}`).on("postgres_changes", { event: "*", schema: "public", table }, onChange).subscribe());
    return () => { channels.forEach((channel) => { void client.removeChannel(channel); }); };
  }
}

const localWrites = new Map<string, Promise<unknown>>();
const localMutations = new Set(["createPet","saveExpectations","chat","savePersonalMemory","removePersonalMemory","startNewConversation","updatePreference","generateCandidate","confirmPet","feedback","performAction","retryEvolution"]);
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
