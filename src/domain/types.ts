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
  identityAnchors: IdentityAnchors;
  abstractTraits: readonly string[];
  memories: readonly SpaceMemory[];
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
}>;
