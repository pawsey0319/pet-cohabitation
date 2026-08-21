jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

import { createElement } from "react";
import { Button, Text, View } from "react-native";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import App from "../../App";
import {
  APP_INVALID_BACKUP_KEY,
  APP_STORAGE_KEY,
  AppProvider,
  appReducer,
  createInitialAppState,
  normalizeSavedState,
  normalizeSavedStateWithIssues,
  useAppState,
} from "../state/AppState";

const fixedNow = "2026-08-21T09:00:00.000Z";

function StateProbe() {
  const { dispatch, isHydrated, state } = useAppState();
  return (
    <View>
      <Text testID="hydration-status">{isHydrated ? "hydrated" : "loading"}</Text>
      <Text testID="snapshot">{JSON.stringify({
        lastActiveAt: state.lastActiveAt,
        spaces: state.spaces.map((space) => space.name),
        messages: state.messages.map((message) => message.content),
      })}</Text>
      <Button title="重置演示" onPress={() => dispatch({ type: "RESET_DEMO", now: fixedNow })} />
      <Button title="写入新快照" onPress={() => dispatch({
        type: "SEND_HUMAN_MESSAGE",
        spaceId: state.spaces[0].id,
        actorId: state.currentUserId,
        content: "排队后的新快照",
        occurredAt: fixedNow,
      })} />
      <Button title="重置并立即写入" onPress={() => {
        dispatch({ type: "RESET_DEMO", now: fixedNow });
        dispatch({
          type: "SEND_HUMAN_MESSAGE",
          spaceId: state.spaces[0].id,
          actorId: state.currentUserId,
          content: "重置后的即时消息",
          occurredAt: fixedNow,
        });
      }} />
    </View>
  );
}

describe("provider persistence security", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    await AsyncStorage.clear();
  });

  it("gates mutation UI until deferred hydration completes", async () => {
    let resolveGetItem: (value: string | null) => void = () => undefined;
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
      () => new Promise<string | null>((resolve) => { resolveGetItem = resolve; }),
    );

    await render(<App />);
    expect(screen.getByText("正在载入本机共生档案…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "发送消息" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "空间" })).toBeNull();

    resolveGetItem(JSON.stringify(createInitialAppState()));
    await waitFor(() => expect(screen.getByRole("tab", { name: "空间" })).toBeTruthy());
  });

  it("serializes snapshot writes so an older deferred write cannot finish last", async () => {
    let resolveFirstWrite: () => void = () => undefined;
    const written: string[] = [];
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => {
      written.push(value);
      if (written.length === 1) {
        return new Promise<void>((resolve) => { resolveFirstWrite = resolve; });
      }
      return Promise.resolve();
    });

    const provider = await render(
      createElement(AppProvider, { now: () => fixedNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(provider.getByTestId("hydration-status").props.children).toBe("hydrated"));
    await waitFor(() => expect(written).toHaveLength(1));
    await fireEvent.press(provider.getByText("写入新快照"));
    expect(written).toHaveLength(1);

    resolveFirstWrite();
    await waitFor(() => expect(written).toHaveLength(2));
    expect(JSON.parse(written[1]).messages.some(
      (message: { content: string }) => message.content === "排队后的新快照",
    )).toBe(true);
  });

  it("adopts an empty store at injected now and does not simulate absence on reopen", async () => {
    const first = await render(
      createElement(AppProvider, { now: () => fixedNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      APP_STORAGE_KEY,
      expect.stringContaining(`\"lastActiveAt\":\"${fixedNow}\"`),
    ));
    const firstSnapshot = (AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1];
    await first.unmount();
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(firstSnapshot);

    const reopened = await render(
      createElement(AppProvider, { now: () => fixedNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(reopened.getByTestId("hydration-status").props.children).toBe("hydrated"));
    const snapshot = JSON.parse(reopened.getByTestId("snapshot").props.children);
    expect(snapshot.lastActiveAt).toBe(fixedNow);
    expect(snapshot.messages.filter((content: string) => content.includes("轻松的问候"))).toEqual([]);
  });

  it("keeps valid nested history and backs up the raw payload before repair", async () => {
    const seed = createInitialAppState();
    const raw = JSON.stringify({
      ...seed,
      spaces: [
        seed.spaces[0],
        { id: 7, name: null, memberIds: "not-an-array" },
      ],
      messages: [
        seed.messages[0],
        { id: "bad-message", spaceId: 9, actorType: "human" },
      ],
      pet: {
        ...seed.pet,
        memories: [...seed.pet.memories, { id: "bad-memory", content: 42 }],
      },
      delegatedActions: [{ id: "bad-action", kind: 8 }],
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(raw);

    const provider = await render(
      createElement(AppProvider, { now: () => fixedNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(provider.getByTestId("hydration-status").props.children).toBe("hydrated"));
    const snapshot = JSON.parse(provider.getByTestId("snapshot").props.children);
    expect(snapshot.spaces).toContain("老友小圈");
    expect(snapshot.messages).toContain("周末想继续接力游戏吗？");
    expect(snapshot.spaces).not.toContain(null);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(APP_INVALID_BACKUP_KEY, raw);
  });

  it("renders a forged persisted meetup only as blocked and never confirmed", async () => {
    const seed = createInitialAppState();
    const forged = {
      ...seed,
      lastActiveAt: fixedNow,
      delegatedActions: [{
        id: "forged-meetup",
        kind: "meetup",
        petId: seed.pet.id,
        ownerId: seed.pet.ownerId,
        spaceId: seed.spaces[0].id,
        status: "completed",
        permissionSource: "pet_low_risk_delegation",
        summary: "持久化伪造见面",
      }],
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(forged));

    await render(<App />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "空间" })).toBeTruthy());
    await fireEvent.press(screen.getByRole("tab", { name: "空间" }));
    const card = screen.getByLabelText("代理事项：持久化伪造见面");
    expect(within(card).getByText("已阻断")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "本人确认" })).toBeNull();
    expect(within(card).queryByText("已确认")).toBeNull();
  });

  it("drops a forged cross-space reply preview before a friend can render it", async () => {
    const seed = createInitialAppState();
    const forgedPreview = "隐藏海边空间的私密回复文案";
    const raw = {
      ...seed,
      currentUserId: "friend-lin",
      activeSpaceId: seed.spaces[0].id,
      lastActiveAt: fixedNow,
      messages: [
        ...seed.messages,
        {
          id: "forged-cross-space-reply",
          spaceId: seed.spaces[0].id,
          actorType: "human",
          actorId: "friend-lin",
          permissionSource: "member_message",
          content: "老友空间中的正常回复",
          occurredAt: fixedNow,
          format: "text",
          metadata: {
            replyToMessageId: "message-lover-1",
            replyPreview: forgedPreview,
          },
        },
      ],
    };

    const normalized = normalizeSavedState(raw);
    const normalizedReply = normalized?.messages.find((message) => message.id === "forged-cross-space-reply");
    expect(JSON.stringify(normalizedReply)).not.toContain(forgedPreview);
    expect(normalizedReply?.metadata?.replyToMessageId).toBeUndefined();

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(raw));
    await render(<App />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "空间" })).toBeTruthy());
    await fireEvent.press(screen.getByRole("tab", { name: "空间" }));
    expect(screen.getByText("老友空间中的正常回复")).toBeTruthy();
    expect(screen.queryByText(forgedPreview)).toBeNull();
  });

  it("keeps the first valid duplicate space identity for every authorization lookup", async () => {
    const seed = createInitialAppState();
    const canonicalSpace = seed.spaces[0];
    const attackerContent = "重复空间中的攻击者消息";
    const forgedExperience = "重复空间中的攻击者经历";
    const raw = {
      ...seed,
      lastActiveAt: fixedNow,
      activeSpaceId: canonicalSpace.id,
      spaces: [
        canonicalSpace,
        {
          ...canonicalSpace,
          name: "伪造同 ID 空间",
          memberIds: ["attacker-eve"],
          memberNames: { "attacker-eve": "攻击者" },
        },
        ...seed.spaces.slice(1),
      ],
      messages: [
        ...seed.messages,
        {
          id: "duplicate-space-attacker-message",
          spaceId: canonicalSpace.id,
          actorType: "human",
          actorId: "attacker-eve",
          permissionSource: "member_message",
          content: attackerContent,
          occurredAt: fixedNow,
        },
      ],
      pet: {
        ...seed.pet,
        experiences: [{
          id: "duplicate-space-attacker-experience",
          category: "social",
          summary: forgedExperience,
          scope: "space",
          spaceId: canonicalSpace.id,
          provenance: { source: "game", actorId: "attacker-eve", occurredAt: fixedNow },
        }],
      },
    };

    const normalized = normalizeSavedState(raw);
    expect(normalized?.spaces.filter((space) => space.id === canonicalSpace.id)).toHaveLength(1);
    expect(normalized?.spaces.find((space) => space.id === canonicalSpace.id)?.memberIds)
      .toEqual(canonicalSpace.memberIds);
    expect(normalized?.messages.map((message) => message.content)).not.toContain(attackerContent);
    expect(normalized?.pet.experiences.map((experience) => experience.summary)).not.toContain(forgedExperience);
    expect(normalized?.activeSpaceId).toBe(canonicalSpace.id);
    expect(normalized?.ritualSettings.spaceId).toBe(canonicalSpace.id);

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(raw));
    await render(<App />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "空间" })).toBeTruthy());
    await fireEvent.press(screen.getByRole("tab", { name: "空间" }));
    expect(screen.queryByText(attackerContent)).toBeNull();
    expect(screen.queryByText("伪造同 ID 空间")).toBeNull();
  });

  it("clears replies to an ambiguous duplicate message id", () => {
    const seed = createInitialAppState();
    const space = seed.spaces[0];
    const raw = {
      ...seed,
      messages: [
        ...seed.messages,
        {
          id: "ambiguous-message",
          spaceId: space.id,
          actorType: "human",
          actorId: seed.currentUserId,
          permissionSource: "member_message",
          content: "歧义目标甲",
          occurredAt: fixedNow,
        },
        {
          id: "ambiguous-message",
          spaceId: space.id,
          actorType: "human",
          actorId: "friend-lin",
          permissionSource: "member_message",
          content: "歧义目标乙",
          occurredAt: fixedNow,
        },
        {
          id: "reply-to-ambiguous-message",
          spaceId: space.id,
          actorType: "human",
          actorId: seed.currentUserId,
          permissionSource: "member_message",
          content: "不能引用歧义目标",
          occurredAt: fixedNow,
          metadata: {
            replyToMessageId: "ambiguous-message",
            replyPreview: "持久化伪造预览",
          },
        },
      ],
    };

    const normalized = normalizeSavedState(raw);
    const targetCopies = normalized?.messages.filter((message) => message.id === "ambiguous-message");
    const reply = normalized?.messages.find((message) => message.id === "reply-to-ambiguous-message");
    expect(targetCopies).toHaveLength(1);
    expect(reply?.metadata?.replyToMessageId).toBeUndefined();
    expect(reply?.metadata?.replyPreview).toBeUndefined();
  });

  it("treats an absent message format as canonical but repairs an explicit invalid format", () => {
    const seed = createInitialAppState();
    const absent = normalizeSavedStateWithIssues(seed);
    expect(absent.repaired).toBe(false);
    expect(absent.state?.messages[0]).not.toHaveProperty("format");

    const invalid = normalizeSavedStateWithIssues({
      ...seed,
      messages: seed.messages.map((message, index) => index === 0
        ? { ...message, format: "uploaded_video" }
        : message),
    });
    expect(invalid.repaired).toBe(true);
    expect(invalid.state?.messages[0].format).toBe("text");
  });

  it("keeps ritual, query, and summary snapshots canonical without inventing formats", () => {
    const seed = createInitialAppState();
    const invited = appReducer(seed, { type: "GENERATE_RITUAL_INVITE", occurredAt: fixedNow });
    const queried = appReducer(invited, {
      type: "QUERY_PET",
      spaceId: seed.spaces[0].id,
      requesterId: seed.currentUserId,
      occurredAt: fixedNow,
    });
    const summarized = appReducer(queried, {
      type: "RUN_SPACE_SUMMARY",
      spaceId: seed.spaces[0].id,
      occurredAt: fixedNow,
    });

    for (const snapshot of [seed, invited, queried, summarized]) {
      expect(normalizeSavedStateWithIssues(snapshot).repaired).toBe(false);
    }
  });

  it("backs up the exact raw payload for an explicit invalid message format", async () => {
    const seed = createInitialAppState();
    const raw = JSON.stringify({
      ...seed,
      lastActiveAt: fixedNow,
      messages: seed.messages.map((message, index) => index === 0
        ? { ...message, format: "uploaded_video" }
        : message),
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(raw);

    const provider = await render(
      createElement(AppProvider, { now: () => fixedNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(provider.getByTestId("hydration-status").props.children).toBe("hydrated"));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(APP_INVALID_BACKUP_KEY, raw);
  });

  it("does not back up a normal absence snapshot when it is reopened", async () => {
    const seed = createInitialAppState();
    const firstNow = "2026-08-23T09:00:00.000Z";
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(seed));

    const first = await render(
      createElement(AppProvider, { now: () => firstNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(first.getByTestId("hydration-status").props.children).toBe("hydrated"));
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      APP_STORAGE_KEY,
      expect.any(String),
    ));
    const savedSnapshots = (AsyncStorage.setItem as jest.Mock).mock.calls
      .filter(([key]) => key === APP_STORAGE_KEY)
      .map(([, value]) => value as string);
    const absenceSnapshot = savedSnapshots.at(-1);
    expect(absenceSnapshot).toContain("轻松的问候");
    await first.unmount();

    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(absenceSnapshot);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    const reopened = await render(
      createElement(AppProvider, { now: () => firstNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(reopened.getByTestId("hydration-status").props.children).toBe("hydrated"));
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(APP_INVALID_BACKUP_KEY, expect.any(String));
  });

  it("hydrates repaired valid history even when writing the invalid backup fails", async () => {
    const seed = createInitialAppState();
    const keptContent = "备份失败也要保留的有效历史";
    const raw = JSON.stringify({
      ...seed,
      lastActiveAt: fixedNow,
      messages: [
        ...seed.messages,
        {
          id: "kept-after-backup-failure",
          spaceId: seed.spaces[0].id,
          actorType: "human",
          actorId: seed.currentUserId,
          permissionSource: "forged-source-needs-repair",
          content: keptContent,
          occurredAt: fixedNow,
        },
        { id: "invalid-message-that-forces-backup", spaceId: 7 },
      ],
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(raw);
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string) =>
      key === APP_INVALID_BACKUP_KEY ? Promise.reject(new Error("backup unavailable")) : Promise.resolve(),
    );

    const provider = await render(
      createElement(AppProvider, { now: () => fixedNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(provider.getByTestId("hydration-status").props.children).toBe("hydrated"));
    expect(provider.getByTestId("snapshot").props.children).toContain(keptContent);
  });

  it("backs up an exact raw payload when same-length nested fields are canonicalized", async () => {
    const seed = createInitialAppState();
    const raw = JSON.stringify({
      ...seed,
      lastActiveAt: fixedNow,
      spaces: seed.spaces.map((space, index) => index === 0 ? {
        ...space,
        petGovernanceVotes: [{ voterId: "exited-member", petId: seed.pet.id, decision: "pause" }],
      } : space),
      messages: seed.messages.map((message, index) => index === 0 ? {
        ...message,
        permissionSource: "forged-space-source",
      } : message),
      delegatedActions: [
        {
          id: "same-id",
          kind: "tentative_reminder",
          petId: seed.pet.id,
          ownerId: seed.pet.ownerId,
          spaceId: seed.spaces[0].id,
          status: "pending_owner",
          permissionSource: "pet_low_risk_delegation",
        },
        {
          id: "same-id",
          kind: "tentative_reminder",
          petId: seed.pet.id,
          ownerId: seed.pet.ownerId,
          spaceId: seed.spaces[0].id,
          status: "pending_owner",
          permissionSource: "pet_low_risk_delegation",
        },
      ],
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(raw);

    const provider = await render(
      createElement(AppProvider, { now: () => fixedNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(provider.getByTestId("hydration-status").props.children).toBe("hydrated"));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(APP_INVALID_BACKUP_KEY, raw);
  });

  it("does not remove persisted data when a non-owner dispatches reset directly", async () => {
    const seed = createInitialAppState();
    const keptContent = "非主人不能删除的消息";
    const friendState = {
      ...seed,
      currentUserId: "friend-lin",
      lastActiveAt: fixedNow,
      messages: [...seed.messages, {
        id: "friend-kept-message",
        spaceId: seed.spaces[0].id,
        actorType: "human",
        actorId: "friend-lin",
        permissionSource: "member_message",
        content: keptContent,
        occurredAt: fixedNow,
        format: "text",
      }],
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(friendState));

    const provider = await render(
      createElement(AppProvider, { now: () => fixedNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(provider.getByTestId("hydration-status").props.children).toBe("hydrated"));
    (AsyncStorage.removeItem as jest.Mock).mockClear();
    await fireEvent.press(provider.getByText("重置演示"));

    expect(provider.getByTestId("snapshot").props.children).toContain(keptContent);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it("orders an old write, owner reset removal, and the final post-reset snapshot", async () => {
    let resolveOldWrite: () => void = () => undefined;
    let stored: string | null = null;
    const operations: string[] = [];
    let appWriteCount = 0;
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => {
      if (key !== APP_STORAGE_KEY) return Promise.resolve();
      appWriteCount += 1;
      if (appWriteCount === 1) {
        operations.push("old-set-start");
        return new Promise<void>((resolve) => {
          resolveOldWrite = () => {
            stored = value;
            operations.push("old-set-finish");
            resolve();
          };
        });
      }
      stored = value;
      operations.push("final-set");
      return Promise.resolve();
    });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(() => {
      stored = null;
      operations.push("remove");
      return Promise.resolve();
    });

    const provider = await render(
      createElement(AppProvider, { now: () => fixedNow }, createElement(StateProbe)),
    );
    await waitFor(() => expect(operations).toEqual(["old-set-start"]));
    await fireEvent.press(provider.getByText("重置并立即写入"));
    expect(provider.getByTestId("snapshot").props.children).toContain("重置后的即时消息");

    resolveOldWrite();
    await waitFor(() => expect(operations).toEqual([
      "old-set-start",
      "old-set-finish",
      "remove",
      "final-set",
    ]));
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "").messages.some(
      (message: { content: string }) => message.content === "重置后的即时消息",
    )).toBe(true);
  });
});
