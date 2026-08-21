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
  SpaceMessage,
} from "../domain/types";

export const APP_STORAGE_KEY = "pet-cohabitation-mvp-v1";

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
}>;

export type AppAction =
  | Readonly<{
      type: "SEND_HUMAN_MESSAGE";
      spaceId: string;
      actorId: string;
      content: string;
      occurredAt: string;
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
  | Readonly<{ type: "RESET_DEMO" }>;

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

export function normalizeSavedState(value: unknown): AppState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<AppState>;
  if (
    !candidate.pet ||
    !Array.isArray(candidate.pet.memories) ||
    !Array.isArray(candidate.spaces) ||
    !Array.isArray(candidate.messages) ||
    !Array.isArray(candidate.petCornerStories) ||
    !Array.isArray(candidate.delegatedActions) ||
    typeof candidate.lastActiveAt !== "string"
  ) {
    return null;
  }

  const experiences = Array.isArray(candidate.pet.experiences)
    ? candidate.pet.experiences
    : Object.freeze([]);
  const evolutionEvents: readonly EvolutionEvent[] = Array.isArray(candidate.evolutionEvents)
    ? candidate.evolutionEvents as readonly EvolutionEvent[]
    : Object.freeze([]);
  const consumedFromEvents = evolutionEvents.flatMap((event) =>
    event.sources.map((source) => source.id),
  );
  const consumed = Array.isArray(candidate.consumedEvolutionExperienceIds)
    ? candidate.consumedEvolutionExperienceIds.filter(
        (id): id is string => typeof id === "string",
      )
    : consumedFromEvents;
  const currentUserId = typeof candidate.currentUserId === "string" &&
    candidate.spaces.some((space) => space.memberIds.includes(candidate.currentUserId as string))
    ? candidate.currentUserId
    : candidate.pet.ownerId;
  const delegatedActions = uniqueDelegatedActions(candidate.delegatedActions, candidate.pet.id);
  const storedNextDelegationSequence = Number.isInteger(candidate.nextDelegationSequence) &&
    (candidate.nextDelegationSequence as number) > 0
    ? candidate.nextDelegationSequence as number
    : 1;
  const nextDelegationSequence = Math.max(
    storedNextDelegationSequence,
    nextSequenceFrom(delegatedActions, candidate.pet.id),
  );
  const activeSpaceId = typeof candidate.activeSpaceId === "string" &&
    candidate.spaces.some((space) => space.id === candidate.activeSpaceId)
    ? candidate.activeSpaceId
    : null;

  return Object.freeze({
    pet: Object.freeze({ ...candidate.pet, experiences: Object.freeze([...experiences]) }),
    spaces: Object.freeze([...candidate.spaces]),
    messages: Object.freeze([...candidate.messages]),
    petCornerStories: Object.freeze([...candidate.petCornerStories]),
    delegatedActions,
    lastActiveAt: candidate.lastActiveAt,
    petPreferences: validPreferences(candidate.petPreferences),
    activeSpaceId,
    pendingEvolution: candidate.pendingEvolution ?? null,
    evolutionEvents: Object.freeze([...evolutionEvents]),
    currentUserId,
    nextDelegationSequence,
    consumedEvolutionExperienceIds: Object.freeze([...new Set(consumed)]),
  });
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
        delegatedAction.status !== "pending_owner"
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
      if (!space) {
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
      return action.spaceId !== null && !findSpace(state, action.spaceId)
        ? state
        : Object.freeze({ ...state, activeSpaceId: action.spaceId });

    case "RESET_DEMO":
      return createInitialAppState();
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

export function AppProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AppState>(createInitialAppState);
  const [isHydrated, setIsHydrated] = useState(false);
  const resetRequested = useRef(false);
  const hydrationGeneration = useRef(0);

  const dispatch = useCallback<Dispatch<AppAction>>((action) => {
    if (action.type === "RESET_DEMO") {
      resetRequested.current = true;
      hydrationGeneration.current += 1;
    }
    setState((current) => appReducer(current, action));
  }, []);

  useEffect(() => {
    let isMounted = true;
    const generation = hydrationGeneration.current;

    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(APP_STORAGE_KEY);
        if (!isMounted || generation !== hydrationGeneration.current || !saved) {
          return;
        }

        const parsed: unknown = JSON.parse(saved);
        const normalized = normalizeSavedState(parsed);
        if (normalized) {
          setState(hydrateSavedState(normalized, new Date().toISOString()));
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
      void AsyncStorage.removeItem(APP_STORAGE_KEY);
      return;
    }

    void AsyncStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
  }, [isHydrated, state]);

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
