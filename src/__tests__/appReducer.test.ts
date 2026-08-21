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
  const { dispatch, state } = useAppState();
  const containsStaleMessage = state.messages.some(
    (message) => message.content === "过期消息",
  );

  return createElement(
    View,
    null,
    createElement(Text, { testID: "provider-state" }, containsStaleMessage ? "stale" : "seed"),
    createElement(Button, {
      title: "重置演示",
      onPress: () => dispatch({ type: "RESET_DEMO" }),
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
      id: "legacy-care-1",
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
      consumed: ["legacy-care-1"],
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
      request: { kind: "purchase", summary: "买一份礼物" },
    });

    expect(next.delegatedActions.at(-1)?.status).toBe("blocked");
    expect(next.delegatedActions.at(-1)?.permissionSource).toBe("delegation_policy");
  });

  it("cannot confirm a blocked delegation", () => {
    const seed = createInitialAppState();
    const blocked = appReducer(seed, {
      type: "REQUEST_DELEGATION",
      request: { kind: "purchase" },
    });
    const actionId = blocked.delegatedActions.at(-1)?.id as string;

    const next = appReducer(blocked, { type: "CONFIRM_ACTION", actionId });

    expect(next).toEqual(blocked);
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
      request: { kind: "tentative_reminder" },
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
      actorId: "friend-lin",
      content: "临时消息",
      occurredAt,
    });

    expect(appReducer(changed, { type: "RESET_DEMO" })).toEqual(
      createInitialAppState(),
    );
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

  it("keeps the deterministic seed when reset wins a deferred hydration", async () => {
    const staleSavedState = appReducer(createInitialAppState(), {
      type: "SEND_HUMAN_MESSAGE",
      spaceId: "space-old-friends",
      actorId: "friend-lin",
      content: "过期消息",
      occurredAt,
    });
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

    expect(provider.getByTestId("provider-state").props.children).toBe("seed");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(APP_STORAGE_KEY);
  });
});
