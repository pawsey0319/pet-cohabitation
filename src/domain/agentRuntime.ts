import {
  canPetExecute,
  getPetContextForSpace,
} from "./policies";
import type {
  AgentCard,
  DelegatedAction,
  DelegatedActionRequest,
  PetCornerStory,
  PetGovernanceVote,
  PetNarrative,
  RelationshipSpace,
  RuntimeState,
  SimulationResult,
  SpaceMessage,
  UserPet,
} from "./types";

const DAY_IN_MILLISECONDS = 86_400_000;
const MAX_SIMULATED_DAYS = 3;
const AUTO_COMPLETABLE_ACTIONS = new Set(["game_invite", "light_vote"]);

function simulatedDays(lastActiveAt: string, now: string): number {
  const elapsed = new Date(now).getTime() - new Date(lastActiveAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return 0;
  }

  return Math.min(MAX_SIMULATED_DAYS, Math.floor(elapsed / DAY_IN_MILLISECONDS));
}

function isPetPausedByMajority(space: RelationshipSpace, petId: string): boolean {
  const latestVotes = new Map<string, "pause" | "resume">();
  for (const vote of space.petGovernanceVotes) {
    if (vote.petId === petId && (vote.decision === "pause" || vote.decision === "resume")) {
      latestVotes.set(vote.voterId, vote.decision);
    }
  }

  const pauses = [...latestVotes.values()].filter((decision) => decision === "pause").length;
  return pauses > space.memberIds.length / 2;
}

function canSendProactivePetContent(space: RelationshipSpace, petId: string): boolean {
  return !space.locallyMutedPetIds.includes(petId) && !isPetPausedByMajority(space, petId);
}

function atDay(lastActiveAt: string, day: number): string {
  return new Date(new Date(lastActiveAt).getTime() + day * DAY_IN_MILLISECONDS).toISOString();
}

function createPetMessage(
  space: RelationshipSpace,
  pet: UserPet,
  occurredAt: string,
): SpaceMessage {
  return Object.freeze({
    id: `absence-message-${space.id}-${occurredAt}`,
    spaceId: space.id,
    actorType: "pet",
    actorId: pet.id,
    permissionSource: "pet_space_context",
    content: `${pet.name}在${space.name}留下一句轻松的问候。`,
    occurredAt,
  });
}

function createPetCornerStories(
  space: RelationshipSpace,
  pet: UserPet,
  occurredAt: string,
): readonly PetCornerStory[] {
  return Object.freeze([
    Object.freeze({
      id: `absence-corner-${space.id}-${occurredAt}-1`,
      actorType: "pet" as const,
      permissionSource: "pet_corner" as const,
      petId: pet.id,
      spaceId: space.id,
      content: `${pet.name}在宠物角整理了今天的小玩具。`,
      occurredAt,
    }),
    Object.freeze({
      id: `absence-corner-${space.id}-${occurredAt}-2`,
      actorType: "pet" as const,
      permissionSource: "pet_corner" as const,
      petId: pet.id,
      spaceId: space.id,
      content: `${pet.name}和伙伴完成了一轮轻量小游戏。`,
      occurredAt,
    }),
  ]);
}

export function summarizeSpace(
  space: RelationshipSpace,
  messages: readonly SpaceMessage[],
): AgentCard {
  const spaceMessages = messages.filter((message) => message.spaceId === space.id);
  const humanMessages = spaceMessages.filter((message) => message.actorType === "human").length;
  const petMessages = spaceMessages.filter((message) => message.actorType === "pet").length;

  return Object.freeze({
    actorType: "space_agent",
    permissionSource: "space_objective_summary",
    spaceId: space.id,
    content: `${space.name}目前有${humanMessages}条成员消息和${petMessages}条异宠消息；尚无已确认的人类承诺。`,
  });
}

export function askPetWhatHappened(pet: UserPet, spaceId: string): PetNarrative {
  const context = getPetContextForSpace(pet, spaceId);
  const latestMemory = context.memories.at(-1);
  const remembered = latestMemory
    ? `我还记得这里的${latestMemory.content}`
    : "这个空间今天很安静，我在等大家随时回来";

  return Object.freeze({
    actorType: "pet",
    permissionSource: "pet_space_context",
    petId: pet.id,
    spaceId,
    content: `${pet.name}说：${remembered}。`,
  });
}

export function createDelegatedAction(
  pet: UserPet,
  request: DelegatedActionRequest,
): DelegatedAction {
  const status = !canPetExecute({ kind: request.kind })
    ? "blocked"
    : AUTO_COMPLETABLE_ACTIONS.has(request.kind)
      ? "completed"
      : "pending_owner";

  return Object.freeze({
    id: `delegated-${pet.id}-${request.kind}`,
    kind: request.kind,
    petId: pet.id,
    status,
    permissionSource: status === "blocked" ? "delegation_policy" : "pet_low_risk_delegation",
    summary: request.summary,
  });
}

export function applyPetGovernance(
  space: RelationshipSpace,
  petId: string,
  vote: PetGovernanceVote,
): RelationshipSpace {
  if (!space.memberIds.includes(vote.voterId)) {
    return space;
  }

  if (vote.decision === "mute_locally" || vote.decision === "unmute_locally") {
    const locallyMutedPetIds = vote.decision === "mute_locally"
      ? [...new Set([...space.locallyMutedPetIds, petId])]
      : space.locallyMutedPetIds.filter((id) => id !== petId);

    return Object.freeze({
      ...space,
      locallyMutedPetIds: Object.freeze(locallyMutedPetIds),
    });
  }

  const petGovernanceVotes = [
    ...space.petGovernanceVotes.filter(
      (existing) => !(existing.petId === petId && existing.voterId === vote.voterId),
    ),
    Object.freeze({ ...vote, petId }),
  ];

  return Object.freeze({
    ...space,
    petGovernanceVotes: Object.freeze(petGovernanceVotes),
  });
}

export function simulateOwnerAbsence(
  state: RuntimeState,
  now: string,
): SimulationResult {
  const activeSpaces = state.spaces
    .filter((space) => canSendProactivePetContent(space, state.pet.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const days = simulatedDays(state.lastActiveAt, now);
  const generatedMessages: SpaceMessage[] = [];
  const generatedStories: PetCornerStory[] = [];

  for (let day = 1; day <= days && activeSpaces.length > 0; day += 1) {
    const space = activeSpaces[(day - 1) % activeSpaces.length];
    const occurredAt = atDay(state.lastActiveAt, day);
    generatedMessages.push(createPetMessage(space, state.pet, occurredAt));
    generatedStories.push(...createPetCornerStories(space, state.pet, occurredAt));
  }

  return Object.freeze({
    pet: Object.freeze({ ...state.pet, status: "waiting_warmly" }),
    messages: Object.freeze([...state.messages, ...generatedMessages]),
    petCornerStories: Object.freeze([...state.petCornerStories, ...generatedStories]),
    delegatedActions: Object.freeze(
      state.delegatedActions.map((action) =>
        action.status ? action : createDelegatedAction(state.pet, action),
      ),
    ),
  });
}
