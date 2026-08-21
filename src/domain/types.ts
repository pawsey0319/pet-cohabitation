export type RelationshipKind =
  | "lover_pair"
  | "friend_pair"
  | "friend_circle";

export type ActionRisk = "low" | "high";

export type IdentityAnchors = Readonly<{
  eyes: string;
  coreColor: string;
  voice: string;
  silhouette: string;
  signatureOrgan: string;
}>;

export type MemorySensitivity = "normal" | "sensitive";
export type MemoryVisibility = "space_members" | "owner_only";

export type SpaceMemory = Readonly<{
  id: string;
  spaceId: string;
  ownerId: string;
  source: string;
  occurredAt: string;
  content: string;
  sensitivity: MemorySensitivity;
  visibility: MemoryVisibility;
}>;

export type UserPet = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  lifeSeed: string;
  status?: PetStatus;
  identityAnchors: IdentityAnchors;
  abstractTraits: readonly string[];
  memories: readonly SpaceMemory[];
}>;

export type PetStatus = "waiting_warmly" | "exploring_spaces";

export type PetWithStatus = UserPet & Readonly<{
  status: PetStatus;
}>;

export type AgentActorType = "human" | "pet" | "space_agent";

export type RelationshipSpace = Readonly<{
  id: string;
  name: string;
  kind: RelationshipKind;
  memberIds: readonly string[];
  locallyMutedPetIds: readonly string[];
  petGovernanceVotes: readonly PetGovernanceVote[];
}>;

export type PetGovernanceDecision =
  | "pause"
  | "resume"
  | "mute_locally"
  | "unmute_locally";

export type PetGovernanceVote = Readonly<{
  voterId: string;
  decision: PetGovernanceDecision;
  petId?: string;
}>;

export type SpaceMessage = Readonly<{
  id: string;
  spaceId: string;
  actorType: AgentActorType;
  actorId: string;
  permissionSource: string;
  content: string;
  occurredAt: string;
}>;

export type AgentCard = Readonly<{
  actorType: "space_agent";
  permissionSource: "space_objective_summary";
  spaceId: string;
  content: string;
}>;

export type PetNarrative = Readonly<{
  actorType: "pet";
  permissionSource: "pet_space_context";
  petId: string;
  spaceId: string;
  content: string;
}>;

export type PetCornerStory = Readonly<{
  id: string;
  actorType: "pet";
  permissionSource: "pet_corner";
  petId: string;
  spaceId: string;
  content: string;
  occurredAt: string;
}>;

export type DelegatedActionStatus =
  | "completed"
  | "pending_owner"
  | "blocked";

export type DelegatedActionRequest = Readonly<{
  kind: string;
  spaceId?: string;
  summary?: string;
}>;

export type ExperienceCategory = "care" | "work" | "social" | "shared";

export type GrowthExperience = Readonly<{
  id: string;
  category: ExperienceCategory;
  summary: string;
}>;

export type EvolutionEvent = Readonly<{
  petName: string;
  sources: readonly GrowthExperience[];
  ownerInfluence: string;
  decisionBy: "pet";
  visualTrait: string | null;
}>;

export type PetContext = Readonly<{
  petId: string;
  identityAnchors: IdentityAnchors;
  abstractTraits: readonly string[];
  memories: readonly SpaceMemory[];
}>;

export type DelegatedAction = Readonly<{
  kind: string;
  id?: string;
  petId?: string;
  status?: DelegatedActionStatus;
  permissionSource?: string;
  summary?: string;
}>;

export type RuntimeState = Readonly<{
  pet: PetWithStatus;
  spaces: readonly RelationshipSpace[];
  messages: readonly SpaceMessage[];
  petCornerStories: readonly PetCornerStory[];
  delegatedActions: readonly DelegatedAction[];
  lastActiveAt: string;
}>;

export type SimulationResult = Readonly<{
  pet: PetWithStatus;
  messages: readonly SpaceMessage[];
  petCornerStories: readonly PetCornerStory[];
  delegatedActions: readonly DelegatedAction[];
}>;
