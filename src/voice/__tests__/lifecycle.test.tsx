jest.mock("expo-router",()=>({useFocusEffect:(callback:()=>()=>void)=>require("react").useEffect(callback,[callback])}));
jest.mock("../../auth/SessionProvider",()=>({useSession:()=>({profile:{id:mockOwner}})}));
jest.mock("../../lib/uuid",()=>({createRequestId:()=>`request-${++mockId}`}));
jest.mock("../native",()=>({getVoiceModule:()=>mockNative,voiceError:(code?:string)=>code??"unavailable"}));
import { act, render, waitFor } from "@testing-library/react-native";
import { PermissionsAndroid, Platform } from "react-native";
import { useSystemVoice } from "../useSystemVoice";
import type { VoiceEvent } from "../native";
let mockOwner="owner-a",mockId=0;const mockListeners=new Map<string,(event:VoiceEvent)=>void>();
const mockNative={capabilities:jest.fn(async()=>({recognition:true,onDevice:true,speech:true})),startRecognition:jest.fn(async(_id:string,_language:string)=>{}),finishRecognition:jest.fn(async()=>{}),speak:jest.fn(async()=>{}),stop:jest.fn(async()=>{}),addListener:jest.fn((name:string,callback:(event:VoiceEvent)=>void)=>{mockListeners.set(name,callback);return{remove:()=>mockListeners.delete(name)};})};
let voice:ReturnType<typeof useSystemVoice>;const transcript=jest.fn();
function Probe(){voice=useSystemVoice({scopeKey:"companion",onTranscript:transcript});return null;}
beforeEach(()=>{mockOwner="owner-a";mockId=0;mockListeners.clear();jest.clearAllMocks();Object.defineProperty(Platform,"OS",{value:"android",configurable:true});jest.spyOn(PermissionsAndroid,"request").mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);});
test("only final recognition reaches editable draft, never a send action",async()=>{
 const view=await render(<Probe/>);await waitFor(()=>expect(voice.capabilities?.recognition).toBe(true));
 await act(async()=>{await voice.listen();});const id=mockNative.startRecognition.mock.calls[0][0];
 await act(async()=>{mockListeners.get("onTranscript")?.({sessionId:id,text:"临时识别",final:false});});expect(transcript).not.toHaveBeenCalled();
 await act(async()=>{mockListeners.get("onTranscript")?.({sessionId:id,text:"确认前可编辑",final:true});mockListeners.get("onTranscript")?.({sessionId:id,text:"重复最终回调",final:true});});expect(transcript).toHaveBeenCalledWith("确认前可编辑");expect(transcript).toHaveBeenCalledTimes(1);expect(voice.status).toBe("idle");await view.unmount();
});
test("cancel and account switch exclude late callbacks and stop native audio",async()=>{
 const view=await render(<Probe/>);await waitFor(()=>expect(voice.capabilities?.recognition).toBe(true));
 await act(async()=>{await voice.listen();});const id=mockNative.startRecognition.mock.calls[0][0];const oldListener=mockListeners.get("onTranscript")!;
 await act(async()=>{await voice.stop();oldListener({sessionId:id,text:"已取消内容",final:true});});expect(transcript).not.toHaveBeenCalled();
 mockOwner="owner-b";await view.rerender(<Probe/>);await act(async()=>{oldListener({sessionId:id,text:"旧账号内容",final:true});});expect(transcript).not.toHaveBeenCalled();expect(mockNative.stop).toHaveBeenCalledWith("owner-a:companion:");await view.unmount();
});
