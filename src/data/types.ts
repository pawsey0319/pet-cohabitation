export type RelationshipKind = "friend_pair" | "lover_pair" | "friend_circle";
export type MessageKind = "text" | "image" | "voice" | "system";
export type ActorKind = "human" | "pet" | "space_agent";
export type DeliveryState = "pending" | "sent" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "blocked";
export type AgentFeedbackRating = "natural" | "irrelevant" | "intrusive" | "unsafe";
export type PetMotionState = "idle" | "listening" | "thinking" | "speaking" | "happy" | "eating" | "playing" | "sleeping";
export type AgentRequestKind = "read_summary" | "read_query" | "delegated_message" | "group_task" | "group_plan" | "group_schedule" | "personal_reminder" | "group_reminder";
export type AgentRequestOrigin = "space_panel" | "pet_private";
export type AgentRequestStatus = "queued" | "reviewing" | "needs_clarification" | "voting" | "approved" | "executing" | "completed" | "failed" | "withdrawn" | "expired" | "rejected";

export type AppProfile = Readonly<{
  id: string;
  email: string;
  nickname: string;
  avatarUrl?: string | null;
  isAdmin?: boolean;
}>;

export type ChatSpace = Readonly<{
  id: string;
  name: string;
  kind: RelationshipKind;
  memberCount: number;
  maxMembers: number;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  observationEnabled?: boolean;
}>;

export type ChatMessage = Readonly<{
  id: string;
  clientId: string;
  spaceId: string;
  senderId: string | null;
  actorKind: ActorKind;
  actorId?: string | null;
  actorName: string;
  kind: MessageKind;
  text: string | null;
  mediaPath: string | null;
  mediaDurationSeconds: number | null;
  replyToMessageId: string | null;
  replyPreview: string | null;
  createdAt: string;
  deliveryState: DeliveryState;
  reactions: Readonly<Record<string, readonly string[]>>;
  deletedAt?: string | null;
  delegatedByPetId?: string | null;
  delegationRequestId?: string | null;
  agentProposalId?: string | null;
}>;

export type AgentProposalVote = Readonly<{
  userId: string;
  decision: "approve" | "reject";
  updatedAt: string;
}>;

export type AgentProposal = Readonly<{
  id: string;
  requestId: string;
  title: string;
  content: Readonly<Record<string, unknown>>;
  memberSnapshot: readonly string[];
  affectedUserIds: readonly string[];
  requiredApprovals: number;
  status: "voting" | "approved" | "rejected" | "expired" | "withdrawn" | "executed";
  expiresAt: string;
  votes: readonly AgentProposalVote[];
}>;

export type AgentRequest = Readonly<{
  id: string;
  spaceId: string | null;
  requestedBy: string;
  petId: string | null;
  origin: AgentRequestOrigin;
  kind: AgentRequestKind;
  userInput: string;
  exactContent: string | null;
  status: AgentRequestStatus;
  resultText: string | null;
  reviewReason: string | null;
  finalMessageId: string | null;
  createdAt: string;
  expiresAt: string;
  proposal: AgentProposal | null;
}>;

export type SubmitAgentRequestInput = Readonly<{
  spaceId: string | null;
  origin: AgentRequestOrigin;
  kind: AgentRequestKind;
  text: string;
  exactContent?: string | null;
  petId?: string | null;
  idempotencyKey: string;
}>;

export type AgentJob = Readonly<{
  id: string;
  kind: string;
  scopeId: string;
  sourceMessageId: string | null;
  status: JobStatus;
  errorCode: string | null;
  attempts: number;
  createdAt: string;
  completedAt: string | null;
}>;

export type QueuedMessage = Readonly<{
  clientId: string;
  spaceId: string;
  senderId: string;
  kind: Extract<MessageKind, "text" | "image" | "voice">;
  text: string | null;
  localMediaUri?: string | null;
  mediaMimeType?: string | null;
  mediaSizeBytes?: number | null;
  mediaDurationSeconds?: number | null;
  replyToMessageId?: string | null;
  replyPreview?: string | null;
  createdAt: string;
  attempts: number;
}>;

export type PetStatus = "incubating" | "drafting" | "confirmed";

export type PetRecord = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  status: PetStatus;
  conversationTurns: number;
  currentAssetId: string | null;
  confirmedAt: string | null;
  generationsRemainingToday: number;
}>;

export type PetExpectations = Readonly<{
  name: string;
  appearance: string;
  personality: string;
  companionship: string;
  excludedFeatures: string;
  additionalDescription: string;
  personalitySeedPrompt?: string | null;
  visualSeedPrompt?: string | null;
  negativeSeedPrompt?: string | null;
  seedSummary?: string | null;
  version?: number;
}>;

export type PetVisualAsset = Readonly<{
  id: string;
  petId: string;
  storagePath: string;
  parentAssetId: string | null;
  evolutionEventId: string | null;
  isDraft: boolean;
  createdAt: string;
  signedUrl?: string | null;
}>;

export type StyleSignal = Readonly<{
  id: string;
  tendency: string;
  rationale: string;
  sourceKind: "pet_private" | "space";
  sourceLabel: string;
  confidence: number;
  createdAt: string;
  feedback: "accepted" | "corrected" | "forgotten" | null;
}>;

export type PetPrivateMessage = Readonly<{
  id: string;
  role: "owner" | "pet";
  content: string;
  createdAt: string;
  requestKey?: string | null;
  replyStatus?: "queued" | "classifying" | "retrieving" | "thinking" | "succeeded" | "failed" | null;
  replyErrorCode?: string | null;
  replyPhaseUpdatedAt?: string | null;
  inReplyToId?: string | null;
  recallSources?: readonly PetRecallSource[];
  agentRequestId?: string | null;
  targetSpaceName?: string | null;
}>;

export type PetRecallSource = Readonly<{
  spaceId: string;
  spaceName: string;
  messageId: string;
  createdAt: string;
}>;

export type PetRuntimeState = Readonly<{
  petId: string;
  state: PetMotionState;
  sourceKind: "system" | "owner_action" | "space_action" | "private_chat" | "space_chat";
  sourceId: string | null;
  startedAt: string;
  expiresAt: string | null;
}>;

export type PetObservationStatus = Readonly<{
  petId: string;
  petName: string;
  ownerName: string;
  ownConsent: boolean;
  unanimousConsent: boolean;
  participationEnabled: boolean;
  ownMuted: boolean;
  ownPauseVote: boolean;
  pausedByVote: boolean;
}>;

export type PetCornerStory = Readonly<{
  id: string;
  spaceId: string;
  petId: string;
  petName: string;
  content: string;
  createdAt: string;
}>;

export type PetExperience = Readonly<{
  id: string;
  category: "care" | "work" | "social" | "shared";
  summary: string;
  spaceId: string | null;
  occurredAt: string;
}>;

export type PetEvolutionEvent = Readonly<{
  id: string;
  parentAssetId: string;
  officialAssetId: string | null;
  ownerBlessing: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "blocked";
  failedAttempts: number;
  continuityRepairUsed: boolean;
  errorCode?: string | null;
  createdAt: string;
  growthSnapshot?: Readonly<Record<string, unknown>>;
}>;

export type PetGenerationSession = Readonly<{
  id: string;
  status: JobStatus;
  instruction: string;
  baseAssetId: string | null;
  explore: boolean;
  attempts: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}>;

export type DemoSettings = Readonly<{
  registrationEnabled: boolean;
  imageGenerationEnabled: boolean;
  implicitPetRepliesEnabled: boolean;
  agentWorkbenchEnabled: boolean;
  structuredPetOnboardingEnabled: boolean;
  maxRegisteredUsers: number;
  globalDailyImageLimit: number;
  testEndsAt: string | null;
  purgeAfterDays: number;
  evolutionThresholdMode: "standard" | "accelerated";
}>;

export type AdminDemoMetrics = Readonly<{
  registeredUsers: number;
  spaces: number;
  jobsToday: number;
  jobsSucceededToday: number;
  jobsFailedToday: number;
  modelRunsToday: number;
  imageRunsToday: number;
  modelSuccessRate: number;
  averageLatencyMs: number;
  feedback: Readonly<Record<string, number>>;
  recentErrors: readonly Readonly<{ error_code: string; total: number }>[];
}>;
