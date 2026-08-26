export type AgentRequestKind =
  | "read_summary"
  | "read_query"
  | "delegated_message"
  | "group_task"
  | "group_plan"
  | "group_schedule"
  | "personal_reminder"
  | "group_reminder";

export type ProposalVoteSnapshot = Readonly<{
  userId: string;
  decision: "approve" | "reject";
}>;

export type ProposalResolution = "pending" | "approved" | "rejected" | "expired";

export function resolveProposalState(input: Readonly<{
  memberIds: readonly string[];
  affectedUserIds: readonly string[];
  votes: readonly ProposalVoteSnapshot[];
  expiresAt: string;
  now: string;
}>): ProposalResolution {
  if (Date.parse(input.expiresAt) <= Date.parse(input.now)) return "expired";
  const members = new Set(input.memberIds);
  const latestVotes = new Map<string, ProposalVoteSnapshot["decision"]>();
  for (const current of input.votes) if (members.has(current.userId)) latestVotes.set(current.userId, current.decision);
  if (input.affectedUserIds.some((userId) => latestVotes.get(userId) === "reject")) return "rejected";
  const approvals = [...latestVotes.values()].filter((decision) => decision === "approve").length;
  const majority = Math.floor(input.memberIds.length / 2) + 1;
  const affectedApproved = input.affectedUserIds.every((userId) => latestVotes.get(userId) === "approve");
  return approvals >= majority && affectedApproved ? "approved" : "pending";
}

export function canExecuteDirectly(input: Readonly<{
  kind: AgentRequestKind;
  targetSpaceId: string | null;
  exactContent: string;
}>): boolean {
  if (!input.exactContent.trim()) return false;
  if (input.kind === "personal_reminder") return input.targetSpaceId === null;
  return input.kind === "delegated_message" && Boolean(input.targetSpaceId);
}
