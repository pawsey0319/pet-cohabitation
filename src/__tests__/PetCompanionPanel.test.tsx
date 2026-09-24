jest.mock("../theme/ThemeProvider", () => ({useAppTheme: () => ({theme: {card:"#16142D",primary:"#AA6655",secondary:"#444444",danger:"#FF0000",line:"#333333",radius:12,controlHeight:48}})}));
jest.mock("@react-native-async-storage/async-storage",()=>require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@react-native-community/netinfo", () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }));
jest.mock("../voice/useSystemVoice", () => ({ useSystemVoice: ({ onTranscript }: { onTranscript(text: string): void }) => ({ capabilities: {recognition:true,speech:true,onDevice:true}, supported: true, status: "idle", partial: "", error: null, listen: () => onTranscript("语音识别结果"), finish: jest.fn(), speak: jest.fn(), stop: jest.fn(), speakingMessageId: null }) }));
jest.mock("../vision/repository",()=>({prepareVisionAttachment:jest.fn(),readVisionImage:jest.fn(),visionRequest:jest.fn()}));
jest.mock("../vision/VisionMessageImage",()=>({VisionMessageImage:()=>null}));
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PetCompanionPanel } from "../components/PetCompanionPanel";
import { loadPrivateDraft, savePrivateDraft } from "../pets/privateDraft";
import { clearPrivateSendQueue, privateSendQueue } from "../pets/privateSendQueue";
import { prepareVisionAttachment } from "../vision/repository";
import { Text } from "react-native";
import { PetSectionScope } from "../pets/PetSectionScope";
beforeEach(async () => { await clearPrivateSendQueue("local-preview"); });

function props() { return { petName: "芽芽", incubating: false, messages: [{ id: "owner1", role: "owner" as const, content: "我想准备面试", createdAt: "2026-09-06T08:00:00Z" }], context: { memories: [], contextStartedAt: null }, enteredAt: Date.parse("2026-09-07T08:00:00Z"), busy: false, onSend: jest.fn().mockResolvedValue(undefined), onSaveMemory: jest.fn().mockResolvedValue(undefined), onRemoveMemory: jest.fn().mockResolvedValue(undefined), onNewConversation: jest.fn().mockResolvedValue(undefined) }; }

test("independent settings route preserves the current editable draft and does not open a duplicate memory hub", async () => {
  const settings = jest.fn(), memories = jest.fn();
  await render(<PetCompanionPanel {...props()} onSettings={settings} onManageMemory={memories} />);
  await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"), "我还没发完的话");
  await fireEvent.press(screen.getByLabelText("相处设置"));
  expect(settings).toHaveBeenCalledTimes(1); expect(memories).not.toHaveBeenCalled();
  expect(screen.queryByText("它记住的你")).toBeNull(); expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("我还没发完的话");
});

test("companion never renders a pet portrait or empty-state stage, and keeps the composer", async () => {
 const callbacks=props();
 const view=await render(<PetCompanionPanel {...callbacks} messages={[]} portrait={() => <Text>原图本体</Text>} onDesktopPet={jest.fn()} />);
 expect(screen.queryByText("原图本体")).toBeNull();
 expect(screen.queryByTestId("pet-position-stage")).toBeNull();
 expect(screen.queryByLabelText("桌面异宠设置")).toBeNull();
 await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"), "草稿保留");
 expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("草稿保留");
 await view.unmount();
});

test("a reply continues while its panel is hidden and keeps the next draft when restored",async()=>{
 const owner="hidden-reply-continuity",callbacks=props();
 let emit!:(event:any)=>void,finish!:()=>void;
 callbacks.onSend.mockImplementation((_text,_id,onEvent)=>{emit=onEvent;return new Promise<void>(resolve=>{finish=resolve;});});
 const panel=(visible:boolean)=><PetSectionScope.Provider value={{visible,section:"companion",navigate:jest.fn()}}><PetCompanionPanel {...callbacks} ownerId={owner}/></PetSectionScope.Provider>;
 const view=await render(panel(true));
 await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));
 await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"请继续讲这个故事");
 await fireEvent.press(screen.getByLabelText("发送私聊"));
 await waitFor(()=>expect(callbacks.onSend).toHaveBeenCalledTimes(1));
 await act(()=>emit({type:"text",content:"故事的开头"}));
 await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"下一条还没有发送的草稿");
 await view.rerender(panel(false));
 await act(()=>emit({type:"text",content:"故事的开头，切页期间仍然继续"}));
 await view.rerender(panel(true));
 expect(screen.getByText("故事的开头，切页期间仍然继续")).toBeTruthy();
 expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("下一条还没有发送的草稿");
 await act(()=>finish());
 expect(callbacks.onSend).toHaveBeenCalledTimes(1);
 expect((await loadPrivateDraft(owner))?.content).toBe("下一条还没有发送的草稿");
 await view.unmount();await clearPrivateSendQueue(owner);
});

test("failed image upload keeps draft and retries its exact request and image",async()=>{
 const owner="vision-upload-retry",attachment={uploadId:"11111111-1111-4111-8111-111111111111",uri:"file:///stable.jpg"};await clearPrivateSendQueue(owner);await savePrivateDraft(owner,{id:"image-request",content:"看看这张图片",attachment});
 jest.mocked(prepareVisionAttachment).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({...attachment,asset:{id:attachment.uploadId,version:1,state:"active"}});
 const callbacks=props(),view=await render(<PetCompanionPanel {...callbacks} ownerId={owner}/>);await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("看看这张图片"));
 await fireEvent.press(screen.getByLabelText("发送私聊"));await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("看看这张图片"));
 expect(callbacks.onSend).not.toHaveBeenCalled();expect((await loadPrivateDraft(owner))?.attachment?.uploadId).toBe(attachment.uploadId);
 await fireEvent.press(screen.getByLabelText("发送私聊"));await waitFor(()=>expect(callbacks.onSend).toHaveBeenCalledTimes(1));
 expect(callbacks.onSend.mock.calls[0][1]).toBe("image-request");expect(callbacks.onSend.mock.calls[0][3]).toMatchObject({imageAssetId:attachment.uploadId,imageAssetVersion:1});await view.unmount();await clearPrivateSendQueue(owner);
});

test("stopping an upload cannot send a late image or discard newly typed text",async()=>{
 const owner="vision-stop-upload",attachment={uploadId:"22222222-2222-4222-8222-222222222222",uri:"file:///stable.jpg"};await clearPrivateSendQueue(owner);await savePrivateDraft(owner,{id:"image-stop",content:"看图",attachment});
 let release!:(value:any)=>void;const held=new Promise<any>(resolve=>{release=resolve;});jest.mocked(prepareVisionAttachment).mockImplementationOnce(()=>held);
 const callbacks=props(),onStop=jest.fn().mockResolvedValue(undefined),view=await render(<PetCompanionPanel {...callbacks} ownerId={owner} onStop={onStop}/>);await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("看图"));
 await fireEvent.press(screen.getByLabelText("发送私聊"));await waitFor(()=>expect(screen.getByText("正在上传图片")).toBeTruthy());await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"下一条新文字");await fireEvent.press(screen.getByLabelText("停止当前回答"));
 await act(async()=>{release({...attachment,asset:{id:attachment.uploadId,version:1,state:"active"}});});expect(callbacks.onSend).not.toHaveBeenCalled();expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("下一条新文字");await view.unmount();await clearPrivateSendQueue(owner);
});

test("voice transcript appends to the editable draft and never sends by itself", async () => {
  const callbacks = props(); await render(<PetCompanionPanel {...callbacks} />);
  await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"), "已有草稿");
  expect(screen.queryByText(/系统识别服务可能联网/)).toBeNull();
  await fireEvent.press(screen.getByText("语音输入"));
  expect(screen.getByText(/系统识别服务可能联网/)).toBeTruthy();
  expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("已有草稿");
  await fireEvent.press(screen.getByText("开始识别"));
  expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("已有草稿\n语音识别结果");
  expect(callbacks.onSend).not.toHaveBeenCalled();
});

test("image messages never use the ordinary save-this-message shortcut or action card",async()=>{
 const callbacks=props(),renderActions=jest.fn();await render(<PetCompanionPanel {...callbacks} renderActions={renderActions} messages={[{...callbacks.messages[0],imageAssetId:"22222222-2222-4222-8222-222222222222",imageAssetVersion:1}]}/>);
 expect(screen.queryByLabelText("记住这句：我想准备面试")).toBeNull();expect(renderActions).not.toHaveBeenCalled();
});

test("a confirmed new topic clears the image draft as well as its text",async()=>{
 const owner="vision-new-topic",attachment={uploadId:"33333333-3333-4333-8333-333333333333",uri:"file:///draft.jpg"};await clearPrivateSendQueue(owner);await savePrivateDraft(owner,{id:"old-topic-image",content:"旧话题图片",attachment});const callbacks=props(),view=await render(<PetCompanionPanel {...callbacks} ownerId={owner}/>);
 await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("旧话题图片"));await fireEvent.press(screen.getByText("开启新话题"));await fireEvent.press(screen.getByText("开始新话题"));await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.value).toBe(""));expect(await loadPrivateDraft(owner)).toBeNull();
 await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"新话题文字");expect((await loadPrivateDraft(owner))?.attachment).toBeUndefined();await view.unmount();await clearPrivateSendQueue(owner);
});

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
  await waitFor(() => expect(screen.getAllByText("记忆已更新，请重新发送").length).toBeGreaterThan(0));
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
  await waitFor(()=>expect(screen.getAllByText("暂时没有回复").length).toBeGreaterThan(0));
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

test("legacy history stays readable without becoming a reunion or a memory source",async()=>{
  const callbacks=props();
  const messages=[{...callbacks.messages[0],conversationKind:"legacy" as const}];
  await render(<PetCompanionPanel {...callbacks} messages={messages}/>);
  expect(screen.queryByText("欢迎回来，慢慢接着聊")).toBeNull();
  expect(screen.queryByText("我想准备面试")).toBeNull();
  await fireEvent.press(screen.getByText("查看之前的聊天记录"));
  expect(screen.getByText("我想准备面试")).toBeTruthy();
  expect(screen.queryByLabelText("记住这句：我想准备面试")).toBeNull();
});

test("an unsent draft survives leaving the page and quick edits do not overwrite the latest text",async()=>{
  const callbacks=props();
  const first=await render(<PetCompanionPanel {...callbacks} ownerId="unsent-draft"/>);
  await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));
  await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"准备面试");
  await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"准备面试\n想先梳理自我介绍");
  await first.unmount();
  await render(<PetCompanionPanel {...callbacks} ownerId="unsent-draft"/>);
  await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("准备面试\n想先梳理自我介绍"));
  expect(callbacks.onSend).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"");
  expect(await loadPrivateDraft("unsent-draft")).toBeNull();
});

test("sending clears the composer before the reply and ignores late keyboard text changes",async()=>{
  const callbacks=props();
  let finish!:()=>void;
  callbacks.onSend.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  await render(<PetCompanionPanel {...callbacks} ownerId="clear-on-submit"/>);
  await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));
  await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"这句话已经发送");
  await fireEvent.press(screen.getByLabelText("发送私聊"));
  await waitFor(()=>expect(callbacks.onSend).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("");
  expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true);
  await act(()=>screen.getByLabelText("异宠私聊输入").props.onChangeText("这句话已经发送"));
  expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("");
  expect(privateSendQueue("clear-on-submit").snapshot()[0].id).toBe(callbacks.onSend.mock.calls[0][1]);
  await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"), "回答期间继续输入的新草稿");
  await act(()=>finish());
  await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));
  expect((await loadPrivateDraft("clear-on-submit"))?.content).toBe("回答期间继续输入的新草稿");
  expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("回答期间继续输入的新草稿");
});

test("a draft already delivered on the server is not restored after reopening",async()=>{
  await savePrivateDraft("delivered-draft",{id:"delivered-request",content:"已经回答过的问题"});
  const callbacks=props();
  await render(<PetCompanionPanel {...callbacks} ownerId="delivered-draft" messages={[{
    id:"sent-owner",role:"owner",content:"已经回答过的问题",createdAt:new Date().toISOString(),
    conversationKind:"companion",requestKey:"delivered-request",replyStatus:"succeeded",
  }]}/>);
  await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));
  expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("");
  expect(await loadPrivateDraft("delivered-draft")).toBeNull();
  expect(callbacks.onSend).not.toHaveBeenCalled();
});

test("a late reply clears its failed queue and old error while preserving a newer draft",async()=>{
 const owner="late-authoritative-reply",callbacks=props();callbacks.onSend.mockRejectedValueOnce(new Error("连接中断，等待核对"));
 const view=await render(<PetCompanionPanel {...callbacks} ownerId={owner}/>);await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));
 await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"第一条问题");await fireEvent.press(screen.getByLabelText("发送私聊"));await waitFor(()=>expect(screen.getAllByText("连接中断，等待核对").length).toBeGreaterThan(0));
 const requestId=callbacks.onSend.mock.calls[0][1];await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"不能被晚到回答清除的新草稿");
 await view.rerender(<PetCompanionPanel {...callbacks} ownerId={owner} messages={[...callbacks.messages,{id:"late-source",role:"owner",content:"第一条问题",createdAt:new Date().toISOString(),conversationKind:"companion",requestKey:requestId,replyStatus:"succeeded"}]}/>);
 await waitFor(()=>expect(privateSendQueue(owner).snapshot()).toEqual([]));expect(screen.queryByText("连接中断，等待核对")).toBeNull();expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("不能被晚到回答清除的新草稿");expect((await loadPrivateDraft(owner))?.content).toBe("不能被晚到回答清除的新草稿");expect(callbacks.onSend).toHaveBeenCalledTimes(1);await view.unmount();await clearPrivateSendQueue(owner);
});

test("a late success releases the next queued question with no duplicate first send",async()=>{
 const owner="late-unblocks-next",callbacks=props();callbacks.onSend.mockRejectedValueOnce(new Error("首条暂时中断"));
 const view=await render(<PetCompanionPanel {...callbacks} ownerId={owner}/>);await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));
 await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"第一条问题");await fireEvent.press(screen.getByLabelText("发送私聊"));await waitFor(()=>expect(screen.getAllByText("首条暂时中断").length).toBeGreaterThan(0));const firstId=callbacks.onSend.mock.calls[0][1];
 await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"第二条问题");await fireEvent.press(screen.getByLabelText("发送私聊"));await waitFor(()=>expect(privateSendQueue(owner).snapshot()).toHaveLength(2));expect(callbacks.onSend).toHaveBeenCalledTimes(1);const nextId=privateSendQueue(owner).snapshot()[1].id;
 await view.rerender(<PetCompanionPanel {...callbacks} ownerId={owner} messages={[...callbacks.messages,{id:"first-source",role:"owner",content:"第一条问题",createdAt:new Date().toISOString(),conversationKind:"companion",requestKey:firstId,replyStatus:"succeeded"}]}/>);
 await waitFor(()=>expect(privateSendQueue(owner).snapshot()).toEqual([]));expect(callbacks.onSend.mock.calls.map(call=>call[1])).toEqual([firstId,nextId]);await view.unmount();await clearPrivateSendQueue(owner);
});

test("server confirmation phase is visible and a locally stopped response cannot restore its draft",async()=>{
 const owner="confirmation-stop",callbacks=props();let fail!:(error:Error)=>void;callbacks.onSend.mockImplementation((_text,_id,onEvent)=>{onEvent({type:"phase",phase:"confirming"});return new Promise((_resolve,reject)=>{fail=reject;});});
 const view=await render(<PetCompanionPanel {...callbacks} ownerId={owner} onStop={jest.fn().mockResolvedValue(undefined)}/>);await waitFor(()=>expect(screen.getByLabelText("异宠私聊输入").props.editable).toBe(true));await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"问题");await fireEvent.press(screen.getByLabelText("发送私聊"));await waitFor(()=>expect(screen.getByText("连接中断，正在核对服务器回答…")).toBeTruthy());await fireEvent.changeText(screen.getByLabelText("异宠私聊输入"),"下一条草稿");await fireEvent.press(screen.getByLabelText("停止当前回答"));await act(()=>fail(new Error("已停止")));expect(screen.getByLabelText("异宠私聊输入").props.value).toBe("下一条草稿");expect(screen.queryByText("已停止")).toBeNull();await view.unmount();await clearPrivateSendQueue(owner);
});
// Background generation is verified independently; these tests exercise chat continuity.
jest.mock("../backgrounds/ChatBackgroundEditor",()=>({ChatBackgroundEditor:()=>null}));
jest.mock("../backgrounds/ChatBackgroundSurface",()=>({
  ChatBackgroundSurface:require("react-native").View,
  useChatBackgroundColors:()=>({userBubble:"#F0D9C9",userText:"#462F22",bubble:"#FFFFFF",text:"#202522"}),
}));
