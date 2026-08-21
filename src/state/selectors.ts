import { canRevealMemory } from "../domain/policies";
import type { RelationshipSpace } from "../domain/types";
import type { AppState } from "./AppState";

export function isCurrentUserPetOwner(state: AppState): boolean {
  return state.currentUserId === state.pet.ownerId;
}

export function selectAccessibleSpaces(state: AppState): readonly RelationshipSpace[] {
  return state.spaces.filter((space) => space.memberIds.includes(state.currentUserId));
}

export function selectAccessibleSpaceById(
  state: AppState,
  spaceId: string | null,
): RelationshipSpace | null {
  if (!spaceId) return null;
  return selectAccessibleSpaces(state).find((space) => space.id === spaceId) ?? null;
}

export function selectActiveAccessibleSpace(state: AppState): RelationshipSpace | null {
  const spaces = selectAccessibleSpaces(state);
  return spaces.find((space) => space.id === state.activeSpaceId) ?? spaces[0] ?? null;
}

export function selectVisiblePetMemories(state: AppState) {
  if (isCurrentUserPetOwner(state)) {
    return state.pet.memories.filter(
      (memory) => memory.ownerId === state.pet.ownerId &&
        canRevealMemory(memory, state.currentUserId) === "allow",
    );
  }

  const accessibleSpaceIds = new Set(selectAccessibleSpaces(state).map((space) => space.id));
  return state.pet.memories.filter(
    (memory) =>
      memory.spaceId !== "global" &&
      accessibleSpaceIds.has(memory.spaceId) &&
      memory.sensitivity === "normal" &&
      memory.visibility === "space_members" &&
      canRevealMemory(memory, state.currentUserId) === "allow",
  );
}

export function selectVisibleDelegatedActions(state: AppState) {
  return isCurrentUserPetOwner(state) ? state.delegatedActions : Object.freeze([]);
}

export function selectVisiblePetCornerStories(state: AppState) {
  const accessibleSpaceIds = new Set(selectAccessibleSpaces(state).map((space) => space.id));
  return state.petCornerStories.filter((story) => accessibleSpaceIds.has(story.spaceId));
}
