import { canEditInitialAppearance, canGenerateInitialCandidate, validateEvolutionDraft } from "../pets/rules";

describe("pet lifecycle rules", () => {
  it("requires five owner turns before first generation", () => {
    expect(canGenerateInitialCandidate("incubating", 4)).toBe(false);
    expect(canGenerateInitialCandidate("incubating", 5)).toBe(true);
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
