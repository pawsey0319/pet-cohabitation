import type { PetStatus, StyleSignal } from "../data/types";

export const MIN_INCUBATION_TURNS = 5;
export const DAILY_CANDIDATE_LIMIT = 20;

export function canGenerateInitialCandidate(status: PetStatus, _ownerTurns = 0): boolean {
  return status !== "confirmed";
}

export type PetExpectationInput = Readonly<{
  name: string;
  appearance: string;
  personality: string;
  companionship: string;
  excludedFeatures: string;
  additionalDescription: string;
}>;

export function hasCompletePetExpectations(input: PetExpectationInput): boolean {
  return input.name.trim().length > 0
    && input.appearance.trim().length >= 4
    && input.personality.trim().length >= 2
    && input.companionship.trim().length >= 2;
}

export function canEditInitialAppearance(status: PetStatus): boolean {
  return status === "incubating" || status === "drafting";
}

export function buildStyleSignalSummary(signals: readonly StyleSignal[]): string {
  return signals
    .filter((signal) => signal.feedback !== "forgotten")
    .map((signal) => {
      const correction = signal.feedback === "corrected" ? "（主人已纠正，需谨慎采纳）" : "";
      return `- ${signal.tendency}${correction}；依据：${signal.rationale}；置信度：${signal.confidence.toFixed(2)}`;
    })
    .join("\n");
}

export type EvolutionDraft = Readonly<{
  petStatus: PetStatus;
  currentAssetId: string | null;
  parentAssetId: string | null;
  officialResultsForEvent: number;
  failedAttempts: number;
}>;

export function validateEvolutionDraft(draft: EvolutionDraft): string | null {
  if (draft.petStatus !== "confirmed") return "只有已确认的异宠可以重大进化";
  if (!draft.currentAssetId || draft.parentAssetId !== draft.currentAssetId) return "重大进化必须直接引用当前正式肖像";
  if (draft.officialResultsForEvent > 0) return "同一进化事件只能产生一个正式结果";
  if (draft.failedAttempts >= 3) return "生成失败已达到最多两次重试";
  return null;
}

export const SOFT_CONTINUITY_INSTRUCTION =
  "必须把父图视为同一个生命的上一阶段，生成看得出延续关系的下一生命阶段；允许颜色、眼睛、轮廓和器官渐变，不强制永久保留任何单一特征。";
