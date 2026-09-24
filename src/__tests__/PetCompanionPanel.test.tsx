jest.mock("@react-native-async-storage/async-storage",()=>require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PetCompanionPanel } from "../components/PetCompanionPanel";
import { loadPrivateDraft, savePrivateDraft } from "../pets/privateDraft";

function props() { return { petName: "芽芽", incubating: false, messages: [{ id: "owner1", role: "owner" as const, content: "我想准备面试", createdAt: "2026-09-06T08:00:00Z" }], context: { memories: [], contextStartedAt: null }, enteredAt: Date.parse("2026-09-07T08:00:00Z"), busy: false, onSend: jest.fn().mockResolvedValue(undefined), onSaveMemory: jest.fn().mockResolvedValue(undefined), onRemoveMemory: jest.fn().mockResolvedValue(undefined), onNewConversation: jest.fn().mockResolvedValue(undefined) }; }

test("opening a reunion does not generate a message; continuation only fills an editable draft", async () => {
  const callbacks = props(); await render(<PetCompanionPanel {...callbacks} />);
  expect(screen.getByText("欢迎回来，慢慢接着聊")).toBeTruthy();
  expect(callbacks.onSend).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("接着聊这件事"));
  expect(screen.getByLabelText("异宠私聊输入").props.value).toContain("我想准备面试");
  expect(callbacks.onSend).not.toHaveBeenCalled();
});

test("pinning requires explicit confirmation and lets the owner rewrite the selected message", async () => {
  const callbacks = props(); await render(<PetCompanionPanel {...callbacks} />);
  await fireEvent.press(screen.getByLabelText("记住这句：我想准备面试"));
  expect(callbacks.onSaveMemory).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("个人记忆内容"), "我在准备设计岗位面试");
  await fireEvent.press(screen.getByText("保存记忆"));
  await waitFor(() => expect(callbacks.onSaveMemory).toHaveBeenCalledWith({ content: "我在准备设计岗位面试", sourceMessageId: "owner1" }));
});

test("failed sends preserve the draft and display the actionable error", async () => {
  const callbacks = props(); callbacks.onSend.mockRejectedValue(new Error("记忆已更新，请重新发送"));
  await render(<PetCompanionPanel {...callbacks} />);
  await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"), "这是一条不能丢的草稿");
  await fireEvent.press(screen.getByLabelText("发送私聊"));
  await waitFor(() => expect(screen.getByText("记忆已更新，请重新发送")).toBeTruthy());
  expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("这是一条不能丢的草稿");
});

test("starting a new topic requires confirmation and leaves saved-memory policy visible", async () => {
  const callbacks = props(); await render(<PetCompanionPanel {...callbacks} />);
  await fireEvent.press(screen.getByText("开启新话题"));
  expect(callbacks.onNewConversation).not.toHaveBeenCalled();
  expect(screen.getByText(/你主动保存的记忆会保留/)).toBeTruthy();
  await fireEvent.press(screen.getByText("开始新话题"));
  await waitFor(() => expect(callbacks.onNewConversation).toHaveBeenCalledTimes(1));
});

test("failed requests survive remount with the same ID and clear after successful retry",async()=>{
  const callbacks=props();callbacks.onSend.mockRejectedValueOnce(new Error("暂时没有回复"));
  const first=await render(<PetCompanionPanel {...callbacks} ownerId="draft-test"/>);
  await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));
  await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"继续面试的话题");
  await fireEvent.press(screen.getByLabelText("发送私聊"));
  await waitFor(()=>expect(screen.getByText("暂时没有回复")).toBeTruthy());
  const requestId=callbacks.onSend.mock.calls[0][1];
  expect((await loadPrivateDraft("draft-test"))?.id).toBe(requestId);
  await first.unmount();
  await render(<PetCompanionPanel {...callbacks} ownerId="draft-test"/>);
  await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("继续面试的话题"));
  await fireEvent.press(screen.getByLabelText("发送私聊"));
  await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.value).toBe(""));
  expect(callbacks.onSend.mock.calls[1][1]).toBe(requestId);
  expect(await loadPrivateDraft("draft-test")).toBeNull();
});

test("another owner's draft is not restored",async()=>{
  await savePrivateDraft("first-owner",{content:"private draft",id:"private-id"});
  await render(<PetCompanionPanel {...props()} ownerId="second-owner"/>);
  await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));
  expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("");
});
