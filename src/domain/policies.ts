import type {
  ActionRisk,
  DelegatedAction,
  PetContext,
  SpaceMemory,
  UserPet,
} from "./types";

const PET_EXECUTABLE_ACTIONS = new Set([
  "game_invite",
  "light_vote",
  "tentative_reminder",
  "tentative_task",
  "preference_guess",
]);

export function getPetContextForSpace(
  pet: UserPet,
  spaceId: string,
): PetContext {
  return Object.freeze({
    petId: pet.id,
    identityAnchors: pet.identityAnchors,
    abstractTraits: Object.freeze([...pet.abstractTraits]),
    memories: Object.freeze(
      pet.memories.filter((memory) => memory.spaceId === spaceId),
    ),
  });
}

export function classifyDelegatedAction(kind: string): ActionRisk {
  return PET_EXECUTABLE_ACTIONS.has(kind) ? "low" : "high";
}

export function canPetExecute(action: DelegatedAction): boolean {
  return classifyDelegatedAction(action.kind) === "low";
}

export function canRevealMemory(
  memory: SpaceMemory,
  requesterId: string,
): "allow" | "require_owner" | "deny" {
  if (requesterId === memory.ownerId) {
    return "allow";
  }

  if (memory.sensitivity === "sensitive") {
    return "require_owner";
  }

  return memory.visibility === "owner_only" ? "deny" : "allow";
}
