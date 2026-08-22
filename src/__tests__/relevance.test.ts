import { ownerReplyPolicy, routePetCandidates } from "../agents/relevance";

const candidates = Array.from({ length: 20 }, (_, index) => ({
  petId: `pet-${index}`,
  petName: `宠${index}`,
  ownerId: `owner-${index}`,
  ownerName: `主人${index}`,
  relevantTerms: [`故事${index}`],
  participationEnabled: true,
}));

describe("multi-pet relevance routing", () => {
  it("does not fan an irrelevant message out to twenty pets", () => {
    expect(routePetCandidates({ text: "今天下雨了", now: "2026-08-21T00:00:00.000Z", candidates })).toEqual([]);
  });

  it("allows explicit cues to at most three pets and implicit relevance to one", () => {
    expect(routePetCandidates({ text: "@宠1 @宠2 你们觉得呢？", now: "2026-08-21T00:00:00.000Z", candidates })).toHaveLength(2);
    expect(routePetCandidates({ text: "主人1和主人2的安排", now: "2026-08-21T00:00:00.000Z", candidates })).toHaveLength(1);
  });

  it("never answers owner-sensitive matters and waits while owner is online", () => {
    const now = "2026-08-21T10:05:00.000Z";
    expect(ownerReplyPolicy({ ownerLastActiveAt: "2026-08-21T10:01:00.000Z", now, concernsOwner: true, topic: "他喜欢什么零食" })).toBe("wait_for_owner");
    expect(ownerReplyPolicy({ ownerLastActiveAt: "2026-08-21T09:00:00.000Z", now, concernsOwner: true, topic: "他同意周末见面吗" })).toBe("wait_for_owner");
    expect(ownerReplyPolicy({ ownerLastActiveAt: "2026-08-21T09:00:00.000Z", now, concernsOwner: true, topic: "他喜欢什么零食" })).toBe("guess_low_risk");
  });
});
