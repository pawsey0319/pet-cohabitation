import { z } from "zod";
import { extractJsonValue, extractJsonValues, parseStructuredModelContent } from "../../supabase/functions/_shared/jsonExtraction";

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

  it("returns every valid candidate so callers can select by schema", () => {
    expect(extractJsonValues('草稿：["先分析"]\n正式：{"answer":"具体结果"}')).toEqual([
      ["先分析"],
      { answer: "具体结果" },
    ]);
  });

  it("rejects output that contains no valid JSON", () => {
    expect(() => extractJsonValue("只有自然语言，没有结构化结果")).toThrow("text_model_invalid_json");
  });

  it("does not extract a nested array from an unfinished parent", () => {
    expect(extractJsonValues('{"topics":["野餐"], "source_message_ids":["unfinished')).toEqual([]);
    expect(extractJsonValues('结果：{"content":"未闭合的字符串里面有 {}')).toEqual([]);
  });

  it("does not consider nested objects or reasoning to be final answers", () => {
    expect(extractJsonValues('结果：{"topics":[{"title":"野餐"}]}')).toEqual([{ topics: [{ title: "野餐" }] }]);
    expect(extractJsonValues('<think>{"answer":"草稿"}</think>{"answer":"结果"}')).toEqual([{ answer: "结果" }]);
  });
});

describe("parseStructuredModelContent", () => {
  const schema = z.object({ topics: z.array(z.string()) });
  const parse = (text: string, finishReason = "stop") => parseStructuredModelContent(text, finishReason, (value) => schema.safeParse(value));

  it("chooses the complete document that matches the required schema", () => {
    expect(parse('[] 然后 {"unrelated":true} 最终 {"topics":["公园野餐"]}')).toEqual({ topics: ["公园野餐"] });
  });

  it("rejects truncated responses even when a JSON fragment is valid", () => {
    expect(() => parse('{"topics":["半成品"]}', "length")).toThrow("text_model_output_truncated");
  });

  it("normalizes schema errors without exposing the model content", () => {
    expect(() => parse('{"topics":42}')).toThrow("text_model_invalid_structure");
    expect(() => parse('{}')).toThrow("text_model_invalid_structure");
    expect(() => parse('不能完成此请求', "content_filter")).toThrow("text_model_content_blocked");
  });
});
