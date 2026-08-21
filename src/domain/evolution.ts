import type {
  EvolutionEvent,
  ExperienceCategory,
  GrowthExperience,
  UserPet,
} from "./types";

const TRAITS_BY_CATEGORY: Readonly<Record<ExperienceCategory, readonly string[]>> = {
  care: ["柔光绒边", "暖心徽记"],
  work: ["专注星纹", "工具小挂饰"],
  social: ["迎宾光点", "友伴缎带"],
  shared: ["同游足迹", "共鸣铃铛"],
};

function categoryWeightedBy(ownerExpectation: string): ExperienceCategory | null {
  if (ownerExpectation.includes("勇敢") || ownerExpectation.includes("朋友")) {
    return "social";
  }

  if (ownerExpectation.includes("照顾") || ownerExpectation.includes("温柔")) {
    return "care";
  }

  if (ownerExpectation.includes("工作") || ownerExpectation.includes("专注")) {
    return "work";
  }

  if (ownerExpectation.includes("一起") || ownerExpectation.includes("陪伴")) {
    return "shared";
  }

  return null;
}

function stableHash(input: string): number {
  let value = 2166136261;
  for (const character of input) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function selectTrait(
  pet: UserPet,
  experiences: readonly GrowthExperience[],
  ownerExpectation: string,
): string | null {
  const preferredCategory = categoryWeightedBy(ownerExpectation);
  const eligibleExperiences = preferredCategory
    ? experiences.filter((experience) => experience.category === preferredCategory)
    : experiences;
  const candidates = eligibleExperiences.flatMap(
    (experience) => TRAITS_BY_CATEGORY[experience.category],
  );
  const newCandidates = candidates.filter(
    (trait) => !pet.abstractTraits.includes(trait),
  );

  if (newCandidates.length === 0) {
    return null;
  }

  const sourceIds = experiences.map((experience) => experience.id).sort().join(":");
  return newCandidates[stableHash(`${pet.lifeSeed}:${sourceIds}`) % newCandidates.length];
}

export function proposeEvolution(
  pet: UserPet,
  experiences: readonly GrowthExperience[],
  ownerExpectation: string,
): EvolutionEvent {
  const sources = Object.freeze(experiences.map((experience) => Object.freeze({ ...experience })));

  return Object.freeze({
    petName: pet.name,
    sources,
    ownerInfluence: ownerExpectation,
    decisionBy: "pet",
    visualTrait: selectTrait(pet, sources, ownerExpectation),
  });
}

export function applyEvolution(pet: UserPet, event: EvolutionEvent): UserPet {
  if (
    event.sources.length === 0 ||
    !event.visualTrait ||
    pet.abstractTraits.includes(event.visualTrait)
  ) {
    return pet;
  }

  return Object.freeze({
    ...pet,
    abstractTraits: Object.freeze([...pet.abstractTraits, event.visualTrait]),
  });
}

export function writeGrowthDiary(event: EvolutionEvent): string {
  if (!event.visualTrait) {
    return `${event.petName}暂时没有新的成长变化。`;
  }

  return `${event.petName}从${event.sources.map((source) => source.id).join("、")}的经历中，自主决定添上${event.visualTrait}。`;
}
