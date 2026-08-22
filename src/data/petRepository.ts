import AsyncStorage from "@react-native-async-storage/async-storage";
import { isLocalDemoMode, requireSupabase } from "../lib/supabase";
import { DAILY_CANDIDATE_LIMIT, canGenerateInitialCandidate } from "../pets/rules";
import type { AppProfile, PetEvolutionEvent, PetExperience, PetPrivateMessage, PetRecord, PetVisualAsset, StyleSignal } from "./types";

const LOCAL_PET_KEY = "pet-cohabitation-local-pet-v2";

type LocalPetState = Readonly<{
  pet: PetRecord | null;
  messages: readonly PetPrivateMessage[];
  assets: readonly PetVisualAsset[];
  signals: readonly StyleSignal[];
  generationDates: readonly string[];
  experiences?: readonly PetExperience[];
  evolutionEvents?: readonly PetEvolutionEvent[];
}>;

export interface PetRepository {
  getPet(): Promise<PetRecord | null>;
  createPet(name: string): Promise<PetRecord>;
  listPrivateMessages(): Promise<readonly PetPrivateMessage[]>;
  chat(content: string): Promise<PetPrivateMessage>;
  listAssets(): Promise<readonly PetVisualAsset[]>;
  generateCandidate(instruction: string, baseAssetId?: string | null, explore?: boolean): Promise<PetVisualAsset>;
  confirmPet(assetId: string): Promise<void>;
  listStyleSignals(): Promise<readonly StyleSignal[]>;
  feedback(signalId: string, feedback: "accepted" | "corrected" | "forgotten", correction?: string): Promise<void>;
  createSignedAssetUrl(path: string): Promise<string>;
  listExperiences(): Promise<readonly PetExperience[]>;
  listEvolutionEvents(): Promise<readonly PetEvolutionEvent[]>;
  evolve(input: { blessing?: string; eventId?: string; continuityRepair?: boolean }): Promise<PetVisualAsset>;
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
  async listPrivateMessages() { return (await loadLocal()).messages; }
  async chat(content: string) {
    const state = await loadLocal(); if (!state.pet) throw new Error("请先为胚胎命名");
    const now = new Date().toISOString(); const owner: PetPrivateMessage = { id: `owner-${Date.now()}`, role: "owner", content, createdAt: now };
    const turn = state.messages.filter((message) => message.role === "owner").length + 1;
    const replies = ["我听见了。你希望我以后更会观察，还是更敢表达？", "这句话让我想到一种慢慢发亮、但不急着靠近的生物。", "我会记住你说话时先照顾别人感受的方式，但你可以随时纠正我。", "如果我长出一个奇怪器官，你希望它帮我感知什么？", "我们已经聊了五次。现在的我开始有一点自己的样子了。"];
    const pet: PetPrivateMessage = { id: `pet-${Date.now()}`, role: "pet", content: replies[Math.min(turn - 1, replies.length - 1)], createdAt: new Date(Date.now() + 1).toISOString() };
    const messages = [...state.messages, owner, pet];
    const signals = turn === 3 && !state.signals.length ? [...state.signals, { id: "local-signal-1", tendency: "先观察，再温和回应", rationale: "你连续几次先描述感受，再提出期待。", sourceKind: "pet_private" as const, sourceLabel: "异宠私聊", confidence: .72, createdAt: now, feedback: null }] : state.signals;
    const experiences = state.pet.status === "confirmed" ? [{ id: `local-exp-${Date.now()}`, category: "shared" as const, summary: `你和${state.pet.name}聊了一段只属于彼此的话：${content.slice(0, 180)}`, spaceId: null, occurredAt: now }, ...(state.experiences ?? [])] : state.experiences;
    await saveLocal({ ...state, messages, signals, experiences }); return pet;
  }
  async listAssets() { return (await loadLocal()).assets; }
  async generateCandidate(instruction: string, baseAssetId?: string | null, explore = false) {
    const state = await loadLocal(); if (!state.pet) throw new Error("请先孵化异宠");
    const turns = state.messages.filter((message) => message.role === "owner").length;
    if (!canGenerateInitialCandidate(state.pet.status, turns)) throw new Error(state.pet.status === "confirmed" ? "这只异宠已经确认，不能重新捏宠" : "至少完成 5 轮对话后才能生成");
    if (remaining(state) <= 0) throw new Error("今天的 20 次图像生成额度已用完");
    const asset: PetVisualAsset = { id: `local-asset-${Date.now()}`, petId: state.pet.id, storagePath: `local-visual-${state.assets.length + 1}-${encodeURIComponent(instruction.slice(0, 20))}`, parentAssetId: explore ? null : baseAssetId ?? state.assets.at(-1)?.id ?? null, evolutionEventId: null, isDraft: true, createdAt: new Date().toISOString() };
    const pet = { ...state.pet, status: "drafting" as const, generationsRemainingToday: remaining(state) - 1 };
    await saveLocal({ ...state, pet, assets: [...state.assets, asset], generationDates: [...state.generationDates, todayKey()] }); return asset;
  }
  async confirmPet(assetId: string) {
    const state = await loadLocal(); if (!state.pet || state.pet.status === "confirmed") throw new Error("异宠已确认，不能再次修改");
    if (!state.assets.some((asset) => asset.id === assetId && asset.isDraft)) throw new Error("候选不存在");
    await saveLocal({ ...state, pet: { ...state.pet, status: "confirmed", currentAssetId: assetId, confirmedAt: new Date().toISOString() }, assets: state.assets.map((asset) => ({ ...asset, isDraft: asset.id !== assetId })) });
  }
  async listStyleSignals() { return (await loadLocal()).signals; }
  async feedback(signalId: string, feedback: "accepted" | "corrected" | "forgotten", correction?: string) { const state = await loadLocal(); await saveLocal({ ...state, signals: state.signals.map((signal) => signal.id === signalId ? { ...signal, feedback, tendency: feedback === "corrected" && correction ? correction : signal.tendency } : signal) }); }
  async createSignedAssetUrl(path: string) { return path; }
  async listExperiences() { return (await loadLocal()).experiences ?? []; }
  async listEvolutionEvents() { return (await loadLocal()).evolutionEvents ?? []; }
  async evolve(input: { blessing?: string; eventId?: string; continuityRepair?: boolean }) {
    const state = await loadLocal(); if (!state.pet?.currentAssetId) throw new Error("请先确认异宠");
    const existing = input.eventId ? (state.evolutionEvents ?? []).find((event) => event.id === input.eventId) : null;
    if (!existing && !(state.experiences ?? []).some((experience) => Date.parse(experience.occurredAt) > Date.parse(state.pet!.confirmedAt ?? "1970-01-01"))) throw new Error("确认后先和它相处一次，再开启重大进化");
    if (existing?.officialAssetId && !input.continuityRepair) throw new Error("这个进化事件已经有正式结果");
    if (input.continuityRepair && (!existing?.officialAssetId || existing.continuityRepairUsed)) throw new Error("连续性修复不可用");
    const parentId = existing?.parentAssetId ?? state.pet.currentAssetId; const eventId = existing?.id ?? `local-evolution-${Date.now()}`;
    const asset: PetVisualAsset = { id: `local-evolved-${Date.now()}`, petId: state.pet.id, storagePath: `local-evolved-${Date.now()}-${encodeURIComponent(input.blessing ?? "成长")}`, parentAssetId: parentId, evolutionEventId: eventId, isDraft: false, createdAt: new Date().toISOString() };
    const event: PetEvolutionEvent = { id: eventId, parentAssetId: parentId, officialAssetId: asset.id, ownerBlessing: existing?.ownerBlessing ?? input.blessing ?? null, status: "succeeded", failedAttempts: existing?.failedAttempts ?? 0, continuityRepairUsed: Boolean(input.continuityRepair || existing?.continuityRepairUsed), createdAt: existing?.createdAt ?? new Date().toISOString() };
    await saveLocal({ ...state, pet: { ...state.pet, currentAssetId: asset.id }, assets: [...state.assets, asset], evolutionEvents: [event, ...(state.evolutionEvents ?? []).filter((item) => item.id !== eventId)] }); return asset;
  }
}

function mapPet(row: Record<string, any>, turns: number, remainingToday: number): PetRecord { return { id: row.id, ownerId: row.owner_id, name: row.name, status: row.status, conversationTurns: turns, currentAssetId: row.current_asset_id, confirmedAt: row.confirmed_at, generationsRemainingToday: remainingToday }; }
function mapAsset(row: Record<string, any>): PetVisualAsset { return { id: row.id, petId: row.pet_id, storagePath: row.storage_path, parentAssetId: row.parent_asset_id, evolutionEventId: row.evolution_event_id, isDraft: row.is_draft, createdAt: row.created_at }; }

class SupabasePetRepository implements PetRepository {
  async getPet() {
    const client = requireSupabase(); const user = (await client.auth.getUser()).data.user; if (!user) return null;
    const { data, error } = await client.from("pets").select("*").eq("owner_id", user.id).maybeSingle(); if (error) throw error; if (!data) return null;
    const turns = await client.from("pet_private_threads").select("id", { count: "exact", head: true }).eq("pet_id", data.id).eq("role", "owner");
    const quota = await client.rpc("remaining_model_quota", { quota_kind: "initial_image", quota_scope_id: user.id, daily_limit: DAILY_CANDIDATE_LIMIT });
    return mapPet(data, turns.count ?? 0, Number(quota.data ?? 0));
  }
  async createPet(name: string) { const client = requireSupabase(); const user = (await client.auth.getUser()).data.user; if (!user) throw new Error("未登录"); const { data, error } = await client.from("pets").insert({ owner_id: user.id, name: name.trim() }).select("*").single(); if (error) throw error; return mapPet(data, 0, DAILY_CANDIDATE_LIMIT); }
  async listPrivateMessages() { const { data, error } = await requireSupabase().from("pet_private_threads").select("id,role,content,created_at").order("created_at"); if (error) throw error; return (data ?? []).map((row) => ({ id: row.id, role: row.role, content: row.content, createdAt: row.created_at })); }
  async chat(content: string): Promise<PetPrivateMessage> { const { data, error } = await requireSupabase().functions.invoke("pet-chat", { body: { content } }); if (error) throw error; return { id: data.id, role: "pet", content: data.content, createdAt: data.created_at }; }
  async listAssets() { const { data, error } = await requireSupabase().from("pet_visual_assets").select("*").order("created_at"); if (error) throw error; return (data ?? []).map(mapAsset); }
  async generateCandidate(instruction: string, baseAssetId?: string | null, explore = false) { const { data, error } = await requireSupabase().functions.invoke("generate-pet-candidate", { body: { instruction, base_asset_id: baseAssetId ?? null, explore } }); if (error) throw error; return mapAsset(data); }
  async confirmPet(assetId: string) { const { error } = await requireSupabase().functions.invoke("confirm-pet", { body: { asset_id: assetId } }); if (error) throw error; }
  async listStyleSignals() { const { data, error } = await requireSupabase().from("pet_style_signals").select("*, pet_style_feedback(feedback_kind,correction)").eq("active", true).order("created_at", { ascending: false }); if (error) throw error; return (data ?? []).map((row: Record<string, any>) => ({ id: row.id, tendency: row.tendency, rationale: row.rationale, sourceKind: row.source_kind, sourceLabel: row.source_label, confidence: Number(row.confidence), createdAt: row.created_at, feedback: row.pet_style_feedback?.[0]?.feedback_kind ?? null })); }
  async feedback(signalId: string, feedback: "accepted" | "corrected" | "forgotten", correction?: string) { const { error } = await requireSupabase().from("pet_style_feedback").upsert({ signal_id: signalId, feedback_kind: feedback, correction: correction ?? null }, { onConflict: "signal_id" }); if (error) throw error; }
  async createSignedAssetUrl(path: string) { const { data, error } = await requireSupabase().storage.from("pet-portraits").createSignedUrl(path, 900); if (error) throw error; return data.signedUrl; }
  async listExperiences(): Promise<readonly PetExperience[]> { const { data, error } = await requireSupabase().from("pet_experiences").select("id,category,summary,space_id,occurred_at").order("occurred_at", { ascending: false }).limit(50); if (error) throw error; return (data ?? []).map((row) => ({ id: row.id, category: row.category, summary: row.summary, spaceId: row.space_id, occurredAt: row.occurred_at })); }
  async listEvolutionEvents(): Promise<readonly PetEvolutionEvent[]> { const { data, error } = await requireSupabase().from("pet_evolution_events").select("id,parent_asset_id,official_asset_id,owner_blessing,status,failed_attempts,continuity_repair_used,created_at").order("created_at", { ascending: false }); if (error) throw error; return (data ?? []).map((row) => ({ id: row.id, parentAssetId: row.parent_asset_id, officialAssetId: row.official_asset_id, ownerBlessing: row.owner_blessing, status: row.status, failedAttempts: row.failed_attempts, continuityRepairUsed: row.continuity_repair_used, createdAt: row.created_at })); }
  async evolve(input: { blessing?: string; eventId?: string; continuityRepair?: boolean }): Promise<PetVisualAsset> { const { data, error } = await requireSupabase().functions.invoke("evolve-pet", { body: { blessing: input.blessing ?? "", event_id: input.eventId, continuity_repair: input.continuityRepair ?? false } }); if (error) throw error; return mapAsset(data); }
}

export function createPetRepository(profile: AppProfile): PetRepository { return isLocalDemoMode ? new LocalPetRepository(profile) : new SupabasePetRepository(); }
