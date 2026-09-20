import type { AgentJob, ChatMessage, MentionTarget } from "../data/types";

// A durable routing/observation job is not a promise of a pet reply. Only a
// deliberate cue gets reply progress, and a committed reply ends that progress
// even while the same worker finishes authorized background observation.
export function groupReplyJobs(
  messages: readonly ChatMessage[], jobs: readonly AgentJob[], targets: readonly MentionTarget[],
): ReadonlyMap<string, AgentJob> {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const replied = new Map<string, Set<string>>();
  for (const message of messages) {
    if (message.actorKind !== "pet" || !message.actorId || !message.replyToMessageId || message.deletedAt) continue;
    const pets = replied.get(message.replyToMessageId) ?? new Set<string>();
    pets.add(message.actorId); replied.set(message.replyToMessageId, pets);
  }
  const result = new Map<string, AgentJob>();
  const seen = new Set<string>();
  for (const job of [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (job.kind !== "route_space_pets" || !job.sourceMessageId || seen.has(job.sourceMessageId)) continue;
    seen.add(job.sourceMessageId);
    const message = byId.get(job.sourceMessageId);
    if (!message || message.actorKind !== "human" || message.deletedAt) continue;
    const parent = message.replyToMessageId ? byId.get(message.replyToMessageId) : undefined;
    const text = message.text ?? "";
    const cueIds = job.replyPetIds ?? [
      ...(message.mentions ?? []).filter((mention) => mention.kind === "pet").map((mention) => mention.targetId),
      ...(parent?.actorKind === "pet" && parent.actorId ? [parent.actorId] : []),
      ...targets.filter((target) => target.kind === "pet" && (
        text.includes(`@${target.displayName}`)
        || (text.includes(target.displayName) && /[?？]|你(觉得|会|能|想)/.test(text))
      )).map((target) => target.id),
    ];
    const expected = [...new Set(cueIds)].slice(0, 3);
    if (!expected.length || expected.every((id) => replied.get(message.id)?.has(id))) continue;
    result.set(message.id, job);
  }
  return result;
}

export function groupReplyProgress(job: AgentJob): string {
  if (job.status === "queued") return "等待异宠回应…";
  if (job.stage === "calling_model") return job.progressLabel || "异宠正在思考…";
  if (job.stage === "validating") return "异宠正在核对回答…";
  return "正在准备异宠回应…";
}

export function startGroupReplyRefresh(refresh: () => Promise<void>, active: () => boolean): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running || !active()) return;
    running = true;
    void refresh().catch(() => undefined).finally(() => { running = false; });
  }, 2_500);
  return () => clearInterval(timer);
}
