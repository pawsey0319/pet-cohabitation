import { fireEvent, render, screen } from "@testing-library/react-native";
import { AgentProposalCard } from "../components/AgentProposalCard";
import type { AgentProposal } from "../data/types";

const proposal: AgentProposal = {
  id: "proposal-1",
  requestId: "request-1",
  title: "周六一起去滨江公园",
  content: { request_kind: "group_schedule", summary: "周六一起去滨江公园", scheduled_for: "2026-08-29T01:30:00.000Z", created_by_name: "阿华" },
  memberSnapshot: ["owner-1", "member-2"],
  affectedUserIds: ["member-2"],
  requiredApprovals: 2,
  status: "voting",
  expiresAt: "2026-08-29T10:00:00.000Z",
  votes: [{ userId: "owner-1", decision: "approve", updatedAt: "2026-08-26T10:00:00.000Z" }],
};

describe("AgentProposalCard", () => {
  it("shows a discoverable schedule with the current vote state", async () => {
    await render(<AgentProposalCard proposal={proposal} currentUserId="member-2" onVote={jest.fn()} />);
    expect(screen.getByText("日程提案")).toBeTruthy();
    expect(screen.getByText("周六一起去滨江公园")).toBeTruthy();
    expect(screen.getByText(/赞成 1 \/ 2/)).toBeTruthy();
    expect(screen.getByText(/被安排成员需全部同意/)).toBeTruthy();
  });

  it("lets a member vote directly from the chat card", async () => {
    const onVote = jest.fn();
    await render(<AgentProposalCard proposal={proposal} currentUserId="member-2" onVote={onVote} />);
    fireEvent.press(screen.getByRole("button", { name: "赞成日程提案" }));
    expect(onVote).toHaveBeenCalledWith("approve");
  });
});
