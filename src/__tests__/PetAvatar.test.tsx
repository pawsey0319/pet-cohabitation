import { render, screen } from "@testing-library/react-native";
import { PetAvatar } from "../components/PetAvatar";
import { createDemoSeed } from "../domain/seed";

const evolutionTraits = [
  "柔光绒边",
  "暖心徽记",
  "专注星纹",
  "工具小挂饰",
  "迎宾光点",
  "友伴缎带",
  "同游足迹",
  "共鸣铃铛",
] as const;

function petWithTrait(trait: string) {
  const pet = createDemoSeed().pet;
  return Object.freeze({ ...pet, abstractTraits: Object.freeze([trait]) });
}

describe("PetAvatar additive trait marks", () => {
  it.each(evolutionTraits)("renders the evolution trait %s as a visible mark", async (trait) => {
    await render(<PetAvatar pet={petWithTrait(trait)} />);

    expect(screen.getByLabelText(`成长印记：${trait}`)).toBeTruthy();
  });

  it("renders an unknown future trait in a deterministic fallback slot", async () => {
    await render(<PetAvatar pet={petWithTrait("月光羽片")} />);

    expect(screen.getByLabelText("成长印记：月光羽片").props.testID).toBe(
      "trait-mark-fallback-1",
    );
  });

  it("does not mistake a keyword-containing future trait for an exact seed trait", async () => {
    await render(<PetAvatar pet={petWithTrait("深度倾听纹")} />);

    expect(screen.getByLabelText("成长印记：深度倾听纹").props.testID).toBe(
      "trait-mark-fallback-2",
    );
  });
});
