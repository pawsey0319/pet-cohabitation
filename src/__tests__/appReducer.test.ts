jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createElement } from "react";
import { Button, Text, View } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import {
  APP_STORAGE_KEY,
  AppProvider,
  appReducer,
  createInitialAppState,
  hydrateSavedState,
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

describe("application state reducer", () => {
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
    const seed = createInitialAppState();
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
    const seed = createInitialAppState();

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

    const queried = appReducer(seed, { type: "QUERY_PET", spaceId, occurredAt });
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
      voterId: "friend-lin",
    });
    const unmuted = appReducer(muted, {
      type: "TOGGLE_LOCAL_MUTE",
      spaceId,
      voterId: "friend-lin",
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
    const next = hydrateSavedState(saved, "2026-08-21T00:00:00.000Z");

    expect(next.messages.filter((message) => message.actorType === "pet")).toHaveLength(1);
    expect(next.petCornerStories).toHaveLength(2);
    expect(next.lastActiveAt).toBe("2026-08-21T00:00:00.000Z");
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
