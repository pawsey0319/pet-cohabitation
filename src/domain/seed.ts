import type { RuntimeState } from "./types";

export function createDemoSeed(): RuntimeState {
  return Object.freeze({
    pet: Object.freeze({
      id: "pet-lantern",
      ownerId: "owner-mei",
      name: "灯灯",
      lifeSeed: "lantern-seed",
      status: "waiting_warmly" as const,
      identityAnchors: Object.freeze({
        eyes: "琥珀眼",
        coreColor: "珊瑚橙",
        voice: "轻柔",
        silhouette: "圆润",
        signatureOrgan: "发光触角",
      }),
      abstractTraits: Object.freeze(["善于倾听", "会组织小游戏"]),
      memories: Object.freeze([
        Object.freeze({
          id: "memory-life-seed",
          spaceId: "global",
          ownerId: "owner-mei",
          source: "life_seed",
          occurredAt: "2026-08-19T08:00:00.000Z",
          content: "第一次被叫作灯灯时，发光触角轻轻亮了起来",
          sensitivity: "normal" as const,
          visibility: "owner_only" as const,
        }),
        Object.freeze({
          id: "memory-old-friends",
          spaceId: "space-old-friends",
          ownerId: "owner-mei",
          source: "chat",
          occurredAt: "2026-08-20T12:00:00.000Z",
          content: "老友小圈的接力游戏约在周末继续",
          sensitivity: "normal" as const,
          visibility: "space_members" as const,
        }),
        Object.freeze({
          id: "memory-lover",
          spaceId: "space-lover",
          ownerId: "owner-mei",
          source: "chat",
          occurredAt: "2026-08-20T18:00:00.000Z",
          content: "周六去海边",
          sensitivity: "normal" as const,
          visibility: "space_members" as const,
        }),
      ]),
    }),
    spaces: Object.freeze([
      Object.freeze({
        id: "space-old-friends",
        name: "老友小圈",
        kind: "friend_pair" as const,
        memberIds: Object.freeze(["owner-mei", "friend-lin"]),
        locallyMutedPetIds: Object.freeze([]),
        petGovernanceVotes: Object.freeze([]),
      }),
    ]),
    messages: Object.freeze([
      Object.freeze({
        id: "message-old-friends-1",
        spaceId: "space-old-friends",
        actorType: "human" as const,
        actorId: "friend-lin",
        permissionSource: "member_message",
        content: "周末想继续接力游戏吗？",
        occurredAt: "2026-08-20T12:30:00.000Z",
      }),
    ]),
    petCornerStories: Object.freeze([]),
    delegatedActions: Object.freeze([]),
    lastActiveAt: "2026-08-20T00:00:00.000Z",
  });
}
