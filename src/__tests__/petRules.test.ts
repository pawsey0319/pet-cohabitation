import { canEditInitialAppearance, canGenerateInitialCandidate, hasCompletePetExpectations, validateEvolutionDraft } from "../pets/rules";

describe("pet lifecycle rules", () => {
  it("uses structured expectations instead of five incubation turns", () => {
    expect(canGenerateInitialCandidate("incubating", 0)).toBe(true);
    expect(hasCompletePetExpectations({ name: "芽芽", appearance: "像一团会发光的苔藓", personality: "安静但有主见", companionship: "先听再提醒", excludedFeatures: "不要人脸", additionalDescription: "" })).toBe(true);
    expect(hasCompletePetExpectations({ name: "芽芽", appearance: "", personality: "安静", companionship: "陪伴", excludedFeatures: "", additionalDescription: "" })).toBe(false);
  });

  it("permanently closes initial editing after confirmation", () => {
    expect(canEditInitialAppearance("drafting")).toBe(true);
    expect(canEditInitialAppearance("confirmed")).toBe(false);
    expect(canGenerateInitialCandidate("confirmed", 99)).toBe(false);
  });

  it("requires a current parent and one official evolution result", () => {
    expect(validateEvolutionDraft({ petStatus: "confirmed", currentAssetId: "a", parentAssetId: "b", officialResultsForEvent: 0, failedAttempts: 0 })).toContain("当前正式肖像");
    expect(validateEvolutionDraft({ petStatus: "confirmed", currentAssetId: "a", parentAssetId: "a", officialResultsForEvent: 1, failedAttempts: 0 })).toContain("一个正式结果");
    expect(validateEvolutionDraft({ petStatus: "confirmed", currentAssetId: "a", parentAssetId: "a", officialResultsForEvent: 0, failedAttempts: 0 })).toBeNull();
  });
});
