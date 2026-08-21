jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import App from "../../App";
import { APP_STORAGE_KEY, createInitialAppState } from "../state/AppState";

describe("multi-space source isolation", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it("demonstrates friend pair, lover pair, and a 3-member circle with isolated messages", async () => {
    await render(<App />);

    expect(screen.getByText("好友双人 · 2 位成员")).toBeTruthy();
    expect(screen.getByText("亲密搭档 · 2 位成员")).toBeTruthy();
    expect(screen.getByText("朋友小圈 · 3 位成员")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "进入空间：海边二人间" }));
    expect(screen.getByText("周六一起看潮汐吧")).toBeTruthy();
    expect(screen.queryByText("周末想继续接力游戏吗？")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "选择空间：周末小队" }));
    expect(screen.getByText("我带了新的同题题目")).toBeTruthy();
    expect(screen.getByText("成员消息 · 乔")).toBeTruthy();
    expect(screen.queryByText("周六一起看潮汐吧")).toBeNull();
  });

  it("filters care provenance by exact space id instead of substring", async () => {
    const seed = createInitialAppState();
    const shortSpace = Object.freeze({
      ...seed.spaces[0],
      id: "space-old",
      name: "短前缀空间",
      memberNames: Object.freeze({ "owner-mei": "梅", "friend-lin": "林" }),
    });
    const saved = {
      ...seed,
      spaces: [shortSpace, ...seed.spaces],
      activeSpaceId: shortSpace.id,
      lastActiveAt: new Date().toISOString(),
      pet: {
        ...seed.pet,
        experiences: [
          {
            id: "care-space-old-1",
            category: "care",
            summary: "短空间的照顾记录",
            scope: "space",
            spaceId: "space-old",
            provenance: { source: "care", actorId: seed.pet.ownerId, occurredAt: "2026-08-21T08:00:00.000Z" },
          },
          {
            id: "care-space-old-friends-1",
            category: "care",
            summary: "长空间的照顾记录",
            scope: "space",
            spaceId: "space-old-friends",
            provenance: { source: "care", actorId: seed.pet.ownerId, occurredAt: "2026-08-21T08:01:00.000Z" },
          },
        ],
      },
    };
    await AsyncStorage.setItem(APP_STORAGE_KEY, JSON.stringify(saved));
    (AsyncStorage.setItem as jest.Mock).mockClear();

    await render(<App />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "空间" })).toBeTruthy());
    await fireEvent.press(screen.getByRole("tab", { name: "空间" }));
    expect(screen.getByText("短空间的照顾记录")).toBeTruthy();
    expect(screen.queryByText("长空间的照顾记录")).toBeNull();
  });
});
