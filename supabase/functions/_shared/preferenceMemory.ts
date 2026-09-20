/** Shared by Expo, the local demo and Edge Functions. No runtime dependencies. */
export type PreferencePolarity = "positive" | "negative";
export type PreferenceState = "active" | "retracted" | "forgotten";
export type PreferenceCandidate = Readonly<{
  object: string; topic: "drink" | "food" | "hobby" | "communication" | "other";
  context: string; polarity: PreferencePolarity; temporal: "current" | "past";
  strength: number; quote: string; preferredOver: readonly string[];
  operation: "observe" | "retract" | "forget";
}>;
export type MemoryEvidence = PreferenceCandidate & Readonly<{
  id: string; sourceMessageId: string | null; manualMemoryId: string | null;
  occurredAt: string; state: PreferenceState; origin: "conversation" | "manual";
}>;
export type PreferenceFacts = Readonly<{
  key: string; object: string; topic: PreferenceCandidate["topic"]; context: string;
  polarity: PreferencePolarity; temporal: "current" | "past"; lastExpressedAt: string;
  strength: number; frequencyDays: number; evidenceCount: number; important: boolean;
  latestEvidenceId: string; latestSourceMessageId: string | null; quote: string;
  preferredOver: readonly string[]; hadPositive: boolean;
}>;
export type PreferenceView = PreferenceFacts & Readonly<{
  status: "current" | "past" | "not_recommended";
  score: number; reasons: readonly string[];
}>;
export type MemoryWeights = Readonly<{ recency: number; frequency: number; strength: number; halfLifeDays: number; frequencyWindowDays: number; frequencyCapDays: number }>;
export const DEFAULT_MEMORY_WEIGHTS: MemoryWeights = { recency: .5, frequency: .3, strength: .2, halfLifeDays: 30, frequencyWindowDays: 90, frequencyCapDays: 5 };
export const preferenceKey = (object: string, context = "global") => `${object.trim().toLowerCase()}|${context.trim().toLowerCase() || "global"}`;
const DAY = 86_400_000;

export function scorePreference(fact: PreferenceFacts, now = Date.now(), weights = DEFAULT_MEMORY_WEIGHTS): PreferenceView {
  const age = Math.max(0, now - Date.parse(fact.lastExpressedAt)) / DAY;
  const score = weights.recency * Math.pow(2, -age / weights.halfLifeDays)
    + weights.frequency * Math.min(fact.frequencyDays / weights.frequencyCapDays, 1)
    + weights.strength * fact.strength;
  const status = fact.temporal === "past" ? "past" : fact.polarity === "negative" ? "not_recommended" : "current";
  const reasons = [fact.important ? "你标记为重要" : "", age <= 7 ? "最近明确表达过" : "有你的原话作为依据", fact.frequencyDays > 1 ? `近 90 天有 ${fact.frequencyDays} 天表达过` : "", fact.strength >= 1 ? "你表达了较强的偏好" : ""].filter(Boolean);
  return { ...fact, status, score, reasons };
}

export function buildPreferenceViews(evidence: readonly MemoryEvidence[], importantKeys: readonly string[] = [], now = Date.now(), weights = DEFAULT_MEMORY_WEIGHTS): PreferenceView[] {
  const groups = new Map<string, MemoryEvidence[]>();
  for (const item of evidence) {
    if (item.state !== "active" || item.operation !== "observe") continue;
    const key = preferenceKey(item.object, item.context);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([key, rows]) => {
    const sorted = rows.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.id.localeCompare(a.id));
    const latest = sorted.find((item) => item.temporal === "current") ?? sorted[0];
    const days = new Set(rows.filter((item) => item.origin === "conversation" && item.temporal === "current" && item.polarity === latest.polarity && Date.parse(item.occurredAt) >= now - weights.frequencyWindowDays * DAY).map((item) => new Date(item.occurredAt).toISOString().slice(0, 10)));
    return scorePreference({ key, object: latest.object, topic: latest.topic, context: latest.context, polarity: latest.polarity, temporal: latest.temporal, lastExpressedAt: latest.occurredAt, strength: latest.strength, frequencyDays: days.size, evidenceCount: rows.length, important: importantKeys.includes(key), latestEvidenceId: latest.id, latestSourceMessageId: latest.sourceMessageId, quote: latest.quote, preferredOver: latest.preferredOver, hadPositive: rows.some((item) => item.polarity === "positive") }, now, weights);
  }).sort((a, b) => Date.parse(b.lastExpressedAt) - Date.parse(a.lastExpressedAt));
}

export function selectPreferences(views: readonly PreferenceView[], question: string, limit = 5): PreferenceView[] {
  const general = /我的偏好|喜欢什么|了解我|记得我|记忆|我的喜好/.test(question);
  const topics = new Set<string>();
  if (/喝|饮料|饮品|咖啡|茶|牛奶|果汁/.test(question)) topics.add("drink");
  if (/吃|食物|口味|餐/.test(question)) topics.add("food");
  if (/爱好|兴趣|运动|玩什么/.test(question)) topics.add("hobby");
  if (/累|难过|烦|倾诉|听我|建议|心事|相处|安静/.test(question)) topics.add("communication");
  for (const view of views) if (question.includes(view.object)) topics.add(view.topic);
  const contextual = views.filter((view) => (general || question.includes(view.object) || topics.has(view.topic)) && (view.context === "global" || question.includes(view.context)));
  const preferred = new Set<string>();
  for (const view of contextual) if (view.status === "current" && (view.preferredOver.some((object) => contextual.some((other) => other.object === object && Date.parse(other.lastExpressedAt) <= Date.parse(view.lastExpressedAt))) || /更喜欢|最喜欢|偏爱|更希望/.test(view.quote))) preferred.add(view.key);
  return contextual.sort((a, b) => Number(b.status === "not_recommended") - Number(a.status === "not_recommended")
    || Number(preferred.has(b.key)) - Number(preferred.has(a.key))
    || Number(b.important && b.status === "current") - Number(a.important && a.status === "current")
    || Number(b.status === "current") - Number(a.status === "current") || b.score - a.score).slice(0, limit);
}

const unsafeExpression = /朋友|同事|他喜欢|她喜欢|他们|她们|假如|假设|如果|要是|开玩笑|举例|比如说|例如说|是不是|是否|[吗么？?]|[“”「」『』"‘’]/;
export function hasExplicitSelfPreference(content: string): boolean {
  return content.split(/[，,。！？!?;；\n]/).some((clause)=> !unsafeExpression.test(clause)
    && /我/.test(clause) && /喜欢|偏爱|爱喝|爱吃|爱玩|不喝|不吃|讨厌|希望|想要|忘记|不要记/.test(clause));
}
export function validatePreferenceCandidates(content: string, candidates: readonly PreferenceCandidate[]): PreferenceCandidate[] {
  return candidates.filter((item) => {
    if (!item.object.trim() || item.object.length > 80 || item.context.length > 80 || !item.quote || !content.includes(item.quote) || !item.quote.includes(item.object) || unsafeExpression.test(item.quote)) return false;
    const position = content.indexOf(item.quote);
    // Check the surrounding statement too: a model must not strip "假如", a
    // third-party attribution or a question mark to turn a quote into evidence.
    const before = content.slice(0, position).split(/[。！？!?;；\n]/).at(-1) ?? "";
    const after = content.slice(position + item.quote.length).match(/^[^。！？!?;；\n]*[。！？!?;；\n]?/)?.[0] ?? "";
    if (unsafeExpression.test(before + item.quote + after)) return false;
    if (item.context.trim() && item.context !== "global" && !content.includes(item.context)) return false;
    const preceding = content.slice(0, position).split(/[。！？!?;；\n]/).at(-1) ?? "";
    if (!/我/.test(item.quote) && (!/^我/.test(preceding.trim()) || unsafeExpression.test(preceding))) return false;
    if (item.operation !== "observe") return item.operation === "forget" ? /忘记|别再记|不要记/.test(item.quote) : /从没|从未|不是我|说错/.test(item.quote) || (/记错/.test(content) && /不喜欢|不爱|不喝|不吃/.test(item.quote));
    const negated = /(?:不|没)(?:再|太|怎么|那么|很)?(?:喜欢|爱|喝|吃|希望|想要)|讨厌|从没|从未|别再|不要/.test(item.quote);
    if ((item.polarity === "positive" && negated) || (item.polarity === "negative" && !negated)) return false;
    return /喜欢|偏爱|爱喝|爱吃|爱玩|不喝|不吃|讨厌|希望|想要/.test(item.quote);
  }).slice(0, 5).map((item) => ({ ...item, object: item.object.trim().toLowerCase(), context: item.context.trim() || "global", strength: item.strength >= 1 ? 1 : .6, preferredOver: item.preferredOver.filter((name) => name !== item.object && content.includes(name)).slice(0, 3) }));
}

/** Conservative rules used by local/mock mode. The live adapter also validates exact source quotes. */
export function extractLocalPreferences(content: string): PreferenceCandidate[] {
  const candidates: PreferenceCandidate[] = [];
  let owner = false;
  for (const raw of content.split(/[，,。！？!?;；\n]/)) {
    const clause = raw.trim(); if (!clause) continue;
    if (unsafeExpression.test(clause)) { owner = false; continue; }
    if (/^我/.test(clause)) owner = true;
    if (!owner && !/你记错了/.test(content)) continue;
    const match = clause.match(/(?:不再喜欢|已经不喜欢|从没喜欢过|从未喜欢过|不喜欢|更喜欢|特别喜欢|很喜欢|喜欢|偏爱|爱喝|爱吃|不喝|不吃|讨厌)(.+?)(?:了|的)?$/);
    if (!match) {
      const social = clause.match(/我(?:累的时候|难过的时候|烦的时候)?(?:更)?(?:希望|想要)(?:你)?(.+)/);
      if (social) candidates.push({ object: social[1], topic: "communication", context: /累的时候/.test(clause) ? "累" : /难过的时候/.test(clause) ? "难过" : "global", polarity: "positive", temporal: "current", strength: .6, quote: clause, preferredOver: [], operation: "observe" });
      continue;
    }
    const object = match[1].trim().replace(/(?:一些|一点)$/, "");
    const context = ["晚上", "早上", "工作时", "周末"].find((value) => clause.includes(value)) ?? "global";
    candidates.push({ object, topic: /茶|咖啡|牛奶|果汁|可乐|饮料|水/.test(object) ? "drink" : /吃|辣|甜|饭|面|菜/.test(clause) ? "food" : /运动|跑步|游泳|游戏|阅读|电影/.test(object) ? "hobby" : "other", context, polarity: /不再喜欢|不喜欢|从没|从未|不喝|不吃|讨厌/.test(clause) ? "negative" : "positive", temporal: /以前|过去|曾经/.test(clause) ? "past" : "current", strength: /更喜欢|特别|非常|最喜欢|偏爱/.test(clause) ? 1 : .6, quote: clause, preferredOver: /更喜欢|偏爱/.test(clause) ? candidates.filter((item) => item.polarity === "positive").map((item) => item.object) : [], operation: /从没|从未|记错/.test(clause) ? "retract" : "observe" });
  }
  return validatePreferenceCandidates(content, candidates);
}
