export type PixelPetPromptInput = Readonly<{
  name: string;
  visualSeed: string;
  personalitySeed: string;
  seedSummary: string;
  instruction: string;
  negativeSeed: string;
  signals: readonly string[];
  mode: "initial" | "explore" | "edit";
}>;

export function buildPixelPetPrompt(input: PixelPetPromptInput): string {
  const continuity = input.mode === "edit"
    ? "这是基于父图的确认前连续修改。必须让人一眼看出是同一只异宠的下一版，保留主要生命关系和辨识度，只按本轮意见增量变化。"
    : input.mode === "explore"
      ? "这是确认前重新探索的新方向，身体结构和轮廓应与旧候选明显不同，不能只换颜色。"
      : "这是它的第一张外观候选，应建立清晰、独特且可长期延续的生命形象。";
  return [
    `为唯一成长型异宠“${input.name}”创作一张原创精细像素桌宠肖像。`,
    "制作目标：高质量 2D pixel-art game sprite concept，完整全身，居中自然待机姿势，紧凑轮廓；缩放到约 192×208 像素时，脸、肢体、器官、配件和表情仍清晰可读。",
    "形体要求：使用明确的头身关系、四肢或合理的替代运动器官、独特面部结构、标志性器官与一个能体现个性的配件。禁止简单几何色块、四叶团子、只有渐变填充的抽象图标或普通猫狗模板。",
    "绘制要求：使用精细像素簇、清楚的明暗层次、可读的材质和克制的轮廓光；细节必须足够大，不能依赖缩小后消失的噪点。画面只出现一只异宠，不出现文字、水印、UI、场景或分离的漂浮装饰。",
    "背景要求：透明背景优先；若接口无法透明，则使用干净、单色、容易移除且不接近异宠主体颜色的背景。为未来动作图集保留四周安全边距，不裁切任何器官。",
    continuity,
    `视觉种子：${input.visualSeed}`,
    `人格对姿态和表情的影响：${input.personalitySeed}`,
    `理解摘要：${input.seedSummary}`,
    `主人本轮意见：${input.instruction}`,
    `相处信号：${input.signals.join("；") || "尚少，保持开放、奇异、有生命感，不过度卖萌"}`,
    `负面约束：${input.negativeSeed}；禁止模仿现有 IP、受保护角色或在世艺术家的明确风格。`,
    "输出单张正方形 1024×1024 生产肖像，不输出精灵图表格或多视图。",
  ].join("\n");
}
