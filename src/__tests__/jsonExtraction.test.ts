import { extractJsonValue } from "../../supabase/functions/_shared/jsonExtraction";

describe("extractJsonValue", () => {
  it("parses a plain JSON object", () => {
    expect(extractJsonValue('{"answer":"你好"}')).toEqual({ answer: "你好" });
  });

  it("parses JSON inside a Markdown fence", () => {
    expect(extractJsonValue('这里是结果：\n```json\n{"topics":["计划"]}\n```')).toEqual({ topics: ["计划"] });
  });

  it("parses JSON after reasoning and before a trailing explanation", () => {
    expect(extractJsonValue('<think>先整理字段</think>\n{"risk":"none","content":"收到"}\n完成')).toEqual({
      risk: "none",
      content: "收到",
    });
  });

  it("does not mistake braces inside JSON strings for structure", () => {
    expect(extractJsonValue('说明 {not json} 然后 {"content":"保留 {括号} 和 \\\"引号\\\""}')).toEqual({
      content: '保留 {括号} 和 "引号"',
    });
  });

  it("supports a top-level array", () => {
    expect(extractJsonValue('结果：[1,{"ok":true}]。')).toEqual([1, { ok: true }]);
  });

  it("rejects output that contains no valid JSON", () => {
    expect(() => extractJsonValue("只有自然语言，没有结构化结果")).toThrow("text_model_invalid_json");
  });
});
