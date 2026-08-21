import {
  applyPetGovernance,
  askPetWhatHappened,
  createDelegatedAction,
  simulateOwnerAbsence,
  summarizeSpace,
} from "../domain/agentRuntime";
import { createDemoSeed } from "../domain/seed";

function addDays(isoDate: string, days: number): string {
  return new Date(new Date(isoDate).getTime() + days * 86_400_000).toISOString();
}

describe("local agent runtime", () => {
  it("keeps objective summary separate from pet narrative", () => {
    const state = createDemoSeed();
    const space = state.spaces[0];

    const summary = summarizeSpace(space, state.messages);
    const narrative = askPetWhatHappened(state.pet, space.id);

    expect(summary.actorType).toBe("space_agent");
    expect(summary.permissionSource).toBe("space_objective_summary");
    expect(narrative.actorType).toBe("pet");
    expect(narrative.permissionSource).toBe("pet_space_context");
    expect(summary.content).not.toContain("我");
  });

  it("does not claim a human commitment state from ordinary messages", () => {
    const state = createDemoSeed();
    const space = state.spaces[0];
    const confirmationLikeMessage = {
      ...state.messages[0],
      id: "message-old-friends-2",
      content: "周末见面已确认",
    };

    const summary = summarizeSpace(space, [...state.messages, confirmationLikeMessage]);

    expect(summary.content).toContain("2条成员消息");
    expect(summary.content).not.toContain("确认");
  });

  it("does not punish a pet for owner absence and bounds generated activity", () => {
    const state = createDemoSeed();
    const result = simulateOwnerAbsence(state, addDays(state.lastActiveAt, 5));

    expect(result.pet.status).toBe("waiting_warmly");
    expect(result.messages.filter((message) => message.actorType === "pet")).toHaveLength(3);
    expect(result.petCornerStories).toHaveLength(6);
    expect(JSON.stringify(result)).not.toMatch(/死亡|退化|饥饿|责怪/);
  });

  it("keeps each pet narrative inside its requested space memory", () => {
    const state = createDemoSeed();
    const narrative = askPetWhatHappened(state.pet, "space-old-friends");

    expect(narrative.content).toContain("老友小圈");
    expect(narrative.content).not.toContain("周六去海边");
  });

  it("does not add proactive content when the pet is locally muted", () => {
    const state = createDemoSeed();
    const mutedSpace = applyPetGovernance(state.spaces[0], state.pet.id, {
      voterId: "owner-mei",
      decision: "mute_locally",
    });
    const result = simulateOwnerAbsence(
      { ...state, spaces: [mutedSpace] },
      addDays(state.lastActiveAt, 1),
    );

    expect(result.messages).toEqual(state.messages);
    expect(result.petCornerStories).toEqual([]);
  });

  it("does not add proactive content after a majority pauses the pet", () => {
    const state = createDemoSeed();
    const firstVote = applyPetGovernance(state.spaces[0], state.pet.id, {
      voterId: "owner-mei",
      decision: "pause",
    });
    const pausedSpace = applyPetGovernance(firstVote, state.pet.id, {
      voterId: "friend-lin",
      decision: "pause",
    });
    const result = simulateOwnerAbsence(
      { ...state, spaces: [pausedSpace] },
      addDays(state.lastActiveAt, 1),
    );

    expect(result.messages).toEqual(state.messages);
    expect(result.petCornerStories).toEqual([]);
  });

  it("only completes low-risk pet-only work and blocks human commitments", () => {
    const state = createDemoSeed();

    expect(createDelegatedAction(state.pet, { kind: "game_invite" }).status).toBe(
      "completed",
    );
    expect(
      createDelegatedAction(state.pet, { kind: "tentative_reminder" }).status,
    ).toBe("pending_owner");
    expect(createDelegatedAction(state.pet, { kind: "purchase" }).status).toBe(
      "blocked",
    );
  });
});
