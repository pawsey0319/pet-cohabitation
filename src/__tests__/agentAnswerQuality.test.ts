import {
  chunkDigestMessages,
  fallbackRecallAnswer,
  formatSpaceDigest,
  isUninformativeRecall,
} from "../../supabase/functions/_shared/answerQuality";

describe("agent answer quality", () => {
  it("chunks every unread message without a total message cap", () => {
    const messages = Array.from({ length: 165 }, (_, index) => ({
      id: `message-${index}`,
      actor: index % 2 ? "小林" : "阿华",
      content: `第 ${index + 1} 条讨论内容`,
      createdAt: new Date(2026, 7, 26, 10, index).toISOString(),
    }));

    const chunks = chunkDigestMessages(messages, { maxMessages: 80, maxCharacters: 40_000 });

    expect(chunks.map((chunk) => chunk.length)).toEqual([80, 80, 5]);
    expect(chunks.flat().map((message) => message.id)).toEqual(messages.map((message) => message.id));
  });

  it("formats concrete digest sections and coverage instead of a generic sentence", () => {
    const text = formatSpaceDigest({
      topics: ["周六在滨江公园见面，讨论了骑行路线"],
      decisions: ["集合时间暂定周六 09:30"],
      todos: ["阿华准备饮用水"],
      schedules: ["2026-08-29 09:30 滨江公园"],
      pending: ["是否下雨后改到室内仍待确认"],
      covered_from: "2026-08-26T09:00:00.000Z",
      covered_to: "2026-08-26T10:00:00.000Z",
      message_count: 165,
      source_message_ids: ["message-0", "message-164"],
    });

    expect(text).toContain("主要话题");
    expect(text).toContain("滨江公园");
    expect(text).toContain("已覆盖 165 条消息");
  });

  it("rejects placeholder recall replies and produces a sourced deterministic fallback", () => {
    expect(isUninformativeRecall("阿华田听见啦。我想先凑近观察一下，再告诉你我的发现。", true)).toBe(true);
    expect(isUninformativeRecall("最近大家确定周六九点半在滨江公园集合。", true)).toBe(false);

    const answer = fallbackRecallAnswer([
      { actor: "[群聊回忆·骑行群·2026-08-26] 小林", content: "周六九点半在滨江公园集合" },
      { actor: "[群聊回忆·骑行群·2026-08-26] 阿华", content: "我来准备饮用水" },
    ]);
    expect(answer).toContain("周六九点半");
    expect(answer).toContain("准备饮用水");
  });
});
