import { petReplyFailureText, petReplyStage } from "../pets/replyStatus";

describe("pet reply status", () => {
  it("shows observable processing stages without exposing hidden chain of thought", () => {
    expect(petReplyStage("classifying").title).toBe("正在理解");
    expect(petReplyStage("retrieving").detail).toContain("已读和未读");
    expect(petReplyStage("thinking").title).toBe("正在组织回答");
  });

  it("turns model outages into an actionable retry state", () => {
    expect(petReplyFailureText("text_model_network_error")).toContain("可以稍后重试");
  });
});
