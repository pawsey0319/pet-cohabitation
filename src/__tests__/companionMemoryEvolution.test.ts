import { extractLocalLifeEvidence, validateLifeExtraction } from "../../supabase/functions/_shared/companionMemoryTypes";
import { buildPrivateCompanionMessages } from "../../supabase/functions/_shared/privateCompanion";
test("only the owner's actual statement supplies factual content", () => {
  expect(extractLocalLifeEvidence("我参加了比赛").facts[0]).toMatchObject({ kind: "experience", quote: "我参加了比赛", phase: "happened" });
  expect(validateLifeExtraction("我参加了比赛", { facts: [{ kind: "experience", label: "冠军", quote: "我拿到了冠军", phase: "happened" }], settings: [] }).facts).toHaveLength(0);
});
test.each(["如果我完成了长跑", "我参加了比赛，开玩笑的", "他说我完成了长跑", "我梦见我参加了比赛", "我没有参加了比赛", "我参加了比赛？"])("does not remember hypothetical, joke, reported, dreamed or denied content: %s", content => {
  expect(extractLocalLifeEvidence(content).facts).toHaveLength(0);
});
test("desire, plan and ongoing goal have distinct phases", () => {
  expect(extractLocalLifeEvidence("我想学游泳").facts[0].phase).toBe("desired");
  expect(extractLocalLifeEvidence("我计划学游泳").facts[0].phase).toBe("planned");
  expect(extractLocalLifeEvidence("我正在学游泳").facts[0].phase).toBe("ongoing");
});
test("people records have no inferred group identity", () => {
  const facts = extractLocalLifeEvidence("我的朋友小王在北京").facts;
  expect(facts[0].kind).toBe("person");
  expect(facts[0]).not.toHaveProperty("user_id");
  expect(facts[0]).not.toHaveProperty("space_id");
});
test("explicit interaction preferences need matching evidence", () => {
  expect(extractLocalLifeEvidence("今天回答简短一点").settings).toEqual([{ key: "response_length", value: "concise", quote: "今天回答简短一点" }]);
  expect(extractLocalLifeEvidence("这次先听我说，别给建议").settings[0].value).toBe("listen");
  expect(validateLifeExtraction("请详细回答", { facts: [], settings: [{ key: "response_length", value: "concise", quote: "请详细回答" }] }).settings).toHaveLength(0);
});
test("companion prompt honors saved reply style and excludes forgotten fact sources", () => {
  const prompt = buildPrivateCompanionMessages({ petName: "芽芽", personality: "稳重", styles: [], memories: [], recalledMessages: [], messages: [{ role: "owner", content: "继续", created_at: "2026-09-11T00:00Z" }], contextStartedAt: null, responseStyle: "detailed", interactionSettings: { teasing: "none", advice_frequency: "listen" }, lifeFacts: [{ kind: "experience", label: "被忘记的旅行", quote: "我参加了被忘记的旅行", phase: "happened", source_message_id: "forgotten" }], excludedMessageIds: ["forgotten"] });
  expect(prompt[0].content).toContain("主人已选择详细回答");
  expect(prompt[1].content).toContain('"teasing":"none"');
  expect(JSON.stringify(prompt)).not.toContain("被忘记的旅行");
});
