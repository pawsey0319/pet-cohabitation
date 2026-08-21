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
  EvolutionEvent,
  GrowthExperience,
  PetGovernanceDecision,
  PetWithStatus,
  RuntimeState,
  SpaceMessage,
} from "../domain/types";

export const APP_STORAGE_KEY = "pet-cohabitation-mvp-v1";

export type AppPet = PetWithStatus & Readonly<{
  experiences: readonly GrowthExperience[];
}>;

export type PetPreferences = Readonly<{
  routine: "22:30–07:30" | "23:30–08:00";
  proactiveFrequency: "daily" | "low" | "quiet";
}>;

export type AppState = Omit<RuntimeState, "pet"> & Readonly<{
  pet: AppPet;
  activeSpaceId: string | null;
  pendingEvolution: EvolutionEvent | null;
  evolutionEvents: readonly EvolutionEvent[];
  petPreferences: PetPreferences;
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
  | Readonly<{ type: "QUERY_PET"; spaceId: string; occurredAt: string }>
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
    petPreferences: Object.freeze({
      routine: "22:30–07:30",
      proactiveFrequency: "daily",
    }),
  });
}

export function createInitialAppState(): AppState {
  return cloneDemoState();
}

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AppState>;
  return Boolean(
    candidate.pet &&
      Array.isArray(candidate.spaces) &&
      Array.isArray(candidate.messages) &&
      Array.isArray(candidate.petCornerStories) &&
      Array.isArray(candidate.delegatedActions) &&
      Array.isArray(candidate.pet.experiences) &&
      candidate.petPreferences &&
      typeof candidate.lastActiveAt === "string",
  );
}

function messageId(prefix: string, messages: readonly SpaceMessage[]): string {
  return `${prefix}-${messages.length + 1}`;
}

function findSpace(state: AppState, spaceId: string) {
  return state.spaces.find((space) => space.id === spaceId);
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
      if (!findSpace(state, action.spaceId) || !action.content.trim()) {
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
      if (!space || !space.memberIds.includes(action.byUserId) || !action.care.trim()) {
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

    case "REQUEST_DELEGATION":
      return Object.freeze({
        ...state,
        delegatedActions: Object.freeze([
          ...state.delegatedActions,
          createDelegatedAction(state.pet, action.request),
        ]),
      });

    case "CONFIRM_ACTION": {
      const delegatedAction = state.delegatedActions.find(
        (candidate) => candidate.id === action.actionId,
      );
      if (!delegatedAction || delegatedAction.status !== "pending_owner") {
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
      return Object.freeze({
        ...state,
        delegatedActions: Object.freeze(
          state.delegatedActions.filter((candidate) => candidate.id !== action.actionId),
        ),
      });

    case "QUERY_PET": {
      if (!findSpace(state, action.spaceId)) {
        return state;
      }
      const narrative = askPetWhatHappened(state.pet, action.spaceId);

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

    case "PROPOSE_EVOLUTION":
      return Object.freeze({
        ...state,
        pendingEvolution: proposeEvolution(
          state.pet,
          state.pet.experiences,
          action.ownerExpectation,
        ),
      });

    case "APPLY_EVOLUTION": {
      if (!state.pendingEvolution) {
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
      });
    }

    case "TOGGLE_LOCAL_MUTE": {
      const space = findSpace(state, action.spaceId);
      if (!space) {
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
      if (!space) {
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
      if (!memory || memory.ownerId !== state.pet.ownerId) {
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
      if (!memory || memory.ownerId !== state.pet.ownerId) {
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
      return Object.freeze({
        ...state,
        petPreferences: Object.freeze({ ...state.petPreferences, routine: action.routine }),
      });

    case "SET_PET_PROACTIVE_FREQUENCY":
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
        if (isAppState(parsed)) {
          setState(hydrateSavedState(parsed, new Date().toISOString()));
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
