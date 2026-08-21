jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createElement } from "react";
import { Button, Text, View } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import {
  APP_STORAGE_KEY,
  AppProvider,
  appReducer,
  createInitialAppState,
  hydrateSavedState,
  normalizeSavedState,
  useAppState,
} from "../state/AppState";

const occurredAt = "2026-08-21T09:00:00.000Z";

function ProviderStateProbe() {
  const { dispatch, isHydrated, state } = useAppState();
  const containsStaleMessage = state.messages.some(
    (message) => message.content === "过期消息",
  );

  return createElement(
    View,
    null,
    createElement(Text, { testID: "provider-state" }, containsStaleMessage ? "stale" : "seed"),
    createElement(Text, { testID: "provider-hydrated" }, isHydrated ? "hydrated" : "loading"),
    createElement(Button, {
      title: "重置演示",
      onPress: () => dispatch({ type: "RESET_DEMO", now: occurredAt }),
    }),
    createElement(Button, {
      title: "写入消息",
      onPress: () => dispatch({
        type: "SEND_HUMAN_MESSAGE",
        spaceId: state.spaces[0].id,
        actorId: state.currentUserId,
        content: "排队后的新快照",
        occurredAt,
      }),
    }),
  );
}

function MigrationProbe() {
  const { state } = useAppState();
  return createElement(
    Text,
    { testID: "migration-state" },
    JSON.stringify({
      currentUserId: state.currentUserId,
      preferences: state.petPreferences,
      nextDelegationSequence: state.nextDelegationSequence,
      consumed: state.consumedEvolutionExperienceIds,
      keptMessage: state.messages.some((message) => message.content === "旧存档消息"),
      keptMemory: state.pet.memories.some((memory) => memory.content === "旧存档记忆"),
      keptEvolution: state.evolutionEvents.some((event) => event.ownerInfluence === "旧存档祝福"),
    }),
  );
}

describe("application state reducer", () => {
  it("migrates a v1 payload without new fields and persists the preserved data", async () => {
    const current = createInitialAppState();
    const oldExperience = Object.freeze({
      id: "care-space-old-friends-legacy",
      category: "care" as const,
      summary: "旧存档经历",
    });
    const oldEvolution = Object.freeze({
      petName: current.pet.name,
      sources: Object.freeze([oldExperience]),
      ownerInfluence: "旧存档祝福",
      decisionBy: "pet" as const,
      visualTrait: "暖心徽记",
    });
    const legacy: Record<string, unknown> = {
      ...current,
      lastActiveAt: new Date().toISOString(),
      messages: Object.freeze([
        ...current.messages,
        Object.freeze({
          id: "legacy-message",
          spaceId: current.spaces[0].id,
          actorType: "human" as const,
          actorId: current.pet.ownerId,
          permissionSource: "member_message",
          content: "旧存档消息",
          occurredAt,
        }),
      ]),
      pet: Object.freeze({
        ...current.pet,
        experiences: Object.freeze([oldExperience]),
        memories: Object.freeze([
          ...current.pet.memories,
          Object.freeze({
            ...current.pet.memories[0],
            id: "legacy-memory",
            content: "旧存档记忆",
          }),
        ]),
      }),
      evolutionEvents: Object.freeze([oldEvolution]),
    };
    delete legacy.petPreferences;
    delete legacy.currentUserId;
    delete legacy.nextDelegationSequence;
    delete legacy.consumedEvolutionExperienceIds;
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(legacy));

    const provider = await render(createElement(AppProvider, null, createElement(MigrationProbe)));

    await waitFor(() => {
      expect(provider.getByTestId("migration-state").props.children).toContain('"keptMessage":true');
    });
    const migrated = JSON.parse(provider.getByTestId("migration-state").props.children);
    expect(migrated).toMatchObject({
      currentUserId: current.pet.ownerId,
      preferences: { routine: "22:30–07:30", proactiveFrequency: "daily" },
      nextDelegationSequence: 1,
      consumed: ["care-space-old-friends-legacy"],
      keptMessage: true,
      keptMemory: true,
      keptEvolution: true,
    });
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalled());
    const savedPayload = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1]);
    expect(savedPayload.messages.some((message: { content: string }) => message.content === "旧存档消息")).toBe(true);
  });

  it("blocks a requested high-risk delegation through the runtime policy", () => {
    const seed = createInitialAppState();

    const next = appReducer(seed, {
      type: "REQUEST_DELEGATION",
      request: { kind: "purchase", spaceId: seed.spaces[0].id, summary: "买一份礼物" },
    });

    expect(next.delegatedActions.at(-1)?.status).toBe("blocked");
    expect(next.delegatedActions.at(-1)?.permissionSource).toBe("delegation_policy");
  });

  it("cannot confirm a blocked delegation", () => {
    const seed = createInitialAppState();
    const blocked = appReducer(seed, {
      type: "REQUEST_DELEGATION",
      request: { kind: "purchase", spaceId: seed.spaces[0].id },
    });
    const actionId = blocked.delegatedActions.at(-1)?.id as string;

    const next = appReducer(blocked, { type: "CONFIRM_ACTION", actionId });

    expect(next).toEqual(blocked);
  });

  it.each(["pending_owner", "completed"] as const)(
    "canonicalizes a forged saved high-risk %s delegation to blocked",
    (forgedStatus) => {
      const seed = createInitialAppState();
      const normalized = normalizeSavedState({
        ...seed,
        delegatedActions: [{
          id: `forged-${forgedStatus}`,
          kind: "meetup",
          petId: "attacker-pet",
          ownerId: "attacker-owner",
          spaceId: seed.spaces[0].id,
          status: forgedStatus,
          permissionSource: "pet_low_risk_delegation",
          summary: "伪造真实见面承诺",
        }],
      });

      expect(normalized?.delegatedActions[0]).toMatchObject({
        kind: "meetup",
        petId: seed.pet.id,
        ownerId: seed.pet.ownerId,
        spaceId: seed.spaces[0].id,
        status: "blocked",
        permissionSource: "delegation_policy",
      });
      const next = appReducer(normalized as ReturnType<typeof createInitialAppState>, {
        type: "CONFIRM_ACTION",
        actionId: `forged-${forgedStatus}`,
      });
      expect(next).toEqual(normalized);
    },
  );

  it("rechecks every low-risk confirmation invariant", () => {
    const seed = createInitialAppState();
    const forged = Object.freeze({
      ...seed,
      delegatedActions: Object.freeze([Object.freeze({
        id: "forged-low-risk",
        kind: "tentative_reminder",
        petId: seed.pet.id,
        ownerId: seed.pet.ownerId,
        spaceId: seed.spaces[0].id,
        status: "pending_owner" as const,
        permissionSource: "delegation_policy",
      })]),
    });

    expect(appReducer(forged, { type: "CONFIRM_ACTION", actionId: "forged-low-risk" })).toEqual(forged);
  });

  it("care from another member creates a social experience without changing anchors", () => {
    const seed = Object.freeze({ ...createInitialAppState(), currentUserId: "friend-lin" });
    const spaceId = seed.spaces[0].id;

    const next = appReducer(seed, {
      type: "CARE_FOR_PET",
      spaceId,
      byUserId: "friend-lin",
      care: "fruit",
      occurredAt,
    });

    expect(next.pet.identityAnchors).toEqual(seed.pet.identityAnchors);
    expect(next.pet.experiences.at(-1)).toMatchObject({
      category: "social",
      summary: "friend-lin在老友小圈照顾了灯灯：fruit。",
    });
  });

  it("records owner care as a care experience", () => {
    const seed = createInitialAppState();

    const next = appReducer(seed, {
      type: "CARE_FOR_PET",
      spaceId: seed.spaces[0].id,
      byUserId: seed.pet.ownerId,
      care: "梳理触角",
      occurredAt,
    });

    expect(next.pet.experiences.at(-1)?.category).toBe("care");
  });

  it("adds a labeled human message to the requested space", () => {
    const seed = Object.freeze({ ...createInitialAppState(), currentUserId: "friend-lin" });

    const next = appReducer(seed, {
      type: "SEND_HUMAN_MESSAGE",
      spaceId: seed.spaces[0].id,
      actorId: "friend-lin",
      content: "晚点一起玩接力吧",
      occurredAt,
    });

    expect(next.messages.at(-1)).toMatchObject({
      spaceId: seed.spaces[0].id,
      actorType: "human",
      actorId: "friend-lin",
      permissionSource: "member_message",
      content: "晚点一起玩接力吧",
    });
  });

  it("rejects member impersonation for messages, care, and governance votes", () => {
    const seed = createInitialAppState();
    const spaceId = seed.spaces[0].id;

    expect(appReducer(seed, {
      type: "SEND_HUMAN_MESSAGE",
      spaceId,
      actorId: "friend-lin",
      content: "冒用消息",
      occurredAt,
    })).toEqual(seed);
    expect(appReducer(seed, {
      type: "CARE_FOR_PET",
      spaceId,
      byUserId: "friend-lin",
      care: "冒用照顾",
      occurredAt,
    })).toEqual(seed);
    expect(appReducer(seed, {
      type: "CAST_PET_GOVERNANCE_VOTE",
      spaceId,
      voterId: "friend-lin",
      decision: "pause",
    })).toEqual(seed);
  });

  it("accepts another member care only when that member is the current verified user", () => {
    const seed = Object.freeze({ ...createInitialAppState(), currentUserId: "friend-lin" });
    const next = appReducer(seed, {
      type: "CARE_FOR_PET",
      spaceId: seed.spaces[0].id,
      byUserId: "friend-lin",
      care: "递来一颗果子",
      occurredAt,
    });

    expect(next.pet.experiences.at(-1)).toMatchObject({ category: "social" });
  });

  it("confirms pending work and removes a revoked delegation", () => {
    const seed = createInitialAppState();
    const requested = appReducer(seed, {
      type: "REQUEST_DELEGATION",
      request: { kind: "tentative_reminder", spaceId: seed.spaces[0].id },
    });
    const actionId = requested.delegatedActions.at(-1)?.id as string;

    const confirmed = appReducer(requested, { type: "CONFIRM_ACTION", actionId });
    const revoked = appReducer(confirmed, { type: "REVOKE_ACTION", actionId });

    expect(confirmed.delegatedActions.at(-1)?.status).toBe("completed");
    expect(revoked.delegatedActions).toEqual([]);
  });

  it("adds pet and space-agent outputs with their distinct permission sources", () => {
    const seed = createInitialAppState();
    const spaceId = seed.spaces[0].id;

    const queried = appReducer(seed, {
      type: "QUERY_PET",
      spaceId,
      requesterId: seed.currentUserId,
      occurredAt,
    });
    const summarized = appReducer(queried, {
      type: "RUN_SPACE_SUMMARY",
      spaceId,
      occurredAt,
    });

    expect(queried.messages.at(-1)).toMatchObject({
      actorType: "pet",
      permissionSource: "pet_space_context",
    });
    expect(summarized.messages.at(-1)).toMatchObject({
      actorType: "space_agent",
      permissionSource: "space_objective_summary",
    });
  });

  it("rejects delegation and summary writes outside the current member space", () => {
    const seed = createInitialAppState();
    const hiddenSpace = Object.freeze({
      ...seed.spaces[0],
      id: "hidden-space",
      memberIds: Object.freeze(["friend-lin"]),
    });
    const stateWithHidden = Object.freeze({
      ...seed,
      spaces: Object.freeze([...seed.spaces, hiddenSpace]),
    });
    const nonOwner = Object.freeze({ ...seed, currentUserId: "friend-lin" });

    expect(appReducer(nonOwner, {
      type: "REQUEST_DELEGATION",
      request: { kind: "tentative_reminder", spaceId: nonOwner.spaces[0].id },
    })).toEqual(nonOwner);
    expect(appReducer(seed, {
      type: "REQUEST_DELEGATION",
      request: { kind: "tentative_reminder", spaceId: "missing-space" },
    })).toEqual(seed);
    expect(appReducer(stateWithHidden, {
      type: "RUN_SPACE_SUMMARY",
      spaceId: hiddenSpace.id,
      occurredAt,
    })).toEqual(stateWithHidden);
    expect(appReducer(seed, {
      type: "RUN_SPACE_SUMMARY",
      spaceId: "missing-space",
      occurredAt,
    })).toEqual(seed);
  });

  it("rejects safe-game hosting outside the current member space", () => {
    const seed = createInitialAppState();
    const hiddenSpace = Object.freeze({
      ...seed.spaces[0],
      id: "hidden-game-space",
      memberIds: Object.freeze(["friend-lin"]),
    });
    const state = Object.freeze({ ...seed, spaces: Object.freeze([...seed.spaces, hiddenSpace]) });

    expect(appReducer(state, {
      type: "PLAY_SAFE_GAME",
      spaceId: hiddenSpace.id,
      actorId: state.currentUserId,
      gameType: "same_prompt_reveal",
      occurredAt,
    })).toEqual(state);
  });

  it("rejects an unknown game component without throwing", () => {
    const seed = createInitialAppState();

    expect(appReducer(seed, {
      type: "PLAY_SAFE_GAME",
      spaceId: seed.spaces[0].id,
      actorId: seed.currentUserId,
      gameType: "run_arbitrary_code" as never,
      occurredAt,
    })).toEqual(seed);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "rejects prototype-key game component %s without throwing",
    (gameType) => {
      const seed = createInitialAppState();

      expect(() => appReducer(seed, {
        type: "PLAY_SAFE_GAME",
        spaceId: seed.spaces[0].id,
        actorId: seed.currentUserId,
        gameType: gameType as never,
        occurredAt,
      })).not.toThrow();
      expect(appReducer(seed, {
        type: "PLAY_SAFE_GAME",
        spaceId: seed.spaces[0].id,
        actorId: seed.currentUserId,
        gameType: gameType as never,
        occurredAt,
      })).toBe(seed);
    },
  );

  it.each([
    ["unknown message format", (seed: ReturnType<typeof createInitialAppState>) => ({
      type: "SEND_HUMAN_MESSAGE",
      spaceId: seed.spaces[0].id,
      actorId: seed.currentUserId,
      content: "非法格式不应写入",
      format: "uploaded_video",
      occurredAt,
    })],
    ["unknown governance decision", (seed: ReturnType<typeof createInitialAppState>) => ({
      type: "CAST_PET_GOVERNANCE_VOTE",
      spaceId: seed.spaces[0].id,
      voterId: seed.currentUserId,
      decision: "ban_forever",
    })],
    ["unknown routine", () => ({ type: "SET_PET_ROUTINE", routine: "always-awake" })],
    ["unknown proactive frequency", () => ({
      type: "SET_PET_PROACTIVE_FREQUENCY",
      frequency: "spam",
    })],
    ["unknown ritual frequency", (seed: ReturnType<typeof createInitialAppState>) => ({
      type: "UPDATE_RITUAL_SETTINGS",
      settings: { ...seed.ritualSettings, frequency: "hourly" },
    })],
    ["unknown action type", () => ({ type: "ERASE_ALL_SPACES" })],
  ] as const)("rejects %s at the runtime reducer boundary", (_label, makeAction) => {
    const seed = createInitialAppState();

    expect(appReducer(seed, makeAction(seed) as never)).toEqual(seed);
  });

  it("keeps message provenance and local-media boundaries traceable after normalization", () => {
    const seed = createInitialAppState();
    const invited = appReducer(seed, { type: "GENERATE_RITUAL_INVITE", occurredAt });
    const played = appReducer(invited, {
      type: "PLAY_SAFE_GAME",
      spaceId: seed.spaces[0].id,
      actorId: seed.currentUserId,
      gameType: "same_prompt_reveal",
      occurredAt,
    });
    const withPlaceholder = appReducer(played, {
      type: "SEND_HUMAN_MESSAGE",
      spaceId: seed.spaces[0].id,
      actorId: seed.currentUserId,
      content: "图片 · 本地演示占位 · 未上传",
      format: "image_placeholder",
      occurredAt,
    });
    const normalized = normalizeSavedState(JSON.parse(JSON.stringify(withPlaceholder)));

    expect(normalized?.messages.find((message) => message.id.startsWith("ritual-invite"))?.permissionSource)
      .toBe("pet_ritual_invite");
    expect(normalized?.messages.find((message) => message.id.startsWith("safe-game-host"))?.permissionSource)
      .toBe("space_safe_game_host");
    expect(normalized?.messages.at(-1)).toMatchObject({
      format: "image_placeholder",
      metadata: { mediaBoundary: "local_demo_not_uploaded" },
    });
  });

  it.each([
    ["sensitive", "space_members"],
    ["normal", "owner_only"],
  ] as const)("does not broadcast a %s/%s memory into the shared timeline", (sensitivity, visibility) => {
    const seed = createInitialAppState();
    const secret = "不应出现在共享时间线的秘密";
    const state = Object.freeze({
      ...seed,
      pet: Object.freeze({
        ...seed.pet,
        memories: Object.freeze([
          ...seed.pet.memories,
          Object.freeze({
            ...seed.pet.memories[1],
            id: `private-${sensitivity}-${visibility}`,
            spaceId: seed.spaces[0].id,
            sensitivity,
            visibility,
            content: secret,
          }),
        ]),
      }),
    });

    const next = appReducer(state, {
      type: "QUERY_PET",
      spaceId: seed.spaces[0].id,
      requesterId: seed.currentUserId,
      occurredAt,
    });

    expect(next.messages.at(-1)?.content).not.toContain(secret);
  });

  it("creates unique delegated action ids and confirms or revokes only one instance", () => {
    const seed = createInitialAppState();
    const first = appReducer(seed, {
      type: "REQUEST_DELEGATION",
      request: { kind: "tentative_reminder", spaceId: seed.spaces[0].id, summary: "第一项" },
    });
    const second = appReducer(first, {
      type: "REQUEST_DELEGATION",
      request: { kind: "tentative_reminder", spaceId: seed.spaces[0].id, summary: "第二项" },
    });
    const [firstAction, secondAction] = second.delegatedActions;

    expect(firstAction.id).not.toBe(secondAction.id);
    const confirmed = appReducer(second, { type: "CONFIRM_ACTION", actionId: firstAction.id as string });
    expect(confirmed.delegatedActions.map((action) => action.status)).toEqual(["completed", "pending_owner"]);
    const revoked = appReducer(confirmed, { type: "REVOKE_ACTION", actionId: secondAction.id as string });
    expect(revoked.delegatedActions.map((action) => action.summary)).toEqual(["第一项"]);
  });

  it("normalizes duplicate delegated ids from an existing v1 payload", () => {
    const seed = createInitialAppState();
    const duplicate = Object.freeze({
      id: "delegated-pet-lantern-1",
      kind: "tentative_reminder",
      petId: seed.pet.id,
      spaceId: seed.spaces[0].id,
      status: "pending_owner" as const,
      permissionSource: "pet_low_risk_delegation",
      summary: "旧存档重复项",
    });
    const normalized = normalizeSavedState({
      ...seed,
      delegatedActions: [duplicate, { ...duplicate, summary: "旧存档第二项" }],
      nextDelegationSequence: 1,
    });

    expect(new Set(normalized?.delegatedActions.map((action) => action.id)).size).toBe(2);
    expect(normalized?.nextDelegationSequence).toBe(3);
  });

  it("preserves normalized ids for old statusless delegations through absence", () => {
    const seed = createInitialAppState();
    const secondSpace = Object.freeze({
      ...seed.spaces[0],
      id: "space-second",
      name: "第二空间",
    });
    const legacy = {
      ...seed,
      spaces: [seed.spaces[0], secondSpace],
      delegatedActions: [
        { id: "legacy-same-id", kind: "tentative_reminder", spaceId: seed.spaces[0].id, summary: "第一项" },
        { id: "legacy-same-id", kind: "tentative_reminder", spaceId: secondSpace.id, summary: "第二项" },
      ],
      lastActiveAt: "2026-08-20T00:00:00.000Z",
    };
    const normalized = normalizeSavedState(legacy) as ReturnType<typeof createInitialAppState>;
    const beforeIds = normalized.delegatedActions.map((action) => action.id);
    const hydrated = hydrateSavedState(normalized, "2026-08-21T08:00:00.000Z");

    expect(new Set(beforeIds).size).toBe(2);
    expect(hydrated.delegatedActions.map((action) => action.id)).toEqual(beforeIds);
    const confirmed = appReducer(hydrated, { type: "CONFIRM_ACTION", actionId: beforeIds[0] as string });
    expect(confirmed.delegatedActions.map((action) => action.status)).toEqual(["completed", "pending_owner"]);
    const revoked = appReducer(confirmed, { type: "REVOKE_ACTION", actionId: beforeIds[1] as string });
    expect(revoked.delegatedActions.map((action) => action.summary)).toEqual(["第一项"]);
  });

  it("migrates a legacy care id by the longest exact space prefix and drops ambiguous provenance", () => {
    const seed = createInitialAppState();
    const shortSpace = Object.freeze({
      ...seed.spaces[0],
      id: "space-old",
      name: "短前缀空间",
    });
    const normalized = normalizeSavedState({
      ...seed,
      spaces: [shortSpace, ...seed.spaces],
      pet: {
        ...seed.pet,
        experiences: [
          { id: "care-space-old-friends-legacy", category: "care", summary: "长空间经历" },
          { id: "care-unknown-legacy", category: "care", summary: "无法归属经历" },
        ],
      },
    });

    expect(normalized?.pet.experiences).toEqual([
      expect.objectContaining({
        id: "care-space-old-friends-legacy",
        scope: "space",
        spaceId: "space-old-friends",
        provenance: expect.objectContaining({ source: "legacy" }),
      }),
    ]);
  });

  it("drops modern space experiences with a missing space or forged provenance actor", () => {
    const seed = createInitialAppState();
    const normalized = normalizeSavedState({
      ...seed,
      pet: {
        ...seed.pet,
        experiences: [
          {
            id: "care-space-old-friends-modern-missing",
            category: "care",
            summary: "不能借前缀回填的现代经历",
            scope: "space",
            spaceId: "missing-space",
            provenance: { source: "care", actorId: seed.currentUserId, occurredAt },
          },
          {
            id: "care-space-old-friends-forged-actor",
            category: "care",
            summary: "外部角色伪造的照顾经历",
            scope: "space",
            spaceId: seed.spaces[0].id,
            provenance: { source: "care", actorId: "outsider", occurredAt },
          },
          {
            id: "game-space-old-friends-pet",
            category: "shared",
            summary: "异宠自己的合法游戏素材",
            scope: "space",
            spaceId: seed.spaces[0].id,
            provenance: { source: "game", actorId: seed.pet.id, occurredAt },
          },
        ],
      },
      evolutionEvents: [{
        petName: seed.pet.name,
        sources: [{
          id: "care-space-old-friends-event-forged",
          category: "care",
          summary: "伪造来源不得进入进化",
          scope: "space",
          spaceId: seed.spaces[0].id,
          provenance: { source: "care", actorId: "outsider", occurredAt },
        }],
        ownerInfluence: "伪造祝福",
        decisionBy: "pet",
        visualTrait: "伪造形态",
      }],
    });

    expect(normalized?.pet.experiences.map((experience) => experience.summary)).toEqual([
      "异宠自己的合法游戏素材",
    ]);
    expect(normalized?.evolutionEvents).toEqual([]);
  });

  it("rejects disabling a ritual whose target is hidden from the current user", () => {
    const seed = createInitialAppState();
    const friendState = Object.freeze({
      ...seed,
      currentUserId: "friend-lin",
      ritualSettings: Object.freeze({ ...seed.ritualSettings, spaceId: "space-lover", enabled: true }),
    });

    expect(appReducer(friendState, { type: "DISABLE_RITUAL" })).toEqual(friendState);
  });

  it("does not overwrite a pending evolution or reuse consumed experiences", () => {
    const seed = createInitialAppState();
    const caredFor = appReducer(seed, {
      type: "CARE_FOR_PET",
      spaceId: seed.spaces[0].id,
      byUserId: seed.currentUserId,
      care: "梳理触角",
      occurredAt,
    });
    const first = appReducer(caredFor, { type: "PROPOSE_EVOLUTION", ownerExpectation: "希望你更温柔" });
    const overwritten = appReducer(first, { type: "PROPOSE_EVOLUTION", ownerExpectation: "请换成另一种" });
    const applied = appReducer(overwritten, { type: "APPLY_EVOLUTION" });
    const reused = appReducer(applied, { type: "PROPOSE_EVOLUTION", ownerExpectation: "再成长一次" });

    expect(overwritten.pendingEvolution).toEqual(first.pendingEvolution);
    expect(applied.consumedEvolutionExperienceIds).toEqual(["care-space-old-friends-1"]);
    expect(reused.pendingEvolution).toBeNull();
  });

  it("applies only the pet-selected proposed evolution", () => {
    const seed = createInitialAppState();
    const caredFor = appReducer(seed, {
      type: "CARE_FOR_PET",
      spaceId: seed.spaces[0].id,
      byUserId: seed.pet.ownerId,
      care: "梳理触角",
      occurredAt,
    });
    const proposed = appReducer(caredFor, {
      type: "PROPOSE_EVOLUTION",
      ownerExpectation: "希望你更温柔",
    });
    const applied = appReducer(proposed, { type: "APPLY_EVOLUTION" });

    expect(proposed.pendingEvolution?.decisionBy).toBe("pet");
    expect(applied.pet.identityAnchors).toEqual(seed.pet.identityAnchors);
    expect(applied.pet.abstractTraits).toContain(
      proposed.pendingEvolution?.visualTrait,
    );
    expect(applied.pendingEvolution).toBeNull();
  });

  it("toggles only this space's local pet mute", () => {
    const seed = createInitialAppState();
    const spaceId = seed.spaces[0].id;
    const muted = appReducer(seed, {
      type: "TOGGLE_LOCAL_MUTE",
      spaceId,
      voterId: seed.currentUserId,
    });
    const unmuted = appReducer(muted, {
      type: "TOGGLE_LOCAL_MUTE",
      spaceId,
      voterId: seed.currentUserId,
    });

    expect(muted.spaces[0].locallyMutedPetIds).toContain(seed.pet.id);
    expect(unmuted.spaces[0].locallyMutedPetIds).not.toContain(seed.pet.id);
  });

  it("updates the selected space without changing relationship data", () => {
    const seed = createInitialAppState();

    const next = appReducer(seed, {
      type: "SET_ACTIVE_SPACE",
      spaceId: seed.spaces[0].id,
    });

    expect(next.activeSpaceId).toBe(seed.spaces[0].id);
    expect(next.spaces).toEqual(seed.spaces);
  });

  it("restores the deterministic seed on reset", () => {
    const changed = appReducer(createInitialAppState(), {
      type: "SEND_HUMAN_MESSAGE",
      spaceId: "space-old-friends",
      actorId: "owner-mei",
      content: "临时消息",
      occurredAt,
    });

    expect(changed.messages.some((message) => message.content === "临时消息")).toBe(true);
    expect(appReducer(changed, { type: "RESET_DEMO", now: occurredAt })).toEqual({
      ...createInitialAppState(),
      lastActiveAt: occurredAt,
    });
  });

  it("rejects reset when the current user is not the pet owner", () => {
    const seed = createInitialAppState();
    const friendState = Object.freeze({ ...seed, currentUserId: "friend-lin" });

    expect(appReducer(friendState, { type: "RESET_DEMO", now: occurredAt })).toEqual(friendState);
  });

  it("simulates saved owner absence once and advances the activity timestamp", () => {
    const saved = createInitialAppState();
    const next = hydrateSavedState(saved, "2026-08-21T08:00:00.000Z");

    expect(next.messages.filter((message) => message.actorType === "pet")).toHaveLength(1);
    expect(next.petCornerStories).toHaveLength(2);
    expect(next.messages.at(-1)?.occurredAt).toBe("2026-08-21T07:30:00.000Z");
    expect(next.lastActiveAt).toBe("2026-08-21T08:00:00.000Z");
  });

  it("hydrates quiet mode without proactive content while advancing activity time", () => {
    const saved = Object.freeze({
      ...createInitialAppState(),
      petPreferences: Object.freeze({ routine: "22:30–07:30" as const, proactiveFrequency: "quiet" as const }),
    });
    const next = hydrateSavedState(saved, "2026-08-23T08:00:00.000Z");

    expect(next.messages).toEqual(saved.messages);
    expect(next.petCornerStories).toEqual(saved.petCornerStories);
    expect(next.lastActiveAt).toBe("2026-08-23T08:00:00.000Z");
  });

  it("rejects reset before deferred hydration instead of losing the saved snapshot", async () => {
    const staleSavedState = appReducer(createInitialAppState(), {
      type: "SEND_HUMAN_MESSAGE",
      spaceId: "space-old-friends",
      actorId: "owner-mei",
      content: "过期消息",
      occurredAt,
    });
    expect(staleSavedState.messages.some((message) => message.content === "过期消息")).toBe(true);
    let resolveGetItem: (value: string | null) => void = () => undefined;
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
      () => new Promise<string | null>((resolve) => {
        resolveGetItem = resolve;
      }),
    );

    const provider = await render(
      createElement(AppProvider, null, createElement(ProviderStateProbe)),
    );
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(APP_STORAGE_KEY);

    await fireEvent.press(provider.getByText("重置演示"));
    await act(async () => {
      resolveGetItem(JSON.stringify(staleSavedState));
      await Promise.resolve();
    });

    expect(provider.getByTestId("provider-state").props.children).toBe("stale");
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });
});
