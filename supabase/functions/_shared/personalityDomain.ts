export const STYLE_TRAITS = ["gentle", "direct", "playful", "reflective", "concise", "expressive", "irreverent"] as const;
export type StyleTrait = typeof STYLE_TRAITS[number];
export const STYLE_LABELS: Record<StyleTrait, string> = {
  gentle: "表达温柔，先体会感受", direct: "坦率直接，清楚说重点", playful: "轻松幽默，偶尔开玩笑",
  reflective: "先思考和观察，再回应", concise: "习惯简短自然的交流", expressive: "表达有活力、情绪细节丰富",
  irreverent: "熟悉时可以口语粗犷、调侃和适度粗口，不贬低他人",
};
export type LearnedStyle = { trait: StyleTrait; strength: number };
export function styleHints(styles: readonly LearnedStyle[], scope: "private" | "group"): string[] {
  const hints = styles.filter(item => STYLE_TRAITS.includes(item.trait) && item.strength > 0)
    .map(item => STYLE_LABELS[item.trait]);
  return hints.length && scope === "group" ? [...hints, "群内根据场合收敛表达，避免对不熟悉的成员使用粗口或冒犯性的调侃；不解释私人学习来源。"] : hints;
}
export type StyleEvidenceCandidate = { trait: StyleTrait; quote: string; confidence: number };
export type RelationshipCandidate = {
  subject_id: string; object_id: string; relation: string; quote: string;
  assertion: "self_stated" | "reported" | "uncertain"; operation: "assert" | "retract";
};
export function validateStyleEvidence(content: string, values: readonly StyleEvidenceCandidate[]): StyleEvidenceCandidate[] {
  if (/假如|假设|假装|角色扮演|引用|“|「/.test(content)) return [];
  const seen = new Set<string>();
  return values.filter(item => STYLE_TRAITS.includes(item.trait) && item.confidence >= 0.75 && item.confidence <= 1
    && item.quote.trim().length >= 2 && content.includes(item.quote)
    && !/假如|假设|假装|角色扮演|引用|“|「/.test(item.quote)
    && !seen.has(item.trait) && Boolean(seen.add(item.trait))).slice(0, 3);
}
export function validateRelationships(content: string, speakerId: string, members: readonly { id: string; name: string }[], values: readonly RelationshipCandidate[]): RelationshipCandidate[] {
  if (/假如|假设|开玩笑|角色扮演|如果|梦见/.test(content)) return [];
  const memberIds = new Set(members.map(member => member.id));
  const referenced = (id: string, quote: string) => {
    if (id === speakerId || quote.includes(id)) return true;
    const member = members.find(item => item.id === id);
    return Boolean(member?.name && quote.includes(member.name) && members.filter(item => item.name === member.name).length === 1);
  };
  return values.filter(item => memberIds.has(item.subject_id) && memberIds.has(item.object_id)
    && item.subject_id !== item.object_id && content.includes(item.quote) && item.quote.trim().length >= 3
    && referenced(item.subject_id, item.quote) && referenced(item.object_id, item.quote)
    && item.relation.trim().length > 0 && item.relation.length <= 60
    && !/假如|假设|开玩笑|角色扮演|如果|梦见/.test(item.quote))
    // Attribution belongs to the speaker, not to the grammatical subject.
    // Preserve direction (e.g. "my father") and never promote a reported claim.
    .map(item => ({ ...item, assertion: item.assertion === "self_stated" && item.subject_id !== speakerId && item.object_id !== speakerId ? "reported" as const : item.assertion }))
    .slice(0, 3);
}
