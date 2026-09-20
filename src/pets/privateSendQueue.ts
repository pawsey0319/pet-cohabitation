import AsyncStorage from "@react-native-async-storage/async-storage";
import { removeStabilizedMedia } from "../chat/mediaFile";
import { parseVisionAttachment, type VisionAttachment, type VisionAsset } from "../vision/types";
import { clearVisionLocalData } from "../vision/localFiles";
import { clearPrivateDraft } from "./privateDraft";

export type PrivateQueuedSend = {id:string;content:string;status:"queued"|"sending"|"failed";error?:string;attachment?:VisionAttachment;attachmentInvalid?:boolean};
type Sender = (row:PrivateQueuedSend,signal:AbortSignal)=>Promise<void>;
const key=(owner:string)=>`pet-private-send-queue-v1:${owner}`;
const queues=new Map<string,PrivateSendQueue>();

export class PrivateSendQueue {
  private rows:PrivateQueuedSend[]=[];
  private loaded:Promise<void>|null=null;
  private writes:Promise<unknown>=Promise.resolve();
  private draining:Promise<void>|null=null;
  private sender:Sender|null=null;
  private listeners=new Set<(rows:readonly PrivateQueuedSend[])=>void>();
  private cleared=false;
  private controllers=new Map<string,AbortController>();
  constructor(readonly owner:string){}
  async load():Promise<void>{
    if(!this.loaded)this.loaded=(async()=>{
      const raw=await AsyncStorage.getItem(key(this.owner));if(this.cleared)return;
      try {
        const value:unknown=raw?JSON.parse(raw):[];const seen=new Set<string>();
        this.rows=Array.isArray(value)?value.flatMap<PrivateQueuedSend>((row)=>{
          if(typeof row?.id!=="string"||!row.id||typeof row.content!=="string"||seen.has(row.id))return [];
          seen.add(row.id);
          const attachment=parseVisionAttachment(row.attachment);
          if((row.attachment&&!attachment)||row.attachmentInvalid)return [{id:row.id,content:row.content,status:"failed" as const,error:"图片草稿已无法恢复，请重新选择。",attachmentInvalid:true}];
          return [{id:row.id,content:row.content,status:row.status==="failed"?"failed" as const:"queued" as const,...(typeof row.error==="string"?{error:row.error}:{}),...(attachment?{attachment}:{})}];
        }):[];
      }catch{this.rows=[];}
      this.emit();
    })().catch(error=>{this.loaded=null;throw error;});
    return this.loaded;
  }
  snapshot():readonly PrivateQueuedSend[]{return this.rows.map(row=>({...row}));}
  subscribe(callback:(rows:readonly PrivateQueuedSend[])=>void):()=>void{this.listeners.add(callback);callback(this.snapshot());return()=>this.listeners.delete(callback);}
  private emit(){for(const callback of this.listeners)callback(this.snapshot());}
  private assertActive(){if(this.cleared)throw new Error("账号已退出");}
  private save():Promise<unknown>{
    const raw=JSON.stringify(this.rows);
    this.writes=this.writes.catch(()=>undefined).then(async()=>{if(!this.cleared)await AsyncStorage.setItem(key(this.owner),raw);});
    this.emit();return this.writes;
  }
  async enqueue(id:string,content:string,attachment?:VisionAttachment):Promise<void>{
    await this.load();this.assertActive();
    if(!id||!content.trim())throw new Error("消息不能为空");
    const row=this.rows.find(r=>r.id===id);
    if(row){if(row.attachmentInvalid)throw new Error("图片草稿已无法恢复，请重新选择。");if(row.content!==content||row.attachment?.uploadId!==attachment?.uploadId||row.attachment?.uri!==attachment?.uri)throw new Error("同一请求不能替换内容或图片");if(row.status==="failed"){row.status="queued";row.error=undefined;}}
    else this.rows.push({id,content,status:"queued",...(attachment?{attachment:{...attachment,asset:attachment.asset?{...attachment.asset}:undefined}}:{})});
    await this.save();this.assertActive();
  }
  async retry(id:string):Promise<void>{await this.load();this.assertActive();const row=this.rows.find(r=>r.id===id);if(row?.attachmentInvalid)throw new Error("图片草稿已无法恢复，请重新选择。");if(row?.status==="failed"){row.status="queued";row.error=undefined;await this.save();}}
  async recordUploaded(id:string,asset:VisionAsset):Promise<boolean>{await this.load();this.assertActive();const row=this.rows.find(r=>r.id===id);if(!row?.attachment)return false;if(row.attachment.uploadId!==asset.id||(row.attachment.asset&&row.attachment.asset.version!==asset.version))throw new Error("同一请求不能替换图片");row.attachment={...row.attachment,asset};await this.save();return !this.cleared&&this.rows.includes(row);}
  async remove(id:string):Promise<void>{await this.load();this.assertActive();this.controllers.get(id)?.abort();const row=this.rows.find(r=>r.id===id);this.rows=this.rows.filter(r=>r.id!==id);await this.save();if(row?.attachment?.uri)await removeStabilizedMedia(row.attachment.uri).catch(()=>undefined);}
  async acknowledgeCompleted(ids:readonly string[]):Promise<void>{
    await this.load();this.assertActive();const completed=new Set(ids),removed=this.rows.filter(row=>completed.has(row.id));if(!removed.length)return;
    this.rows=this.rows.filter(row=>!completed.has(row.id));
    // The authoritative reply is already present. Stop local waiting only;
    // this never sends a cancellation or a new business request to the server.
    for(const row of removed)this.controllers.get(row.id)?.abort();
    await this.save();await Promise.all(removed.flatMap(row=>row.attachment?.uri?[removeStabilizedMedia(row.attachment.uri).catch(()=>undefined)]:[]));
  }
  flush(send:Sender):Promise<void>{
    this.sender=send;
    if(this.draining)return this.draining;
    this.draining=(async()=>{
      await this.load();
      while(!this.cleared){
        const row=this.rows[0];if(!row||row.status==="failed")break;
        // Persist the immutable request before any network call. A restart retries its original ID.
        row.status="sending";
        try{await this.save();}catch(error){row.status="failed";row.error="消息尚未保存到本机，请重试。";this.emit();throw error;}
        if(this.cleared)return;
        if(this.rows[0]!==row)continue;
        const activeSender=this.sender!;
        const controller=new AbortController();this.controllers.set(row.id,controller);
        try{
          await activeSender({...row},controller.signal);if(this.cleared)return;
          this.rows=this.rows.filter(r=>r.id!==row.id);await this.save();
          if(row.attachment?.uri)await removeStabilizedMedia(row.attachment.uri).catch(()=>undefined);
        }catch(reason){
          if(this.cleared)return;
          const paused=reason instanceof Error&&reason.name==="QueuePaused";
          const current=this.rows.find(r=>r.id===row.id);
          if(current){current.status=paused?"queued":"failed";current.error=paused?undefined:reason instanceof Error?reason.message:"暂时未完成，可以重试。";await this.save();}
          // A new screen may attach while the old sender is unwinding. Resume only with its new callback.
          if(paused&&this.sender!==activeSender)continue;
          if(!current)continue;break;
        }finally{if(this.controllers.get(row.id)===controller)this.controllers.delete(row.id);}
      }
    })().finally(()=>{this.draining=null;});return this.draining;
  }
  async clear():Promise<void>{this.cleared=true;this.sender=null;for(const controller of this.controllers.values())controller.abort();this.controllers.clear();const images=this.rows.flatMap(row=>row.attachment?.uri?[row.attachment.uri]:[]);this.rows=[];this.emit();await this.writes.catch(()=>undefined);await AsyncStorage.removeItem(key(this.owner));await Promise.all(images.map(uri=>removeStabilizedMedia(uri).catch(()=>undefined)));}
}
export function privateSendQueue(owner:string):PrivateSendQueue{let queue=queues.get(owner);if(!queue){queue=new PrivateSendQueue(owner);queues.set(owner,queue);}return queue;}
export async function clearPrivateSendQueue(owner:string):Promise<void>{const queue=queues.get(owner);if(queue)await queue.clear();else await AsyncStorage.removeItem(key(owner));await clearPrivateDraft(owner);await clearVisionLocalData(owner);if(queues.get(owner)===queue)queues.delete(owner);}
