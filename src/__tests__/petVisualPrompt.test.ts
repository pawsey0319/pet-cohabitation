import { buildPixelPetPrompt } from "../../supabase/functions/_shared/petVisualPrompt";

describe("pixel pet generation prompt", () => {
  it("keeps personalization while enforcing Codex desktop-pet production constraints", () => {
    const prompt = buildPixelPetPrompt({
      name: "雾角",
      visualSeed: "像深海鹿一样，有半透明鹿角和会发光的鳍",
      personalitySeed: "安静、敏锐，但偶尔会突然活泼",
      seedSummary: "观察型深海异宠",
      instruction: "让鹿角更不对称",
      negativeSeed: "不要普通猫狗",
      signals: ["主人喜欢克制的表达"],
      mode: "initial",
    });

    expect(prompt).toContain("精细像素桌宠");
    expect(prompt).toContain("192×208");
    expect(prompt).toContain("完整全身");
    expect(prompt).toContain("半透明鹿角");
    expect(prompt).toContain("禁止简单几何色块");
  });

  it("requires a recognisable life-stage relationship for edits", () => {
    const prompt = buildPixelPetPrompt({ name: "雾角", visualSeed: "深海鹿", personalitySeed: "安静", seedSummary: "观察型", instruction: "增加一条尾鳍", negativeSeed: "无文字", signals: [], mode: "edit" });
    expect(prompt).toContain("父图");
    expect(prompt).toContain("同一只异宠");
  });
});
