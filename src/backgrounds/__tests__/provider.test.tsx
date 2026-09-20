jest.mock("@react-native-async-storage/async-storage",()=>require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-image-manipulator",()=>({manipulateAsync:jest.fn(),SaveFormat:{JPEG:"jpeg"}}));
jest.mock("../../auth/SessionProvider",()=>({useSession:()=>mockSession}));
jest.mock("../../lib/supabase",()=>({requireSupabase:()=>mockClient}));
jest.mock("../../chat/mediaFile",()=>({readMediaForUpload:jest.fn()}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, waitFor } from "@testing-library/react-native";
import { ChatBackgroundProvider,useChatBackground } from "../ChatBackgroundProvider";

const A="00000000-0000-4000-8000-000000000001",B="00000000-0000-4000-8000-000000000002";
let mockSession={profile:{id:A},isLocalDemo:false};
let mockRows:Record<string,Record<string,unknown>[]>={};
let mockSaveError:unknown=null;
let latest:ReturnType<typeof useChatBackground>;
let mockHeldSettings:{promise:Promise<unknown>;owner:string}|null=null;
let mockHeldSave:Promise<unknown>|null=null;
const mockInvoke=jest.fn();
const mockSignedUrl=jest.fn();
let mockMutationListener:((payload:any)=>void)|null=null;
let mockSystemListener:((payload:any)=>void)|null=null;
let mockSubscriptionListener:((status:string)=>void)|null=null;
const mockRemoveChannel=jest.fn();
const mockChannel=jest.fn(()=>{const channel={on:(kind:string,_filter:unknown,listener:(payload:any)=>void)=>{if(kind==="system")mockSystemListener=listener;else mockMutationListener=listener;return channel;},subscribe:(listener:(status:string)=>void)=>{mockSubscriptionListener=listener;return channel;}};return channel;});
const mockFrom=jest.fn((table:string)=>{
  const filters:Record<string,unknown>={};let writing=false;let deleted=false;let values:Record<string,unknown>|null=null;let maximum:number|undefined;let ids:string[]|undefined;
  const query:{[key:string]:any}={
    select:()=>query,eq:(name:string,value:unknown)=>{filters[name]=value;return query;},order:()=>query,limit:(count:number)=>{maximum=count;return query;},in:(_name:string,value:string[])=>{ids=value;return query;},
    upsert:(value:Record<string,unknown>)=>{writing=true;values=value;return query;},delete:()=>{writing=true;deleted=true;return query;},
    then:(resolve:(value:unknown)=>void,reject:(error:unknown)=>void)=>{
      if(!writing&&table==="chat_background_settings"&&mockHeldSettings&&mockHeldSettings.owner===filters.owner_id)return mockHeldSettings.promise.then(resolve,reject);
      if(writing){if(!mockSaveError){const rows=mockRows[table]??[];mockRows[table]=rows.filter(row=>!(row.owner_id===(values?.owner_id??filters.owner_id)&&row.thread_key===(values?.thread_key??filters.thread_key)));if(!deleted&&values)mockRows[table].push(values);}return(mockHeldSave??Promise.resolve({data:null,error:mockSaveError})).then(resolve,reject);}
      const rows=(mockRows[table]??[]).filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value)&&(!ids||ids.includes(row.id as string)));return Promise.resolve({data:maximum?rows.slice(0,maximum):rows,error:null}).then(resolve,reject);
    },
  };return query;
});
const mockClient={from:mockFrom,channel:mockChannel,removeChannel:mockRemoveChannel,storage:{from:()=>({createSignedUrl:mockSignedUrl})},functions:{invoke:mockInvoke},auth:{getSession:jest.fn(async()=>({data:{session:{user:{id:mockSession.profile.id},access_token:`token-${mockSession.profile.id}`}},error:null}))}};
function Probe(){latest=useChatBackground();return null;}
const tree=()=> <ChatBackgroundProvider><Probe/></ChatBackgroundProvider>;

beforeEach(async()=>{
  await AsyncStorage.clear();jest.clearAllMocks();mockRows={};mockSaveError=null;mockHeldSettings=null;mockHeldSave=null;mockMutationListener=null;mockSystemListener=null;mockSubscriptionListener=null;mockSession={profile:{id:A},isLocalDemo:false};
  mockInvoke.mockImplementation(async(_name,{body})=>body.action==="status"?{data:{job:{request_id:body.request_id,prompt:"安静竹林",status:"queued",asset_id:null,error_code:null,created_at:new Date().toISOString()}},error:null}:{data:null,error:{context:{status:0,json:async()=>({})}}});
});

test("network retry reuses the same request ID and owner token",async()=>{
  const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
  await act(async()=>{await latest.generate("安静竹林").catch(()=>undefined);});
  const first=mockInvoke.mock.calls.find(([,options])=>options.body.action==="generate")!;
  await act(async()=>{await latest.retryConnection().catch(()=>undefined);});
  const attempts=mockInvoke.mock.calls.filter(([,options])=>options.body.action==="generate");
  expect(attempts).toHaveLength(2);expect(attempts[1][1].body.request_id).toBe(first[1].body.request_id);
  expect(attempts[1][1].headers.Authorization).toBe(`Bearer token-${A}`);
  expect(latest.generation?.status).toBe("queued");await view.unmount();
});

test("a definitive generation rejection leaves a retryable UI instead of a stuck queue",async()=>{
  mockInvoke.mockImplementation(async(_name,{body})=>body.action==="generate"?{data:null,error:{context:{status:409,json:async()=>({error:"background_daily_limit"})}}}:{data:{job:{request_id:body.request_id,status:"queued"}},error:null});
  const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
  await act(async()=>{await latest.generate("安静竹林").catch(()=>undefined);});
  await waitFor(()=>expect(latest.generation?.status).toBe("failed"));expect(latest.error).toContain("次数");await view.unmount();
});

test("an old account's delayed hydration never appears in the next account",async()=>{
  let release!:(result:unknown)=>void;mockHeldSettings={owner:A,promise:new Promise(resolve=>{release=resolve;})};
  const view=await render(tree());await waitFor(()=>expect(mockFrom).toHaveBeenCalledWith("chat_background_settings"));
  mockSession={profile:{id:B},isLocalDemo:false};await view.rerender(tree());await waitFor(()=>expect(latest.ready).toBe(true));
  await act(async()=>{release({data:[{owner_id:A,thread_key:"global",preset_id:"mist",asset_id:null,palette:"sage"}],error:null});});
  expect(latest.getBackground().presetId).toBe("paper");
  const saved=await AsyncStorage.getItem(`pet-chat-background-v1:${B}`);expect(saved??"").not.toContain('"mist"');await view.unmount();
});

test("applying a generated asset retries the saved candidate without generating again",async()=>{
  const assetId="10000000-0000-4000-8000-000000000001";
  mockRows.chat_background_assets=[{owner_id:A,id:assetId,source:"ai",prompt:"安静竹林",storage_path:`${A}/${assetId}.png`,created_at:new Date().toISOString()}];
  const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
  const selected={presetId:null,assetId,palette:"sage" as const};mockSaveError=new Error("network");
  await act(async()=>{await expect(latest.apply(selected,"companion")).rejects.toThrow("保存未完成");});
  expect(latest.getBackground("companion").assetId).toBeNull();expect(latest.assets).toHaveLength(1);
  mockSaveError=null;await act(async()=>{await latest.apply(selected,"companion");});
  expect(latest.getBackground("companion").assetId).toBe(assetId);expect(mockInvoke.mock.calls.filter(([,options])=>options.body.action==="generate")).toHaveLength(0);await view.unmount();
});

test("new local groups save their own background and recover it after reopening",async()=>{
  mockSession={profile:{id:A},isLocalDemo:true};const key="group:local-space-1789047311222";
  const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
  await act(async()=>{await latest.apply({presetId:"mist",assetId:null,palette:"sage"},key);});
  expect(latest.getBackground(key).presetId).toBe("mist");expect(latest.getBackground("companion").presetId).toBe("paper");await view.unmount();
  const reopened=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));expect(latest.getBackground(key).presetId).toBe("mist");expect(mockFrom).not.toHaveBeenCalled();await reopened.unmount();
});

test("a confirmed deletion restores inheritance without waiting for another network response",async()=>{
  const assetId="10000000-0000-4000-8000-000000000001";
  mockRows.chat_background_assets=[{owner_id:A,id:assetId,source:"upload",prompt:null,storage_path:`${A}/${assetId}.png`,created_at:new Date().toISOString()}];
  mockRows.chat_background_settings=[{owner_id:A,thread_key:"global",preset_id:"mist",asset_id:null,palette:"sage"},{owner_id:A,thread_key:"companion",preset_id:null,asset_id:assetId,palette:"warm"}];
  const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));expect(latest.getBackground("companion").assetId).toBe(assetId);
  await act(async()=>{latest.acceptDeletedAsset(assetId);});
  expect(latest.getBackground("companion").presetId).toBe("mist");expect(latest.assets).toHaveLength(0);expect(latest.hasOverride("companion")).toBe(false);await view.unmount();
});

test("editing retries retain the exact original asset and content version",async()=>{
  const parent={id:"10000000-0000-4000-8000-000000000001",source:"upload" as const,prompt:null,storage_path:"unused",created_at:new Date().toISOString(),content_version:2};
  mockInvoke.mockImplementation(async(_name,{body})=>body.action==="capabilities"?{data:{editing_available:true},error:null}:body.action==="status"?{data:{job:{request_id:body.request_id,prompt:"把背景变浅蓝",status:"queued",asset_id:null,error_code:null,created_at:new Date().toISOString(),parent_asset_id:parent.id,parent_asset_version:2}},error:null}:{data:null,error:{context:{status:0,json:async()=>({})}}});
  const view=await render(tree());await waitFor(()=>expect(latest.ready&&latest.canEdit).toBe(true));
  await act(async()=>{await latest.generate("把背景变浅蓝",parent).catch(()=>undefined);});await act(async()=>{await latest.retryConnection().catch(()=>undefined);});
  const attempts=mockInvoke.mock.calls.filter(([,options])=>options.body.action==="generate");expect(attempts).toHaveLength(2);
  expect(attempts[1][1].body).toEqual(attempts[0][1].body);expect(attempts[1][1].body.parent_asset_version).toBe(2);expect(attempts[1][1].body.parent_asset_id).toBe(parent.id);await view.unmount();
});

test("a refresh started before deletion cannot resurrect the deleted background",async()=>{
 const assetId="10000000-0000-4000-8000-000000000009";
 mockRows.chat_background_assets=[{owner_id:A,id:assetId,source:"upload",prompt:null,storage_path:`${A}/${assetId}.jpg`,created_at:new Date().toISOString()}];
 const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
 let release!:(value:unknown)=>void;mockHeldSettings={owner:A,promise:new Promise(resolve=>{release=resolve;})};let refresh!:Promise<void>;
 await act(async()=>{refresh=latest.refresh();});
 await act(async()=>{latest.acceptDeletedAsset(assetId);});expect(latest.assets).toHaveLength(0);
 await act(async()=>{release({data:[],error:null});await refresh;});expect(latest.assets).toHaveLength(0);await view.unmount();
});

test("a signed URL started before deletion cannot revive a deleted image cache",async()=>{
 const assetId="10000000-0000-4000-8000-000000000010";
 mockRows.chat_background_assets=[{owner_id:A,id:assetId,source:"upload",prompt:null,storage_path:`${A}/${assetId}.jpg`,created_at:new Date().toISOString()}];
 const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
 let release!:(value:unknown)=>void;mockSignedUrl.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const pending=latest.getAssetUrl(assetId);await waitFor(()=>expect(mockSignedUrl).toHaveBeenCalledTimes(1));await act(async()=>{latest.acceptDeletedAsset(assetId);});
 release({data:{signedUrl:"https://example.invalid/already-deleted"},error:null});await expect(pending).resolves.toBeNull();await expect(latest.getAssetUrl(assetId)).resolves.toBeNull();expect(mockSignedUrl).toHaveBeenCalledTimes(1);await view.unmount();
});

test("authoritative refresh after deletion on another device invalidates a pending URL",async()=>{
 const assetId="10000000-0000-4000-8000-000000000011";
 mockRows.chat_background_assets=[{owner_id:A,id:assetId,source:"upload",storage_path:`${A}/${assetId}.jpg`,created_at:new Date().toISOString()}];const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
 let release!:(value:unknown)=>void;mockSignedUrl.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const pending=latest.getAssetUrl(assetId);await waitFor(()=>expect(mockSignedUrl).toHaveBeenCalledTimes(1));
 mockRows.chat_background_assets=[];await act(async()=>{await latest.refresh();});release({data:{signedUrl:"https://example.invalid/remote-deleted"},error:null});await expect(pending).resolves.toBeNull();await view.unmount();
});

test("an asset outside the latest thirty is verified by ID and remains usable",async()=>{
 const assetId="10000000-0000-4000-8000-000000000012",asset={owner_id:A,id:assetId,source:"upload",storage_path:`${A}/${assetId}.jpg`,created_at:new Date().toISOString()};mockRows.chat_background_assets=[asset];const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
 let release!:(value:unknown)=>void;mockSignedUrl.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const pending=latest.getAssetUrl(assetId);await waitFor(()=>expect(mockSignedUrl).toHaveBeenCalledTimes(1));
 mockRows.chat_background_assets=[...Array.from({length:31},(_,i)=>({...asset,id:`new-${i}`})),asset];await act(async()=>{await latest.refresh();});release({data:{signedUrl:"https://example.invalid/valid-old-asset"},error:null});await expect(pending).resolves.toBe("https://example.invalid/valid-old-asset");await view.unmount();
});

test("another device's immutable delete event clears only its owner's asset and pending URL",async()=>{
 const assetId="10000000-0000-4000-8000-000000000013";mockRows.chat_background_assets=[{owner_id:A,id:assetId,source:"upload",storage_path:`${A}/${assetId}.jpg`,created_at:new Date().toISOString()}];const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));expect(mockMutationListener).not.toBeNull();
 let release!:(value:unknown)=>void;mockSignedUrl.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const pending=latest.getAssetUrl(assetId);await waitFor(()=>expect(mockSignedUrl).toHaveBeenCalledTimes(1));
 await act(async()=>{mockMutationListener!({new:{owner_id:B,receipt:{outcome:"deleted",asset:{id:assetId}}}});});expect(latest.assets).toHaveLength(1);
 mockRows.chat_background_assets=[];await act(async()=>{mockMutationListener!({new:{owner_id:A,receipt:{outcome:"deleted",asset:{id:assetId}}}});});expect(latest.assets).toHaveLength(0);release({data:{signedUrl:"https://example.invalid/remote-deleted"},error:null});await expect(pending).resolves.toBeNull();await view.unmount();expect(mockRemoveChannel).toHaveBeenCalled();
});

test("replication readiness closes the gap after channel join and merges repeated refresh requests",async()=>{
 const assetId="10000000-0000-4000-8000-000000000014";mockRows.chat_background_assets=[{owner_id:A,id:assetId,source:"upload",storage_path:`${A}/${assetId}.jpg`,created_at:new Date().toISOString()}];const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));expect(mockSystemListener).not.toBeNull();
 const before=mockFrom.mock.calls.filter(([table])=>table==="chat_background_settings").length;
 let release!:(value:unknown)=>void;mockHeldSettings={owner:A,promise:new Promise(resolve=>{release=resolve;})};mockRows.chat_background_assets=[];
 await act(async()=>{mockSystemListener!({extension:"postgres_changes",status:"error"});mockSystemListener!({extension:"presence",status:"ok"});});expect(mockFrom.mock.calls.filter(([table])=>table==="chat_background_settings")).toHaveLength(before);
 await act(async()=>{mockSystemListener!({extension:"postgres_changes",status:"ok"});for(let index=0;index<4;index++)mockSystemListener!({extension:"system",status:"ok"});});expect(mockFrom.mock.calls.filter(([table])=>table==="chat_background_settings")).toHaveLength(before+1);
 mockHeldSettings=null;await act(async()=>{release({data:[],error:null});});await waitFor(()=>expect(latest.assets).toHaveLength(0));expect(mockFrom.mock.calls.filter(([table])=>table==="chat_background_settings")).toHaveLength(before+2);await view.unmount();
});

test("a successful apply response arriving after deletion cannot restore its old selection",async()=>{
 const assetId="10000000-0000-4000-8000-000000000015";
 mockRows.chat_background_assets=[{owner_id:A,id:assetId,source:"upload",storage_path:`${A}/${assetId}.jpg`,created_at:new Date().toISOString()}];
 mockRows.chat_background_settings=[{owner_id:A,thread_key:"global",preset_id:"mist",asset_id:null,palette:"sage"}];
 const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
 let release!:(value:unknown)=>void;mockHeldSave=new Promise(resolve=>{release=resolve;});let pending!:Promise<unknown>;
 await act(async()=>{pending=latest.apply({presetId:null,assetId,palette:"warm"},"companion").catch(error=>error);});
 await act(async()=>{latest.acceptDeletedAsset(assetId);release({data:null,error:null});});
 expect(await pending).toEqual(expect.objectContaining({code:"background_asset_deleted"}));expect(latest.getBackground("companion").presetId).toBe("mist");expect(latest.hasOverride("companion")).toBe(false);
 await expect(latest.apply({presetId:null,assetId,palette:"warm"},"companion")).rejects.toThrow("已删除");
 expect(await AsyncStorage.getItem(`pet-chat-background-v1:${A}`)).not.toContain(assetId);await view.unmount();
});

test("cached hydration arriving after a deletion event cannot revive its selection or parent job",async()=>{
 const assetId="10000000-0000-4000-8000-000000000016",asset={id:assetId,source:"upload",storage_path:`${A}/${assetId}.jpg`,created_at:new Date().toISOString()};
 let releaseCache!:(value:string)=>void,releaseSettings!:(value:unknown)=>void;
 (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{releaseCache=resolve;}));
 mockHeldSettings={owner:A,promise:new Promise(resolve=>{releaseSettings=resolve;})};
 const view=await render(tree());await waitFor(()=>expect(mockMutationListener).not.toBeNull());
 await act(async()=>{mockMutationListener!({new:{owner_id:A,receipt:{outcome:"deleted",asset:{id:assetId}}}});});
 await act(async()=>{releaseCache(JSON.stringify({owner:A,assets:[asset],settings:{global:{presetId:"mist",assetId:null,palette:"sage"},companion:{presetId:null,assetId,palette:"warm"}},job:{request_id:"pending-edit",status:"queued",parent_asset_id:assetId}}));});
 expect(latest.assets).toHaveLength(0);expect(latest.getBackground("companion").presetId).toBe("mist");expect(latest.generation?.status).toBe("failed");expect(latest.generation?.error_code).toBe("background_parent_deleted");
 await act(async()=>{releaseSettings({data:null,error:new Error("offline")});});await waitFor(()=>expect(latest.ready).toBe(true));
 expect(latest.hasOverride("companion")).toBe(false);await expect(latest.getAssetUrl(assetId)).resolves.toBeNull();await view.unmount();
});

test("a deleted selected asset without a cached shelf entry is revalidated and removed",async()=>{
 const assetId="10000000-0000-4000-8000-000000000017";
 mockRows.chat_background_settings=[{owner_id:A,thread_key:"global",preset_id:"mist",asset_id:null,palette:"sage"},{owner_id:A,thread_key:"companion",preset_id:null,asset_id:assetId,palette:"warm"}];
 const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
 expect(latest.getBackground("companion").presetId).toBe("mist");expect(latest.hasOverride("companion")).toBe(false);await expect(latest.getAssetUrl(assetId)).resolves.toBeNull();await view.unmount();
});

test("a channel rejoin reconciles a deletion whose mutation event was missed while disconnected",async()=>{
 const assetId="10000000-0000-4000-8000-000000000018";
 mockRows.chat_background_assets=[{owner_id:A,id:assetId,source:"upload",storage_path:`${A}/${assetId}.jpg`,created_at:new Date().toISOString()}];
 mockRows.chat_background_settings=[{owner_id:A,thread_key:"companion",preset_id:null,asset_id:assetId,palette:"warm"}];
 const view=await render(tree());await waitFor(()=>expect(latest.ready).toBe(true));
 let release!:(value:unknown)=>void;mockSignedUrl.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const pending=latest.getAssetUrl(assetId);await waitFor(()=>expect(mockSignedUrl).toHaveBeenCalledTimes(1));
 await act(async()=>{mockSubscriptionListener!("TIMED_OUT");});mockRows.chat_background_assets=[];mockRows.chat_background_settings=[];
 await act(async()=>{mockSubscriptionListener!("SUBSCRIBED");});
 expect(latest.assets).toHaveLength(0);expect(latest.getBackground("companion").presetId).toBe("paper");
 release({data:{signedUrl:"https://example.invalid/missed-delete"},error:null});await expect(pending).resolves.toBeNull();await view.unmount();
});
