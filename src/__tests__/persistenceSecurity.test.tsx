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
  createInitialAppState,
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
      <Button title="写入新快照" onPress={() => dispatch({
        type: "SEND_HUMAN_MESSAGE",
        spaceId: state.spaces[0].id,
        actorId: state.currentUserId,
        content: "排队后的新快照",
        occurredAt: fixedNow,
      })} />
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
});
