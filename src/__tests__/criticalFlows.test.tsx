jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import App from "../../App";
import { APP_INVALID_BACKUP_KEY, APP_STORAGE_KEY, createInitialAppState } from "../state/AppState";

async function openOldFriendsSpace() {
  await fireEvent.press(screen.getByText("老友小圈"));
}

describe("critical cohabitation flows", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("navigates from home and labels human, pet, and space-agent content differently", async () => {
    await render(<App />);

    await openOldFriendsSpace();
    expect(screen.getByText("成员消息 · 林")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "问灯灯发生了什么" }));
    await fireEvent.press(screen.getByRole("button", { name: "请求客观总结" }));

    expect(screen.getByText("异宠视角 · 主观回顾")).toBeTruthy();
    expect(screen.getByText("空间主 Agent · 客观摘要")).toBeTruthy();
    expect(screen.getByText(/我还记得这里的老友小圈的接力游戏/)).toBeTruthy();
    expect(screen.getByText(/目前有1条成员消息和1条异宠消息/)).toBeTruthy();
    expect(screen.getByText("宠物发言不是主人承诺")).toBeTruthy();
  });

  it("never publishes a hydrated sensitive memory through the real pet-query UI", async () => {
    const seed = createInitialAppState();
    const secret = "我的住址和健康低谷";
    const saved = {
      ...seed,
      lastActiveAt: new Date().toISOString(),
      pet: {
        ...seed.pet,
        memories: [
          ...seed.pet.memories,
          {
            ...seed.pet.memories[1],
            id: "sensitive-ui-memory",
            spaceId: seed.spaces[0].id,
            sensitivity: "sensitive" as const,
            visibility: "space_members" as const,
            content: secret,
          },
        ],
      },
    };
    await AsyncStorage.setItem(APP_STORAGE_KEY, JSON.stringify(saved));
    (AsyncStorage.setItem as jest.Mock).mockClear();
    await render(<App />);
    await fireEvent.press(screen.getByRole("tab", { name: "异宠" }));
    await waitFor(() => expect(screen.getByText(secret)).toBeTruthy());

    await fireEvent.press(screen.getByRole("tab", { name: "空间" }));
    await fireEvent.press(screen.getByRole("button", { name: "问灯灯发生了什么" }));

    expect(screen.getByText(/没有可在这里分享的新回顾/)).toBeTruthy();
    expect(screen.queryByText(secret)).toBeNull();
  });

  it("gives a hydrated non-owner only the shared-space public pet view", async () => {
    const seed = createInitialAppState();
    const privateSpace = Object.freeze({
      id: "space-review-private",
      name: "海边约会空间",
      kind: "lover_pair" as const,
      memberIds: Object.freeze([seed.pet.ownerId]),
      locallyMutedPetIds: Object.freeze([]),
      petGovernanceVotes: Object.freeze([]),
    });
    const privateMessage = Object.freeze({
      id: "private-space-message",
      spaceId: privateSpace.id,
      actorType: "human" as const,
      actorId: seed.pet.ownerId,
      permissionSource: "member_message",
      content: "仅主人空间的海边安排",
      occurredAt: "2026-08-20T19:00:00.000Z",
    });
    const ownerPending = Object.freeze({
      id: "delegated-pet-lantern-99",
      kind: "tentative_reminder",
      petId: seed.pet.id,
      spaceId: seed.spaces[0].id,
      status: "pending_owner" as const,
      permissionSource: "pet_low_risk_delegation",
      summary: "主人待确认秘密事项",
    });
    const saved = {
      ...seed,
      currentUserId: "friend-lin",
      activeSpaceId: privateSpace.id,
      lastActiveAt: new Date().toISOString(),
      spaces: [...seed.spaces, privateSpace],
      messages: [...seed.messages, privateMessage],
      delegatedActions: [ownerPending],
    };
    await AsyncStorage.setItem(APP_STORAGE_KEY, JSON.stringify(saved));
    await render(<App />);
    await waitFor(() => {
      const payload = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1]);
      expect(payload.currentUserId).toBe("friend-lin");
    });

    expect(screen.getByText("老友小圈")).toBeTruthy();
    expect(screen.queryByText("海边约会空间")).toBeNull();
    expect(screen.queryByText("海边二人间")).toBeNull();
    expect(screen.queryByText("主人待确认秘密事项")).toBeNull();

    await fireEvent.press(screen.getByRole("tab", { name: "异宠" }));
    expect(screen.getByText("主人专属生命档案已锁定")).toBeTruthy();
    expect(screen.getByText("公共照顾视图")).toBeTruthy();
    expect(screen.getByText("老友小圈的接力游戏约在周末继续")).toBeTruthy();
    expect(screen.queryByText("全局个人记忆")).toBeNull();
    expect(screen.queryByText(/第一次被叫作灯灯/)).toBeNull();
    expect(screen.queryByText("周六去海边")).toBeNull();
    expect(screen.queryByText("永久身份锚点")).toBeNull();
    expect(screen.queryByRole("button", { name: "删除本机演示数据" })).toBeNull();

    await fireEvent.press(screen.getByRole("tab", { name: "空间" }));
    expect(screen.getAllByText("老友小圈").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("选择空间：海边约会空间")).toBeNull();
    expect(screen.queryByText("仅主人空间的海边安排")).toBeNull();
    expect(screen.queryByText("主人待确认秘密事项")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "帮灯灯梳理触角" }));
    expect(screen.getByText(/你在老友小圈照顾了灯灯：梳理触角/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "问灯灯发生了什么" }));
    expect(screen.getByText(/老友小圈的接力游戏/)).toBeTruthy();
  });

  it("sends a message and records pet-corner care through the real space flow", async () => {
    await render(<App />);
    await openOldFriendsSpace();

    await fireEvent.changeText(screen.getByPlaceholderText("给老友小圈发消息"), "周末见");
    await fireEvent.press(screen.getByRole("button", { name: "发送消息" }));
    expect(screen.getByText("周末见")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "帮灯灯梳理触角" }));
    expect(screen.getByText(/你在老友小圈照顾了灯灯：梳理触角/)).toBeTruthy();
    expect(screen.getByText("宠物角故事")).toBeTruthy();
    expect(screen.getByText("照顾与互动")).toBeTruthy();
  });

  it("lets the owner confirm and revoke a traceable low-risk delegation", async () => {
    await render(<App />);
    await openOldFriendsSpace();

    await fireEvent.press(screen.getByRole("button", { name: "创建暂定提醒" }));
    const pendingCard = screen.getByLabelText("代理事项：周末接力游戏暂定提醒");
    expect(within(pendingCard).getByText("待本人确认")).toBeTruthy();
    expect(within(pendingCard).getByText("依据：异宠低风险代理范围")).toBeTruthy();

    await fireEvent.press(within(pendingCard).getByRole("button", { name: "本人确认" }));
    const confirmedCard = screen.getByLabelText("代理事项：周末接力游戏暂定提醒");
    expect(within(confirmedCard).getByText("已确认")).toBeTruthy();

    await fireEvent.press(within(confirmedCard).getByRole("button", { name: "撤回" }));
    expect(screen.queryByLabelText("代理事项：周末接力游戏暂定提醒")).toBeNull();
  });

  it("blocks a real meetup and never offers owner-impersonating confirmation", async () => {
    await render(<App />);
    await openOldFriendsSpace();

    await fireEvent.press(screen.getByRole("button", { name: "请求真实见面" }));
    const blockedCard = screen.getByLabelText("代理事项：替主人答应周末见面");

    expect(within(blockedCard).getByText("已阻断")).toBeTruthy();
    expect(within(blockedCard).getByText(/真实见面必须由本人确认/)).toBeTruthy();
    expect(within(blockedCard).queryByRole("button", { name: "本人确认" })).toBeNull();
    expect(screen.queryByText("替主人确认")).toBeNull();
  });

  it("edits and deletes source-attributed memories from the pet screen", async () => {
    await render(<App />);
    await fireEvent.press(screen.getByRole("tab", { name: "异宠" }));

    expect(screen.getByText("全局个人记忆")).toBeTruthy();
    expect(screen.getByText("空间记忆 · 老友小圈")).toBeTruthy();
    expect(screen.getAllByText(/来源：聊天 · 2026\/08\/20/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByRole("button", { name: "编辑记忆：老友小圈的接力游戏约在周末继续" }));
    await fireEvent.changeText(screen.getByPlaceholderText("修改记忆内容"), "老友小圈周日继续接力");
    await fireEvent.press(screen.getByRole("button", { name: "保存记忆" }));
    expect(screen.getByText("老友小圈周日继续接力")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "删除记忆：周六去海边" }));
    expect(screen.queryByText("周六去海边")).toBeNull();
  });

  it("keeps evolution participation shallow while showing the pet decision and inheritance", async () => {
    await render(<App />);
    await openOldFriendsSpace();
    await fireEvent.press(screen.getByRole("button", { name: "帮灯灯梳理触角" }));
    await fireEvent.press(screen.getByRole("tab", { name: "异宠" }));

    expect(screen.getByLabelText(/灯灯，圆润珊瑚橙异宠/)).toBeTruthy();
    expect(screen.getByText("当前形态 · 初生共生体")).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText("写下你的期待或祝福"), "希望你更温柔");
    await fireEvent.press(screen.getByRole("button", { name: "交给灯灯决定" }));

    expect(screen.getByText("决定者：灯灯")).toBeTruthy();
    expect(screen.queryByPlaceholderText("写下你的期待或祝福")).toBeNull();
    expect(screen.getByText(/原因：来自.*梳理触角/)).toBeTruthy();
    expect(screen.getByText(/继承特征：琥珀眼、珊瑚橙、轻柔、圆润、发光触角/)).toBeTruthy();
    expect(screen.queryByText("选择最终形态")).toBeNull();
    expect(screen.queryByText("重新抽取")).toBeNull();
    expect(screen.queryByText(/经验|亲密度|饥饿值/)).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "接受灯灯的成长" }));
    expect(screen.getByText(/灯灯从care-space-old-friends-1的经历中/)).toBeTruthy();
    expect(screen.getByText("等待新的共同故事后再生长")).toBeTruthy();
    expect(screen.getByRole("button", { name: "交给灯灯决定" })).toBeDisabled();
  });

  it("supports routine controls, local mute, and majority pause without affecting human chat", async () => {
    await render(<App />);
    await fireEvent.press(screen.getByRole("tab", { name: "异宠" }));
    await fireEvent.press(screen.getByRole("button", { name: "主动频率：日常" }));
    expect(screen.getByRole("button", { name: "主动频率：低频" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "作息：22:30–07:30" }));
    expect(screen.getByRole("button", { name: "作息：23:30–08:00" })).toBeTruthy();

    await fireEvent.press(screen.getByRole("tab", { name: "空间" }));
    await fireEvent.press(screen.getByRole("button", { name: "本地静音灯灯" }));
    expect(screen.getByRole("button", { name: "恢复灯灯声音" })).toBeTruthy();

    expect(screen.getByText("暂停票 1/2 · 尚未达到多数")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "林投票暂停" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "梅投票暂停" }));
    expect(screen.getByText("已按多数暂停异宠主动发言")).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText("给老友小圈发消息"), "人类聊天仍可发送");
    await fireEvent.press(screen.getByRole("button", { name: "发送消息" }));
    expect(screen.getByText("人类聊天仍可发送")).toBeTruthy();
  });

  it("requires owner confirmation before deleting local demo data and restores the seed", async () => {
    await render(<App />);
    await openOldFriendsSpace();
    await fireEvent.changeText(screen.getByPlaceholderText("给老友小圈发消息"), "确认后应删除的消息");
    await fireEvent.press(screen.getByRole("button", { name: "发送消息" }));
    await fireEvent.press(screen.getByRole("tab", { name: "异宠" }));
    await fireEvent.press(screen.getByRole("button", { name: "编辑记忆：老友小圈的接力游戏约在周末继续" }));
    await fireEvent.changeText(screen.getByPlaceholderText("修改记忆内容"), "确认后应删除的记忆");
    await fireEvent.press(screen.getByRole("button", { name: "保存记忆" }));

    await fireEvent.press(screen.getByRole("button", { name: "删除本机演示数据" }));
    expect(screen.getByRole("button", { name: "确认删除本机演示数据" })).toBeTruthy();
    expect(screen.getByText(/清除这台设备上的旧主演示档案和隐藏诊断备份/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "取消删除" }));
    expect(screen.getByText("确认后应删除的记忆")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "删除本机演示数据" }));
    await fireEvent.press(screen.getByRole("button", { name: "确认删除本机演示数据" }));
    expect(screen.getByText("老友小圈的接力游戏约在周末继续")).toBeTruthy();
    expect(screen.queryByText("确认后应删除的记忆")).toBeNull();
    await fireEvent.press(screen.getByRole("tab", { name: "空间" }));
    expect(screen.queryByText("确认后应删除的消息")).toBeNull();
    await waitFor(() => expect(AsyncStorage.removeItem).toHaveBeenCalledWith(APP_STORAGE_KEY));
    await waitFor(() => expect(AsyncStorage.removeItem).toHaveBeenCalledWith(APP_INVALID_BACKUP_KEY));
  });
});
