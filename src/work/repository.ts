import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as ImagePicker from "expo-image-picker";
import { requireSupabase, isLocalDemoMode } from "../lib/supabase";
import { createRequestId } from "../lib/uuid";
import { canQueueOffline, optimisticWorkItem } from "./domain";
import type { WorkAuthorization,WorkDetail,WorkInput,WorkItem,WorkReceipt,WorkRequest,WorkSuggestion } from "./types";

export const workStorageKey=(ownerId:string)=>`pet-work-v1:${ownerId}`;
export const workRecoveryStorageKey=(ownerId:string)=>`${workStorageKey(ownerId)}:recovery`;
export const WORK_CACHE_ERROR="本地事项数据暂时无法读取，原数据已保留。";
export type PendingWork={request:WorkRequest;local:WorkItem;state:"pending"|"conflict";error?:string;server?:WorkItem};
type WorkStore={items:WorkItem[];pending:PendingWork[]};
const listeners=new Map<string,Set<()=>void>>();const epochs=new Map<string,number>();const locks=new Map<string,Promise<unknown>>();
function emit(owner:string){listeners.get(owner)?.forEach(listener=>listener());}
function serial<T>(owner:string,action:()=>Promise<T>):Promise<T>{const promise=(locks.get(owner)??Promise.resolve()).catch(()=>undefined).then(action);locks.set(owner,promise);return promise;}
function readableItem(value:unknown):value is WorkItem {
  if(!value||typeof value!=="object")return false;
  const item=value as WorkItem;
  return [item.id,item.title,item.description,item.status,item.kind,item.updated_at].every(field=>typeof field==="string")&&Array.isArray(item.participants)&&item.participants.every(id=>typeof id==="string")&&(item.space_id===null||typeof item.space_id==="string")&&(item.due_at===null||typeof item.due_at==="string");
}
async function read(owner:string):Promise<WorkStore>{
  const raw=await AsyncStorage.getItem(workStorageKey(owner));if(!raw)return {items:[],pending:[]};
  try{
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("invalid cache");
    // Missing lists are empty, but unrecognized data must never reach rendering
    // or be overwritten while it may contain unsynced personal edits.
    const items=parsed.items===undefined?[]:parsed.items,pending=parsed.pending===undefined?[]:parsed.pending;
    if(!Array.isArray(items)||!items.every(readableItem)||!Array.isArray(pending)||!pending.every(entry=>entry&&readableItem(entry.local)&&entry.request&&typeof entry.request.request_id==="string"&&entry.request.input&&["pending","conflict"].includes(entry.state)))throw new Error("invalid cache");
    return {items,pending};
  }catch{throw new Error(WORK_CACHE_ERROR);}
}
async function save(owner:string,store:WorkStore,epoch:number){if((epochs.get(owner)??0)!==epoch)return;await AsyncStorage.setItem(workStorageKey(owner),JSON.stringify(store));emit(owner);}
export async function clearWorkData(owner:string){epochs.set(owner,(epochs.get(owner)??0)+1);await serial(owner,async()=>{await AsyncStorage.removeItem(workStorageKey(owner));await AsyncStorage.removeItem(workRecoveryStorageKey(owner));});emit(owner);}
export async function exportLocalWorkData(owner:string){return read(owner);}
/** Raw backups remain owner-scoped, and can be exported for recovery before logout. */
export async function exportWorkRecoveryData(owner:string):Promise<{at:string;raw:string}[]>{const raw=await AsyncStorage.getItem(workRecoveryStorageKey(owner));return raw?JSON.parse(raw):[];}
export async function recoverWorkCache(owner:string){
  const epoch=epochs.get(owner)??0;
  if(!await workOnline())throw new Error("请联网后重新加载云端事项，原本地数据仍保留。");
  await serial(owner,async()=>{
    if((epochs.get(owner)??0)!==epoch)throw new Error("账号已切换，请重新打开事项。");
    const raw=await AsyncStorage.getItem(workStorageKey(owner));
    // A background sync may already have repaired the cache. Never reset valid
    // pending edits, and never replace anything until its backup write succeeds.
    try{await read(owner);return;}catch(reason){if(!(reason instanceof Error)||reason.message!==WORK_CACHE_ERROR)throw reason;}
    const backups=await exportWorkRecoveryData(owner);
    if(!Array.isArray(backups))throw new Error("本地备份暂时无法读取，原数据未更改。");
    await AsyncStorage.setItem(workRecoveryStorageKey(owner),JSON.stringify([...backups,{at:new Date().toISOString(),raw:raw!}]));
    if((epochs.get(owner)??0)!==epoch)throw new Error("账号已切换，请重新打开事项。");
    await save(owner,{items:[],pending:[]},epoch);
  });
  return syncWork(owner);
}
export function subscribeWorkData(owner:string,listener:()=>void){const set=listeners.get(owner)??new Set();set.add(listener);listeners.set(owner,set);return ()=>{set.delete(listener);};}
export async function cachedWorkItems(owner:string){return (await read(owner)).items;}
export async function pendingWork(owner:string){return (await read(owner)).pending;}
export async function workOnline(){if(isLocalDemoMode)return false;const state=await NetInfo.fetch();return state.isConnected!==false&&state.isInternetReachable!==false;}
const networkError=(reason:unknown)=>reason instanceof Error&&/Failed to fetch|Network request failed|FunctionsFetchError|network|fetch failed/i.test(`${reason.name} ${reason.message}`);
export async function invokeWork<T>(name:string,body:unknown):Promise<T>{
  const client=requireSupabase();const session=await client.auth.getSession();if(!session.data.session)throw new Error("请重新登录");
  const {data,error}=await client.functions.invoke(name,{body:body as Record<string,unknown>,headers:{Authorization:`Bearer ${session.data.session.access_token}`}});
  if(error){let message=error.message;try{const parsed=await error.context?.json();if(parsed?.error)message=parsed.error;}catch{/* Keep transport classification. */}const reason=new Error(message);reason.name=error.name;throw reason;}
  if(data?.error)throw new Error(data.error);return data as T;
}
function mergeItem(store:WorkStore,item:WorkItem){store.items=[item,...store.items.filter(old=>old.id!==item.id)];}
export function submitWork(owner:string,request:WorkRequest):Promise<WorkReceipt>{return serial(owner,async()=>{
  const epoch=epochs.get(owner)??0;const store=await read(owner);const current=store.items.find(item=>item.id===request.item_id);
  // A lost response must not change the client-generated item ID on retry.
  const normalized={...request,item_id:request.item_id??(request.action==="create"?request.request_id:undefined)};
  const queue=async()=>{if(!canQueueOffline(normalized,current))throw new Error("群协作需要联网确认");const duplicate=store.pending.find(item=>item.request.request_id===request.request_id);if(duplicate){if(JSON.stringify(duplicate.request)!==JSON.stringify(normalized))throw new Error("work_request_conflict");return {item:duplicate.local,outcome:"pending_sync"} as WorkReceipt;}
    const local=optimisticWorkItem(owner,normalized,current);store.pending.push({request:normalized,local,state:"pending"});mergeItem(store,local);await save(owner,store,epoch);return {item:local,outcome:"pending_sync"} as WorkReceipt;};
  if(!await workOnline()||store.pending.some(item=>item.local.id===normalized.item_id))return queue();
  try{const result=await invokeWork<WorkReceipt>("work-items",normalized);mergeItem(store,result.item);await save(owner,store,epoch);return result;}
  catch(reason){if(networkError(reason))return queue();throw reason;}
});}
export function syncWork(owner:string):Promise<{items:WorkItem[];conflicts:number;authorizedSpaceIds?:string[]}>{return serial(owner,async()=>{
  const epoch=epochs.get(owner)??0;const store=await read(owner);if(!await workOnline())return {items:store.items,conflicts:store.pending.filter(p=>p.state==="conflict").length};
  const blocked=new Set<string>();
  for(const entry of [...store.pending]){
    if(entry.state==="conflict"||blocked.has(entry.local.id)){blocked.add(entry.local.id);continue;}
    try{const result=await invokeWork<WorkReceipt>("work-items",entry.request);store.pending=store.pending.filter(p=>p.request.request_id!==entry.request.request_id);mergeItem(store,result.item);await save(owner,store,epoch);}
    catch(reason){if(networkError(reason))break;entry.state="conflict";entry.error=reason instanceof Error?reason.message:"同步失败";entry.local.sync_state="conflict";blocked.add(entry.local.id);mergeItem(store,entry.local);await save(owner,store,epoch);}
  }
  const items:WorkItem[]=[];let cursor:{updated_at:string;id:string}|null=null;let authorized:string[]=[];let verified=false;
  try{do{const page:{items:WorkItem[];cursor:{updated_at:string;id:string}|null;authorized_space_ids:string[]}=await invokeWork("work-items",{action:"list",...(cursor?{cursor}:{})});if(!Array.isArray(page?.items)||!page.items.every(readableItem)||!Array.isArray(page.authorized_space_ids))throw new Error("事项数据暂时无法读取，请稍后重试。");items.push(...page.items);cursor=page.cursor;authorized=page.authorized_space_ids;}while(cursor);
    store.items=items.filter(item=>!item.space_id||authorized.includes(item.space_id));verified=true;
    for(const entry of store.pending){entry.server=items.find(item=>item.id===entry.local.id);mergeItem(store,entry.local);}await save(owner,store,epoch);
  }catch(reason){if(!networkError(reason))throw reason;}
  return {items:store.items,conflicts:store.pending.filter(p=>p.state==="conflict").length,...(verified?{authorizedSpaceIds:authorized}:{})};
});}
export async function getWorkDetail(owner:string,itemId:string):Promise<WorkDetail>{
  const store=await read(owner);const local=store.items.find(item=>item.id===itemId);
  if(!await workOnline()||store.pending.some(p=>p.local.id===itemId)){if(!local)throw new Error("此事项尚未缓存");return {item:local,confirmations:[],materials:[],activity:[],children:store.items.filter(item=>item.parent_id===itemId)};}
  return invokeWork<WorkDetail>("work-items",{action:"get",item_id:itemId});
}
export function resolveWorkConflict(owner:string,itemId:string,choice:"keep_server"|"apply_local"):Promise<void>{return serial(owner,async()=>{
  const epoch=epochs.get(owner)??0;const store=await read(owner);const entries=store.pending.filter(entry=>entry.local.id===itemId);if(!entries.length)return;
  const last=entries.at(-1)!;const server=last.server??entries.find(entry=>entry.server)?.server;
  if(choice==="apply_local"){
    if(!server)throw new Error("服务端事项已不可用，请复制本地内容后新建");
    const input:WorkInput={title:last.local.title,description:last.local.description,due_at:last.local.due_at};
    const edit:WorkRequest={action:"edit",request_id:createRequestId(),item_id:itemId,expected_version:server.version,input};
    store.pending=store.pending.filter(entry=>entry.local.id!==itemId);const updated=optimisticWorkItem(owner,edit,server);store.pending.push({request:edit,local:updated,state:"pending"});
    if(last.local.status!==server.status&&["completed","cancelled","in_progress"].includes(last.local.status)){const next:WorkRequest={action:last.local.status==="completed"?"complete":last.local.status==="cancelled"?"cancel":"progress",request_id:createRequestId(),item_id:itemId,expected_version:updated.version,input:{completion_note:last.local.completion_note}};const final=optimisticWorkItem(owner,next,updated);store.pending.push({request:next,local:final,state:"pending"});mergeItem(store,final);}else mergeItem(store,updated);
  }else{store.pending=store.pending.filter(entry=>entry.local.id!==itemId);store.items=store.items.filter(item=>item.id!==itemId);if(server)mergeItem(store,server);}
  await save(owner,store,epoch);
});}
export function startWorkSync(owner:string,onChange:()=>void){let disposed=false;let running=false;const sync=()=>{if(disposed||running)return;running=true;void syncWork(owner).then(()=>{if(!disposed)onChange();}).catch(()=>undefined).finally(()=>{running=false;});};
  const removeNet=NetInfo.addEventListener(state=>{if(state.isConnected&&state.isInternetReachable!==false)sync();});
  let channel:ReturnType<ReturnType<typeof requireSupabase>["channel"]>|undefined;
  // Tabs remain mounted behind a pushed group screen. Supabase reuses a channel
  // by topic, and adding handlers to that already-subscribed channel throws.
  if(!isLocalDemoMode){channel=requireSupabase().channel(`work:${owner}:${createRequestId()}`).on("postgres_changes",{event:"*",schema:"public",table:"work_items"},sync).on("postgres_changes",{event:"DELETE",schema:"public",table:"space_members",filter:`user_id=eq.${owner}`},payload=>{const spaceId=(payload.old as {space_id?:string}).space_id;void serial(owner,async()=>{const epoch=epochs.get(owner)??0;const store=await read(owner);store.items=store.items.filter(item=>!spaceId?item.space_id===null:item.space_id!==spaceId);await save(owner,store,epoch);}).then(sync).catch(()=>{if(!disposed)onChange();});}).subscribe();}
  return ()=>{disposed=true;removeNet();if(channel)void requireSupabase().removeChannel(channel);};
}
export async function chooseWorkImage(owner:string,item:WorkItem,isCompletion=false){
  if(!await workOnline()||item.sync_state)throw new Error("图片材料需要事项同步成功后联网添加");
  const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();if(!permission.granted)throw new Error("请允许访问相册，或使用文字说明");
  const selection=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:0.85});if(selection.canceled)return null;
  const asset=selection.assets[0];const mime=asset.mimeType??"image/jpeg";if(!["image/jpeg","image/png","image/webp"].includes(mime))throw new Error("支持 JPG、PNG 和 WebP 图片");
  const bytes=await(await fetch(asset.uri)).arrayBuffer();if(bytes.byteLength>8*1024*1024)throw new Error("请选择小于 8MB 的图片");
  const path=`${owner}/${item.id}/${createRequestId()}.${mime==="image/png"?"png":mime==="image/webp"?"webp":"jpg"}`;
  const uploaded=await requireSupabase().storage.from("work-materials").upload(path,bytes,{contentType:mime});if(uploaded.error)throw uploaded.error;
  return submitWork(owner,{action:"attach",request_id:createRequestId(),item_id:item.id,expected_version:item.version,input:{material:{kind:"image",content:path,is_completion:isCompletion}}});
}
export async function listWorkSuggestions(spaceId:string){return invokeWork<{authorization:WorkAuthorization;consents:{user_id:string;version:number;consented:boolean}[];suggestions:WorkSuggestion[]}>("group-work-suggestions",{action:"list",space_id:spaceId});}
