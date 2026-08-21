import {
  canPetExecute,
  canRevealMemory,
  classifyDelegatedAction,
  getPetContextForSpace,
} from "../domain/policies";
import type { UserPet } from "../domain/types";

const pet: UserPet = {
  id: "pet-lantern",
  ownerId: "owner-mei",
  name: "灯灯",
  lifeSeed: "lantern-seed",
  identityAnchors: {
    eyes: "琥珀眼",
    coreColor: "珊瑚橙",
    voice: "轻柔",
    silhouette: "圆润",
    signatureOrgan: "发光触角",
  },
  abstractTraits: ["善于倾听", "会组织小游戏"],
  memories: [
    {
      id: "memory-old-friends",
      spaceId: "space-old-friends",
      ownerId: "owner-mei",
      source: "chat",
      occurredAt: "2026-08-20T12:00:00.000Z",
      content: "大家约好下周玩接力游戏",
      sensitivity: "normal",
      visibility: "space_members",
    },
    {
      id: "memory-lover",
      spaceId: "space-lover",
      ownerId: "owner-mei",
      source: "chat",
      occurredAt: "2026-08-20T18:00:00.000Z",
      content: "周六去海边",
      sensitivity: "normal",
      visibility: "space_members",
    },
  ],
};

describe("pet trust policies", () => {
  it("never exposes another space event", () => {
    const context = getPetContextForSpace(pet, "space-old-friends");

    expect(context.memories.map((memory) => memory.spaceId)).toEqual([
      "space-old-friends",
    ]);
    expect(JSON.stringify(context)).not.toContain("周六去海边");
  });

  it.each([
    ["game_invite", "low"],
    ["light_vote", "low"],
    ["tentative_reminder", "low"],
    ["tentative_task", "low"],
    ["preference_guess", "low"],
    ["meetup", "high"],
    ["relationship_change", "high"],
    ["location", "high"],
    ["purchase", "high"],
    ["finance", "high"],
    ["health", "high"],
  ] as const)("classifies %s as %s risk", (kind, expectedRisk) => {
    expect(classifyDelegatedAction(kind)).toBe(expectedRisk);
  });

  it.each([
    "meetup",
    "relationship_change",
    "location",
    "purchase",
    "finance",
    "health",
  ])("blocks high-risk %s", (kind) => {
    expect(canPetExecute({ kind })).toBe(false);
  });

  it.each([
    "game_invite",
    "light_vote",
    "tentative_reminder",
    "tentative_task",
    "preference_guess",
  ])("allows low-risk %s", (kind) => {
    expect(canPetExecute({ kind })).toBe(true);
  });

  it("requires the owner before revealing sensitive memory to another member", () => {
    const sensitiveMemory = {
      ...pet.memories[0],
      sensitivity: "sensitive" as const,
    };

    expect(canRevealMemory(sensitiveMemory, "friend-lin")).toBe(
      "require_owner",
    );
  });

  it("allows the owner to reveal their sensitive memory", () => {
    const sensitiveMemory = {
      ...pet.memories[0],
      sensitivity: "sensitive" as const,
    };

    expect(canRevealMemory(sensitiveMemory, "owner-mei")).toBe("allow");
  });

  it("denies owner-only non-sensitive memories to other members", () => {
    const ownerOnlyMemory = {
      ...pet.memories[0],
      visibility: "owner_only" as const,
    };

    expect(canRevealMemory(ownerOnlyMemory, "friend-lin")).toBe("deny");
  });
});
