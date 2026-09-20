import { recallKeywords, recallSpaceMatches } from "../../supabase/functions/_shared/petRecallQuery";

describe("pet private recall query", () => {
  it("matches the owner's shorthand for a relationship space", () => {
    expect(recallSpaceMatches("告诉我公网群之前聊了什么", "公网互动测试")).toBe(true);
    expect(recallSpaceMatches("告诉我旅行群聊了什么", "公网互动测试")).toBe(false);
  });

  it("keeps specific topics so read history can be searched beyond recent messages", () => {
    expect(recallKeywords("之前关于露营装备聊了什么？", ["老友小圈"])).toEqual(["露营装备"]);
    expect(recallKeywords("还记得“雨天方案”吗？", ["老友小圈"])).toEqual(["雨天方案"]);
  });

  it("does not mistake a redundant recent-summary question for a historical topic", () => {
    expect(recallKeywords("关于老友小圈最近大家都聊了什么？", ["老友小圈"])).toEqual([]);
    expect(recallKeywords("关于这个群之前都说了什么？", ["老友小圈"])).toEqual([]);
    expect(recallKeywords("关于群里最近的消息总结一下", ["老友小圈"])).toEqual([]);
    expect(recallKeywords("还记得“消息”这个原词吗？", ["老友小圈"])).toEqual(["消息"]);
  });
});
