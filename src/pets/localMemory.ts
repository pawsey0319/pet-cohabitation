import type { PetPrivateMessage } from "../data/types";
import { preferenceKey, type MemoryEvidence, type PreferenceCandidate } from "../../supabase/functions/_shared/preferenceMemory";

export function excludeLocalContext(messages: readonly PetPrivateMessage[], previous: readonly string[], sources: readonly string[], evidenceIds: readonly string[] = [], manualIds: readonly string[] = []): string[] {
  const excluded = new Set([...previous, ...sources]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const message of messages) {
      if (excluded.has(message.id)) continue;
      if (message.contextMessageIds?.some((id) => excluded.has(id)) || message.memoryEvidenceIds?.some((id) => evidenceIds.includes(id)) || message.manualMemoryIds?.some((id) => manualIds.includes(id))) { excluded.add(message.id); changed = true; }
    }
  }
  return [...excluded];
}

export function recordLocalEvidence(existing: readonly MemoryEvidence[], source: PetPrivateMessage, candidates: readonly PreferenceCandidate[], messages: readonly PetPrivateMessage[], previousExclusions: readonly string[]) {
  let evidence = [...existing]; let excludedMessageIds = [...previousExclusions];
  if (excludedMessageIds.includes(source.id)) return { evidence, excludedMessageIds };
  for (const item of candidates) {
    const id = `${source.id}:${preferenceKey(item.object, item.context)}:${item.polarity}:${item.temporal}:${item.operation}`;
    if (evidence.some((row) => row.id === id)) continue;
    if (item.operation !== "observe") {
      const affected = evidence.filter((row) => preferenceKey(row.object, row.context) === preferenceKey(item.object, item.context) && Date.parse(row.occurredAt) <= Date.parse(source.createdAt));
      evidence = evidence.map((row) => affected.some((target) => target.id === row.id) ? { ...row, state: item.operation === "forget" ? "forgotten" : "retracted" } : row);
      excludedMessageIds = excludeLocalContext(messages, excludedMessageIds, affected.flatMap((row) => row.sourceMessageId ? [row.sourceMessageId] : []), affected.map((row) => row.id));
    }
    evidence.push({ ...item, id, sourceMessageId: source.id, manualMemoryId: null, occurredAt: source.createdAt, origin: "conversation", state: "active" });
  }
  return { evidence, excludedMessageIds };
}
