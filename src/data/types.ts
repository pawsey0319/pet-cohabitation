export type RelationshipKind = "friend_pair" | "lover_pair" | "friend_circle";
export type MessageKind = "text" | "image" | "voice" | "system";
export type ActorKind = "human" | "pet" | "space_agent";
export type DeliveryState = "pending" | "sent" | "failed";

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
  createdAt: string;
}>;
