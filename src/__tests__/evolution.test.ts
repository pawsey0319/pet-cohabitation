import {
  applyEvolution,
  proposeEvolution,
  writeGrowthDiary,
} from "../domain/evolution";

const pet = {
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
  abstractTraits: ["善于倾听"],
  memories: [],
} as const;

const experiences = [
  {
    id: "memory-care-01",
    category: "care",
    summary: "梅在雨天为灯灯擦干触角。",
  },
  {
    id: "memory-social-02",
    category: "social",
    summary: "灯灯在朋友聚会中先向新朋友打招呼。",
  },
] as const;

describe("identity-preserving evolution", () => {
  it("preserves every identity anchor", () => {
    const event = proposeEvolution(pet, experiences, "希望你更勇敢");
    const next = applyEvolution(pet, event);

    expect(next.identityAnchors).toEqual(pet.identityAnchors);
    expect(event.sources.length).toBeGreaterThan(0);
    expect(event.ownerInfluence).toBe("希望你更勇敢");
    expect(event.decisionBy).toBe("pet");
  });

  it("derives one stable additive trait from a complete set of source ids", () => {
    const first = proposeEvolution(pet, experiences, "希望你更勇敢");
    const second = proposeEvolution(pet, experiences, "希望你更勇敢");
    const next = applyEvolution(pet, first);

    expect(second).toEqual(first);
    expect(first.sources.map((source) => source.id)).toEqual([
      "memory-care-01",
      "memory-social-02",
    ]);
    expect(first.visualTrait).toEqual(expect.any(String));
    expect(next.abstractTraits).toContain(first.visualTrait);
    expect(next.abstractTraits).toHaveLength(2);
  });

  it("chooses the same trait when identical source experiences arrive in reverse order", () => {
    const forward = proposeEvolution(pet, experiences, "希望你每天开心");
    const reverse = proposeEvolution(pet, [...experiences].reverse(), "希望你每天开心");

    expect(reverse.visualTrait).toBe(forward.visualTrait);
  });

  it("does not turn an owner request into a selected visual trait", () => {
    const event = proposeEvolution(
      pet,
      experiences,
      "请直接长出蓝色翅膀",
    );

    expect(event.visualTrait).not.toBe("蓝色翅膀");
    expect(event.decisionBy).toBe("pet");
  });

  it("leaves the pet unchanged when there are no source experiences", () => {
    const event = proposeEvolution(pet, [], "希望你更勇敢");
    const next = applyEvolution(pet, event);

    expect(event.sources).toEqual([]);
    expect(event.visualTrait).toBeNull();
    expect(next).toEqual(pet);
  });

  it("refuses a trait change without sources", () => {
    const next = applyEvolution(
      pet,
      {
        petName: "灯灯",
        sources: [],
        ownerInfluence: "希望你更勇敢",
        decisionBy: "pet",
        visualTrait: "迎宾光点",
      },
    );

    expect(next).toEqual(pet);
  });

  it("writes a diary from the pet decision and its sources", () => {
    const event = proposeEvolution(pet, experiences, "希望你更勇敢");

    expect(writeGrowthDiary(event)).toContain("灯灯");
    expect(writeGrowthDiary(event)).toContain("memory-care-01");
    expect(writeGrowthDiary(event)).not.toContain("进度");
    expect(writeGrowthDiary(event)).not.toContain("XP");
  });
});
