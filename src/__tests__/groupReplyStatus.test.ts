import { groupReplyJobs, groupReplyProgress, startGroupReplyRefresh } from "../chat/groupReplyStatus";
import type { AgentJob, ChatMessage, MentionTarget } from "../data/types";

const message: ChatMessage = { id: "m1", clientId: "c1", spaceId: "s1", senderId: "u1", actorKind: "human", actorName: "甲", kind: "text", text: "明天见", mediaPath: null, mediaDurationSeconds: null, replyToMessageId: null, replyPreview: null, createdAt: "2026-09-14T00:00:00Z", deliveryState: "sent", reactions: {} };
const job: AgentJob = { id: "j1", kind: "route_space_pets", scopeId: "s1", sourceMessageId: "m1", status: "queued", errorCode: null, attempts: 0, createdAt: message.createdAt, completedAt: null, progressLabel: "等待异宠处理" };
const targets: MentionTarget[] = [{ id: "p1", kind: "pet", displayName: "团团", ownerName: "甲", avatarUrl: null }, { id: "p2", kind: "pet", displayName: "圆圆", ownerName: "乙", avatarUrl: null }];
const cue = { ...message, mentions: [{ kind: "pet" as const, targetId: "p1", displayText: "团团" }] };
const reply = { ...message, id: "r1", actorKind: "pet" as const, actorId: "p1", senderId: null, replyToMessageId: "m1" };

describe("group reply progress reflects a requested reply", () => {
  test.each(["queued", "running", "failed"] as const)("ordinary %s route/observation has no reply progress", (status) => {
    expect(groupReplyJobs([message], [{ ...job, status }], targets).size).toBe(0);
  });
  test("human mentions and a pet's name in normal discussion do not imply a reply", () => {
    expect(groupReplyJobs([{ ...message, text: "今天团团很开心 @乙", mentions: [{ kind: "user", targetId: "u2", displayText: "乙" }] }], [job], targets).size).toBe(0);
  });
  test("structured, typed and direct reply cues show the actual route", () => {
    for (const source of [cue, { ...message, text: "@团团 你好" }, { ...message, text: "团团你觉得呢？" }]) {
      expect(groupReplyJobs([source], [job], targets).get("m1")).toBe(job);
    }
    expect(groupReplyJobs([{ ...reply, id: "parent", replyToMessageId: null }, { ...message, replyToMessageId: "parent" }], [job], []).get("m1")).toBe(job);
    expect(groupReplyProgress(job)).toBe("等待异宠回应…");
  });
  test("server-selected IDs are authoritative, including paused/no eligible pets", () => {
    expect(groupReplyJobs([cue], [{ ...job, replyPetIds: [] }], targets).size).toBe(0);
    expect(groupReplyJobs([message], [{ ...job, replyPetIds: ["p2"] }], []).size).toBe(1);
  });
  test("committed reply hides stale running status while observation finishes", () => {
    expect(groupReplyJobs([cue, reply], [{ ...job, status: "running" }], targets).size).toBe(0);
    expect(groupReplyJobs([cue, { ...reply, replyToMessageId: "another" }], [job], targets).size).toBe(1);
  });
  test("multiple pets stay pending until every requested pet has replied", () => {
    const two = { ...job, replyPetIds: ["p1", "p2"], status: "running" as const };
    expect(groupReplyJobs([message, reply], [two], targets).size).toBe(1);
    expect(groupReplyJobs([message, reply, { ...reply, id: "r2", actorId: "p2" }], [two], targets).size).toBe(0);
  });
  test("latest route wins; unrelated analysis jobs cannot replace it", () => {
    const latest = { ...job, id: "new", createdAt: "2026-09-14T00:01:00Z", replyPetIds: [] };
    expect(groupReplyJobs([cue], [job, latest], targets).size).toBe(0);
    expect(groupReplyJobs([cue], [{ ...job, kind: "group_work_analysis" }], targets).size).toBe(0);
  });
  test("legacy review remains visible with its retry prohibition", () => {
    const review = { ...job, status: "blocked" as const, retryable: false, errorCode: "legacy_route_review_required" };
    expect(groupReplyJobs([cue], [review], targets).get("m1")).toEqual(review);
  });
});

test("missed-event refresh is foreground-only, single-flight and stops on cleanup", async () => {
  jest.useFakeTimers();
  let active = false;
  let resolve!: () => void;
  const refresh = jest.fn(() => new Promise<void>((done) => { resolve = done; }));
  const stop = startGroupReplyRefresh(refresh, () => active);
  try {
    jest.advanceTimersByTime(5_000); expect(refresh).not.toHaveBeenCalled();
    active = true; jest.advanceTimersByTime(2_500); expect(refresh).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10_000); expect(refresh).toHaveBeenCalledTimes(1);
    resolve(); await Promise.resolve(); await Promise.resolve();
    stop(); jest.advanceTimersByTime(10_000); expect(refresh).toHaveBeenCalledTimes(1);
  } finally { stop(); jest.useRealTimers(); }
});
