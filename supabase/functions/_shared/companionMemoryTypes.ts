export type LifeFact = { id?: string; kind: "experience" | "person" | "goal"; label: string; quote: string; phase: "desired" | "planned" | "ongoing" | "happened"; source_message_id?: string; source_date?: string };
export type InteractionSettings = { address?: string; response_length?: "concise" | "balanced" | "detailed"; advice_frequency?: "listen" | "when_asked" | "balanced" | "proactive"; humor?: "none" | "light" | "playful"; teasing?: "none" | "light" };
export type SettingCandidate = { key: keyof InteractionSettings; value: string; quote: string };
export type LifeExtraction = { facts: LifeFact[]; settings: SettingCandidate[] };
const nonEvidence = /假如|假设|如果|要是|开玩笑|逗你|举个例|比如|例如|梦见|梦到|小说|剧本|转述|他[说讲]|她[说讲]|别人[说讲]|听说|据说|[“”「」『』]|(?:^|[，。！？\s])(?:他说|她说|朋友说)/;
export function hasLifeEvidenceCandidate(content: string): boolean {
  return /我|以后|今天|这次|回答|建议|幽默|吐槽|叫我|称呼/.test(content) && !nonEvidence.test(content);
}
/** Structural and literal-evidence validation is shared by real and mock paths. */
export function validateLifeExtraction(content: string, input: unknown): LifeExtraction {
  if (!input || typeof input !== "object") throw new Error("invalid_life_candidates");
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.facts) || value.facts.length > 5 || !Array.isArray(value.settings) || value.settings.length > 5) throw new Error("invalid_life_candidates");
  const factsInput = value.facts.map(candidate => {
    if (!candidate || typeof candidate !== "object") throw new Error("invalid_life_candidate");
    const row = candidate as Record<string, unknown>;
    if (!["experience", "person", "goal"].includes(String(row.kind)) || !["desired", "planned", "ongoing", "happened"].includes(String(row.phase)) || typeof row.label !== "string" || row.label.length < 1 || row.label.length > 80 || typeof row.quote !== "string" || row.quote.length < 1 || row.quote.length > 1000) throw new Error("invalid_life_candidate");
    return { kind: row.kind, label: row.label, quote: row.quote, phase: row.phase } as LifeFact;
  });
  const settingsInput = value.settings.map(candidate => {
    if (!candidate || typeof candidate !== "object") throw new Error("invalid_setting_candidate");
    const row = candidate as Record<string, unknown>;
    if (!["address", "response_length", "advice_frequency", "humor", "teasing"].includes(String(row.key)) || typeof row.value !== "string" || row.value.length < 1 || row.value.length > 40 || typeof row.quote !== "string" || row.quote.length < 1 || row.quote.length > 1000) throw new Error("invalid_setting_candidate");
    return { key: row.key, value: row.value, quote: row.quote } as SettingCandidate;
  });
  const parsed = { facts: factsInput, settings: settingsInput };
  if (nonEvidence.test(content)) return { facts: [], settings: [] };
  const facts = parsed.facts.filter(fact => {
    if (!content.includes(fact.quote) || !fact.quote.includes(fact.label) || !fact.quote.includes("我") || /[？?]/.test(fact.quote) || /我(?:没|不曾|从没|没有)|不是我|我不想|我不打算|我没计划/.test(fact.quote)) return false;
    if (fact.kind === "goal" && /以前|曾经|当时|小时候/.test(fact.quote)) return false;
    if (fact.kind === "person") return /我的?(?:朋友|同学|同事|伴侣|爱人|妻子|丈夫|妈妈|爸爸|母亲|父亲|孩子|哥哥|姐姐|弟弟|妹妹|家人|导师|室友)/.test(fact.quote) && fact.phase === "happened";
    if (fact.phase === "desired") return /我(?:很|也)?(?:想|希望|愿望)/.test(fact.quote);
    if (fact.phase === "planned") return /我(?:计划|打算|准备)|我[^。！？]{0,20}(?:明天|下周|下个月)[^。！？]{0,15}(?:要|会)/.test(fact.quote);
    if (fact.phase === "ongoing") return /我(?:正在|现在在|已经开始)|我[^。！？]{0,20}(?:进行中|练习中)/.test(fact.quote);
    return (fact.kind === "experience" || fact.kind === "goal") && /我[^。！？]{0,60}(?:完成了|做过|去过|参加了|经历了|通过了|做了|去了|拿到了|结束了|毕业了|搬家了)/.test(fact.quote);
  });
  const settings = parsed.settings.filter(setting => {
    if (!content.includes(setting.quote) || /[？?]/.test(setting.quote)) return false;
    if (setting.key === "address") return new RegExp(`(?:叫我|称呼我)[“"']?${setting.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(setting.quote);
    const rules: Record<string, Record<string, RegExp>> = {
      response_length: { concise: /简短|简洁|短一点|少说|别长篇/, balanced: /适中|均衡/, detailed: /详细|展开|多说一点/ },
      advice_frequency: { listen: /只想.{0,6}听|先听我|别建议|不要.{0,4}建议|别给.{0,4}建议/, when_asked: /问你.{0,8}建议|我问.{0,8}建议/, balanced: /适当.{0,4}建议/, proactive: /主动.{0,4}建议|多给.{0,4}建议/ },
      humor: { none: /别开玩笑|不要.{0,4}幽默|严肃/, light: /轻松|幽默一点/, playful: /活泼|多开玩笑/ },
      teasing: { none: /别吐槽|不要吐槽|不喜欢.{0,4}吐槽/, light: /可以.{0,4}吐槽|轻微吐槽|偶尔.{0,4}吐槽/ },
    };
    return rules[setting.key]?.[setting.value]?.test(setting.quote) === true;
  });
  return { facts, settings };
}

export function extractLocalLifeEvidence(content: string): LifeExtraction {
  const facts: LifeFact[] = []; const settings: SettingCandidate[] = [];
  if (!hasLifeEvidenceCandidate(content)) return { facts, settings };
  for (const quote of content.split(/[。！\n]/).map(value => value.trim()).filter(Boolean)) {
    const goal = quote.match(/我(想|希望|计划|打算|准备|正在|现在在|已经开始)(.{1,60})$/);
    if (goal) facts.push({ kind: "goal", label: goal[2], quote, phase: ["想", "希望"].includes(goal[1]) ? "desired" : ["正在", "现在在", "已经开始"].includes(goal[1]) ? "ongoing" : "planned" });
    const experience = quote.match(/我.{0,20}?(完成了|参加了|去过|通过了)(.{1,60})$/);
    if (experience) facts.push({ kind: "experience", label: experience[2], quote, phase: "happened" });
    const person = quote.match(/我的?(朋友|同学|同事|伴侣|妈妈|爸爸|导师|室友)(?:叫|是)?([\p{Script=Han}A-Za-z]{1,12})/u);
    if (person) facts.push({ kind: "person", label: person[0], quote, phase: "happened" });
    if (/简短|简洁|短一点|少说|别长篇/.test(quote)) settings.push({ key: "response_length", value: "concise", quote });
    else if (/详细|展开|多说一点/.test(quote)) settings.push({ key: "response_length", value: "detailed", quote });
    if (/先听我|别建议|不要.{0,4}建议|别给.{0,4}建议/.test(quote)) settings.push({ key: "advice_frequency", value: "listen", quote });
    if (/别吐槽|不要吐槽|不喜欢.{0,4}吐槽/.test(quote)) settings.push({ key: "teasing", value: "none", quote });
    const address = quote.match(/(?:叫我|称呼我)([\p{Script=Han}A-Za-z0-9]{1,16})/u);
    if (address) settings.push({ key: "address", value: address[1], quote });
  }
  return validateLifeExtraction(content, { facts: facts.slice(0, 5), settings: settings.slice(0, 5) });
}


