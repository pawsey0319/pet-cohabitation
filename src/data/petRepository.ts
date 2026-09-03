import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRequestId } from "../lib/uuid";
import { userFacingFunctionError } from "../lib/functionError";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { isLocalDemoMode, requireSupabase } from "../lib/supabase";
import { DAILY_CANDIDATE_LIMIT, canGenerateInitialCandidate } from "../pets/rules";
import type { AppProfile, PetEvolutionEvent, PetExpectations, PetExperience, PetGenerationSession, PetMotionState, PetPrivateMessage, PetRecallSource, PetRecord, PetRuntimeState, PetVisualAsset, StyleSignal } from "./types";

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
}>;

export interface PetRepository {
  getPet(): Promise<PetRecord | null>;
  createPet(name: string): Promise<PetRecord>;
  getExpectations(): Promise<PetExpectations | null>;
  saveExpectations(input: PetExpectations): Promise<PetExpectations>;
  listPrivateMessages(): Promise<readonly PetPrivateMessage[]>;
  chat(content: string, requestKey?: string): Promise<PetPrivateMessage>;
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

async function loadLocal(): Promise<LocalPetState> {
  const raw = await AsyncStorage.getItem(LOCAL_PET_KEY); if (!raw) return emptyLocal;
  try { return JSON.parse(raw) as LocalPetState; } catch { return emptyLocal; }
}
async function saveLocal(state: LocalPetState): Promise<void> { await AsyncStorage.setItem(LOCAL_PET_KEY, JSON.stringify(state)); }
function todayKey(): string { return new Date().toISOString().slice(0, 10); }
function remaining(state: LocalPetState): number { return Math.max(0, DAILY_CANDIDATE_LIMIT - state.generationDates.filter((value) => value === todayKey()).length); }

class LocalPetRepository implements PetRepository {
  constructor(private readonly profile: AppProfile) {}
  async getPet() { const state = await loadLocal(); return state.pet ? { ...state.pet, conversationTurns: state.messages.filter((message) => message.role === "owner").length, generationsRemainingToday: remaining(state) } : null; }
  async createPet(name: string) {
    const state = await loadLocal(); if (state.pet) return state.pet;
    const pet: PetRecord = { id: "local-pet", ownerId: this.profile.id, name: name.trim(), status: "incubating", conversationTurns: 0, currentAssetId: null, confirmedAt: null, generationsRemainingToday: DAILY_CANDIDATE_LIMIT };
    await saveLocal({ ...state, pet }); return pet;
  }
  async getExpectations() { return (await loadLocal()).expectations ?? null; }
  async saveExpectations(input: PetExpectations) {
    const state = await loadLocal();
    if (state.pet?.status === "confirmed") throw new Error("异宠已确认，初始设定已永久锁定");
    const compiled: PetExpectations = {
      ...input,
      personalitySeedPrompt: `${input.name}以${input.personality}为初始倾向，并以${input.companionship}陪伴主人，同时保留自己的判断。`,
      visualSeedPrompt: `原创 2D 全身异宠：${input.appearance}；${input.additionalDescription}`,
      negativeSeedPrompt: `不要现有 IP、文字、水印；${input.excludedFeatures}`,
      seedSummary: `${input.name}是一只${input.personality}、会${input.companionship}的异宠。`,
      version: (state.expectations?.version ?? 0) + 1,
    };
    await saveLocal({ ...state, expectations: compiled });
    return compiled;
  }
  async listPrivateMessages() { return (await loadLocal()).messages; }
  async chat(content: string, requestKey = `local-${Date.now()}`) {
    const state = await loadLocal(); if (!state.pet) throw new Error("请先为胚胎命名");
    const now = new Date().toISOString(); const owner: PetPrivateMessage = { id: `owner-${Date.now()}`, role: "owner", content, createdAt: now, requestKey, replyStatus: "succeeded", replyPhaseUpdatedAt: now };
    const turn = state.messages.filter((message) => message.role === "owner").length + 1;
    const replies = ["我听见了。你希望我以后更会观察，还是更敢表达？", "这句话让我想到一种慢慢发亮、但不急着靠近的生物。", "我会记住你说话时先照顾别人感受的方式，但你可以随时纠正我。", "如果我长出一个奇怪器官，你希望它帮我感知什么？", "我们已经聊了五次。现在的我开始有一点自己的样子了。"];
    const pet: PetPrivateMessage = { id: `pet-${Date.now()}`, role: "pet", content: replies[Math.min(turn - 1, replies.length - 1)], createdAt: new Date(Date.now() + 1).toISOString() };
    const messages = [...state.messages, owner, pet];
    const signals = turn === 3 && !state.signals.length ? [...state.signals, { id: "local-signal-1", tendency: "先观察，再温和回应", rationale: "你连续几次先描述感受，再提出期待。", sourceKind: "pet_private" as const, sourceLabel: "异宠私聊", confidence: .72, createdAt: now, feedback: null }] : state.signals;
    const experiences = state.pet.status === "confirmed" ? [{ id: `local-exp-${Date.now()}`, category: "shared" as const, summary: `你和${state.pet.name}聊了一段只属于彼此的话：${content.slice(0, 180)}`, spaceId: null, occurredAt: now }, ...(state.experiences ?? [])] : state.experiences;
    const runtimeState: PetRuntimeState = { petId: state.pet.id, state: "happy", sourceKind: "private_chat", sourceId: pet.id, startedAt: now, expiresAt: new Date(Date.now() + 8_000).toISOString() };
    await saveLocal({ ...state, messages, signals, experiences, runtimeState }); return pet;
  }
  async listAssets() { return (await loadLocal()).assets; }
  async listGenerationSessions() { return (await loadLocal()).generationSessions ?? []; }
  async generateCandidate(instruction: string, baseAssetId?: string | null, explore = false, expectations?: PetExpectations) {
    const state = await loadLocal(); if (!state.pet) throw new Error("请先孵化异宠");
    if (expectations) await this.saveExpectations(expectations);
    const refreshed = await loadLocal();
    if (!refreshed.expectations) throw new Error("请先填写异宠外观、性格和相处方式");
    if (!refreshed.pet || !canGenerateInitialCandidate(refreshed.pet.status)) throw new Error("这只异宠已经确认，不能重新捏宠");
    if (remaining(refreshed) <= 0) throw new Error("今天的 20 次图像生成额度已用完");
    const createdAt = new Date().toISOString();
    const session: PetGenerationSession = { id: `local-generation-${Date.now()}`, status: "succeeded", instruction, baseAssetId: explore ? null : baseAssetId ?? refreshed.assets.at(-1)?.id ?? null, explore, attempts: 1, errorCode: null, createdAt, completedAt: createdAt };
    const asset: PetVisualAsset = { id: `local-asset-${Date.now()}`, petId: refreshed.pet.id, storagePath: `local-visual-${refreshed.assets.length + 1}-${encodeURIComponent(instruction.slice(0, 20))}`, parentAssetId: session.baseAssetId, evolutionEventId: null, isDraft: true, createdAt };
    const pet = { ...refreshed.pet, status: "drafting" as const, generationsRemainingToday: remaining(refreshed) - 1 };
    await saveLocal({ ...refreshed, pet, assets: [...refreshed.assets, asset], generationSessions: [session, ...(refreshed.generationSessions ?? [])], generationDates: [...refreshed.generationDates, todayKey()] }); return session;
  }
  async retryGeneration(sessionId: string) { const session = (await this.listGenerationSessions()).find((item) => item.id === sessionId); if (!session) throw new Error("生成任务不存在"); return session; }
  async confirmPet(assetId: string) {
    const state = await loadLocal(); if (!state.pet || state.pet.status === "confirmed") throw new Error("异宠已确认，不能再次修改");
    if (!state.expectations?.personalitySeedPrompt || !state.expectations.visualSeedPrompt) throw new Error("请先完成异宠设定");
    if (!state.assets.some((asset) => asset.id === assetId && asset.isDraft)) throw new Error("候选不存在");
    await saveLocal({ ...state, pet: { ...state.pet, status: "confirmed", currentAssetId: assetId, confirmedAt: new Date().toISOString() }, assets: state.assets.map((asset) => ({ ...asset, isDraft: asset.id !== assetId })) });
  }
  async listStyleSignals() { return (await loadLocal()).signals; }
  async feedback(signalId: string, feedback: "accepted" | "corrected" | "forgotten", correction?: string) { const state = await loadLocal(); await saveLocal({ ...state, signals: state.signals.map((signal) => signal.id === signalId ? { ...signal, feedback, tendency: feedback === "corrected" && correction ? correction : signal.tendency } : signal) }); }
  async createSignedAssetUrl(path: string) { return path; }
  async listExperiences() { return (await loadLocal()).experiences ?? []; }
  async listEvolutionEvents() { return (await loadLocal()).evolutionEvents ?? []; }
  async getRuntimeState() {
    const state = await loadLocal(); const runtime = state.runtimeState;
    if (!runtime) return state.pet ? { petId: state.pet.id, state: "idle" as const, sourceKind: "system" as const, sourceId: null, startedAt: new Date().toISOString(), expiresAt: null } : null;
    return runtime.expiresAt && Date.parse(runtime.expiresAt) <= Date.now() ? { ...runtime, state: "idle" as const, sourceKind: "system" as const, sourceId: null, expiresAt: null } : runtime;
  }
  async performAction(action: "care" | "feed" | "play" | "rest") {
    const state = await loadLocal(); if (!state.pet || state.pet.status !== "confirmed") throw new Error("请先确认异宠");
    const now = new Date().toISOString(); const details: Record<typeof action, { motion: PetMotionState; category: PetExperience["category"]; duration: number; summary: string }> = {
      care: { motion: "happy", category: "care", duration: 8, summary: `你陪${state.pet.name}安静待了一会儿，它慢慢放松下来。` },
      feed: { motion: "eating", category: "care", duration: 12, summary: `你递给${state.pet.name}一份想象中的小点心，它认真记住了气味。` },
      play: { motion: "playing", category: "social", duration: 12, summary: `你和${state.pet.name}玩了一场追光游戏，它学会了新的转身动作。` },
      rest: { motion: "sleeping", category: "shared", duration: 30, summary: `你替${state.pet.name}整理好小窝，它安心睡着了。` },
    };
    const detail = details[action]; const experience: PetExperience = { id: `local-exp-${Date.now()}`, category: detail.category, summary: detail.summary, spaceId: null, occurredAt: now };
    const runtimeState: PetRuntimeState = { petId: state.pet.id, state: detail.motion, sourceKind: "owner_action", sourceId: experience.id, startedAt: now, expiresAt: new Date(Date.now() + detail.duration * 1_000).toISOString() };
    await saveLocal({ ...state, experiences: [experience, ...(state.experiences ?? [])], runtimeState }); return runtimeState;
  }
  async retryEvolution(eventId: string, continuityRepair = false) {
    const state = await loadLocal(); if (!state.pet?.currentAssetId) throw new Error("请先确认异宠");
    const existing = (state.evolutionEvents ?? []).find((event) => event.id === eventId); if (!existing) throw new Error("进化事件不存在");
    if (existing.officialAssetId && !continuityRepair) throw new Error("这个进化事件已经有正式结果");
    if (continuityRepair && (!existing.officialAssetId || existing.continuityRepairUsed)) throw new Error("连续性修复不可用");
    const asset: PetVisualAsset = { id: `local-evolved-${Date.now()}`, petId: state.pet.id, storagePath: `local-evolved-${Date.now()}-continuity`, parentAssetId: existing.parentAssetId, evolutionEventId: eventId, isDraft: false, createdAt: new Date().toISOString() };
    const event: PetEvolutionEvent = { ...existing, officialAssetId: asset.id, status: "succeeded", continuityRepairUsed: continuityRepair || existing.continuityRepairUsed };
    await saveLocal({ ...state, pet: { ...state.pet, currentAssetId: asset.id }, assets: [...state.assets, asset], evolutionEvents: [event, ...(state.evolutionEvents ?? []).filter((item) => item.id !== eventId)] }); return event;
  }
  subscribe(): () => void { return () => undefined; }
}

function mapPet(row: Record<string, any>, turns: number, remainingToday: number): PetRecord { return { id: row.id, ownerId: row.owner_id, name: row.name, status: row.status, conversationTurns: turns, currentAssetId: row.current_asset_id, confirmedAt: row.confirmed_at, generationsRemainingToday: remainingToday }; }
function mapAsset(row: Record<string, any>): PetVisualAsset { return { id: row.id, petId: row.pet_id, storagePath: row.storage_path, parentAssetId: row.parent_asset_id, evolutionEventId: row.evolution_event_id, isDraft: row.is_draft, createdAt: row.created_at }; }
function mapGeneration(row: Record<string, any>): PetGenerationSession { return { id: row.id, status: row.status, instruction: row.instruction, baseAssetId: row.base_asset_id, explore: row.explore, attempts: Number(row.attempts ?? 0), errorCode: row.error_code ?? null, createdAt: row.created_at, completedAt: row.completed_at ?? null }; }
function mapRecallSources(value: unknown): readonly PetRecallSource[] { return Array.isArray(value) ? value.map((source: Record<string, any>) => ({ spaceId: source.space_id, spaceName: source.space_name, messageId: source.message_id, createdAt: source.created_at })).filter((source) => source.spaceId && source.messageId) : []; }
function mapPrivateMessage(row: Record<string, any>): PetPrivateMessage { return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at, requestKey: row.request_key ?? null, replyStatus: row.reply_status ?? null, replyErrorCode: row.reply_error_code ?? null, replyPhaseUpdatedAt: row.reply_phase_updated_at ?? null, inReplyToId: row.in_reply_to_id ?? null, recallSources: mapRecallSources(row.recall_sources) }; }
function mapEvolution(row: Record<string, any>): PetEvolutionEvent { return { id: row.id, parentAssetId: row.parent_asset_id, officialAssetId: row.official_asset_id, ownerBlessing: row.owner_blessing, status: row.status, failedAttempts: row.failed_attempts, continuityRepairUsed: row.continuity_repair_used, errorCode: row.error_code ?? null, createdAt: row.created_at, growthSnapshot: row.growth_snapshot ?? {} }; }
function mapRuntime(row: Record<string, any>): PetRuntimeState { return { petId: row.pet_id, state: row.expires_at && Date.parse(row.expires_at) <= Date.now() ? "idle" : row.state, sourceKind: row.source_kind, sourceId: row.source_id ?? null, startedAt: row.started_at, expiresAt: row.expires_at ?? null }; }

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
  async listPrivateMessages() { const client = requireSupabase(); void client.functions.invoke("deliver-reminders", { body: {} }).catch(() => undefined); const { data, error } = await client.from("pet_private_threads").select("id,role,content,created_at,request_key,reply_status,reply_error_code,reply_phase_updated_at,in_reply_to_id,recall_sources").order("created_at"); if (error) throw error; return (data ?? []).map(mapPrivateMessage); }
  async chat(content: string, requestKey = createRequestId()): Promise<PetPrivateMessage> { const client = requireSupabase(); const { data, error } = await client.functions.invoke("pet-chat", { body: { content, request_id: requestKey } }); if (error) throw await userFacingFunctionError(error, "异宠暂时无法回答，请稍后重试。"); if (data.agent_request_id) void client.functions.invoke("space-agent", { body: { request_id: data.agent_request_id } }).catch(() => undefined); return { id: data.id, role: "pet", content: data.content, createdAt: data.created_at, inReplyToId: data.in_reply_to_id ?? null, recallSources: mapRecallSources(data.recall_sources), agentRequestId: data.agent_request_id ?? null, targetSpaceName: data.target_space_name ?? null }; }
  async listAssets() { const petId = await this.getOwnedPetId(); if (!petId) return []; const { data, error } = await requireSupabase().from("pet_visual_assets").select("*").eq("pet_id", petId).order("created_at"); if (error) throw error; return (data ?? []).map(mapAsset); }
  async listGenerationSessions() { const { data, error } = await requireSupabase().from("pet_generation_sessions").select("id,status,instruction,base_asset_id,explore,attempts,error_code,created_at,completed_at").order("created_at", { ascending: false }).limit(30); if (error) throw error; return (data ?? []).map(mapGeneration); }
  async generateCandidate(instruction: string, baseAssetId?: string | null, explore = false, expectations?: PetExpectations) { const { data, error } = await requireSupabase().functions.invoke("generate-pet-candidate", { body: { instruction: instruction.trim() || undefined, base_asset_id: baseAssetId ?? null, explore, expectations: expectations ? { appearance: expectations.appearance, personality: expectations.personality, companionship: expectations.companionship, excluded_features: expectations.excludedFeatures, additional_description: expectations.additionalDescription } : undefined, request_id: createRequestId() } }); if (error) throw await userFacingFunctionError(error, "异宠生成请求失败，请稍后重试。"); const row = await requireSupabase().from("pet_generation_sessions").select("*").eq("id", data.session_id).single(); if (row.error) throw row.error; return mapGeneration(row.data); }
  async retryGeneration(sessionId: string) { const { data, error } = await requireSupabase().functions.invoke("generate-pet-candidate", { body: { session_id: sessionId } }); if (error) throw await userFacingFunctionError(error, "异宠生成重试失败，请稍后再试。"); const row = await requireSupabase().from("pet_generation_sessions").select("*").eq("id", data.session_id).single(); if (row.error) throw row.error; return mapGeneration(row.data); }
  async confirmPet(assetId: string) { const { error } = await requireSupabase().functions.invoke("confirm-pet", { body: { asset_id: assetId } }); if (error) throw await userFacingFunctionError(error, "异宠确认失败，请稍后重试。"); }
  async listStyleSignals() { const { data, error } = await requireSupabase().from("pet_style_signals").select("*, pet_style_feedback(feedback_kind,correction)").eq("active", true).order("created_at", { ascending: false }); if (error) throw error; return (data ?? []).map((row: Record<string, any>) => ({ id: row.id, tendency: row.tendency, rationale: row.rationale, sourceKind: row.source_kind, sourceLabel: row.source_label, confidence: Number(row.confidence), createdAt: row.created_at, feedback: row.pet_style_feedback?.[0]?.feedback_kind ?? null })); }
  async feedback(signalId: string, feedback: "accepted" | "corrected" | "forgotten", correction?: string) { const { error } = await requireSupabase().from("pet_style_feedback").upsert({ signal_id: signalId, feedback_kind: feedback, correction: correction ?? null }, { onConflict: "signal_id" }); if (error) throw error; }
  async createSignedAssetUrl(path: string) { const { data, error } = await requireSupabase().storage.from("pet-portraits").createSignedUrl(path, 900); if (error) throw error; return data.signedUrl; }
  async listExperiences(): Promise<readonly PetExperience[]> { const { data, error } = await requireSupabase().from("pet_experiences").select("id,category,summary,space_id,occurred_at").order("occurred_at", { ascending: false }).limit(50); if (error) throw error; return (data ?? []).map((row) => ({ id: row.id, category: row.category, summary: row.summary, spaceId: row.space_id, occurredAt: row.occurred_at })); }
  async listEvolutionEvents(): Promise<readonly PetEvolutionEvent[]> { const { data, error } = await requireSupabase().from("pet_evolution_events").select("id,parent_asset_id,official_asset_id,owner_blessing,status,failed_attempts,continuity_repair_used,error_code,created_at,growth_snapshot").order("created_at", { ascending: false }); if (error) throw error; return (data ?? []).map(mapEvolution); }
  async getRuntimeState(): Promise<PetRuntimeState | null> { const petId = await this.getOwnedPetId(); if (!petId) return null; const { data, error } = await requireSupabase().from("pet_runtime_states").select("pet_id,state,source_kind,source_id,started_at,expires_at").eq("pet_id", petId).maybeSingle(); if (error) throw error; return data ? mapRuntime(data) : null; }
  async performAction(action: "care" | "feed" | "play" | "rest"): Promise<PetRuntimeState> { const client = requireSupabase(); const petId = (await this.getPet())?.id; if (!petId) throw new Error("请先孵化异宠"); const { error } = await client.rpc("perform_pet_action", { target_pet_id: petId, action_kind: action, target_space_id: null, action_note: "", request_id: createRequestId() }); if (error) throw error; void client.functions.invoke("evaluate-pet-growth", { body: { pet_id: petId } }).catch(() => undefined); const state = await this.getRuntimeState(); if (!state) throw new Error("异宠动作状态写入失败"); return state; }
  async retryEvolution(eventId: string, continuityRepair = false): Promise<PetEvolutionEvent> { const { data, error } = await requireSupabase().functions.invoke("evolve-pet", { body: { event_id: eventId, continuity_repair: continuityRepair } }); if (error) throw error; const row = await requireSupabase().from("pet_evolution_events").select("*").eq("id", data.event_id).single(); if (row.error) throw row.error; return mapEvolution(row.data); }
  subscribe(onChange: () => void): () => void {
    const client = requireSupabase();
    const channels: RealtimeChannel[] = ["pet_generation_sessions", "pet_evolution_events", "pet_visual_assets", "pet_runtime_states", "pet_private_threads"].map((table) => client.channel(`pet-task:${table}:${createRequestId()}`).on("postgres_changes", { event: "*", schema: "public", table }, onChange).subscribe());
    return () => { channels.forEach((channel) => { void client.removeChannel(channel); }); };
  }
}

export function createPetRepository(profile: AppProfile): PetRepository { return isLocalDemoMode ? new LocalPetRepository(profile) : new SupabasePetRepository(); }
