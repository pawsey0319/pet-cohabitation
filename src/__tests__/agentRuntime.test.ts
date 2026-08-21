import {
  applyPetGovernance,
  askPetWhatHappened,
  createDelegatedAction,
  getPetPauseGovernance,
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
    const narrative = askPetWhatHappened(state.pet, space.id, state.pet.ownerId);

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
    const narrative = askPetWhatHappened(state.pet, "space-old-friends", state.pet.ownerId);

    expect(narrative.content).toContain("老友小圈");
    expect(narrative.content).not.toContain("周六去海边");
  });

  it.each([
    ["sensitive", "space_members"],
    ["normal", "owner_only"],
  ] as const)("returns a safe shared recap instead of a %s/%s memory", (sensitivity, visibility) => {
    const state = createDemoSeed();
    const secret = "住址和健康低谷不能广播";
    const pet = Object.freeze({
      ...state.pet,
      memories: Object.freeze([
        ...state.pet.memories,
        Object.freeze({
          ...state.pet.memories[1],
          id: `blocked-${sensitivity}-${visibility}`,
          spaceId: state.spaces[0].id,
          sensitivity,
          visibility,
          content: secret,
        }),
      ]),
    });

    const narrative = askPetWhatHappened(pet, state.spaces[0].id, state.pet.ownerId);

    expect(narrative.content).toContain("没有可在这里分享的新回顾");
    expect(narrative.content).not.toContain(secret);
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

  it("counts only each current member's latest valid governance vote", () => {
    const state = createDemoSeed();
    const space = Object.freeze({
      ...state.spaces[0],
      petGovernanceVotes: Object.freeze([
        Object.freeze({ voterId: "owner-mei", decision: "resume" as const, petId: state.pet.id }),
        Object.freeze({ voterId: "owner-mei", decision: "pause" as const, petId: state.pet.id }),
        Object.freeze({ voterId: "exited-member", decision: "pause" as const, petId: state.pet.id }),
      ]),
    });

    expect(getPetPauseGovernance(space, state.pet.id)).toEqual({ pauses: 1, required: 2, paused: false });
    const currentMajority = Object.freeze({
      ...space,
      petGovernanceVotes: Object.freeze([
        ...space.petGovernanceVotes,
        Object.freeze({ voterId: "friend-lin", decision: "pause" as const, petId: state.pet.id }),
      ]),
    });
    expect(getPetPauseGovernance(currentMajority, state.pet.id)).toEqual({ pauses: 2, required: 2, paused: true });
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

  it("quiet mode suppresses proactive messages and pet-corner stories", () => {
    const state = createDemoSeed();
    const result = simulateOwnerAbsence(
      { ...state, petPreferences: { routine: "22:30–07:30", proactiveFrequency: "quiet" } },
      addDays(state.lastActiveAt, 3),
    );

    expect(result.messages).toEqual(state.messages);
    expect(result.petCornerStories).toEqual(state.petCornerStories);
  });

  it("low frequency deterministically participates every second simulated day", () => {
    const state = createDemoSeed();
    const result = simulateOwnerAbsence(
      { ...state, petPreferences: { routine: "22:30–07:30", proactiveFrequency: "low" } },
      addDays(state.lastActiveAt, 3),
    );

    expect(result.messages.filter((message) => message.actorType === "pet")).toHaveLength(1);
    expect(result.petCornerStories).toHaveLength(2);
  });

  it("moves proactive activity out of the configured sleep routine", () => {
    const state = {
      ...createDemoSeed(),
      lastActiveAt: "2026-08-20T23:00:00.000Z",
      petPreferences: { routine: "22:30–07:30" as const, proactiveFrequency: "daily" as const },
    };
    const now = "2026-08-22T23:00:00.000Z";
    const result = simulateOwnerAbsence(state, now);
    const generated = result.messages.filter((message) => message.actorType === "pet");

    expect(generated).toHaveLength(1);
    expect(generated[0].occurredAt).toBe("2026-08-22T07:30:00.000Z");
    expect(new Date(generated[0].occurredAt).getTime()).toBeLessThanOrEqual(new Date(now).getTime());
  });
});
