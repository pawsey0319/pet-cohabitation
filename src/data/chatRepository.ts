import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRequestId } from "../lib/uuid";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { isLocalDemoMode, requireSupabase } from "../lib/supabase";
import { readMediaForUpload } from "../chat/mediaFile";
import type { AgentFeedbackRating, AgentJob, AgentProposal, AgentRequest, AppProfile, ChatMessage, ChatSpace, PetCornerStory, PetObservationStatus, QueuedMessage, RelationshipKind, SubmitAgentRequestInput } from "./types";

const LOCAL_CHAT_KEY = "pet-cohabitation-local-chat-v2";
let lastReminderDeliveryAt = 0;

function deliverDueReminders(): void {
  if (isLocalDemoMode || Date.now() - lastReminderDeliveryAt < 30_000) return;
  lastReminderDeliveryAt = Date.now();
  void requireSupabase().functions.invoke("deliver-reminders", { body: {} }).catch(() => undefined);
}

type LocalState = Readonly<{ spaces: readonly ChatSpace[]; messages: readonly ChatMessage[]; stories?: readonly PetCornerStory[]; observationConsents?: Readonly<Record<string, boolean>>; agentRequests?: readonly AgentRequest[] }>;
type Unsubscribe = () => void;

export interface ChatRepository {
  listSpaces(userId: string): Promise<readonly ChatSpace[]>;
  listMessages(spaceId: string, before?: string | null, limit?: number): Promise<readonly ChatMessage[]>;
  sendMessage(message: QueuedMessage, actorName: string): Promise<ChatMessage>;
  toggleReaction(messageId: string, emoji: string, userId: string): Promise<void>;
  markRead(spaceId: string): Promise<void>;
  subscribe(spaceId: string, onChange: () => void): Unsubscribe;
  createSpace(input: { name: string; kind: RelationshipKind }): Promise<string>;
  createSpaceInvite(spaceId: string): Promise<{ token: string; expiresAt: string }>;
  joinSpace(token: string): Promise<string>;
  uploadMedia(message: QueuedMessage): Promise<string | null>;
  createSignedMediaUrl(path: string): Promise<string>;
  listPetObservation(spaceId: string): Promise<readonly PetObservationStatus[]>;
  setPetObservationConsent(spaceId: string, petId: string, consented: boolean): Promise<void>;
  listPetCorner(spaceId: string): Promise<readonly PetCornerStory[]>;
  interactWithPet(spaceId: string, petId: string, action: "care" | "feed" | "play", note?: string): Promise<PetCornerStory>;
  setPetLocalMute(spaceId: string, petId: string, muted: boolean): Promise<void>;
  votePetPause(spaceId: string, petId: string, paused: boolean): Promise<void>;
  listAgentJobs(spaceId: string): Promise<readonly AgentJob[]>;
  retryAgentDispatch(messageId: string): Promise<AgentJob>;
  feedbackAgentMessage(messageId: string, spaceId: string, rating: AgentFeedbackRating): Promise<void>;
  submitAgentRequest(input: SubmitAgentRequestInput): Promise<AgentRequest>;
  listAgentRequests(spaceId: string): Promise<readonly AgentRequest[]>;
  voteAgentProposal(proposalId: string, decision: "approve" | "reject"): Promise<string>;
  withdrawAgentRequest(requestId: string): Promise<void>;
}

function seedLocalState(user: AppProfile): LocalState {
  const now = new Date();
  const earlier = new Date(now.getTime() - 32 * 60_000).toISOString();
  const recent = new Date(now.getTime() - 4 * 60_000).toISOString();
  const spaces: readonly ChatSpace[] = [
    { id: "local-pair", name: "晚风和灯", kind: "friend_pair", memberCount: 2, maxMembers: 2, unreadCount: 1, lastMessage: "晚上想不想一起玩同题揭晓？", lastMessageAt: recent },
    { id: "local-circle", name: "周末小分队", kind: "friend_circle", memberCount: 6, maxMembers: 20, unreadCount: 0, lastMessage: "我把散步路线放进待确认里啦。", lastMessageAt: earlier },
  ];
  const messages: readonly ChatMessage[] = [
    {
      id: "local-message-1", clientId: "seed-1", spaceId: "local-pair", senderId: "local-friend", actorKind: "human", actorName: "小满", kind: "text",
      text: "刚看到一朵长得很奇怪的云，感觉你的异宠会喜欢。", mediaPath: null, mediaDurationSeconds: null, replyToMessageId: null, replyPreview: null,
      createdAt: earlier, deliveryState: "sent", reactions: { "❤️": [user.id] },
    },
    {
      id: "local-message-2", clientId: "seed-2", spaceId: "local-pair", senderId: null, actorKind: "pet", actorName: "芽芽 · 异宠", kind: "text",
      text: "我喜欢！但更想知道它最后飘去了哪里。", mediaPath: null, mediaDurationSeconds: null, replyToMessageId: "local-message-1", replyPreview: "刚看到一朵长得很奇怪的云…",
      createdAt: recent, deliveryState: "sent", reactions: {},
    },
    {
      id: "local-message-3", clientId: "seed-3", spaceId: "local-circle", senderId: null, actorKind: "space_agent", actorName: "空间主 Agent", kind: "system",
      text: "已整理：周六散步尚未确认；路线建议已放入待办。", mediaPath: null, mediaDurationSeconds: null, replyToMessageId: null, replyPreview: null,
      createdAt: earlier, deliveryState: "sent", reactions: {},
    },
  ];
  return { spaces, messages };
}

const localListeners = new Map<string, Set<() => void>>();

async function loadLocal(user?: AppProfile): Promise<LocalState> {
  const raw = await AsyncStorage.getItem(LOCAL_CHAT_KEY);
  if (raw) {
    try { return JSON.parse(raw) as LocalState; } catch { /* seed below */ }
  }
  const state = seedLocalState(user ?? { id: "local", email: "", nickname: "我" });
  await AsyncStorage.setItem(LOCAL_CHAT_KEY, JSON.stringify(state));
  return state;
}

async function saveLocal(state: LocalState, spaceId: string): Promise<void> {
  await AsyncStorage.setItem(LOCAL_CHAT_KEY, JSON.stringify(state));
  localListeners.get(spaceId)?.forEach((listener) => listener());
}

class LocalChatRepository implements ChatRepository {
  constructor(private readonly profile: AppProfile) {}

  async listSpaces(): Promise<readonly ChatSpace[]> {
    return (await loadLocal(this.profile)).spaces;
  }

  async listMessages(spaceId: string, before?: string | null, limit = 50): Promise<readonly ChatMessage[]> {
    const state = await loadLocal(this.profile); const muted = state.observationConsents?.[`mute:${spaceId}:local-pet`] ?? false;
    const messages = state.messages
      .filter((message) => message.spaceId === spaceId && (!before || message.createdAt < before))
      .filter((message) => !(muted && message.actorKind === "pet"))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .reverse();
    return messages;
  }

  async sendMessage(input: QueuedMessage, actorName: string): Promise<ChatMessage> {
    const state = await loadLocal(this.profile);
    const existing = state.messages.find((item) => item.clientId === input.clientId && item.senderId === input.senderId);
    if (existing) return existing;
    const message: ChatMessage = {
      id: input.clientId,
      clientId: input.clientId,
      spaceId: input.spaceId,
      senderId: input.senderId,
      actorKind: "human",
      actorName,
      kind: input.kind,
      text: input.text,
      mediaPath: input.localMediaUri ?? null,
      mediaDurationSeconds: input.mediaDurationSeconds ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      replyPreview: input.replyPreview ?? null,
      createdAt: input.createdAt,
      deliveryState: "sent",
      reactions: {},
    };
    const spaces = state.spaces.map((space) => space.id === input.spaceId ? {
      ...space,
      lastMessage: input.kind === "image" ? "[图片]" : input.kind === "voice" ? "[语音]" : input.text,
      lastMessageAt: input.createdAt,
    } : space);
    const nextMessages: ChatMessage[] = [...state.messages, message];
    if (input.kind === "text" && /@芽芽|芽芽[?？]|异宠[?？]/.test(input.text ?? "")) {
      nextMessages.push({
        id: `local-pet-reply-${Date.now()}`, clientId: `local-pet-reply-${Date.now()}`, spaceId: input.spaceId,
        senderId: null, actorKind: "pet", actorName: "芽芽 · 异宠", kind: "text",
        text: "我听见啦。我会先观察一会儿，再把自己的想法告诉你；主人的决定还是等主人自己说。",
        mediaPath: null, mediaDurationSeconds: null, replyToMessageId: message.id, replyPreview: message.text?.slice(0, 80) ?? null,
        createdAt: new Date(Date.now() + 1).toISOString(), deliveryState: "sent", reactions: {},
      });
    }
    await saveLocal({ spaces, messages: nextMessages }, input.spaceId);
    return message;
  }

  async toggleReaction(messageId: string, emoji: string, userId: string): Promise<void> {
    const state = await loadLocal(this.profile);
    let targetSpace = "";
    const messages = state.messages.map((message) => {
      if (message.id !== messageId) return message;
      targetSpace = message.spaceId;
      const current = message.reactions[emoji] ?? [];
      const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
      return { ...message, reactions: { ...message.reactions, [emoji]: next } };
    });
    await saveLocal({ ...state, messages }, targetSpace);
  }

  async markRead(spaceId: string): Promise<void> {
    const state = await loadLocal(this.profile);
    if (!state.spaces.some((space) => space.id === spaceId && space.unreadCount > 0)) return;
    // Read-state changes must not notify the message subscription. Otherwise
    // ChatScreen reloads, marks read again, and creates an endless local loop.
    await AsyncStorage.setItem(LOCAL_CHAT_KEY, JSON.stringify({ ...state, spaces: state.spaces.map((space) => space.id === spaceId ? { ...space, unreadCount: 0 } : space) }));
  }

  subscribe(spaceId: string, onChange: () => void): Unsubscribe {
    const listeners = localListeners.get(spaceId) ?? new Set();
    listeners.add(onChange);
    localListeners.set(spaceId, listeners);
    return () => listeners.delete(onChange);
  }

  async createSpace(input: { name: string; kind: RelationshipKind }): Promise<string> {
    const state = await loadLocal(this.profile);
    const id = `local-space-${Date.now()}`;
    const maxMembers = input.kind === "friend_circle" ? 20 : 2;
    await saveLocal({
      ...state,
      spaces: [{ id, name: input.name, kind: input.kind, memberCount: 1, maxMembers, unreadCount: 0 }, ...state.spaces],
    }, id);
    return id;
  }

  async createSpaceInvite(spaceId: string) {
    return { token: `local-${spaceId}`, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() };
  }

  async joinSpace(token: string): Promise<string> {
    if (!token.startsWith("local-")) throw new Error("本地体验邀请无效");
    return token.slice("local-".length);
  }

  async uploadMedia(message: QueuedMessage): Promise<string | null> { return message.localMediaUri ?? null; }
  async createSignedMediaUrl(path: string): Promise<string> { return path; }
  async listPetObservation(spaceId: string): Promise<readonly PetObservationStatus[]> {
    const state = await loadLocal(this.profile); const ownConsent = state.observationConsents?.[`${spaceId}:local-pet`] ?? false;
    const ownMuted = state.observationConsents?.[`mute:${spaceId}:local-pet`] ?? false; const ownPauseVote = state.observationConsents?.[`vote:${spaceId}:local-pet`] ?? false;
    return [{ petId: "local-pet", petName: "芽芽", ownerName: this.profile.nickname, ownConsent, unanimousConsent: ownConsent, participationEnabled: !ownPauseVote, ownMuted, ownPauseVote, pausedByVote: ownPauseVote }];
  }
  async setPetObservationConsent(spaceId: string, petId: string, consented: boolean): Promise<void> {
    const state = await loadLocal(this.profile); await saveLocal({ ...state, observationConsents: { ...state.observationConsents, [`${spaceId}:${petId}`]: consented } }, spaceId);
  }
  async listPetCorner(spaceId: string): Promise<readonly PetCornerStory[]> { return ((await loadLocal(this.profile)).stories ?? []).filter((story) => story.spaceId === spaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async interactWithPet(spaceId: string, petId: string, action: "care" | "feed" | "play", note = ""): Promise<PetCornerStory> {
    const state = await loadLocal(this.profile); const verb = action === "feed" ? "递给芽芽一份想象中的小点心" : action === "play" ? "和芽芽玩了一场追光游戏" : "陪芽芽安静待了一会儿";
    const story: PetCornerStory = { id: `local-story-${Date.now()}`, spaceId, petId, petName: "芽芽", content: `${this.profile.nickname}${verb}。芽芽把这段相处认真记了下来${note ? `：“${note}”` : ""}。`, createdAt: new Date().toISOString() };
    await saveLocal({ ...state, stories: [story, ...(state.stories ?? [])] }, spaceId); return story;
  }
  async setPetLocalMute(spaceId: string, petId: string, muted: boolean): Promise<void> { const state = await loadLocal(this.profile); await saveLocal({ ...state, observationConsents: { ...state.observationConsents, [`mute:${spaceId}:${petId}`]: muted } }, spaceId); }
  async votePetPause(spaceId: string, petId: string, paused: boolean): Promise<void> { const state = await loadLocal(this.profile); await saveLocal({ ...state, observationConsents: { ...state.observationConsents, [`vote:${spaceId}:${petId}`]: paused } }, spaceId); }
  async listAgentJobs(): Promise<readonly AgentJob[]> { return []; }
  async retryAgentDispatch(messageId: string): Promise<AgentJob> { return { id: `local-job-${messageId}`, kind: "route_space_pets", scopeId: "local", sourceMessageId: messageId, status: "succeeded", errorCode: null, attempts: 1, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() }; }
  async feedbackAgentMessage(): Promise<void> { return; }
  async submitAgentRequest(input: SubmitAgentRequestInput): Promise<AgentRequest> {
    const state = await loadLocal(this.profile);
    const duplicate = (state.agentRequests ?? []).find((item) => item.requestedBy === this.profile.id && item.id === input.idempotencyKey);
    if (duplicate) return duplicate;
    const now = new Date().toISOString();
    const resultText = input.kind === "read_summary" ? "群聊简报：大家最近分享了近况，尚无需要本人确认的安排。" : input.kind === "read_query" ? "我已按当前空间消息回答这个查询。" : null;
    const direct = input.kind === "delegated_message" || input.kind === "personal_reminder";
    const request: AgentRequest = {
      id: input.idempotencyKey, spaceId: input.spaceId, requestedBy: this.profile.id, petId: input.petId ?? null,
      origin: input.origin, kind: input.kind, userInput: input.text, exactContent: input.exactContent ?? null,
      status: resultText || direct ? "completed" : "voting", resultText, reviewReason: null, finalMessageId: null,
      createdAt: now, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), proposal: null,
    };
    await saveLocal({ ...state, agentRequests: [request, ...(state.agentRequests ?? [])] }, input.spaceId ?? "personal");
    return request;
  }
  async listAgentRequests(spaceId: string): Promise<readonly AgentRequest[]> { return ((await loadLocal(this.profile)).agentRequests ?? []).filter((item) => item.spaceId === spaceId); }
  async voteAgentProposal(): Promise<string> { return "pending"; }
  async withdrawAgentRequest(requestId: string): Promise<void> {
    const state = await loadLocal(this.profile);
    await saveLocal({ ...state, agentRequests: (state.agentRequests ?? []).map((item) => item.id === requestId ? { ...item, status: "withdrawn" as const } : item) }, "personal");
  }
}

function reactionsFromRows(rows: readonly Record<string, unknown>[] | null | undefined): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, string[]> = {};
  for (const row of rows ?? []) {
    if (typeof row.emoji !== "string" || typeof row.user_id !== "string") continue;
    result[row.emoji] = [...(result[row.emoji] ?? []), row.user_id];
  }
  return result;
}

function mapRemoteMessage(row: Record<string, any>): ChatMessage {
  return {
    id: row.id,
    clientId: row.client_id,
    spaceId: row.space_id,
    senderId: row.sender_id,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    actorName: row.actor_name ?? row.profiles?.nickname ?? (row.actor_kind === "pet" ? "异宠" : row.actor_kind === "space_agent" ? "空间主 Agent" : "成员"),
    kind: row.kind,
    text: row.text,
    mediaPath: row.media_path,
    mediaDurationSeconds: row.media_duration_seconds,
    replyToMessageId: row.reply_to_message_id,
    replyPreview: row.reply_preview,
    createdAt: row.created_at,
    deliveryState: "sent",
    reactions: reactionsFromRows(row.message_reactions),
    deletedAt: row.deleted_at ?? null,
    delegatedByPetId: row.delegated_by_pet_id ?? null,
    delegationRequestId: row.delegation_request_id ?? null,
    agentProposalId: row.agent_proposal_id ?? null,
  };
}

function mapProposal(row: Record<string, any> | null | undefined): AgentProposal | null {
  if (!row?.id) return null;
  return {
    id: row.id, requestId: row.request_id, title: row.title, content: row.proposal_content ?? {},
    memberSnapshot: row.member_snapshot ?? [], affectedUserIds: row.affected_user_ids ?? [], requiredApprovals: Number(row.required_approvals),
    status: row.status, expiresAt: row.expires_at,
    votes: (row.agent_proposal_votes ?? []).map((vote: Record<string, any>) => ({ userId: vote.user_id, decision: vote.decision, updatedAt: vote.updated_at })),
  };
}

function mapAgentRequest(row: Record<string, any>): AgentRequest {
  const proposal = Array.isArray(row.agent_proposals) ? row.agent_proposals[0] : row.agent_proposals;
  return {
    id: row.id, spaceId: row.space_id, requestedBy: row.requested_by, petId: row.pet_id, origin: row.origin,
    kind: row.request_kind, userInput: row.user_input, exactContent: row.exact_content, status: row.status,
    resultText: typeof row.result?.text === "string" ? row.result.text : typeof row.result?.summary === "string" ? row.result.summary : null,
    reviewReason: row.review_reason ?? null, finalMessageId: row.final_message_id ?? null,
    createdAt: row.created_at, expiresAt: row.expires_at, proposal: mapProposal(proposal),
  };
}

class SupabaseChatRepository implements ChatRepository {
  async listSpaces(): Promise<readonly ChatSpace[]> {
    deliverDueReminders();
    const { data, error } = await requireSupabase().rpc("list_my_spaces");
    if (error) throw error;
    return (data ?? []).map((row: Record<string, any>) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      memberCount: Number(row.member_count),
      maxMembers: Number(row.max_members),
      lastMessage: row.last_message,
      lastMessageAt: row.last_message_at,
      unreadCount: Number(row.unread_count),
      observationEnabled: row.observation_enabled,
    }));
  }

  async listMessages(spaceId: string, before?: string | null, limit = 50): Promise<readonly ChatMessage[]> {
    deliverDueReminders();
    let query = requireSupabase().from("messages")
      .select("*, profiles:sender_id(nickname), message_reactions(emoji,user_id)")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) query = query.lt("created_at", before);
    const [{ data, error }, mutedResult] = await Promise.all([query, requireSupabase().from("space_member_pet_settings").select("pet_id").eq("space_id", spaceId).eq("muted", true)]);
    if (error) throw error;
    if (mutedResult.error) throw mutedResult.error;
    const muted = new Set((mutedResult.data ?? []).map((row) => row.pet_id));
    return (data ?? []).filter((row) => row.actor_kind !== "pet" || !muted.has(row.actor_id)).map(mapRemoteMessage).reverse();
  }

  async sendMessage(input: QueuedMessage, actorName: string): Promise<ChatMessage> {
    const mediaPath = await this.uploadMedia(input);
    const payload = {
      client_id: input.clientId,
      space_id: input.spaceId,
      sender_id: input.senderId,
      actor_kind: "human",
      actor_name: actorName,
      kind: input.kind,
      text: input.text,
      media_path: mediaPath,
      media_duration_seconds: input.mediaDurationSeconds ?? null,
      reply_to_message_id: input.replyToMessageId ?? null,
      reply_preview: input.replyPreview ?? null,
    };
    const client = requireSupabase();
    const { data, error } = await client.from("messages").insert(payload).select("*, profiles:sender_id(nickname), message_reactions(emoji,user_id)").single();
    if (error && error.code !== "23505") throw error;
    if (data) {
      await client.functions.invoke("handle-space-message", { body: { message_id: data.id } }).catch(() => undefined);
      return mapRemoteMessage(data);
    }
    const existing = await client.from("messages")
      .select("*, profiles:sender_id(nickname), message_reactions(emoji,user_id)")
      .eq("sender_id", input.senderId).eq("client_id", input.clientId).single();
    if (existing.error) throw existing.error;
    await client.functions.invoke("handle-space-message", { body: { message_id: existing.data.id } }).catch(() => undefined);
    return mapRemoteMessage(existing.data);
  }

  async toggleReaction(messageId: string, emoji: string): Promise<void> {
    const { error } = await requireSupabase().rpc("toggle_message_reaction", { target_message_id: messageId, reaction_emoji: emoji });
    if (error) throw error;
  }

  async markRead(spaceId: string): Promise<void> {
    const { error } = await requireSupabase().rpc("mark_space_read", { target_space_id: spaceId });
    if (error) throw error;
  }

  subscribe(spaceId: string, onChange: () => void): Unsubscribe {
    const client = requireSupabase();
    const subscriptionId = createRequestId();
    const channels: RealtimeChannel[] = [
      client.channel(`messages:${spaceId}:${subscriptionId}`).on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `space_id=eq.${spaceId}` }, onChange).subscribe(),
      client.channel(`reactions:${spaceId}:${subscriptionId}`).on("postgres_changes", { event: "*", schema: "public", table: "message_reactions", filter: `space_id=eq.${spaceId}` }, onChange).subscribe(),
      client.channel(`agent-jobs:${spaceId}:${subscriptionId}`).on("postgres_changes", { event: "*", schema: "public", table: "agent_jobs", filter: `scope_id=eq.${spaceId}` }, onChange).subscribe(),
      client.channel(`agent-requests:${spaceId}:${subscriptionId}`).on("postgres_changes", { event: "*", schema: "public", table: "agent_requests", filter: `space_id=eq.${spaceId}` }, onChange).subscribe(),
      client.channel(`agent-proposals:${spaceId}:${subscriptionId}`).on("postgres_changes", { event: "*", schema: "public", table: "agent_proposals", filter: `space_id=eq.${spaceId}` }, onChange).subscribe(),
    ];
    return () => { channels.forEach((channel) => { void client.removeChannel(channel); }); };
  }

  async createSpace(input: { name: string; kind: RelationshipKind }): Promise<string> {
    const { data, error } = await requireSupabase().rpc("create_relationship_space", { space_name: input.name, space_kind: input.kind });
    if (error) throw error;
    return data as string;
  }

  async createSpaceInvite(spaceId: string) {
    const { data, error } = await requireSupabase().rpc("create_space_invite", { target_space_id: spaceId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { token: row.token as string, expiresAt: row.expires_at as string };
  }

  async joinSpace(token: string): Promise<string> {
    const { data, error } = await requireSupabase().rpc("join_space_with_invite", { invite_token: token });
    if (error) throw error;
    return data as string;
  }

  async uploadMedia(message: QueuedMessage): Promise<string | null> {
    if (!message.localMediaUri || message.kind === "text") return null;
    const media = await readMediaForUpload(message.localMediaUri, (message.kind === "image" ? 8 : 5) * 1024 * 1024);
    const extension = message.kind === "image" ? "jpg" : "m4a";
    const path = `${message.spaceId}/${message.senderId}/${message.clientId}.${extension}`;
    const { error } = await requireSupabase().storage.from("chat-media").upload(path, media.body, {
      contentType: message.mediaMimeType || media.mimeType || (message.kind === "image" ? "image/jpeg" : "audio/mp4"),
      upsert: false,
    });
    if (error && !/already exists/i.test(error.message)) throw error;
    return path;
  }

  async createSignedMediaUrl(path: string): Promise<string> {
    const { data, error } = await requireSupabase().storage.from("chat-media").createSignedUrl(path, 15 * 60);
    if (error) throw error;
    return data.signedUrl;
  }

  async listPetObservation(spaceId: string): Promise<readonly PetObservationStatus[]> {
    const { data, error } = await requireSupabase().rpc("list_space_pet_observation", { target_space_id: spaceId });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, any>) => ({ petId: row.pet_id, petName: row.pet_name, ownerName: row.owner_name, ownConsent: row.own_consent, unanimousConsent: row.unanimous_consent, participationEnabled: row.participation_enabled, ownMuted: row.own_muted, ownPauseVote: row.own_pause_vote, pausedByVote: row.paused_by_vote }));
  }
  async setPetObservationConsent(spaceId: string, petId: string, consented: boolean): Promise<void> {
    const { error } = await requireSupabase().rpc("set_space_observation_consent", { target_space_id: spaceId, target_pet_id: petId, decision: consented });
    if (error) throw error;
  }
  async listPetCorner(spaceId: string): Promise<readonly PetCornerStory[]> {
    const { data, error } = await requireSupabase().from("pet_corner_stories").select("id,space_id,pet_id,content,created_at,pets(name)").eq("space_id", spaceId).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []).map((row: Record<string, any>) => ({ id: row.id, spaceId: row.space_id, petId: row.pet_id, petName: row.pets?.name ?? "异宠", content: row.content, createdAt: row.created_at }));
  }
  async interactWithPet(spaceId: string, petId: string, action: "care" | "feed" | "play", note = ""): Promise<PetCornerStory> {
    const { data, error } = await requireSupabase().functions.invoke("pet-interaction", { body: { space_id: spaceId, pet_id: petId, action, note, request_id: createRequestId() } });
    if (error) throw error;
    return { id: data.id, spaceId: data.space_id, petId: data.pet_id, petName: data.pet_name, content: data.content, createdAt: data.created_at };
  }
  async setPetLocalMute(spaceId: string, petId: string, muted: boolean): Promise<void> { const { error } = await requireSupabase().rpc("set_pet_local_mute", { target_space_id: spaceId, target_pet_id: petId, decision: muted }); if (error) throw error; }
  async votePetPause(spaceId: string, petId: string, paused: boolean): Promise<void> { const { error } = await requireSupabase().rpc("vote_pet_pause", { target_space_id: spaceId, target_pet_id: petId, decision: paused }); if (error) throw error; }
  async listAgentJobs(spaceId: string): Promise<readonly AgentJob[]> {
    const { data, error } = await requireSupabase().from("agent_jobs").select("id,job_kind,scope_id,source_message_id,status,error_code,attempts,created_at,completed_at,stage,progress_label,retryable,provider_checked_at").eq("scope_kind", "space").eq("scope_id", spaceId).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []).map((row) => ({ id: row.id, kind: row.job_kind, scopeId: row.scope_id, sourceMessageId: row.source_message_id, status: row.status, errorCode: row.error_code, attempts: row.attempts, createdAt: row.created_at, completedAt: row.completed_at, stage: row.stage, progressLabel: row.progress_label, retryable: row.retryable, providerCheckedAt: row.provider_checked_at }));
  }
  async retryAgentDispatch(messageId: string): Promise<AgentJob> {
    const { data, error } = await requireSupabase().functions.invoke("handle-space-message", { body: { message_id: messageId } });
    if (error) throw error;
    return { id: data.job_id, kind: "route_space_pets", scopeId: "", sourceMessageId: messageId, status: data.status, errorCode: null, attempts: 0, createdAt: new Date().toISOString(), completedAt: null };
  }
  async feedbackAgentMessage(messageId: string, spaceId: string, rating: AgentFeedbackRating): Promise<void> {
    const user = (await requireSupabase().auth.getUser()).data.user;
    if (!user) throw new Error("未登录");
    const { error } = await requireSupabase().from("agent_message_feedback").insert({ message_id: messageId, space_id: spaceId, user_id: user.id, rating });
    if (error) throw error;
  }
  async submitAgentRequest(input: SubmitAgentRequestInput): Promise<AgentRequest> {
    const client = requireSupabase();
    const created = await client.rpc("create_agent_request", {
      target_space_id: input.spaceId,
      request_origin: input.origin,
      request_text: input.text,
      request_kind: input.kind,
      exact_content: input.exactContent ?? null,
      target_pet_id: input.petId ?? null,
      request_key: input.idempotencyKey,
    });
    if (created.error) throw created.error;
    const invoked = await client.functions.invoke("space-agent", { body: { request_id: created.data } });
    if (invoked.error) throw invoked.error;
    const row = await client.from("agent_requests").select("*,agent_proposals(*,agent_proposal_votes(*))").eq("id", created.data).single();
    if (row.error) throw row.error;
    return mapAgentRequest(row.data);
  }
  async listAgentRequests(spaceId: string): Promise<readonly AgentRequest[]> {
    const client = requireSupabase();
    const [requestRows, proposalRows] = await Promise.all([
      client.from("agent_requests").select("*,agent_proposals(*,agent_proposal_votes(*))").eq("space_id", spaceId).order("created_at", { ascending: false }).limit(100),
      client.from("agent_proposals").select("*,agent_proposal_votes(*)").eq("space_id", spaceId).order("created_at", { ascending: false }).limit(100),
    ]);
    if (requestRows.error) throw requestRows.error; if (proposalRows.error) throw proposalRows.error;
    const visible = (requestRows.data ?? []).map(mapAgentRequest);
    const visibleIds = new Set(visible.map((item) => item.id));
    const sharedProposalPlaceholders: AgentRequest[] = (proposalRows.data ?? []).filter((proposal) => !visibleIds.has(proposal.request_id)).map((proposal: Record<string, any>) => ({
      id: proposal.request_id, spaceId, requestedBy: proposal.created_by, petId: null, origin: "pet_private",
      kind: proposal.proposal_content?.request_kind ?? "group_plan", userInput: proposal.proposal_content?.summary ?? proposal.title,
      exactContent: null, status: proposal.status === "voting" ? "voting" : proposal.status === "executed" ? "completed" : proposal.status,
      resultText: proposal.status === "executed" ? "已按投票结果执行" : null, reviewReason: null, finalMessageId: null,
      createdAt: proposal.created_at, expiresAt: proposal.expires_at, proposal: mapProposal(proposal),
    }));
    return [...visible, ...sharedProposalPlaceholders].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  async voteAgentProposal(proposalId: string, decision: "approve" | "reject"): Promise<string> {
    const { data, error } = await requireSupabase().rpc("cast_agent_proposal_vote", { target_proposal_id: proposalId, vote_decision: decision });
    if (error) throw error;
    if (data === "approved") void requireSupabase().functions.invoke("space-agent", { body: { proposal_id: proposalId } }).catch(() => undefined);
    return String(data);
  }
  async withdrawAgentRequest(requestId: string): Promise<void> {
    const { error } = await requireSupabase().rpc("withdraw_agent_request", { target_request_id: requestId });
    if (error) throw error;
  }
}

export function createChatRepository(profile: AppProfile): ChatRepository {
  return isLocalDemoMode ? new LocalChatRepository(profile) : new SupabaseChatRepository();
}
