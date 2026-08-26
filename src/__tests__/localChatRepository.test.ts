jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createChatRepository } from "../data/chatRepository";
import type { AppProfile } from "../data/types";

const profile: AppProfile = { id: "00000000-0000-4000-8000-000000000001", email: "local@example.test", nickname: "本地测试" };

describe("local chat repository", () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it("does not emit a message refresh when an already-read space is marked read", async () => {
    const repository = createChatRepository(profile);
    const spaceId = await repository.createSpace({ name: "已读空间", kind: "friend_circle" });
    let refreshes = 0;
    const unsubscribe = repository.subscribe(spaceId, () => { refreshes += 1; });

    await repository.markRead(spaceId);

    unsubscribe();
    expect(refreshes).toBe(0);
  });

  it("keeps main-Agent requests in a shared auditable workbench", async () => {
    const repository = createChatRepository(profile);
    const spaceId = await repository.createSpace({ name: "计划空间", kind: "friend_circle" });
    const request = await repository.submitAgentRequest({
      spaceId,
      origin: "space_panel",
      kind: "read_summary",
      text: "总结最近消息",
      idempotencyKey: "local-request-0001",
    });
    const repeated = await repository.submitAgentRequest({
      spaceId,
      origin: "space_panel",
      kind: "read_summary",
      text: "不应重复执行",
      idempotencyKey: "local-request-0001",
    });

    expect(repeated.id).toBe(request.id);
    const shared = await repository.listAgentRequests(spaceId);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ kind: "read_summary", status: "completed" });
    expect(shared[0].resultText).toContain("群聊");
  });
});
