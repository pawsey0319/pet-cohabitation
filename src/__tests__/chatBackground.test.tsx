jest.mock("@react-native-async-storage/async-storage",()=>require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
let mockSession={profile:{id:"owner-a"},isLocalDemo:true};
jest.mock("../auth/SessionProvider",()=>({useSession:()=>mockSession}));
const mockInvoke=jest.fn();let mockRows:(table:string,owner:string)=>Promise<{data:unknown[];error:null}>;
const mockClient={
  auth:{getSession:async()=>({data:{session:{user:{id:mockSession.profile.id},access_token:"test-only"}}})},
  functions:{invoke:(...args:unknown[])=>mockInvoke(...args)},
  from:(table:string)=>{let owner="";const q:any={select:()=>q,eq:(_:string,id:string)=>{owner=id;return q;},order:()=>q,limit:()=>q,in:()=>q,then:(a:unknown,b:unknown)=>mockRows(table,owner).then(a as never,b as never)};return q;},
};
jest.mock("../lib/supabase",()=>({requireSupabase:()=>mockClient}));
import {act,renderHook,waitFor} from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {ChatBackgroundProvider,useChatBackground} from "../backgrounds/ChatBackgroundProvider";
import {normalizeThreadKey,resolveBackground,backgroundColors} from "../backgrounds/types";
import {localDataKeys} from "../data/localData";
import {backgroundErrorCode,validateBackgroundImage} from "../../supabase/functions/_shared/chatBackgroundPrompt";

beforeEach(async()=>{await AsyncStorage.clear();mockSession={profile:{id:"owner-a"},isLocalDemo:true};mockInvoke.mockReset().mockResolvedValue({data:{editing_available:false},error:null});mockRows=async()=>({data:[],error:null});});
test("global fallback and a local group override remain independent after remount",async()=>{
 const hook=await renderHook(()=>useChatBackground(),{wrapper:ChatBackgroundProvider});await waitFor(()=>expect(hook.result.current.ready).toBe(true));
 await act(()=>hook.result.current.apply({presetId:"mist",assetId:null,palette:"sage"}));
 await act(()=>hook.result.current.apply({presetId:"sand",assetId:null,palette:"warm"},"group:local-space-123"));
 expect(hook.result.current.getBackground("companion").presetId).toBe("mist");expect(hook.result.current.getBackground("group:local-space-123").presetId).toBe("sand");
 await hook.unmount();const re=await renderHook(()=>useChatBackground(),{wrapper:ChatBackgroundProvider});await waitFor(()=>expect(re.result.current.ready).toBe(true));
 expect(re.result.current.getBackground("group:local-space-123").presetId).toBe("sand");
 await act(()=>re.result.current.resetToGlobal("group:local-space-123"));expect(re.result.current.getBackground("group:local-space-123").presetId).toBe("mist");
});
test("late server data from the previous owner cannot replace the new owner's backgrounds",async()=>{
 mockSession.isLocalDemo=false;let finish!:(result:any)=>void;const delayed=new Promise<{data:unknown[];error:null}>(resolve=>finish=resolve);
 mockRows=async(table,owner)=>table==="chat_background_settings"?(owner==="owner-a"?delayed:{data:[{thread_key:"global",preset_id:"sand",asset_id:null,palette:"warm"}],error:null}):{data:[],error:null};
 const hook=await renderHook(()=>useChatBackground(),{wrapper:ChatBackgroundProvider});await act(async()=>{});
 mockSession={profile:{id:"owner-b"},isLocalDemo:false};await hook.rerender(undefined);await waitFor(()=>expect(hook.result.current.ready).toBe(true));
 await act(async()=>finish({data:[{thread_key:"global",preset_id:"mist",palette:"sage"}],error:null}));
 expect(hook.result.current.getBackground().presetId).toBe("sand");
});
test("a lost generation response retains its request identifier when reconnecting",async()=>{
 mockSession.isLocalDemo=false;mockInvoke.mockImplementation(async(_name,{body})=>body.action==="status"?{error:new Error("network")}:{error:new Error("network")});
 const hook=await renderHook(()=>useChatBackground(),{wrapper:ChatBackgroundProvider});await waitFor(()=>expect(hook.result.current.canGenerate).toBe(true));
 await act(async()=>{await expect(hook.result.current.generate("安静的灰绿竹林")).rejects.toThrow();});
 const id=hook.result.current.generation?.request_id;expect(id).toBeTruthy();
 await act(async()=>{await expect(hook.result.current.retryConnection()).rejects.toThrow();});
 const requests=mockInvoke.mock.calls.filter(([,arg])=>arg.body.action==="generate").map(([,arg])=>arg.body);
 expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(hook.result.current.generation?.request_id).toBe(id);
});
test("export and deletion keys include only this owner's theme and background",async()=>{
 await AsyncStorage.multiSet([["pet-chat-background-v1:owner-a","{}"],["pet-chat-background-v1:owner-b","{}"],["pet-cohabitation-theme-v1:owner-a","{}"],["pet-cohabitation-theme-v1:owner-b","{}"]]);
 expect(await localDataKeys("owner-a")).toEqual(expect.arrayContaining(["pet-chat-background-v1:owner-a","pet-cohabitation-theme-v1:owner-a"]));
 expect((await localDataKeys("owner-a")).some(key=>key.endsWith("owner-b"))).toBe(false);
});
test("clearing deleted-account backgrounds cannot be undone by a later local snapshot",async()=>{
 const hook=await renderHook(()=>useChatBackground(),{wrapper:ChatBackgroundProvider});await waitFor(()=>expect(hook.result.current.ready).toBe(true));
 await act(()=>hook.result.current.apply({presetId:"mist",assetId:null,palette:"sage"}));
 await act(()=>hook.result.current.clearLocalData());
 await act(()=>hook.result.current.apply({presetId:"sand",assetId:null,palette:"warm"}));
 expect(await AsyncStorage.getItem("pet-chat-background-v1:owner-a")).toBeNull();
 expect(hook.result.current.getBackground().presetId).toBe("paper");
});
test("invalid navigation keys are harmless to rendering and disallowed for server storage",()=>{
 expect(()=>normalizeThreadKey("group:local-pair")).toThrow();expect(normalizeThreadKey("group:local-pair",true)).toBe("group:local-pair");
 expect(resolveBackground({},"group:undefined").presetId).toBe("paper");
 expect(backgroundColors({presetId:"mist",assetId:null,palette:"sage"},false).text).toBe("#202522");
});
test("invalid model data is rejected and raw upstream details cannot become public errors",()=>{
 expect(()=>validateBackgroundImage(new TextEncoder().encode("<html>not an image</html>"))).toThrow("background_invalid_image");
 expect(backgroundErrorCode(new Error("secret endpoint body image_model_http_502 token=example"))).toBe("image_model_http_502");
 expect(backgroundErrorCode(new Error("database internal details"))).toBe("background_generation_failed");
});

