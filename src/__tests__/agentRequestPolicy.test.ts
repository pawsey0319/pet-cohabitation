import {
  canExecuteDirectly,
  resolveProposalState,
  type ProposalVoteSnapshot,
} from "../agents/requestPolicy";

const members = ["a", "b", "c", "d", "e"] as const;

function vote(userId: string, decision: "approve" | "reject"): ProposalVoteSnapshot {
  return { userId, decision };
}

describe("agent request execution policy", () => {
  it("approves an ordinary proposal after a strict majority", () => {
    expect(resolveProposalState({
      memberIds: members,
      affectedUserIds: [],
      votes: [vote("a", "approve"), vote("b", "approve"), vote("c", "approve")],
      expiresAt: "2026-08-30T00:00:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    })).toBe("approved");
  });

  it("waits until every affected member has personally approved", () => {
    expect(resolveProposalState({
      memberIds: members,
      affectedUserIds: ["d"],
      votes: [vote("a", "approve"), vote("b", "approve"), vote("c", "approve")],
      expiresAt: "2026-08-30T00:00:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    })).toBe("pending");
  });

  it("rejects when an affected member explicitly rejects", () => {
    expect(resolveProposalState({
      memberIds: members,
      affectedUserIds: ["d"],
      votes: [vote("a", "approve"), vote("b", "approve"), vote("c", "approve"), vote("d", "reject")],
      expiresAt: "2026-08-30T00:00:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    })).toBe("rejected");
  });

  it("expires before evaluating votes", () => {
    expect(resolveProposalState({
      memberIds: members,
      affectedUserIds: [],
      votes: [vote("a", "approve"), vote("b", "approve"), vote("c", "approve")],
      expiresAt: "2026-08-24T00:00:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    })).toBe("expired");
  });

  it("directly executes only exact delegated messages and personal reminders", () => {
    expect(canExecuteDirectly({ kind: "delegated_message", targetSpaceId: "space-a", exactContent: "我今天会晚一点到。" })).toBe(true);
    expect(canExecuteDirectly({ kind: "personal_reminder", targetSpaceId: null, exactContent: "晚上九点提醒我喝水" })).toBe(true);
    expect(canExecuteDirectly({ kind: "delegated_message", targetSpaceId: "space-a", exactContent: "" })).toBe(false);
    expect(canExecuteDirectly({ kind: "group_plan", targetSpaceId: "space-a", exactContent: "周末聚餐" })).toBe(false);
  });
});
