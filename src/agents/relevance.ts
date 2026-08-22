export type PetCandidate = Readonly<{
  petId: string;
  petName: string;
  ownerId: string;
  ownerName: string;
  relevantTerms: readonly string[];
  participationEnabled: boolean;
  implicitCooldownUntil?: string | null;
}>;

export type RoutingInput = Readonly<{
  text: string;
  replyToPetId?: string | null;
  now: string;
  candidates: readonly PetCandidate[];
}>;

export type RoutedPet = Readonly<{ petId: string; explicit: boolean; score: number }>;

function normalizedIncludes(text: string, value: string): boolean {
  const term = value.trim().toLocaleLowerCase();
  return term.length > 0 && text.toLocaleLowerCase().includes(term);
}

export function routePetCandidates(input: RoutingInput): readonly RoutedPet[] {
  const scored = input.candidates.flatMap((candidate): RoutedPet[] => {
    if (!candidate.participationEnabled) return [];
    const mentioned = normalizedIncludes(input.text, `@${candidate.petName}`);
    const replied = input.replyToPetId === candidate.petId;
    const directQuestion = normalizedIncludes(input.text, candidate.petName) && /[?？]|你(觉得|会|能|想)/.test(input.text);
    const explicit = mentioned || replied || directQuestion;
    let score = explicit ? 100 : 0;
    if (normalizedIncludes(input.text, candidate.petName)) score += 35;
    if (normalizedIncludes(input.text, candidate.ownerName)) score += 25;
    score += candidate.relevantTerms.filter((term) => normalizedIncludes(input.text, term)).length * 10;
    if (!explicit && candidate.implicitCooldownUntil && candidate.implicitCooldownUntil > input.now) return [];
    return score >= 25 ? [{ petId: candidate.petId, explicit, score }] : [];
  }).sort((left, right) => right.score - left.score);

  const explicit = scored.filter((item) => item.explicit).slice(0, 3);
  if (explicit.length > 0) return explicit;
  return scored.slice(0, 1);
}

export type OwnerReplySafetyInput = Readonly<{
  ownerLastActiveAt: string | null;
  now: string;
  concernsOwner: boolean;
  topic: string;
}>;

const HIGH_RISK = /(见面|分手|复合|承诺|同意|立场|地址|位置|定位|生病|健康|医院|钱|转账|消费|购买|密码|身份证)/;

export function ownerReplyPolicy(input: OwnerReplySafetyInput): "pet_only" | "guess_low_risk" | "wait_for_owner" {
  if (!input.concernsOwner) return "pet_only";
  if (HIGH_RISK.test(input.topic)) return "wait_for_owner";
  const activeAt = input.ownerLastActiveAt ? Date.parse(input.ownerLastActiveAt) : 0;
  const now = Date.parse(input.now);
  if (activeAt > 0 && now - activeAt <= 5 * 60_000) return "wait_for_owner";
  return "guess_low_risk";
}
