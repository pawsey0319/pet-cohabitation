import AsyncStorage from "@react-native-async-storage/async-storage";
let mockOnline=false;let mockId=0;
const mockInvoke=jest.fn();const mockStorage=new Map<string,string>();
const mockChannels=new Map<string,any>();const mockRemoveChannel=jest.fn();
const mockChannel=(name:string)=>{if(mockChannels.has(name))return mockChannels.get(name);const channel:any={name,subscribed:false,handlers:new Map(),on:jest.fn((_event:string,filter:{table:string},handler:unknown)=>{if(channel.subscribed)throw new Error("cannot add postgres_changes callbacks after subscribe");channel.handlers.set(filter.table,handler);return channel;}),subscribe:jest.fn(()=>{channel.subscribed=true;return channel;})};mockChannels.set(name,channel);return channel;};
jest.mock("@react-native-async-storage/async-storage",()=>({__esModule:true,default:{getItem:jest.fn(async(key:string)=>mockStorage.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{mockStorage.set(key,value);}),removeItem:jest.fn(async(key:string)=>{mockStorage.delete(key);})}}));
jest.mock("@react-native-community/netinfo",()=>({__esModule:true,default:{fetch:async()=>({isConnected:mockOnline,isInternetReachable:mockOnline}),addEventListener:()=>()=>undefined}}));
jest.mock("../../lib/uuid",()=>({createRequestId:()=>`request-${++mockId}`}));
jest.mock("../../lib/supabase",()=>({isLocalDemoMode:false,requireSupabase:()=>({auth:{getSession:async()=>({data:{session:{access_token:"test-session"}}})},functions:{invoke:mockInvoke},channel:mockChannel,removeChannel:mockRemoveChannel})}));
jest.mock("expo-image-picker",()=>({}));
import { cachedWorkItems,clearWorkData,exportWorkRecoveryData,pendingWork,recoverWorkCache,resolveWorkConflict,startWorkSync,submitWork,syncWork,workRecoveryStorageKey,workStorageKey } from "../repository";
import { optimisticWorkItem } from "../domain";
import type { WorkItem,WorkRequest } from "../types";

const owner="account-a";
beforeEach(()=>{mockStorage.clear();mockInvoke.mockReset();mockChannels.clear();mockRemoveChannel.mockReset();mockOnline=false;mockId=0;});

test("retained tab and pushed group screen have independent realtime subscriptions",()=>{const stopTab=startWorkSync(owner,()=>{});const stopGroup=startWorkSync(owner,()=>{});expect(mockChannels.size).toBe(2);const channels=[...mockChannels.values()];stopGroup();expect(mockRemoveChannel).toHaveBeenCalledWith(channels[1]);expect(mockRemoveChannel).not.toHaveBeenCalledWith(channels[0]);stopTab();expect(mockRemoveChannel).toHaveBeenCalledWith(channels[0]);});
test("membership deletion with unreadable cache reports change without an unhandled rejection",async()=>{await AsyncStorage.setItem(workStorageKey(owner),'{"items":[null]}');const changed=jest.fn();const stop=startWorkSync(owner,changed);[...mockChannels.values()][0].handlers.get("space_members")({old:{space_id:"space"}});await new Promise(resolve=>setTimeout(resolve,0));expect(changed).toHaveBeenCalledTimes(1);stop();});

test("missing cache lists become empty and can refresh without poisoning React state",async()=>{
 await AsyncStorage.setItem(workStorageKey(owner),"{}");expect(await cachedWorkItems(owner)).toEqual([]);expect(await pendingWork(owner)).toEqual([]);
 mockOnline=true;mockInvoke.mockResolvedValue({data:{items:[],cursor:null,authorized_space_ids:["space"]}});
 expect(await syncWork(owner)).toEqual({items:[],conflicts:0,authorizedSpaceIds:["space"]});
});
test.each(["{",JSON.stringify({items:[null],pending:[]}),JSON.stringify({items:[],pending:[{local:{title:"保留未同步修改"}}]})])("unrecognized local data remains saved and never reaches rendering",async raw=>{
 await AsyncStorage.setItem(workStorageKey(owner),raw);await expect(cachedWorkItems(owner)).rejects.toThrow("原数据已保留");await expect(syncWork(owner)).rejects.toThrow("原数据已保留");expect(await AsyncStorage.getItem(workStorageKey(owner))).toBe(raw);
});
test("malformed server rows cannot replace the previous readable cache",async()=>{
 const original=JSON.stringify({items:[],pending:[]});await AsyncStorage.setItem(workStorageKey(owner),original);mockOnline=true;mockInvoke.mockResolvedValue({data:{items:[null],cursor:null,authorized_space_ids:[]}});
 await expect(syncWork(owner)).rejects.toThrow("事项数据暂时无法读取");expect(await AsyncStorage.getItem(workStorageKey(owner))).toBe(original);
});
test("explicit online recovery backs up original bytes before loading cloud data",async()=>{
 const raw=JSON.stringify({items:[null],pending:[{local:{title:"未同步原文"}}]});await AsyncStorage.setItem(workStorageKey(owner),raw);mockOnline=true;mockInvoke.mockResolvedValue({data:{items:[],cursor:null,authorized_space_ids:["space"]}});
 expect(await recoverWorkCache(owner)).toEqual({items:[],conflicts:0,authorizedSpaceIds:["space"]});expect(await exportWorkRecoveryData(owner)).toEqual([{at:expect.any(String),raw}]);expect(await exportWorkRecoveryData("other-account")).toEqual([]);expect(await cachedWorkItems(owner)).toEqual([]);
});
test("failed backup and offline recovery never replace the original cache",async()=>{
 const raw='{"items":[null]}';await AsyncStorage.setItem(workStorageKey(owner),raw);await expect(recoverWorkCache(owner)).rejects.toThrow("请联网");expect(await AsyncStorage.getItem(workStorageKey(owner))).toBe(raw);mockOnline=true;jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("disk full"));await expect(recoverWorkCache(owner)).rejects.toThrow("disk full");expect(await AsyncStorage.getItem(workStorageKey(owner))).toBe(raw);
});
test("recovery never resets a readable pending edit and logout clears its own backup",async()=>{
 await submitWork(owner,request("create"));const before=await pendingWork(owner);mockOnline=true;mockInvoke.mockRejectedValue(new Error("network failed"));await recoverWorkCache(owner);expect(await pendingWork(owner)).toEqual(before);expect(await exportWorkRecoveryData(owner)).toEqual([]);
 await AsyncStorage.setItem(workRecoveryStorageKey(owner),'[{"raw":"original"}]');await clearWorkData(owner);expect(await exportWorkRecoveryData(owner)).toEqual([]);
});
function request(action:WorkRequest["action"],overrides:Partial<WorkRequest>={}):WorkRequest{return {action,request_id:`request-${++mockId}`,input:{title:"本地事项"},...overrides};}
function serverItem(request:WorkRequest,prior?:WorkItem){const result=optimisticWorkItem(owner,request,prior);delete result.sync_state;return result;}

test("offline create/edit/complete survive persistence and synchronize in version order",async()=>{
 const creation=request("create");const created=await submitWork(owner,creation);expect(created.outcome).toBe("pending_sync");expect(created.item.id).toBe(creation.request_id);
 const edited=await submitWork(owner,request("edit",{item_id:created.item.id,expected_version:1,input:{title:"更新标题"}}));
 await submitWork(owner,request("complete",{item_id:created.item.id,expected_version:edited.item.version,input:{completion_note:"已完成"}}));
 expect((await pendingWork(owner)).length).toBe(3);expect((await cachedWorkItems(owner))[0].status).toBe("completed");
 let server:WorkItem|undefined;const versions:(number|undefined)[]=[];mockOnline=true;
 mockInvoke.mockImplementation(async(_name:string,{body}:{body:WorkRequest|{action:"list"}})=>{if(body.action==="list")return {data:{items:[server],cursor:null,authorized_space_ids:[]}};versions.push(body.expected_version);server=serverItem(body,server);return {data:{item:server,outcome:"updated"}};});
 const result=await syncWork(owner);expect(versions).toEqual([undefined,1,2]);expect(result.items[0]).toMatchObject({title:"更新标题",status:"completed",version:3});expect(result.items[0].sync_state).toBeUndefined();expect(await pendingWork(owner)).toHaveLength(0);
});

test("CAS conflicts preserve local edits and require an explicit resolution with a new request ID",async()=>{
 const base=serverItem(request("create",{item_id:"item"}));await AsyncStorage.setItem(workStorageKey(owner),JSON.stringify({items:[base],pending:[]}));
 const edit=request("edit",{item_id:"item",expected_version:1,input:{title:"本地修改"}});await submitWork(owner,edit);mockOnline=true;
 const remote={...base,title:"另一设备修改",version:5};mockInvoke.mockImplementation(async(_name:string,{body}:{body:{action:string}})=>body.action==="list"?{data:{items:[remote],cursor:null,authorized_space_ids:[]}}:{error:{name:"FunctionsHttpError",message:"work_version_conflict"}});
 expect((await syncWork(owner)).conflicts).toBe(1);const pending=await pendingWork(owner);expect(pending[0].local.title).toBe("本地修改");expect(pending[0].server?.title).toBe("另一设备修改");
 await resolveWorkConflict(owner,"item","apply_local");const retry=(await pendingWork(owner))[0];expect(retry.request.expected_version).toBe(5);expect(retry.request.request_id).not.toBe(edit.request_id);expect(retry.local.title).toBe("本地修改");
});

test("group actions cannot enter the offline queue",async()=>{
 const base={...serverItem(request("create",{item_id:"group-item"})),space_id:"space"};await AsyncStorage.setItem(workStorageKey(owner),JSON.stringify({items:[base],pending:[]}));
 await expect(submitWork(owner,request("accept",{item_id:base.id,expected_version:1,input:{}}))).rejects.toThrow("群协作需要联网确认");expect(await pendingWork(owner)).toHaveLength(0);
});

test("logout clears account cache even when a request response arrives late",async()=>{
 mockOnline=true;let finish:((value:unknown)=>void)|undefined;let started:()=>void=()=>undefined;const ready=new Promise<void>(resolve=>{started=resolve;});
 mockInvoke.mockImplementation(()=>{started();return new Promise(resolve=>{finish=resolve;});});
 const req=request("create");const pending=submitWork(owner,req);await ready;const clearing=clearWorkData(owner);finish!({data:{item:serverItem({...req,item_id:req.request_id}),outcome:"created"}});await pending;await clearing;
 expect(await AsyncStorage.getItem(workStorageKey(owner))).toBeNull();expect(await cachedWorkItems("account-b")).toEqual([]);
});
