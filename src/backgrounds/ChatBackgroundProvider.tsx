import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { AppState } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { createRequestId } from "../lib/uuid";
import { readMediaForUpload } from "../chat/mediaFile";
import { BACKGROUND_BUCKET, MAX_BACKGROUND_BYTES, backgroundErrorMessage, normalizeBackground, normalizeThreadKey, resolveBackground, type BackgroundGeneration, type ChatBackgroundAsset, type ChatBackgroundSelection } from "./types";

type Store = { owner: string | null; settings: Record<string,ChatBackgroundSelection>; assets: ChatBackgroundAsset[]; job: BackgroundGeneration|null };
type Value = {
  ready: boolean; saving: boolean; error: string|null; assets: ChatBackgroundAsset[]; generation: BackgroundGeneration|null; canGenerate: boolean;
  getBackground(threadKey?:string):ChatBackgroundSelection;
  hasOverride(threadKey?:string):boolean;
  apply(selection:ChatBackgroundSelection,threadKey?:string):Promise<void>;
  resetToGlobal(threadKey:string):Promise<void>;
  generate(prompt:string,parent?:ChatBackgroundAsset):Promise<void>;
  retryConnection():Promise<void>;
  upload(uri:string):Promise<ChatBackgroundAsset>;
  getAssetUrl(assetId:string):Promise<string|null>;
  refresh():Promise<void>;
  clearLocalData():Promise<void>;
  acceptDeletedAsset(assetId:string):void;
  canEdit: boolean;
};
const Context=createContext<Value|null>(null);
const empty=(owner:string|null):Store=>({owner,settings:{},assets:[],job:null});
const storageKey=(owner:string)=>`pet-chat-background-v1:${owner}`;
const activeJob=(job:BackgroundGeneration|null)=>job?.status==="queued"||job?.status==="running"||job?.status==="uploading";

class BackgroundRequestError extends Error {
  constructor(readonly code:string,readonly definitive=false){super(backgroundErrorMessage(code));}
}
async function invoke(ownerId:string,body:Record<string,unknown>):Promise<BackgroundGeneration> {
  const client=requireSupabase();const session=await client.auth.getSession();
  if(session.error||session.data.session?.user.id!==ownerId)throw new BackgroundRequestError("unauthenticated",true);
  // Bind this request to its original owner, including during account switching.
  const {data,error}=await client.functions.invoke("generate-chat-background",{body,headers:{Authorization:`Bearer ${session.data.session.access_token}`}});
  if(error) {
    let code="network_error";let definitive=false;
    try { const response=(error as unknown as {context:Response}).context;const payload=await response.json(); if(typeof payload?.error==="string")code=payload.error;definitive=response.status>=400&&response.status<500&&response.status!==404; } catch { /* A lost response can be retried with the same request ID. */ }
    throw new BackgroundRequestError(code,definitive);
  }
  if(data?.error) throw new BackgroundRequestError(String(data.error),true);
  if(!data?.job?.request_id) throw new Error("暂时未能取得生成状态，请重试连接。");
  return data.job as BackgroundGeneration;
}

export function ChatBackgroundProvider({children}:PropsWithChildren) {
  const {profile,isLocalDemo}=useSession(); const owner=profile?.id??null;
  const ownerRef=useRef(owner); ownerRef.current=owner;
  const [store,setStore]=useState<Store>(()=>empty(owner)); const storeRef=useRef(store); storeRef.current=store;
  const [readyOwner,setReadyOwner]=useState<string|null>(null);
  const [saving,setSaving]=useState(false); const [error,setError]=useState<string|null>(null);
  const [canEdit,setCanEdit]=useState(false);
  const urlCache=useRef(new Map<string,{url:string;expires:number}>());
  const deletedAssets=useRef(new Set<string>());
  const requestedAssets=useRef(new Set<string>());
  const [assetRevision,setAssetRevision]=useState(0);
  const refreshSequence=useRef(0);
  const actionLock=useRef<string|null>(null); const writeQueue=useRef(Promise.resolve());
  const settingsVersion=useRef(0);
  const clearedOwners=useRef(new Set<string>());
  const persist=useCallback((next:Store)=>{
    if(!next.owner) return Promise.resolve();
    // Serialize snapshots: an older storage write must never overwrite a new job.
    const write=writeQueue.current.catch(()=>undefined).then(()=>clearedOwners.current.has(next.owner!)?undefined:AsyncStorage.setItem(storageKey(next.owner!),JSON.stringify(next)));
    writeQueue.current=write; return write;
  },[]);
  const adopt=useCallback((id:string,change:(current:Store)=>Store)=>{
    if(ownerRef.current!==id||clearedOwners.current.has(id)) return;
    const base=storeRef.current.owner===id?storeRef.current:empty(id); const proposed=change(base);
    // Every late state writer, including hydration and successful save responses,
    // must honor deletion receipts already accepted for this owner.
    const deleted=(assetId:string)=>deletedAssets.current.has(`${id}:${assetId}`);
    const next:Store={...proposed,assets:proposed.assets.filter(asset=>!deleted(asset.id)),settings:Object.fromEntries(Object.entries(proposed.settings).filter(([,selection])=>!selection.assetId||!deleted(selection.assetId))),job:activeJob(proposed.job)&&proposed.job?.parent_asset_id&&deleted(proposed.job.parent_asset_id)?{...proposed.job,status:"failed",error_code:"background_parent_deleted"}:proposed.job};
    storeRef.current=next; setStore(next); void persist(next).catch(()=>{if(ownerRef.current===id)setError("背景已更新，但本机保存失败，请保持网络连接。");});
  },[persist]);

  const invalidateAsset=useCallback((id:string,assetId:string)=>{
    if(ownerRef.current!==id||deletedAssets.current.has(`${id}:${assetId}`))return;
    settingsVersion.current+=1;deletedAssets.current.add(`${id}:${assetId}`);urlCache.current.delete(`${id}:${assetId}`);setAssetRevision(value=>value+1);
    adopt(id,current=>({...current,assets:current.assets.filter(asset=>asset.id!==assetId),settings:Object.fromEntries(Object.entries(current.settings).filter(([,selection])=>selection.assetId!==assetId)),job:current.job?.parent_asset_id===assetId&&activeJob(current.job)?{...current.job,status:"failed",error_code:"background_parent_deleted"}:current.job}));
  },[adopt]);

  const refresh=useCallback(async()=>{
    const id=ownerRef.current; if(!id||isLocalDemo)return;const version=settingsVersion.current,sequence=++refreshSequence.current;
    const knownIds=new Set([...(storeRef.current.owner===id?[...storeRef.current.assets.map(asset=>asset.id),...Object.values(storeRef.current.settings).flatMap(selection=>selection.assetId?[selection.assetId]:[])]:[]),...[...requestedAssets.current].filter(key=>key.startsWith(`${id}:`)).map(key=>key.slice(id.length+1))]);
    const client=requireSupabase();
    const [settings,assets,jobs]=await Promise.all([
      client.from("chat_background_settings").select("thread_key,preset_id,asset_id,palette").eq("owner_id",id),
      client.from("chat_background_assets").select("id,storage_path,source,prompt,created_at,name,favorite,version,content_version,parent_asset_id,parent_asset_version").eq("owner_id",id).order("created_at",{ascending:false}).limit(30),
      client.from("chat_background_generations").select("request_id,prompt,status,asset_id,error_code,created_at,parent_asset_id,parent_asset_version").eq("owner_id",id).order("created_at",{ascending:false}).limit(20),
    ]);
    if(ownerRef.current!==id||sequence!==refreshSequence.current)return;
    for(const result of [settings,assets,jobs])if(result.error)throw new Error("暂时未能同步背景，联网后可重试。");
    urlCache.current.clear();
    const nextSettings:Store["settings"]={};
    for(const row of settings.data??[]){const value=normalizeBackground({presetId:row.preset_id,assetId:row.asset_id,palette:row.palette});if(value&&(!value.assetId||!deletedAssets.current.has(`${id}:${value.assetId}`)))nextSettings[row.thread_key]=value;}
    // Include older applied assets even when they fall outside the candidate shelf.
    const allAssets=(assets.data??[]) as ChatBackgroundAsset[];
    const missing=[...new Set(Object.values(nextSettings).flatMap(value=>value.assetId&&!allAssets.some(asset=>asset.id===value.assetId)?[value.assetId]:[]))];
    for(const assetId of missing)knownIds.add(assetId);
    if(missing.length){const old=await client.from("chat_background_assets").select("id,storage_path,source,prompt,created_at").eq("owner_id",id).in("id",missing);if(old.error)throw new Error("背景图片暂时无法读取。");allAssets.push(...(old.data??[]) as ChatBackgroundAsset[]);}
    // A paginated shelf cannot prove an old asset was deleted. Verify every
    // previously used/requested missing ID explicitly under the owner's RLS.
    const visibleIds=new Set(allAssets.map(asset=>asset.id));const verify=[...knownIds].filter(assetId=>!visibleIds.has(assetId)&&!deletedAssets.current.has(`${id}:${assetId}`));
    for(let offset=0;offset<verify.length;offset+=50){const result=await client.from("chat_background_assets").select("id").eq("owner_id",id).in("id",verify.slice(offset,offset+50));if(result.error)throw new Error("背景图片暂时无法读取。");for(const asset of result.data??[])visibleIds.add(asset.id);}
    if(ownerRef.current!==id||sequence!==refreshSequence.current)return;
    const replaceSettings=settingsVersion.current===version&&!actionLock.current;
    for(const assetId of verify)if(!visibleIds.has(assetId))invalidateAsset(id,assetId);
    adopt(id,current=>{
      const serverJobs=(jobs.data??[]) as BackgroundGeneration[];
      const matching=current.job?serverJobs.find(job=>job.request_id===current.job!.request_id):null;
      let job=matching??(activeJob(current.job)?current.job:serverJobs.find(activeJob)??serverJobs[0]??null);
      if(activeJob(job)&&job?.parent_asset_id&&deletedAssets.current.has(`${id}:${job.parent_asset_id}`))job={...job,status:"failed",error_code:"background_parent_deleted"};
      return {...current,settings:replaceSettings?Object.fromEntries(Object.entries(nextSettings).filter(([,selection])=>!selection.assetId||!deletedAssets.current.has(`${id}:${selection.assetId}`))):current.settings,assets:allAssets.filter(asset=>!deletedAssets.current.has(`${id}:${asset.id}`)),job};
    });
  },[adopt,invalidateAsset,isLocalDemo]);

  useEffect(()=>{
    let cancelled=false; urlCache.current.clear(); actionLock.current=null; setError(null); setSaving(false); setReadyOwner(null);setCanEdit(false);
    storeRef.current=empty(owner);setStore(storeRef.current);
    if(!owner)return;
    const id=owner;
    if(!isLocalDemo)void requireSupabase().functions.invoke("generate-chat-background",{body:{action:"capabilities"}}).then(result=>{if(!cancelled&&ownerRef.current===id)setCanEdit(result.data?.editing_available===true);}).catch(()=>undefined);
    void (async()=>{
      try{
        const raw=await AsyncStorage.getItem(storageKey(id));
        if(cancelled||ownerRef.current!==id)return;
        if(raw){const saved=JSON.parse(raw) as Store;if(saved.owner===id){const settings:Store["settings"]={};for(const [key,value]of Object.entries(saved.settings??{})){try{const parsed=normalizeBackground(value);if(parsed)settings[normalizeThreadKey(key,isLocalDemo)]=parsed;}catch{}}const next={owner:id,settings,assets:Array.isArray(saved.assets)?saved.assets:[],job:saved.job??null};adopt(id,()=>next);}}
        if(!isLocalDemo)await refresh();
      }catch{if(!cancelled&&ownerRef.current===id)setError("暂时未能同步背景，已保留本机设置。");}
      finally{if(!cancelled&&ownerRef.current===id)setReadyOwner(id);}
    })();
    return()=>{cancelled=true;};
  },[owner,isLocalDemo,refresh,adopt]);

  const updateJob=useCallback(async(id:string,job:BackgroundGeneration)=>{
    if(ownerRef.current!==id)return;
    // A response for an earlier candidate cannot replace a newer request.
    if(storeRef.current.job?.request_id!==job.request_id)return;
    if(!activeJob(storeRef.current.job)&&activeJob(job))return;
    adopt(id,current=>({...current,job}));setError(null);
    if(job.status==="succeeded")await refresh();
  },[adopt,refresh]);

  useEffect(()=>{
    if(!owner||isLocalDemo||store.owner!==owner||!activeJob(store.job))return;
    const id=owner;const requestId=store.job!.request_id;let busy=false;let closed=false;
    const poll=async()=>{
      if(busy||closed||ownerRef.current!==id)return;busy=true;
      try{const job=await invoke(id,{action:"status",request_id:requestId});if(!closed)await updateJob(id,job);}
      catch(reason){if(!closed&&ownerRef.current===id)setError(reason instanceof Error?reason.message:"暂时连接不上，恢复网络后会继续查询。");}
      finally{busy=false;}
    };
    const timer=setInterval(()=>{void poll();},5000);void poll();
    const listener=AppState.addEventListener("change",state=>{if(state==="active")void poll();});
    return()=>{closed=true;clearInterval(timer);listener.remove();};
  },[owner,isLocalDemo,store.owner,store.job?.request_id,store.job?.status,updateJob]);

  useEffect(()=>{
    const listener=AppState.addEventListener("change",state=>{if(state==="active"&&!actionLock.current)void refresh().catch(()=>undefined);});
    return()=>listener.remove();
  },[refresh]);

  const apply=useCallback(async(selection:ChatBackgroundSelection,threadKey?:string)=>{
    const id=ownerRef.current; if(!id)throw new Error("请先登录。");
    if(readyOwner!==id)throw new Error("背景设置正在读取，请稍候。");
    const key=normalizeThreadKey(threadKey,isLocalDemo);const value=normalizeBackground(selection);if(!value)throw new Error("请选择一个背景。");
    if(value.assetId&&deletedAssets.current.has(`${id}:${value.assetId}`))throw new BackgroundRequestError("background_asset_deleted",true);
    if(actionLock.current)throw new Error("正在保存，请稍候。");
    actionLock.current=id;settingsVersion.current+=1;setSaving(true);setError(null);
    try{
      if(!isLocalDemo){const result=await requireSupabase().from("chat_background_settings").upsert({owner_id:id,thread_key:key,preset_id:value.presetId,asset_id:value.assetId,palette:value.palette,updated_at:new Date().toISOString()},{onConflict:"owner_id,thread_key"});if(result.error)throw new Error("保存未完成，请检查网络后重试。");}
      if(ownerRef.current!==id)return;
      if(value.assetId&&deletedAssets.current.has(`${id}:${value.assetId}`))throw new BackgroundRequestError("background_asset_deleted",true);
      adopt(id,current=>({...current,settings:{...current.settings,[key]:value}}));await persist(storeRef.current);
    }finally{if(ownerRef.current===id){actionLock.current=null;setSaving(false);}}
  },[adopt,isLocalDemo,persist,readyOwner]);

  const resetToGlobal=useCallback(async(threadKey:string)=>{
    const id=ownerRef.current;if(!id)throw new Error("请先登录。");const key=normalizeThreadKey(threadKey,isLocalDemo);if(key==="global")throw new Error("请选择默认背景以重置全部聊天。");
    if(readyOwner!==id)throw new Error("背景设置正在读取，请稍候。");
    if(actionLock.current)throw new Error("正在保存，请稍候。");actionLock.current=id;settingsVersion.current+=1;setSaving(true);
    try{
      if(!isLocalDemo){const result=await requireSupabase().from("chat_background_settings").delete().eq("owner_id",id).eq("thread_key",key);if(result.error)throw new Error("保存未完成，请检查网络后重试。");}
      if(ownerRef.current!==id)return;
      adopt(id,current=>{const settings={...current.settings};delete settings[key];return {...current,settings};});await persist(storeRef.current);
    }finally{if(ownerRef.current===id){actionLock.current=null;setSaving(false);}}
  },[adopt,isLocalDemo,persist,readyOwner]);

  const generate=useCallback(async(prompt:string,parent?:ChatBackgroundAsset)=>{
    const id=ownerRef.current;if(!id||isLocalDemo)throw new Error("请登录后使用 AI 设计。");
    if(readyOwner!==id)throw new Error("背景设置正在读取，请稍候。");
    const text=prompt.trim();if(text.length<4||text.length>600)throw new Error("用 4～600 个字描述你想要的背景。");
    if(activeJob(storeRef.current.job))throw new Error("还有一张背景正在生成，请等待完成。");
    if(parent&&!canEdit)throw new Error(backgroundErrorMessage("background_edit_unavailable"));
    const parentInput=parent?{parent_asset_id:parent.id,parent_asset_version:parent.content_version??1}:{};
    const pending:BackgroundGeneration={request_id:createRequestId(),prompt:text,status:"queued",asset_id:null,error_code:null,created_at:new Date().toISOString(),...parentInput};
    adopt(id,current=>({...current,job:pending}));await persist(storeRef.current);setError(null);
    if(ownerRef.current!==id)return;
    try{await updateJob(id,await invoke(id,{action:"generate",request_id:pending.request_id,prompt:text,...parentInput}));}
    catch(reason){if(ownerRef.current===id){if(reason instanceof BackgroundRequestError&&reason.definitive)adopt(id,current=>current.job?.request_id===pending.request_id?{...current,job:{...pending,status:"failed",error_code:reason.code}}:current);setError(reason instanceof Error?reason.message:"暂时连接不上，请重试连接。");}throw reason;}
  },[adopt,isLocalDemo,persist,readyOwner,updateJob,canEdit]);

  const retryConnection=useCallback(async()=>{
    const id=ownerRef.current;const job=storeRef.current.job;if(!id||!job||isLocalDemo)return;
    try{await updateJob(id,await invoke(id,{action:"generate",request_id:job.request_id,prompt:job.prompt,...(job.parent_asset_id?{parent_asset_id:job.parent_asset_id,parent_asset_version:job.parent_asset_version}:{} )}));}
    catch(reason){if(reason instanceof BackgroundRequestError&&reason.definitive)adopt(id,current=>current.job?.request_id===job.request_id?{...current,job:{...job,status:"failed",error_code:reason.code}}:current);throw reason;}
  },[adopt,isLocalDemo,updateJob]);

  const upload=useCallback(async(uri:string):Promise<ChatBackgroundAsset>=>{
    const id=ownerRef.current;if(!id||isLocalDemo)throw new Error("请登录后保存图片背景。");
    if(readyOwner!==id)throw new Error("背景设置正在读取，请稍候。");
    const converted=await ImageManipulator.manipulateAsync(uri,[{resize:{width:1080}}],{compress:0.86,format:ImageManipulator.SaveFormat.JPEG});
    const media=await readMediaForUpload(converted.uri,MAX_BACKGROUND_BYTES);if(ownerRef.current!==id)throw new Error("账号已切换，请重新选择图片。");
    const assetId=createRequestId();const path=`${id}/${assetId}.jpg`;const client=requireSupabase();
    const uploaded=await client.storage.from(BACKGROUND_BUCKET).upload(path,media.body,{contentType:"image/jpeg",upsert:false});if(uploaded.error)throw new Error("图片上传未完成，请检查网络后重试。");
    const asset:ChatBackgroundAsset={id:assetId,storage_path:path,source:"upload",prompt:null,created_at:new Date().toISOString()};
    const saved=await client.from("chat_background_assets").insert({...asset,owner_id:id});
    if(saved.error){await client.storage.from(BACKGROUND_BUCKET).remove([path]);throw new Error("图片保存未完成，请重试。");}
    if(ownerRef.current!==id)throw new Error("账号已切换，请重新打开背景设置。");
    adopt(id,current=>({...current,assets:[asset,...current.assets]}));return asset;
  },[adopt,isLocalDemo,readyOwner]);

  const getAssetUrl=useCallback(async(assetId:string)=>{
    const id=ownerRef.current;if(!id||isLocalDemo)return null;
    const key=`${id}:${assetId}`;requestedAssets.current.add(key);if(deletedAssets.current.has(key)||clearedOwners.current.has(id))return null;const cached=urlCache.current.get(key);if(cached&&cached.expires>Date.now())return cached.url;
    let asset=storeRef.current.owner===id?storeRef.current.assets.find(item=>item.id===assetId):null;
    if(!asset){const result=await requireSupabase().from("chat_background_assets").select("id,storage_path,source,prompt,created_at").eq("id",assetId).eq("owner_id",id).maybeSingle();if(result.error||!result.data)return null;asset=result.data as ChatBackgroundAsset;}
    if(!asset.storage_path.startsWith(`${id}/`)||ownerRef.current!==id||deletedAssets.current.has(key))return null;
    const signed=await requireSupabase().storage.from(BACKGROUND_BUCKET).createSignedUrl(asset.storage_path,3600);if(signed.error||ownerRef.current!==id||deletedAssets.current.has(key)||clearedOwners.current.has(id))return null;
    urlCache.current.set(key,{url:signed.data.signedUrl,expires:Date.now()+50*60_000});return signed.data.signedUrl;
  },[isLocalDemo,assetRevision]);

  const clearLocalData=useCallback(async()=>{
    const id=ownerRef.current;if(!id)return;
    clearedOwners.current.add(id);urlCache.current.clear();
    storeRef.current=empty(id);setStore(storeRef.current);
    await writeQueue.current.catch(()=>undefined);
    await AsyncStorage.removeItem(storageKey(id));
  },[]);

  // Called only after the server's deletion receipt. Applying the receipt locally
  // remains reliable even if the subsequent library refresh loses its connection.
  const acceptDeletedAsset=useCallback((assetId:string)=>{
    const id=ownerRef.current;if(id)invalidateAsset(id,assetId);
  },[invalidateAsset]);

  useEffect(()=>{
    if(!owner||isLocalDemo)return;const id=owner,client=requireSupabase();if(typeof client.channel!=="function")return;
    let closed=false,running=false,pending=false;
    const synchronize=()=>{if(closed||ownerRef.current!==id)return;if(running){pending=true;return;}running=true;void refresh().catch(()=>undefined).finally(()=>{running=false;if(pending){pending=false;synchronize();}});};
    const channel=client.channel(`background-changes:${id}`,{config:{broadcast:{replication_ready:true}}}).on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_background_mutations",filter:`owner_id=eq.${id}`},event=>{
      if(closed||ownerRef.current!==id||event.new.owner_id!==id)return;
      const receipt=event.new.receipt,assetId=receipt?.asset?.id;
      if(receipt?.outcome==="deleted"&&typeof assetId==="string"&&/^[0-9a-f-]{36}$/i.test(assetId))invalidateAsset(id,assetId);
      synchronize();
    }).on("postgres_changes",{event:"*",schema:"public",table:"chat_background_settings",filter:`owner_id=eq.${id}`},synchronize)
      .on("postgres_changes",{event:"*",schema:"public",table:"chat_background_generations",filter:`owner_id=eq.${id}`},synchronize)
      .on("system",{},event=>{
      // Joining can precede WAL replication readiness; reconcile the intervening changes.
      if(event.status==="ok"&&(event.extension==="postgres_changes"||event.extension==="system"))synchronize();
    }).subscribe(status=>{if(status==="SUBSCRIBED")synchronize();});
    return()=>{closed=true;void client.removeChannel(channel);};
  },[owner,isLocalDemo,refresh,invalidateAsset]);

  const visible=store.owner===owner?store:empty(owner);
  const value=useMemo<Value>(()=>({ready:!!owner&&readyOwner===owner,saving,error,assets:visible.assets,generation:visible.job,canGenerate:!!owner&&readyOwner===owner&&!isLocalDemo,getBackground:key=>resolveBackground(visible.settings,key,isLocalDemo),hasOverride:key=>Object.hasOwn(visible.settings,key??"global"),apply,resetToGlobal,generate,retryConnection,upload,getAssetUrl,refresh,clearLocalData,acceptDeletedAsset,canEdit}),[owner,readyOwner,saving,error,visible,isLocalDemo,apply,resetToGlobal,generate,retryConnection,upload,getAssetUrl,refresh,clearLocalData,acceptDeletedAsset,canEdit]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChatBackground():Value {const value=useContext(Context);if(!value)throw new Error("useChatBackground must be used inside ChatBackgroundProvider");return value;}
