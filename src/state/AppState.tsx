import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PropsWithChildren,
} from "react";
import {
  applyPetGovernance,
  askPetWhatHappened,
  createDelegatedAction,
  simulateOwnerAbsence,
  summarizeSpace,
} from "../domain/agentRuntime";
import { applyEvolution, proposeEvolution } from "../domain/evolution";
import { canPetExecute } from "../domain/policies";
import { createDemoSeed } from "../domain/seed";
import type {
  DelegatedActionRequest,
  DelegatedAction,
  EvolutionEvent,
  GrowthExperience,
  PetGovernanceDecision,
  PetRuntimePreferences,
  PetWithStatus,
  RuntimeState,
  RitualSettings,
  SafeGameType,
  SpaceMessageMetadata,
  SpaceMessage,
} from "../domain/types";

export const APP_STORAGE_KEY = "pet-cohabitation-mvp-v1";
export const APP_INVALID_BACKUP_KEY = "pet-cohabitation-mvp-v1-invalid-backup";

export type AppPet = PetWithStatus & Readonly<{
  experiences: readonly GrowthExperience[];
}>;

export type PetPreferences = PetRuntimePreferences;

export type AppState = Omit<RuntimeState, "pet"> & Readonly<{
  pet: AppPet;
  activeSpaceId: string | null;
  pendingEvolution: EvolutionEvent | null;
  evolutionEvents: readonly EvolutionEvent[];
  petPreferences: PetPreferences;
  currentUserId: string;
  nextDelegationSequence: number;
  consumedEvolutionExperienceIds: readonly string[];
  ritualSettings: RitualSettings;
}>;

export type AppAction =
  | Readonly<{
      type: "SEND_HUMAN_MESSAGE";
      spaceId: string;
      actorId: string;
      content: string;
      occurredAt: string;
      format?: SpaceMessage["format"];
      metadata?: SpaceMessageMetadata;
    }>
  | Readonly<{
      type: "CARE_FOR_PET";
      spaceId: string;
      byUserId: string;
      care: string;
      occurredAt: string;
    }>
  | Readonly<{ type: "REQUEST_DELEGATION"; request: DelegatedActionRequest }>
  | Readonly<{ type: "CONFIRM_ACTION"; actionId: string }>
  | Readonly<{ type: "REVOKE_ACTION"; actionId: string }>
  | Readonly<{
      type: "QUERY_PET";
      spaceId: string;
      requesterId: string;
      occurredAt: string;
    }>
  | Readonly<{ type: "RUN_SPACE_SUMMARY"; spaceId: string; occurredAt: string }>
  | Readonly<{ type: "PROPOSE_EVOLUTION"; ownerExpectation: string }>
  | Readonly<{ type: "APPLY_EVOLUTION" }>
  | Readonly<{ type: "TOGGLE_LOCAL_MUTE"; spaceId: string; voterId: string }>
  | Readonly<{
      type: "CAST_PET_GOVERNANCE_VOTE";
      spaceId: string;
      voterId: string;
      decision: Extract<PetGovernanceDecision, "pause" | "resume">;
    }>
  | Readonly<{ type: "EDIT_MEMORY"; memoryId: string; content: string }>
  | Readonly<{ type: "DELETE_MEMORY"; memoryId: string }>
  | Readonly<{ type: "SET_PET_ROUTINE"; routine: PetPreferences["routine"] }>
  | Readonly<{
      type: "SET_PET_PROACTIVE_FREQUENCY";
      frequency: PetPreferences["proactiveFrequency"];
    }>
  | Readonly<{ type: "SET_ACTIVE_SPACE"; spaceId: string | null }>
  | Readonly<{ type: "UPDATE_RITUAL_SETTINGS"; settings: RitualSettings }>
  | Readonly<{ type: "GENERATE_RITUAL_INVITE"; occurredAt: string }>
  | Readonly<{ type: "DISABLE_RITUAL" }>
  | Readonly<{
      type: "PLAY_SAFE_GAME";
      spaceId: string;
      actorId: string;
      gameType: SafeGameType;
      occurredAt: string;
    }>
  | Readonly<{ type: "RESET_DEMO"; now: string }>;

function cloneDemoState(): AppState {
  const demo = createDemoSeed();

  return Object.freeze({
    ...demo,
    pet: Object.freeze({ ...demo.pet, experiences: Object.freeze([]) }),
    activeSpaceId: null,
    pendingEvolution: null,
    evolutionEvents: Object.freeze([]),
    currentUserId: demo.pet.ownerId,
    nextDelegationSequence: 1,
    consumedEvolutionExperienceIds: Object.freeze([]),
    ritualSettings: Object.freeze({
      enabled: true,
      spaceId: demo.spaces[0].id,
      time: "21:30",
      frequency: "daily",
      timezone: "Asia/Shanghai",
    }),
  });
}

export function createInitialAppState(): AppState {
  return cloneDemoState();
}

const DEFAULT_PET_PREFERENCES: PetPreferences = Object.freeze({
  routine: "22:30–07:30",
  proactiveFrequency: "daily",
});

function validPreferences(value: unknown): PetPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_PET_PREFERENCES;
  }
  const candidate = value as Partial<PetPreferences>;
  const routine = candidate.routine === "23:30–08:00" ? candidate.routine : "22:30–07:30";
  const proactiveFrequency = candidate.proactiveFrequency === "low" || candidate.proactiveFrequency === "quiet"
    ? candidate.proactiveFrequency
    : "daily";
  return Object.freeze({ routine, proactiveFrequency });
}

function nextSequenceFrom(actions: AppState["delegatedActions"], petId: string): number {
  const prefix = `delegated-${petId}-`;
  const sequences = actions
    .map((action) => action.id?.startsWith(prefix) ? Number(action.id.slice(prefix.length)) : 0)
    .filter((value) => Number.isInteger(value) && value > 0);
  return Math.max(actions.length, ...sequences, 0) + 1;
}

function uniqueDelegatedActions(
  actions: readonly DelegatedAction[],
  petId: string,
): readonly DelegatedAction[] {
  const seen = new Set<string>();
  let migratedSequence = 1;

  return Object.freeze(actions.map((action) => {
    let id = action.id;
    while (!id || seen.has(id)) {
      id = `delegated-${petId}-migrated-${migratedSequence}`;
      migratedSequence += 1;
    }
    seen.add(id);
    return id === action.id ? action : Object.freeze({ ...action, id });
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const RELATIONSHIP_KINDS = new Set(["lover_pair", "friend_pair", "friend_circle"]);
const ACTOR_TYPES = new Set(["human", "pet", "space_agent"]);
const EXPERIENCE_CATEGORIES = new Set(["care", "work", "social", "shared"]);

function normalizeSpace(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.kind !== "string" ||
    !RELATIONSHIP_KINDS.has(value.kind) ||
    !isStringArray(value.memberIds)
  ) {
    return null;
  }
  const votes = Array.isArray(value.petGovernanceVotes)
    ? value.petGovernanceVotes.filter((vote) =>
        isRecord(vote) &&
        typeof vote.voterId === "string" &&
        typeof vote.decision === "string" &&
        ["pause", "resume", "mute_locally", "unmute_locally"].includes(vote.decision),
      )
    : [];
  const memberNames = isRecord(value.memberNames) ? value.memberNames : null;
  return Object.freeze({
    id: value.id,
    name: value.name,
    kind: value.kind as "lover_pair" | "friend_pair" | "friend_circle",
    memberIds: Object.freeze([...new Set(value.memberIds)]),
    memberNames: Object.freeze(
      memberNames
        ? Object.fromEntries(value.memberIds.map((memberId) => [
            memberId,
            typeof memberNames[memberId] === "string" ? memberNames[memberId] : memberId,
          ]))
        : Object.fromEntries(value.memberIds.map((memberId) => [memberId, memberId])),
    ),
    locallyMutedPetIds: Object.freeze(
      isStringArray(value.locallyMutedPetIds) ? [...new Set(value.locallyMutedPetIds)] : [],
    ),
    petGovernanceVotes: Object.freeze(votes.map((vote) => Object.freeze({
      voterId: vote.voterId as string,
      decision: vote.decision as PetGovernanceDecision,
      ...(typeof vote.petId === "string" ? { petId: vote.petId } : {}),
    }))),
  });
}

function normalizeExperience(
  value: unknown,
  spaces: readonly NonNullable<ReturnType<typeof normalizeSpace>>[] = [],
  fallbackActorId = "unknown",
  fallbackOccurredAt = "1970-01-01T00:00:00.000Z",
): GrowthExperience | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.category !== "string" ||
    !EXPERIENCE_CATEGORIES.has(value.category) ||
    typeof value.summary !== "string"
  ) {
    return null;
  }
  const id = value.id;
  const rawProvenance = isRecord(value.provenance) ? value.provenance : null;
  const validProvenance = Boolean(rawProvenance) &&
    (rawProvenance?.source === "care" || rawProvenance?.source === "game" || rawProvenance?.source === "legacy") &&
    typeof rawProvenance?.actorId === "string" &&
    typeof rawProvenance?.occurredAt === "string";
  const explicitSpace = value.scope === "space" && typeof value.spaceId === "string"
    ? spaces.find((space) => space.id === value.spaceId)
    : undefined;
  const legacySpace = value.category === "care"
    ? [...spaces]
        .sort((left, right) => right.id.length - left.id.length)
        .find((space) => id.startsWith(`care-${space.id}-`))
    : undefined;
  const space = explicitSpace ?? legacySpace;
  if (value.category === "care" && !space) {
    return null;
  }
  const scope = space ? "space" as const : value.scope === "global" ? "global" as const : "global" as const;
  return Object.freeze({
    id,
    category: value.category as GrowthExperience["category"],
    summary: value.summary,
    scope,
    ...(space ? { spaceId: space.id } : {}),
    provenance: Object.freeze(validProvenance ? {
      source: rawProvenance?.source as "care" | "game" | "legacy",
      actorId: rawProvenance?.actorId as string,
      occurredAt: rawProvenance?.occurredAt as string,
    } : {
      source: "legacy" as const,
      actorId: fallbackActorId,
      occurredAt: fallbackOccurredAt,
    }),
  });
}

function normalizeEvolutionEvent(
  value: unknown,
  spaces: readonly NonNullable<ReturnType<typeof normalizeSpace>>[] = [],
  fallbackActorId = "unknown",
  fallbackOccurredAt = "1970-01-01T00:00:00.000Z",
): EvolutionEvent | null {
  if (
    !isRecord(value) ||
    typeof value.petName !== "string" ||
    typeof value.ownerInfluence !== "string" ||
    value.decisionBy !== "pet" ||
    !(typeof value.visualTrait === "string" || value.visualTrait === null) ||
    !Array.isArray(value.sources)
  ) {
    return null;
  }
  const sources = value.sources.map((source) => normalizeExperience(
    source,
    spaces,
    fallbackActorId,
    fallbackOccurredAt,
  )).filter(
    (source): source is GrowthExperience => Boolean(source),
  );
  if (sources.length !== value.sources.length) return null;
  return Object.freeze({
    petName: value.petName,
    sources: Object.freeze(sources),
    ownerInfluence: value.ownerInfluence,
    decisionBy: "pet",
    visualTrait: value.visualTrait,
  });
}

type NormalizedSavedState = Readonly<{ state: AppState | null; repaired: boolean }>;

export function normalizeSavedStateWithIssues(value: unknown): NormalizedSavedState {
  if (!isRecord(value) || !isRecord(value.pet)) {
    return Object.freeze({ state: null, repaired: true });
  }

  const fallback = createInitialAppState();
  const rawPet = value.pet;
  const rawAnchors = isRecord(rawPet.identityAnchors) ? rawPet.identityAnchors : null;
  if (
    typeof rawPet.id !== "string" ||
    typeof rawPet.ownerId !== "string" ||
    typeof rawPet.name !== "string" ||
    typeof rawPet.lifeSeed !== "string" ||
    !rawAnchors ||
    !["eyes", "coreColor", "voice", "silhouette", "signatureOrgan"].every(
      (key) => typeof rawAnchors[key] === "string",
    ) ||
    !isStringArray(rawPet.abstractTraits)
  ) {
    return Object.freeze({ state: null, repaired: true });
  }

  let repaired = false;
  const rawSpaces = Array.isArray(value.spaces) ? value.spaces : [];
  if (!Array.isArray(value.spaces)) repaired = true;
  const spaces = rawSpaces.map(normalizeSpace).filter(
    (space): space is NonNullable<ReturnType<typeof normalizeSpace>> => Boolean(space),
  );
  if (spaces.length !== rawSpaces.length) repaired = true;
  const spaceById = new Map(spaces.map((space) => [space.id, space]));

  const rawMemories = Array.isArray(rawPet.memories) ? rawPet.memories : [];
  if (!Array.isArray(rawPet.memories)) repaired = true;
  const memories = rawMemories.filter((memory) =>
    isRecord(memory) &&
    typeof memory.id === "string" &&
    typeof memory.spaceId === "string" &&
    (memory.spaceId === "global" || spaceById.has(memory.spaceId)) &&
    memory.ownerId === rawPet.ownerId &&
    typeof memory.source === "string" &&
    typeof memory.occurredAt === "string" &&
    typeof memory.content === "string" &&
    (memory.sensitivity === "normal" || memory.sensitivity === "sensitive") &&
    (memory.visibility === "space_members" || memory.visibility === "owner_only"),
  );
  if (memories.length !== rawMemories.length) repaired = true;

  const migrationOccurredAt = typeof value.lastActiveAt === "string"
    ? value.lastActiveAt
    : fallback.lastActiveAt;
  const rawExperiences = Array.isArray(rawPet.experiences) ? rawPet.experiences : [];
  if (rawPet.experiences !== undefined && !Array.isArray(rawPet.experiences)) repaired = true;
  const experiences = rawExperiences.map((experience) => normalizeExperience(
    experience,
    spaces,
    rawPet.ownerId as string,
    migrationOccurredAt,
  )).filter(
    (experience): experience is GrowthExperience => Boolean(experience),
  );
  if (experiences.length !== rawExperiences.length) repaired = true;

  const pet = Object.freeze({
    id: rawPet.id,
    ownerId: rawPet.ownerId,
    name: rawPet.name,
    lifeSeed: rawPet.lifeSeed,
    status: rawPet.status === "exploring_spaces" ? "exploring_spaces" as const : "waiting_warmly" as const,
    identityAnchors: Object.freeze({
      eyes: rawAnchors.eyes as string,
      coreColor: rawAnchors.coreColor as string,
      voice: rawAnchors.voice as string,
      silhouette: rawAnchors.silhouette as string,
      signatureOrgan: rawAnchors.signatureOrgan as string,
    }),
    abstractTraits: Object.freeze([...rawPet.abstractTraits]),
    memories: Object.freeze(memories.map((memory) => Object.freeze({ ...memory }))) as AppPet["memories"],
    experiences: Object.freeze(experiences),
  });

  const rawMessages = Array.isArray(value.messages) ? value.messages : [];
  if (!Array.isArray(value.messages)) repaired = true;
  const messages = rawMessages.filter((message) => {
    if (
      !isRecord(message) ||
      typeof message.id !== "string" ||
      typeof message.spaceId !== "string" ||
      !spaceById.has(message.spaceId) ||
      typeof message.actorType !== "string" ||
      !ACTOR_TYPES.has(message.actorType) ||
      typeof message.actorId !== "string" ||
      typeof message.content !== "string" ||
      typeof message.occurredAt !== "string"
    ) return false;
    const space = spaceById.get(message.spaceId);
    return message.actorType !== "human" || Boolean(space?.memberIds.includes(message.actorId));
  }).map((message) => {
    const actorType = message.actorType as SpaceMessage["actorType"];
    const rawMetadata = isRecord(message.metadata) ? message.metadata : null;
    const format = message.format === "image_placeholder" || message.format === "voice_placeholder"
      ? message.format
      : "text";
    const permissionSource = actorType === "human"
      ? (message.permissionSource === "member_game_contribution" ? "member_game_contribution" : "member_message")
      : actorType === "pet"
        ? message.permissionSource === "pet_corner"
          ? "pet_corner"
          : message.permissionSource === "pet_ritual_invite"
            ? "pet_ritual_invite"
            : message.permissionSource === "pet_safe_game_contribution"
              ? "pet_safe_game_contribution"
              : "pet_space_context"
        : message.permissionSource === "space_safe_game_host"
          ? "space_safe_game_host"
          : "space_objective_summary";
    return Object.freeze({
      id: message.id as string,
      spaceId: message.spaceId as string,
      actorType,
      actorId: actorType === "pet" ? pet.id : message.actorId as string,
      permissionSource,
      content: message.content as string,
      occurredAt: message.occurredAt as string,
      format,
      ...(rawMetadata || format !== "text" ? { metadata: Object.freeze({
        ...(typeof rawMetadata?.replyToMessageId === "string" ? { replyToMessageId: rawMetadata.replyToMessageId } : {}),
        ...(typeof rawMetadata?.replyPreview === "string" ? { replyPreview: rawMetadata.replyPreview } : {}),
        ...(typeof rawMetadata?.mood === "string" ? { mood: rawMetadata.mood } : {}),
        ...(rawMetadata?.communicationIntent === "share" || rawMetadata?.communicationIntent === "seek_comfort"
          ? { communicationIntent: rawMetadata.communicationIntent }
          : {}),
        ...(format !== "text" ? { mediaBoundary: "local_demo_not_uploaded" as const } : {}),
      }) } : {}),
    });
  });
  if (messages.length !== rawMessages.length) repaired = true;

  const rawStories = Array.isArray(value.petCornerStories) ? value.petCornerStories : [];
  if (!Array.isArray(value.petCornerStories)) repaired = true;
  const petCornerStories = rawStories.filter((story) =>
    isRecord(story) &&
    typeof story.id === "string" &&
    typeof story.spaceId === "string" &&
    spaceById.has(story.spaceId) &&
    typeof story.content === "string" &&
    typeof story.occurredAt === "string",
  ).map((story) => Object.freeze({
    id: story.id as string,
    actorType: "pet" as const,
    permissionSource: "pet_corner" as const,
    petId: pet.id,
    spaceId: story.spaceId as string,
    content: story.content as string,
    occurredAt: story.occurredAt as string,
  }));
  if (petCornerStories.length !== rawStories.length) repaired = true;

  const rawActions = Array.isArray(value.delegatedActions) ? value.delegatedActions : [];
  if (!Array.isArray(value.delegatedActions)) repaired = true;
  const canonicalActions = rawActions.flatMap((action) => {
    if (!isRecord(action) || typeof action.kind !== "string" || typeof action.spaceId !== "string") {
      repaired = true;
      return [];
    }
    const space = spaceById.get(action.spaceId);
    if (!space || !space.memberIds.includes(pet.ownerId)) {
      repaired = true;
      return [];
    }
    const canonical = createDelegatedAction(pet, {
      kind: action.kind,
      spaceId: action.spaceId,
      summary: typeof action.summary === "string" ? action.summary : undefined,
      requestId: typeof action.id === "string" ? action.id : undefined,
    });
    const status = canPetExecute(canonical) && action.status === "completed"
      ? "completed" as const
      : canonical.status;
    if (
      action.petId !== pet.id ||
      action.ownerId !== pet.ownerId ||
      action.permissionSource !== canonical.permissionSource ||
      action.status !== status
    ) repaired = true;
    return [Object.freeze({ ...canonical, status })];
  });
  const delegatedActions = uniqueDelegatedActions(canonicalActions, pet.id);

  const rawEvolutionEvents = Array.isArray(value.evolutionEvents) ? value.evolutionEvents : [];
  if (value.evolutionEvents !== undefined && !Array.isArray(value.evolutionEvents)) repaired = true;
  const evolutionEvents = rawEvolutionEvents.map((event) => normalizeEvolutionEvent(
    event,
    spaces,
    pet.ownerId,
    migrationOccurredAt,
  )).filter(
    (event): event is EvolutionEvent => Boolean(event),
  );
  if (evolutionEvents.length !== rawEvolutionEvents.length) repaired = true;
  const pendingEvolution = value.pendingEvolution === null || value.pendingEvolution === undefined
    ? null
    : normalizeEvolutionEvent(value.pendingEvolution, spaces, pet.ownerId, migrationOccurredAt);
  if (value.pendingEvolution && !pendingEvolution) repaired = true;
  const consumedFromEvents = evolutionEvents.flatMap((event) => event.sources.map((source) => source.id));
  const consumed = Array.isArray(value.consumedEvolutionExperienceIds)
    ? value.consumedEvolutionExperienceIds.filter((id): id is string => typeof id === "string")
    : consumedFromEvents;
  if (!Array.isArray(value.consumedEvolutionExperienceIds)) repaired = true;
  const currentUserId = typeof value.currentUserId === "string" &&
    spaces.some((space) => space.memberIds.includes(value.currentUserId as string))
    ? value.currentUserId
    : pet.ownerId;
  if (currentUserId !== value.currentUserId) repaired = true;
  const storedNextDelegationSequence = Number.isInteger(value.nextDelegationSequence) &&
    (value.nextDelegationSequence as number) > 0
    ? value.nextDelegationSequence as number
    : 1;
  const nextDelegationSequence = Math.max(
    storedNextDelegationSequence,
    nextSequenceFrom(delegatedActions, pet.id),
  );
  const activeSpaceId = typeof value.activeSpaceId === "string" &&
    spaces.some((space) => space.id === value.activeSpaceId && space.memberIds.includes(currentUserId))
    ? value.activeSpaceId
    : null;
  const lastActiveAt = typeof value.lastActiveAt === "string" ? value.lastActiveAt : fallback.lastActiveAt;
  if (lastActiveAt !== value.lastActiveAt) repaired = true;
  const rawRitual = isRecord(value.ritualSettings) ? value.ritualSettings : null;
  const ritualSpaceId = typeof rawRitual?.spaceId === "string" && spaceById.has(rawRitual.spaceId)
    ? rawRitual.spaceId
    : spaces.find((space) => space.memberIds.includes(currentUserId))?.id ?? fallback.ritualSettings.spaceId;
  const ritualSettings: RitualSettings = Object.freeze({
    enabled: typeof rawRitual?.enabled === "boolean" ? rawRitual.enabled : true,
    spaceId: ritualSpaceId,
    time: typeof rawRitual?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(rawRitual.time)
      ? rawRitual.time
      : "21:30",
    frequency: rawRitual?.frequency === "weekly" ? "weekly" : "daily",
    timezone: typeof rawRitual?.timezone === "string" && rawRitual.timezone.trim()
      ? rawRitual.timezone
      : "Asia/Shanghai",
  });
  if (!rawRitual) repaired = true;

  return Object.freeze({
    repaired,
    state: Object.freeze({
      pet,
      spaces: Object.freeze(spaces),
      messages: Object.freeze(messages),
      petCornerStories: Object.freeze(petCornerStories),
      delegatedActions,
      lastActiveAt,
      petPreferences: validPreferences(value.petPreferences),
      activeSpaceId,
      pendingEvolution,
      evolutionEvents: Object.freeze(evolutionEvents),
      currentUserId,
      nextDelegationSequence,
      consumedEvolutionExperienceIds: Object.freeze([...new Set(consumed)]),
      ritualSettings,
    }),
  });
}

export function normalizeSavedState(value: unknown): AppState | null {
  return normalizeSavedStateWithIssues(value).state;
}

function messageId(prefix: string, messages: readonly SpaceMessage[]): string {
  return `${prefix}-${messages.length + 1}`;
}

function findSpace(state: AppState, spaceId: string) {
  return state.spaces.find((space) => space.id === spaceId);
}

function isCurrentSpaceMember(state: AppState, spaceId: string, claimedUserId: string): boolean {
  const space = findSpace(state, spaceId);
  return claimedUserId === state.currentUserId && Boolean(space?.memberIds.includes(claimedUserId));
}

function appendMessage(state: AppState, message: SpaceMessage): AppState {
  return Object.freeze({
    ...state,
    messages: Object.freeze([...state.messages, Object.freeze(message)]),
  });
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SEND_HUMAN_MESSAGE": {
      if (!isCurrentSpaceMember(state, action.spaceId, action.actorId) || !action.content.trim()) {
        return state;
      }

      return appendMessage(state, {
        id: messageId("human-message", state.messages),
        spaceId: action.spaceId,
        actorType: "human",
        actorId: action.actorId,
        permissionSource: "member_message",
        content: action.content,
        occurredAt: action.occurredAt,
        format: action.format ?? "text",
        ...(action.metadata || action.format === "image_placeholder" || action.format === "voice_placeholder" ? {
          metadata: Object.freeze({
            ...(typeof action.metadata?.replyToMessageId === "string" && state.messages.some(
              (message) => message.id === action.metadata?.replyToMessageId && message.spaceId === action.spaceId,
            ) ? {
              replyToMessageId: action.metadata.replyToMessageId,
              replyPreview: state.messages.find(
                (message) => message.id === action.metadata?.replyToMessageId && message.spaceId === action.spaceId,
              )?.content,
            } : {}),
            ...(action.metadata?.mood?.trim() ? { mood: action.metadata.mood.trim() } : {}),
            ...(action.metadata?.communicationIntent === "share" || action.metadata?.communicationIntent === "seek_comfort"
              ? { communicationIntent: action.metadata.communicationIntent }
              : {}),
            ...(action.format === "image_placeholder" || action.format === "voice_placeholder"
              ? { mediaBoundary: "local_demo_not_uploaded" as const }
              : {}),
          }),
        } : {}),
      });
    }

    case "CARE_FOR_PET": {
      const space = findSpace(state, action.spaceId);
      if (!space || !isCurrentSpaceMember(state, action.spaceId, action.byUserId) || !action.care.trim()) {
        return state;
      }

      const experience: GrowthExperience = Object.freeze({
        id: `care-${space.id}-${state.pet.experiences.length + 1}`,
        category: action.byUserId === state.pet.ownerId ? "care" : "social",
        summary: `${action.byUserId}在${space.name}照顾了${state.pet.name}：${action.care}。`,
        scope: "space",
        spaceId: space.id,
        provenance: Object.freeze({
          source: "care",
          actorId: action.byUserId,
          occurredAt: action.occurredAt,
        }),
      });

      return Object.freeze({
        ...state,
        pet: Object.freeze({
          ...state.pet,
          experiences: Object.freeze([...state.pet.experiences, experience]),
        }),
      });
    }

    case "REQUEST_DELEGATION": {
      const targetSpace = action.request.spaceId
        ? findSpace(state, action.request.spaceId)
        : undefined;
      if (
        state.currentUserId !== state.pet.ownerId ||
        !targetSpace ||
        !targetSpace.memberIds.includes(state.currentUserId)
      ) {
        return state;
      }
      const requestId = `delegated-${state.pet.id}-${state.nextDelegationSequence}`;
      return Object.freeze({
        ...state,
        delegatedActions: Object.freeze([
          ...state.delegatedActions,
          createDelegatedAction(state.pet, { ...action.request, requestId }),
        ]),
        nextDelegationSequence: state.nextDelegationSequence + 1,
      });
    }

    case "CONFIRM_ACTION": {
      const delegatedAction = state.delegatedActions.find(
        (candidate) => candidate.id === action.actionId,
      );
      if (
        state.currentUserId !== state.pet.ownerId ||
        !delegatedAction ||
        !canPetExecute(delegatedAction) ||
        delegatedAction.petId !== state.pet.id ||
        delegatedAction.ownerId !== state.pet.ownerId ||
        delegatedAction.status !== "pending_owner" ||
        delegatedAction.permissionSource !== "pet_low_risk_delegation" ||
        typeof delegatedAction.spaceId !== "string" ||
        !isCurrentSpaceMember(state, delegatedAction.spaceId, state.currentUserId)
      ) {
        return state;
      }

      return Object.freeze({
        ...state,
        delegatedActions: Object.freeze(
          state.delegatedActions.map((candidate) =>
            candidate.id === action.actionId
              ? Object.freeze({ ...candidate, status: "completed" as const })
              : candidate,
          ),
        ),
      });
    }

    case "REVOKE_ACTION":
      if (state.currentUserId !== state.pet.ownerId) {
        return state;
      }
      return Object.freeze({
        ...state,
        delegatedActions: Object.freeze(
          state.delegatedActions.filter((candidate) => candidate.id !== action.actionId),
        ),
      });

    case "QUERY_PET": {
      if (!isCurrentSpaceMember(state, action.spaceId, action.requesterId)) {
        return state;
      }
      const narrative = askPetWhatHappened(state.pet, action.spaceId, action.requesterId);

      return appendMessage(state, {
        id: messageId("pet-query", state.messages),
        spaceId: action.spaceId,
        actorType: narrative.actorType,
        actorId: narrative.petId,
        permissionSource: narrative.permissionSource,
        content: narrative.content,
        occurredAt: action.occurredAt,
      });
    }

    case "RUN_SPACE_SUMMARY": {
      const space = findSpace(state, action.spaceId);
      if (!space || !space.memberIds.includes(state.currentUserId)) {
        return state;
      }
      const summary = summarizeSpace(space, state.messages);

      return appendMessage(state, {
        id: messageId("space-summary", state.messages),
        spaceId: action.spaceId,
        actorType: summary.actorType,
        actorId: `space-agent-${space.id}`,
        permissionSource: summary.permissionSource,
        content: summary.content,
        occurredAt: action.occurredAt,
      });
    }

    case "PROPOSE_EVOLUTION": {
      if (state.currentUserId !== state.pet.ownerId || state.pendingEvolution) {
        return state;
      }
      const newExperiences = state.pet.experiences.filter(
        (experience) => !state.consumedEvolutionExperienceIds.includes(experience.id),
      );
      if (newExperiences.length === 0) {
        return state;
      }
      return Object.freeze({
        ...state,
        pendingEvolution: proposeEvolution(
          state.pet,
          newExperiences,
          action.ownerExpectation,
        ),
      });
    }

    case "APPLY_EVOLUTION": {
      if (state.currentUserId !== state.pet.ownerId || !state.pendingEvolution) {
        return state;
      }
      const event = state.pendingEvolution;

      return Object.freeze({
        ...state,
        pet: Object.freeze({
          ...applyEvolution(state.pet, event),
          status: state.pet.status,
          experiences: state.pet.experiences,
        }),
        pendingEvolution: null,
        evolutionEvents: Object.freeze([...state.evolutionEvents, event]),
        consumedEvolutionExperienceIds: Object.freeze([
          ...new Set([
            ...state.consumedEvolutionExperienceIds,
            ...event.sources.map((source) => source.id),
          ]),
        ]),
      });
    }

    case "TOGGLE_LOCAL_MUTE": {
      const space = findSpace(state, action.spaceId);
      if (!space || !isCurrentSpaceMember(state, action.spaceId, action.voterId)) {
        return state;
      }
      const isMuted = space.locallyMutedPetIds.includes(state.pet.id);
      const updatedSpace = applyPetGovernance(space, state.pet.id, {
        voterId: action.voterId,
        decision: isMuted ? "unmute_locally" : "mute_locally",
      });

      return Object.freeze({
        ...state,
        spaces: Object.freeze(
          state.spaces.map((candidate) =>
            candidate.id === updatedSpace.id ? updatedSpace : candidate,
          ),
        ),
      });
    }

    case "CAST_PET_GOVERNANCE_VOTE": {
      const space = findSpace(state, action.spaceId);
      if (!space || !isCurrentSpaceMember(state, action.spaceId, action.voterId)) {
        return state;
      }
      const updatedSpace = applyPetGovernance(space, state.pet.id, {
        voterId: action.voterId,
        decision: action.decision,
      });

      return Object.freeze({
        ...state,
        spaces: Object.freeze(
          state.spaces.map((candidate) =>
            candidate.id === updatedSpace.id ? updatedSpace : candidate,
          ),
        ),
      });
    }

    case "EDIT_MEMORY": {
      const content = action.content.trim();
      if (!content) {
        return state;
      }
      const memory = state.pet.memories.find((candidate) => candidate.id === action.memoryId);
      if (state.currentUserId !== state.pet.ownerId || !memory || memory.ownerId !== state.pet.ownerId) {
        return state;
      }
      return Object.freeze({
        ...state,
        pet: Object.freeze({
          ...state.pet,
          memories: Object.freeze(
            state.pet.memories.map((candidate) =>
              candidate.id === action.memoryId
                ? Object.freeze({ ...candidate, content })
                : candidate,
            ),
          ),
        }),
      });
    }

    case "DELETE_MEMORY": {
      const memory = state.pet.memories.find((candidate) => candidate.id === action.memoryId);
      if (state.currentUserId !== state.pet.ownerId || !memory || memory.ownerId !== state.pet.ownerId) {
        return state;
      }
      return Object.freeze({
        ...state,
        pet: Object.freeze({
          ...state.pet,
          memories: Object.freeze(
            state.pet.memories.filter((candidate) => candidate.id !== action.memoryId),
          ),
        }),
      });
    }

    case "SET_PET_ROUTINE":
      if (state.currentUserId !== state.pet.ownerId) {
        return state;
      }
      return Object.freeze({
        ...state,
        petPreferences: Object.freeze({ ...state.petPreferences, routine: action.routine }),
      });

    case "SET_PET_PROACTIVE_FREQUENCY":
      if (state.currentUserId !== state.pet.ownerId) {
        return state;
      }
      return Object.freeze({
        ...state,
        petPreferences: Object.freeze({
          ...state.petPreferences,
          proactiveFrequency: action.frequency,
        }),
      });

    case "SET_ACTIVE_SPACE":
      return action.spaceId !== null &&
        !isCurrentSpaceMember(state, action.spaceId, state.currentUserId)
        ? state
        : Object.freeze({ ...state, activeSpaceId: action.spaceId });

    case "UPDATE_RITUAL_SETTINGS": {
      const space = findSpace(state, action.settings.spaceId);
      if (
        !space ||
        !space.memberIds.includes(state.currentUserId) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(action.settings.time) ||
        !action.settings.timezone.trim()
      ) {
        return state;
      }
      return Object.freeze({
        ...state,
        ritualSettings: Object.freeze({ ...action.settings, enabled: true }),
      });
    }

    case "GENERATE_RITUAL_INVITE": {
      const settings = state.ritualSettings;
      const space = findSpace(state, settings.spaceId);
      if (!settings.enabled || !space || !space.memberIds.includes(state.currentUserId)) {
        return state;
      }
      const frequency = settings.frequency === "daily" ? "每天" : "每周";
      return appendMessage(state, {
        id: messageId("ritual-invite", state.messages),
        spaceId: space.id,
        actorType: "pet",
        actorId: state.pet.id,
        permissionSource: "pet_ritual_invite",
        content: `${state.pet.name}邀请大家${frequency} ${settings.time}（${settings.timezone}）留十分钟碰个面。仅是邀请，不代表任何成员确认真实见面。`,
        occurredAt: action.occurredAt,
      });
    }

    case "DISABLE_RITUAL":
      return Object.freeze({
        ...state,
        ritualSettings: Object.freeze({ ...state.ritualSettings, enabled: false }),
      });

    case "PLAY_SAFE_GAME": {
      const space = findSpace(state, action.spaceId);
      if (!space || !isCurrentSpaceMember(state, action.spaceId, action.actorId)) {
        return state;
      }
      const gameCopy: Readonly<Record<SafeGameType, Readonly<{
        human: string;
        pet: string;
        host: string;
      }>>> = {
        same_prompt_reveal: {
          human: "人类素材：今天最想收藏的是海风。",
          pet: `异宠素材：${state.pet.name}选择了薄荷糖。`,
          host: "空间主 Agent 主持同题揭晓：双方素材已同时翻牌。",
        },
        guess_choice: {
          human: "人类素材：猜灯灯会选靠窗的位置。",
          pet: `异宠素材：${state.pet.name}猜大家会选软垫。`,
          host: "空间主 Agent 主持猜测选择：现在公开彼此的预设选择。",
        },
        relay: {
          human: "人类素材：故事从一盏小灯开始。",
          pet: `异宠素材：${state.pet.name}接上了一条发光小路。`,
          host: "空间主 Agent 主持接力：把两段安全素材组合成一则短故事。",
        },
      };
      const copy = gameCopy[action.gameType];
      if (!copy) {
        return state;
      }
      const base = state.messages.length + 1;
      const gameMessages: readonly SpaceMessage[] = Object.freeze([
        Object.freeze({
          id: `safe-game-human-${base}`,
          spaceId: space.id,
          actorType: "human",
          actorId: action.actorId,
          permissionSource: "member_game_contribution",
          content: copy.human,
          occurredAt: action.occurredAt,
          format: "text",
        }),
        Object.freeze({
          id: `safe-game-pet-${base + 1}`,
          spaceId: space.id,
          actorType: "pet",
          actorId: state.pet.id,
          permissionSource: "pet_safe_game_contribution",
          content: copy.pet,
          occurredAt: action.occurredAt,
          format: "text",
        }),
        Object.freeze({
          id: `safe-game-host-${base + 2}`,
          spaceId: space.id,
          actorType: "space_agent",
          actorId: `space-agent-${space.id}`,
          permissionSource: "space_safe_game_host",
          content: copy.host,
          occurredAt: action.occurredAt,
          format: "text",
        }),
      ]);
      const experience: GrowthExperience = Object.freeze({
        id: `game-${space.id}-${state.pet.experiences.length + 1}`,
        category: "shared",
        summary: `${space.name}完成了${copy.host.replace("空间主 Agent 主持", "")}。`,
        scope: "space",
        spaceId: space.id,
        provenance: Object.freeze({ source: "game", actorId: action.actorId, occurredAt: action.occurredAt }),
      });
      return Object.freeze({
        ...state,
        messages: Object.freeze([...state.messages, ...gameMessages]),
        petCornerStories: Object.freeze([...state.petCornerStories, Object.freeze({
          id: `safe-game-story-${space.id}-${state.petCornerStories.length + 1}`,
          actorType: "pet",
          permissionSource: "pet_corner",
          petId: state.pet.id,
          spaceId: space.id,
          content: `${state.pet.name}把这轮安全共同游戏收进了宠物角。`,
          occurredAt: action.occurredAt,
        })]),
        pet: Object.freeze({
          ...state.pet,
          experiences: Object.freeze([...state.pet.experiences, experience]),
        }),
      });
    }

    case "RESET_DEMO":
      return Object.freeze({ ...createInitialAppState(), lastActiveAt: action.now });
  }
}

export function hydrateSavedState(savedState: AppState, now: string): AppState {
  const simulation = simulateOwnerAbsence(savedState, now);

  return Object.freeze({
    ...savedState,
    ...simulation,
    pet: Object.freeze({
      ...simulation.pet,
      experiences: savedState.pet.experiences,
    }),
    lastActiveAt: now,
  });
}

type AppStateContextValue = Readonly<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
  isHydrated: boolean;
}>;

const AppStateContext = createContext<AppStateContextValue | null>(null);

type AppProviderProps = PropsWithChildren<Readonly<{
  now?: () => string;
}>>;

export function AppProvider({ children, now = () => new Date().toISOString() }: AppProviderProps) {
  const [state, setState] = useState<AppState>(createInitialAppState);
  const [isHydrated, setIsHydrated] = useState(false);
  const resetRequested = useRef(false);
  const hydrationGeneration = useRef(0);
  const nowRef = useRef(now);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  const enqueueStorageWrite = useCallback((operation: () => Promise<void>) => {
    writeQueue.current = writeQueue.current.catch(() => undefined).then(operation);
    return writeQueue.current;
  }, []);

  const dispatch = useCallback<Dispatch<AppAction>>((action) => {
    if (!isHydrated) {
      return;
    }
    if (action.type === "RESET_DEMO") {
      resetRequested.current = true;
      hydrationGeneration.current += 1;
    }
    setState((current) => appReducer(current, action));
  }, [isHydrated]);

  useEffect(() => {
    let isMounted = true;
    const generation = hydrationGeneration.current;

    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(APP_STORAGE_KEY);
        if (!isMounted || generation !== hydrationGeneration.current) {
          return;
        }

        const hydrationNow = nowRef.current();
        if (!saved) {
          setState(Object.freeze({ ...createInitialAppState(), lastActiveAt: hydrationNow }));
          return;
        }

        let result: NormalizedSavedState;
        try {
          result = normalizeSavedStateWithIssues(JSON.parse(saved));
        } catch {
          result = Object.freeze({ state: null, repaired: true });
        }
        if (result.repaired) {
          await AsyncStorage.setItem(APP_INVALID_BACKUP_KEY, saved);
        }
        if (result.state) {
          setState(hydrateSavedState(result.state, hydrationNow));
        } else {
          setState(Object.freeze({ ...createInitialAppState(), lastActiveAt: hydrationNow }));
        }
      } catch {
        // Corrupt or unavailable local data falls back to the deterministic seed.
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (resetRequested.current) {
      resetRequested.current = false;
      void enqueueStorageWrite(() => AsyncStorage.removeItem(APP_STORAGE_KEY));
      return;
    }

    const snapshot = JSON.stringify(state);
    void enqueueStorageWrite(() => AsyncStorage.setItem(APP_STORAGE_KEY, snapshot));
  }, [enqueueStorageWrite, isHydrated, state]);

  return (
    <AppStateContext.Provider value={{ state, dispatch, isHydrated }}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppStateContextValue {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error("useAppState must be used within AppProvider");
  }

  return value;
}
